import express from 'express';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import Fuse, { type IFuseOptions } from 'fuse.js';
import { loadResults, getResultsFilePath, scrapeAllResults, scrapePlus500Results, saveResults, type EventId } from './scraper.js';
import { loadState, monitor, formatStatusMessage } from './monitor.js';
import { sendNotification, isTwilioConfigured } from './notifications/index.js';
import type { RaceResult } from './types.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Rate limiting middleware
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 search requests per minute
  message: 'Too many search requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Fuse.js configuration for fuzzy search
const FUSE_OPTIONS: IFuseOptions<RaceResult & { race: string }> = {
  keys: ['name'],
  threshold: 0.4,
  includeScore: true,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

// Helper function to parse event ID from query parameter
function getEventId(req: express.Request): EventId {
  const eventParam = (req.query.event as string || '').toLowerCase();
  if (eventParam === 'plus500') {
    return 'plus500';
  }
  return 'dcs'; // Default to 'dcs'
}

// CORS middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Apply rate limiting to API routes
app.use('/api/', apiLimiter);

// API: Health check (public, no auth required)
app.get('/api/health', (_req, res) => {
  const twilioConfig = {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    whatsappFrom: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
  };
  const notifyWhatsapp = process.env.NOTIFY_WHATSAPP || '';
  const isTwilioConfigured = twilioConfig.accountSid && twilioConfig.authToken;

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    twilioConfigured: isTwilioConfigured,
    notifyWhatsappSet: !!notifyWhatsapp,
    readyForHeartbeat: isTwilioConfigured && !!notifyWhatsapp,
  });
});

// API: Get current status
app.get('/api/status', (req, res) => {
  const state = loadState();
  const eventId = getEventId(req);
  const data = loadResults(eventId);

  res.json({
    monitor: state,
    hasResults: !!data,
    resultCount: data
      ? data.categories.halfMarathon.length + data.categories.tenKm.length
      : 0,
    scrapedAt: data?.scrapedAt || null,
    eventName: data?.eventName || null,
    eventId,
  });
});

// API: Search results
app.get('/api/search', searchLimiter, (req, res) => {
  // Input validation
  let query = (req.query.q as string || '').trim();
  
  // Limit query length to prevent performance issues
  if (query.length > 100) {
    query = query.substring(0, 100);
  }

  // Sanitize query - remove potentially dangerous characters
  query = query.replace(/[<>]/g, '');

  if (!query || query.length < 2) {
    return res.json({ query: '', results: [], total: 0, limit: 20 });
  }

  const eventId = getEventId(req);
  const data = loadResults(eventId);
  if (!data) {
    return res.json({
      query,
      results: [],
      total: 0,
      limit: 20,
      error: 'No results available yet. Check back later.',
    });
  }

  // Get race filter from query parameter
  const raceParam = (req.query.race as string || '').toLowerCase();
  const raceFilter = raceParam === '10km' || raceParam === '10k' ? 'tenKm' :
                     raceParam === 'half marathon' || raceParam === 'half' ? 'halfMarathon' : 'all';

  // Filter results by race type before searching
  let resultsToSearch: (RaceResult & { race: string })[] = [];
  
  if (raceFilter === 'halfMarathon' || raceFilter === 'all') {
    resultsToSearch.push(...data.categories.halfMarathon.map(r => ({ ...r, race: 'Half Marathon' })));
  }
  if (raceFilter === 'tenKm' || raceFilter === 'all') {
    resultsToSearch.push(...data.categories.tenKm.map(r => ({ ...r, race: '10km' })));
  }

  const fuse = new Fuse(resultsToSearch, FUSE_OPTIONS);
  const matches = fuse.search(query, { limit: 20 });

  const results = matches.map(match => ({
    name: match.item.name,
    position: match.item.position,
    bibNumber: match.item.bibNumber,
    finishTime: match.item.finishTime,
    race: match.item.race,
    gender: match.item.gender,
    category: match.item.category,
    confidence: Math.round((1 - (match.score ?? 0)) * 100),
  }));

  return res.json({
    query,
    results,
    total: results.length,
    limit: 20,
    hasMore: matches.length === 20,
    scrapedAt: data.scrapedAt,
  });
});

// API: Download results as JSON
app.get('/api/download/json', (req, res) => {
  const eventId = getEventId(req);
  const data = loadResults(eventId);
  if (!data) {
    return res.status(404).json({ error: 'No results available' });
  }

  // Get race filter from query parameter
  const raceParam = (req.query.race as string || '').toLowerCase();
  const raceFilter = raceParam === '10km' || raceParam === '10k' ? 'tenKm' :
                     raceParam === 'half marathon' || raceParam === 'half' ? 'halfMarathon' : 'all';

  let resultsToExport;
  const eventPrefix = eventId === 'plus500' ? 'plus500' : 'dcs';
  let filename = `${eventPrefix}-results.json`;

  if (raceFilter === 'halfMarathon') {
    resultsToExport = {
      ...data,
      categories: { halfMarathon: data.categories.halfMarathon, tenKm: [] },
    };
    filename = `${eventPrefix}-half-marathon-results.json`;
  } else if (raceFilter === 'tenKm') {
    resultsToExport = {
      ...data,
      categories: { halfMarathon: [], tenKm: data.categories.tenKm },
    };
    filename = `${eventPrefix}-10km-results.json`;
  } else {
    resultsToExport = data;
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.json(resultsToExport);
});

// API: Download results as CSV
app.get('/api/download/csv', (req, res) => {
  const eventId = getEventId(req);
  const data = loadResults(eventId);
  if (!data) {
    return res.status(404).json({ error: 'No results available' });
  }

  // Get race filter from query parameter
  const raceParam = (req.query.race as string || '').toLowerCase();
  const raceFilter = raceParam === '10km' || raceParam === '10k' ? 'tenKm' :
                     raceParam === 'half marathon' || raceParam === 'half' ? 'halfMarathon' : 'all';

  let allResults: (RaceResult & { race: string })[] = [];
  const eventPrefix = eventId === 'plus500' ? 'plus500' : 'dcs';
  let filename = `${eventPrefix}-results.csv`;

  if (raceFilter === 'halfMarathon') {
    allResults = data.categories.halfMarathon.map(r => ({ ...r, race: 'Half Marathon' }));
    filename = `${eventPrefix}-half-marathon-results.csv`;
  } else if (raceFilter === 'tenKm') {
    allResults = data.categories.tenKm.map(r => ({ ...r, race: '10km' }));
    filename = `${eventPrefix}-10km-results.csv`;
  } else {
    allResults = [
      ...data.categories.halfMarathon.map(r => ({ ...r, race: 'Half Marathon' })),
      ...data.categories.tenKm.map(r => ({ ...r, race: '10km' })),
    ];
  }

  // Create CSV
  const headers = ['Position', 'Bib', 'Name', 'Gender', 'Category', 'Time', 'Race'];
  const rows = allResults.map(r => [
    r.position,
    r.bibNumber,
    `"${r.name.replace(/"/g, '""')}"`,
    r.gender,
    r.category,
    r.finishTime,
    r.race,
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(csv);
});

// API: Get all results (for bulk access)
app.get('/api/results', (req, res) => {
  const eventId = getEventId(req);
  const data = loadResults(eventId);
  if (!data) {
    return res.status(404).json({ error: 'No results available' });
  }
  return res.json(data);
});

// API: Trigger monitor check (called by cron job)
app.post('/api/monitor', async (req, res) => {
  // Simple auth via secret key
  const authKey = req.headers['x-monitor-key'] || req.query.key;
  const expectedKey = process.env.MONITOR_SECRET;

  if (expectedKey && authKey !== expectedKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const targetUrl = process.env.TARGET_URL ||
    'https://results.hopasports.com/event/marina-home-dubai-creek-striders-half-marathon-10km-2026';

  console.log(`\n🔍 Monitor triggered: ${new Date().toISOString()}`);

  try {
    const result = await monitor(targetUrl);
    let message = formatStatusMessage(result, targetUrl);
    let scrapeResult = null;

    console.log(`   Status: ${result.currentStatus.isUp ? 'UP' : 'DOWN'} (${result.currentStatus.statusCode})`);

    // Auto-scrape if site came back up
    if (result.wentUp) {
      console.log('   📥 Auto-scraping results...');
      try {
        const data = await scrapeAllResults(targetUrl);
        saveResults(data);
        const total = data.categories.halfMarathon.length + data.categories.tenKm.length;
        scrapeResult = { success: true, total, halfMarathon: data.categories.halfMarathon.length, tenKm: data.categories.tenKm.length };
        message += `\n\n📊 Auto-scraped ${total} results (${data.categories.halfMarathon.length} HM, ${data.categories.tenKm.length} 10K)`;
        console.log(`   ✅ Scraped ${total} results`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        scrapeResult = { success: false, error: errorMessage };
        message += `\n\n⚠️ Auto-scrape failed: ${errorMessage}`;
        console.log(`   ⚠️ Scrape failed: ${errorMessage}`);
      }

      // Add search UI link
      const appUrl = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;
      if (appUrl) {
        message += `\n\n🔍 Search results: ${appUrl}`;
      }
    }

    // Send notification if status changed
    if (result.wentUp || result.wentDown) {
      const twilioConfig = {
        accountSid: process.env.TWILIO_ACCOUNT_SID || '',
        authToken: process.env.TWILIO_AUTH_TOKEN || '',
        whatsappFrom: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
      };
      const notifyWhatsapp = process.env.NOTIFY_WHATSAPP || '';

      if (isTwilioConfigured(twilioConfig) && notifyWhatsapp) {
        console.log('   📱 Sending notification...');
        await sendNotification({ twilio: twilioConfig, notifyWhatsapp }, message);
      }
    }

    return res.json({
      success: true,
      status: result.currentStatus.isUp ? 'up' : 'down',
      statusCode: result.currentStatus.statusCode,
      stateChanged: result.stateChanged,
      wentUp: result.wentUp,
      wentDown: result.wentDown,
      scrapeResult,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`   ❌ Monitor error: ${errorMessage}`);
    return res.status(500).json({ success: false, error: errorMessage });
  }
});

// Also support GET for easy testing
app.get('/api/monitor', async (req, res) => {
  // Redirect to POST handler
  req.method = 'POST';
  return app._router.handle(req, res, () => {});
});

// API: Heartbeat - send periodic "still monitoring" notification
app.post('/api/heartbeat', async (req, res) => {
  // Simple auth via secret key
  const authKey = req.headers['x-monitor-key'] || req.query.key;
  const expectedKey = process.env.MONITOR_SECRET;

  if (expectedKey && authKey !== expectedKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log(`\n💓 Heartbeat triggered: ${new Date().toISOString()}`);

  const twilioConfig = {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    whatsappFrom: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
  };
  const notifyWhatsapp = process.env.NOTIFY_WHATSAPP || '';

  if (!isTwilioConfigured(twilioConfig) || !notifyWhatsapp) {
    console.log('   ⚠️ Twilio not configured');
    return res.status(400).json({ success: false, error: 'Twilio not configured' });
  }

  // Get current status for the heartbeat message
  const state = loadState();
  const data = loadResults();
  const resultCount = data
    ? data.categories.halfMarathon.length + data.categories.tenKm.length
    : 0;

  const message = `💓 HopaChecker Heartbeat

🔍 Status: ${state.lastStatus === 'up' ? '✅ UP' : '❌ DOWN'}
📊 Results: ${resultCount > 0 ? `${resultCount} stored` : 'Not yet scraped'}
⏰ Last check: ${state.lastChecked ? new Date(state.lastChecked).toLocaleString() : 'Never'}
🔄 Monitoring every 5 minutes

Still watching for results!`;

  try {
    await sendNotification({ twilio: twilioConfig, notifyWhatsapp }, message);
    console.log('   ✅ Heartbeat sent');
    return res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`   ❌ Heartbeat failed: ${errorMessage}`);
    return res.status(500).json({ success: false, error: errorMessage });
  }
});

// Serve the main HTML page for all other routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🏃 HopaChecker server running on port ${PORT}`);
  console.log(`📁 Results files: ${getResultsFilePath('dcs')}, ${getResultsFilePath('plus500')}`);
});
