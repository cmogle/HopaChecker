import express from 'express';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import Fuse, { type IFuseOptions } from 'fuse.js';
import { loadResults, getResultsFilePath, scrapeAllResults, saveResults } from './scraper.js';
import { loadState, monitor, formatStatusMessage } from './monitor.js';
import { sendNotification, isTwilioConfigured } from './notifications/index.js';
import type { RaceResult } from './types.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Fuse.js configuration for fuzzy search
const FUSE_OPTIONS: IFuseOptions<RaceResult & { race: string }> = {
  keys: ['name'],
  threshold: 0.4,
  includeScore: true,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API: Get current status
app.get('/api/status', (_req, res) => {
  const state = loadState();
  const data = loadResults();

  res.json({
    monitor: state,
    hasResults: !!data,
    resultCount: data
      ? data.categories.halfMarathon.length + data.categories.tenKm.length
      : 0,
    scrapedAt: data?.scrapedAt || null,
    eventName: data?.eventName || null,
  });
});

// API: Search results
app.get('/api/search', (req, res) => {
  const query = (req.query.q as string || '').trim();

  if (!query) {
    return res.json({ query: '', results: [], total: 0 });
  }

  const data = loadResults();
  if (!data) {
    return res.json({
      query,
      results: [],
      total: 0,
      error: 'No results available yet. Check back later.',
    });
  }

  // Combine all results with race type
  const allResults: (RaceResult & { race: string })[] = [
    ...data.categories.halfMarathon.map(r => ({ ...r, race: 'Half Marathon' })),
    ...data.categories.tenKm.map(r => ({ ...r, race: '10km' })),
  ];

  const fuse = new Fuse(allResults, FUSE_OPTIONS);
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
    scrapedAt: data.scrapedAt,
  });
});

// API: Download all results as JSON
app.get('/api/download/json', (_req, res) => {
  const data = loadResults();
  if (!data) {
    return res.status(404).json({ error: 'No results available' });
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="dcs-half-marathon-results.json"'
  );
  return res.json(data);
});

// API: Download all results as CSV
app.get('/api/download/csv', (_req, res) => {
  const data = loadResults();
  if (!data) {
    return res.status(404).json({ error: 'No results available' });
  }

  const allResults = [
    ...data.categories.halfMarathon.map(r => ({ ...r, race: 'Half Marathon' })),
    ...data.categories.tenKm.map(r => ({ ...r, race: '10km' })),
  ];

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
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="dcs-half-marathon-results.csv"'
  );
  return res.send(csv);
});

// API: Get all results (for bulk access)
app.get('/api/results', (_req, res) => {
  const data = loadResults();
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

// Serve the main HTML page for all other routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🏃 HopaChecker server running at http://localhost:${PORT}`);
  console.log(`📁 Results file: ${getResultsFilePath()}`);
});
