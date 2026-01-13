import express from 'express';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import Fuse, { type IFuseOptions } from 'fuse.js';
import { loadResults, getResultsFilePath, scrapeAllResults, scrapePlus500Results, scrapeEvoChipResults, saveResults, type EventId } from './scraper.js';
import { loadState, monitor, formatStatusMessage } from './monitor.js';
import { sendNotification, isTwilioConfigured } from './notifications/index.js';
import type { RaceResult } from './types.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// JSON body parser middleware
app.use(express.json());

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
const allowedOrigins = [
  'https://graafin.club',
  'https://www.graafin.club',
  process.env.CORS_ORIGIN,
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length > 0 
    ? (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || process.env.CORS_ORIGIN === '*') {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      }
    : '*',
  credentials: true,
}));

// Optionally serve static files (disabled when frontend is deployed separately)
const enableStaticFiles = process.env.ENABLE_STATIC_FILES !== 'false';
if (enableStaticFiles) {
  app.use(express.static(path.join(__dirname, 'public')));
}

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
  const twilioConfigured = isTwilioConfigured(twilioConfig);
  const staticFilesEnabled = process.env.ENABLE_STATIC_FILES !== 'false';

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    twilioConfigured,
    notifyWhatsappSet: !!notifyWhatsapp,
    readyForHeartbeat: twilioConfigured && !!notifyWhatsapp,
    staticFilesEnabled,
  });
});

// API: Get current status
app.get('/api/status', async (req, res) => {
  const state = await loadState();
  const eventId = getEventId(req);
  const data = await loadResults(eventId);

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

// API: Platform statistics (public)
app.get('/api/stats/platform', async (_req, res) => {
  try {
    const { supabase } = await import('./db/supabase.js');

    // Get counts from database
    const [athletesResult, resultsResult, eventsResult] = await Promise.all([
      supabase.from('athletes').select('id', { count: 'exact', head: true }),
      supabase.from('race_results').select('id', { count: 'exact', head: true }),
      supabase.from('events').select('id', { count: 'exact', head: true }),
    ]);

    res.json({
      athleteCount: athletesResult.count || 0,
      raceCount: resultsResult.count || 0,
      eventCount: eventsResult.count || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching platform stats:', error);
    res.status(500).json({ error: 'Failed to fetch platform statistics' });
  }
});

// API: Search results
app.get('/api/search', searchLimiter, async (req, res) => {
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
  const data = await loadResults(eventId);
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
    country: match.item.country,
    time5km: match.item.time5km,
    time10km: match.item.time10km,
    time13km: match.item.time13km,
    time15km: match.item.time15km,
    pace: match.item.pace,
    genderPosition: match.item.genderPosition,
    categoryPosition: match.item.categoryPosition,
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
app.get('/api/download/json', async (req, res) => {
  const eventId = getEventId(req);
  const data = await loadResults(eventId);
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
app.get('/api/download/csv', async (req, res) => {
  const eventId = getEventId(req);
  const data = await loadResults(eventId);
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
  const headers = ['Position', 'Bib', 'Name', 'Country', 'Gender', 'Category', 'Time', '5km', '10km', '13km', '15km', 'Pace', 'Gender Position', 'Category Position', 'Race'];
  const rows = allResults.map(r => [
    r.position,
    r.bibNumber,
    `"${r.name.replace(/"/g, '""')}"`,
    r.country || '',
    r.gender,
    r.category,
    r.finishTime,
    r.time5km || '',
    r.time10km || '',
    r.time13km || '',
    r.time15km || '',
    r.pace || '',
    r.genderPosition !== undefined ? r.genderPosition : '',
    r.categoryPosition !== undefined ? r.categoryPosition : '',
    r.race,
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(csv);
});

// API: Get all results (for bulk access)
app.get('/api/results', async (req, res) => {
  const eventId = getEventId(req);
  const data = await loadResults(eventId);
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

    console.log(`   Status: ${result.currentStatus.isUp ? 'UP' : 'DOWN'} (${result.currentStatus.statusCode})`);

    // Send notification if status changed (but no auto-scraping)
    if (result.wentUp || result.wentDown) {
      // Add search UI link if site came back up
      if (result.wentUp) {
        const appUrl = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;
        if (appUrl) {
          message += `\n\n🔍 Search results: ${appUrl}`;
        }
      }

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

// API: Scrape EvoChip results handler
async function handleEvoChipScrape(req: express.Request, res: express.Response) {
  // Public endpoint for one-time scraping (no auth required)

  const evoChipUrl = (req.body?.url as string) || (req.query.url as string) || process.env.EVOCHIP_URL || 
    'https://evochip.hu/results/result.php?distance=hm&category=none&timepoint=none&eventid=DubaiCreekHalf26DAd&year=&lang=en&css=evochip.css&iframe=0&mobile=0&viewport=device-width';

  console.log(`\n📥 EvoChip scrape triggered: ${new Date().toISOString()}`);
  console.log(`   URL: ${evoChipUrl}`);

  try {
    const data = await scrapeEvoChipResults(evoChipUrl);
    await saveResults(data, 'dcs');
    
    const total = data.categories.halfMarathon.length + data.categories.tenKm.length;
    console.log(`   ✅ Scraped ${total} results (${data.categories.halfMarathon.length} HM, ${data.categories.tenKm.length} 10K)`);

    return res.json({
      success: true,
      total,
      halfMarathon: data.categories.halfMarathon.length,
      tenKm: data.categories.tenKm.length,
      scrapedAt: data.scrapedAt,
      eventName: data.eventName,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`   ❌ EvoChip scrape failed: ${errorMessage}`);
    return res.status(500).json({ 
      success: false, 
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }
}

// API: Scrape EvoChip results (POST)
app.post('/api/scrape/evochip', handleEvoChipScrape);

// Also support GET for easy testing
app.get('/api/scrape/evochip', handleEvoChipScrape);

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
    const missing = [];
    if (!twilioConfig.accountSid) missing.push('TWILIO_ACCOUNT_SID');
    if (!twilioConfig.authToken) missing.push('TWILIO_AUTH_TOKEN');
    if (!notifyWhatsapp) missing.push('NOTIFY_WHATSAPP');
    
    console.log(`   ⚠️ Twilio not configured. Missing: ${missing.join(', ')}`);
    return res.status(400).json({ 
      success: false, 
      error: 'Twilio not configured',
      missing,
    });
  }

  console.log(`   📱 Twilio configured, sending to: ${notifyWhatsapp}`);

  // Get current status for the heartbeat message
  const state = await loadState();
  const data = await loadResults();
  const resultCount = data
    ? data.categories.halfMarathon.length + data.categories.tenKm.length
    : 0;

  const message = `💓 GRAAFIN Heartbeat

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

// ============================================================================
// NEW ATHLETE PLATFORM API ENDPOINTS
// ============================================================================

// Admin auth middleware that verifies JWT token and checks email
async function requireAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    // Extract JWT token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token with Supabase
    const { supabase } = await import('./db/supabase.js');
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }

    // Check if user email is the admin email
    const adminEmail = 'conorogle@gmail.com';
    if (user.email !== adminEmail) {
      return res.status(403).json({ error: 'Forbidden - Admin access required' });
    }

    // Attach user to request for use in handlers
    (req as any).user = user;
    next();
  } catch (error) {
    console.error('Admin auth error:', error);
    return res.status(500).json({ error: 'Internal server error during authentication' });
  }
}

// Legacy requireAdmin for backward compatibility (API key based)
async function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  // For MVP, use a simple API key. In production, use proper JWT auth
  const authKey = req.headers['x-api-key'] || req.query.key;
  const expectedKey = process.env.ADMIN_API_KEY;

  if (!expectedKey || authKey !== expectedKey) {
    return res.status(401).json({ error: 'Unauthorized - Admin access required' });
  }

  next();
}

// Admin: Trigger scraping job (enhanced with duplicate check)
app.post('/api/admin/scrape', requireAdminAuth, async (req, res) => {
  try {
    const { processScrapeJob } = await import('./scraper/job-processor.js');
    const { getScraperForUrl } = await import('./scraper/index.js');
    const { checkEventDuplicate } = await import('./storage/supabase.js');
    const { eventUrl, organiser, overwrite } = req.body;

    if (!eventUrl) {
      return res.status(400).json({ error: 'eventUrl is required' });
    }

    // Get scraper to extract event info for duplicate check
    const scraper = organiser
      ? (await import('./scraper/index.js')).getScraperByOrganiser(organiser)
      : getScraperForUrl(eventUrl);

    if (!scraper) {
      return res.status(400).json({ error: `No scraper available for URL: ${eventUrl}` });
    }

    // Scrape event metadata first to check for duplicates
    let scrapedData;
    try {
      scrapedData = await scraper.scrapeEvent(eventUrl);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return res.status(500).json({ 
        success: false, 
        error: `Failed to scrape event: ${errorMessage}`,
      });
    }

    // Check for duplicate
    const duplicate = await checkEventDuplicate(
      scrapedData.event.eventName,
      scrapedData.event.eventDate
    );

    if (duplicate && !overwrite) {
      // Get result count for duplicate
      const { getEventSchema } = await import('./storage/supabase.js');
      const schema = await getEventSchema(duplicate.id);
      
      return res.status(409).json({
        success: false,
        error: 'Duplicate event found',
        isDuplicate: true,
        existingEvent: duplicate,
        resultCount: schema.totalResults,
        message: 'An event with this name and date already exists. Set overwrite=true to proceed.',
      });
    }

    // Proceed with scraping
    const result = await processScrapeJob({
      eventUrl,
      organiser,
      startedBy: (req as any).user?.id,
    });

    return res.json({
      success: true,
      jobId: result.job.id,
      eventId: result.eventId,
      resultsCount: result.resultsCount,
      wasDuplicate: !!duplicate,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ success: false, error: errorMessage });
  }
});

// Admin: List scraping jobs
app.get('/api/admin/scrape-jobs', requireAdmin, async (req, res) => {
  try {
    const { getScrapeJobs } = await import('./storage/supabase.js');
    const limit = parseInt(req.query.limit as string || '50', 10);
    const jobs = await getScrapeJobs(limit);
    return res.json({ jobs });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Admin: Get all events with summary (requires JWT auth)
app.get('/api/admin/events', requireAdminAuth, async (req, res) => {
  try {
    const { getAllEventsWithSummary } = await import('./storage/supabase.js');
    const events = await getAllEventsWithSummary();
    return res.json({ events });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Admin: Get detailed event information with schema
app.get('/api/admin/events/:id', requireAdminAuth, async (req, res) => {
  try {
    const { getEventById, getEventSchema, getScrapeJobs } = await import('./storage/supabase.js');
    const eventId = req.params.id;

    const event = await getEventById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const schema = await getEventSchema(eventId);
    
    // Get scrape jobs for this event
    const allJobs = await getScrapeJobs(100);
    const eventJobs = allJobs.filter(job => {
      // Try to match by URL or event name
      return job.event_url === event.event_url;
    });

    return res.json({
      event,
      schema,
      scrapeJobs: eventJobs,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Admin: Check for duplicate event
app.post('/api/admin/scrape/check-duplicate', requireAdminAuth, async (req, res) => {
  try {
    const { checkEventDuplicate } = await import('./storage/supabase.js');
    const { eventName, eventDate } = req.body;

    if (!eventName || !eventDate) {
      return res.status(400).json({ error: 'eventName and eventDate are required' });
    }

    const duplicate = await checkEventDuplicate(eventName, eventDate);
    
    if (duplicate) {
      // Get result count for duplicate
      const { getEventSchema } = await import('./storage/supabase.js');
      const schema = await getEventSchema(duplicate.id);
      
      return res.json({
        isDuplicate: true,
        existingEvent: duplicate,
        resultCount: schema.totalResults,
      });
    }

    return res.json({ isDuplicate: false });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Admin: Get failed scrape jobs
app.get('/api/admin/scrape-jobs/failed', requireAdminAuth, async (req, res) => {
  try {
    const { getFailedScrapeJobs } = await import('./storage/supabase.js');
    const jobs = await getFailedScrapeJobs();
    return res.json({ jobs });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Admin: Retry failed scrape job
app.post('/api/admin/scrape-jobs/:id/retry', requireAdminAuth, async (req, res) => {
  try {
    const { processScrapeJob } = await import('./scraper/job-processor.js');
    const { getScrapeJob, updateScrapeJob } = await import('./storage/supabase.js');
    const jobId = req.params.id;
    const { eventUrl, organiser } = req.body; // Optional override

    const job = await getScrapeJob(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'failed') {
      return res.status(400).json({ error: 'Job is not in failed status' });
    }

    // Reset job to pending
    await updateScrapeJob(jobId, {
      status: 'pending',
      errorMessage: undefined,
    });

    // Process the job with optional URL/organiser override
    const result = await processScrapeJob({
      eventUrl: eventUrl || job.event_url,
      organiser: organiser || job.organiser,
      startedBy: (req as any).user?.id,
    });

    return res.json({
      success: true,
      jobId: result.job.id,
      eventId: result.eventId,
      resultsCount: result.resultsCount,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ success: false, error: errorMessage });
  }
});

// Athlete: Search athletes
app.get('/api/athletes/search', async (req, res) => {
  try {
    const { searchAthletes } = await import('./storage/supabase.js');
    const query = (req.query.q as string || '').trim();
    const limit = parseInt(req.query.limit as string || '20', 10);

    if (!query || query.length < 2) {
      return res.json({ athletes: [] });
    }

    const athletes = await searchAthletes(query, limit);
    return res.json({ athletes });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Athlete: Get athlete profile
app.get('/api/athletes/:id', async (req, res) => {
  try {
    const { getAthleteById } = await import('./storage/supabase.js');
    const athlete = await getAthleteById(req.params.id);

    if (!athlete) {
      return res.status(404).json({ error: 'Athlete not found' });
    }

    return res.json({ athlete });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Athlete: Get athlete results
app.get('/api/athletes/:id/results', async (req, res) => {
  try {
    const { getAthleteResults } = await import('./storage/supabase.js');
    const { supabase } = await import('./db/supabase.js');
    const athleteId = req.params.id;
    const includeHidden = req.query.include_hidden === 'true';
    const userId = req.query.user_id as string;

    let results = await getAthleteResults(athleteId);

    // Exclude hidden results unless user has verified claim and explicitly requests them
    if (!includeHidden) {
      const { data: hiddenResults } = await supabase
        .from('hidden_results')
        .select('result_id')
        .eq('athlete_id', athleteId);

      if (hiddenResults && hiddenResults.length > 0) {
        const hiddenIds = new Set(hiddenResults.map((h: any) => h.result_id));
        results = results.filter((r) => !hiddenIds.has(r.id));
      }
    }

    // If user has verified claim, mark which results are hidden
    if (userId) {
      const { data: claim } = await supabase
        .from('profile_claims')
        .select('*')
        .eq('athlete_id', athleteId)
        .eq('user_id', userId)
        .eq('verification_status', 'verified')
        .single();

      if (claim) {
        const { data: hiddenResults } = await supabase
          .from('hidden_results')
          .select('result_id')
          .eq('athlete_id', athleteId);

        if (hiddenResults) {
          const hiddenIds = new Set(hiddenResults.map((h: any) => h.result_id));
          results = results.map((r) => ({
            ...r,
            hidden: hiddenIds.has(r.id),
          }));
        }
      }
    }

    return res.json({ results });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Athlete: Claim results (legacy endpoint - kept for backward compatibility)
app.post('/api/athletes/claim', async (req, res) => {
  try {
    const { linkResultToAthlete, getAthleteByUserId } = await import('./storage/supabase.js');
    const { resultId, athleteId, userId } = req.body;

    // If userId provided, get or create athlete profile
    let finalAthleteId = athleteId;
    if (userId && !athleteId) {
      let athlete = await getAthleteByUserId(userId);
      if (!athlete) {
        // Create athlete profile
        const { createAthlete } = await import('./storage/supabase.js');
        athlete = await createAthlete({
          userId,
          name: req.body.name || 'Unknown',
        });
      }
      finalAthleteId = athlete.id;
    }

    if (!finalAthleteId || !resultId) {
      return res.status(400).json({ error: 'athleteId and resultId are required' });
    }

    await linkResultToAthlete(resultId, finalAthleteId);
    return res.json({ success: true, athleteId: finalAthleteId });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// PROFILE CLAIM API ENDPOINTS
// ============================================================================

// Strava OAuth: Get authorization URL
app.get('/api/auth/strava/authorize', async (req, res) => {
  try {
    const { getStravaAuthUrl } = await import('./auth/strava.js');
    const redirectUri = req.query.redirect_uri as string || `${req.protocol}://${req.get('host')}/api/auth/strava/callback`;
    const athleteId = req.query.athlete_id as string;
    
    if (!athleteId) {
      return res.status(400).json({ error: 'athlete_id is required' });
    }

    // Store athlete_id in session or state parameter for callback
    const state = Buffer.from(JSON.stringify({ athleteId, redirectUri })).toString('base64');
    const authUrl = getStravaAuthUrl(redirectUri);
    
    // Add state parameter to track athlete_id
    const urlWithState = `${authUrl}&state=${encodeURIComponent(state)}`;
    
    return res.json({ authUrl: urlWithState });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Strava OAuth: Handle callback
app.get('/api/auth/strava/callback', async (req, res) => {
  try {
    const { exchangeStravaCode, storeStravaLink, verifyAthleteWithStrava, getStravaAthlete } = await import('./auth/strava.js');
    const { supabase } = await import('./db/supabase.js');
    
    const code = req.query.code as string;
    const state = req.query.state as string;
    const error = req.query.error as string;

    if (error) {
      return res.redirect(`/?error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      return res.redirect('/?error=missing_code_or_state');
    }

    // Decode state to get athlete_id
    let stateData: { athleteId: string; redirectUri: string };
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    } catch {
      return res.redirect('/?error=invalid_state');
    }

    const { athleteId, redirectUri } = stateData;
    const redirectUrl = redirectUri || `${req.protocol}://${req.get('host')}/api/auth/strava/callback`;

    // Exchange code for token
    const tokenData = await exchangeStravaCode(code, redirectUrl);

    // Get current user from session or require userId in state
    const userId = req.query.user_id as string;
    if (!userId) {
      return res.redirect(`/?error=user_id_required&athlete_id=${athleteId}`);
    }

    // Store Strava link
    await storeStravaLink(
      athleteId,
      userId,
      tokenData.athlete.id.toString(),
      tokenData.access_token,
      tokenData.refresh_token,
      tokenData.expires_at
    );

    // Verify athlete identity
    const verification = await verifyAthleteWithStrava(
      athleteId,
      userId,
      tokenData.athlete,
      tokenData.access_token
    );

    // Create or update profile claim
    const { data: existingClaim } = await supabase
      .from('profile_claims')
      .select('id')
      .eq('athlete_id', athleteId)
      .eq('user_id', userId)
      .single();

    const claimData: any = {
      athlete_id: athleteId,
      user_id: userId,
      verification_method: 'strava',
      verification_status: verification.verified ? 'verified' : 'pending',
      strava_athlete_id: tokenData.athlete.id.toString(),
    };

    if (verification.verified) {
      claimData.verified_at = new Date().toISOString();
    }

    if (existingClaim) {
      await (supabase
        .from('profile_claims') as any)
        .update(claimData)
        .eq('id', (existingClaim as any).id);
    } else {
      await (supabase
        .from('profile_claims') as any)
        .insert(claimData);
    }

    // Redirect to frontend with success/verification status
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return res.redirect(
      `${frontendUrl}/#/athlete/${athleteId}?strava_verified=${verification.verified}&confidence=${verification.confidence}`
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Strava callback error:', error);
    return res.redirect(`/?error=${encodeURIComponent(errorMessage)}`);
  }
});

// Profile Claim: Initiate claim
app.post('/api/athletes/:id/claim', async (req, res) => {
  try {
    const { supabase } = await import('./db/supabase.js');
    const { getAthleteById } = await import('./storage/supabase.js');
    const athleteId = req.params.id;
    const { userId, verificationMethod } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const athlete = await getAthleteById(athleteId);
    if (!athlete) {
      return res.status(404).json({ error: 'Athlete not found' });
    }

    // Check if claim already exists
    const { data: existingClaim } = await supabase
      .from('profile_claims')
      .select('*')
      .eq('athlete_id', athleteId)
      .eq('user_id', userId)
      .single();

    if (existingClaim) {
      return res.json({
        success: true,
        claim: existingClaim,
        message: 'Claim already exists',
      });
    }

    // Create new claim
    const { data: claim, error } = await supabase
      .from('profile_claims')
      .insert({
        athlete_id: athleteId,
        user_id: userId,
        verification_method: verificationMethod || 'strava',
        verification_status: 'pending',
      } as any)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create claim: ${error.message}`);
    }

    return res.json({
      success: true,
      claim,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Profile Claim: Verify with Strava (complete verification after OAuth)
app.post('/api/athletes/:id/verify-strava', async (req, res) => {
  try {
    const { supabase } = await import('./db/supabase.js');
    const { getStravaLink, verifyAthleteWithStrava, getStravaAthlete } = await import('./auth/strava.js');
    const athleteId = req.params.id;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Get Strava link
    const stravaLink = await getStravaLink(athleteId);
    if (!stravaLink) {
      return res.status(404).json({ error: 'Strava account not linked. Please complete OAuth flow first.' });
    }

    // Get Strava athlete profile
    const stravaAthlete = await getStravaAthlete(stravaLink.accessToken);

    // Verify athlete identity
    const verification = await verifyAthleteWithStrava(
      athleteId,
      userId,
      stravaAthlete,
      stravaLink.accessToken
    );

    // Update claim status
    const { data: claim, error } = await (supabase
      .from('profile_claims') as any)
      .update({
        verification_status: verification.verified ? 'verified' : 'pending',
        verified_at: verification.verified ? new Date().toISOString() : null,
        strava_athlete_id: stravaAthlete.id.toString(),
      })
      .eq('athlete_id', athleteId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update claim: ${error.message}`);
    }

    return res.json({
      success: true,
      verified: verification.verified,
      confidence: verification.confidence,
      reason: verification.reason,
      claim,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Profile Claim: Get claim status
app.get('/api/athletes/:id/claim-status', async (req, res) => {
  try {
    const { supabase } = await import('./db/supabase.js');
    const athleteId = req.params.id;
    const userId = req.query.user_id as string;

    if (!userId) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const { data: claim, error } = await supabase
      .from('profile_claims')
      .select('*')
      .eq('athlete_id', athleteId)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.json({ claimed: false, claim: null });
      }
      throw new Error(`Failed to get claim: ${error.message}`);
    }

    return res.json({
      claimed: true,
      claim,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Profile Claim: Merge duplicate profiles
app.post('/api/athletes/merge', async (req, res) => {
  try {
    const { supabase } = await import('./db/supabase.js');
    const { linkResultToAthlete, getAthleteResults } = await import('./storage/supabase.js');
    const { primaryAthleteId, mergedAthleteId, userId } = req.body;

    if (!primaryAthleteId || !mergedAthleteId || !userId) {
      return res.status(400).json({ error: 'primaryAthleteId, mergedAthleteId, and userId are required' });
    }

    if (primaryAthleteId === mergedAthleteId) {
      return res.status(400).json({ error: 'Cannot merge athlete with itself' });
    }

    // Verify user has claimed the primary athlete
    const { data: claim } = await supabase
      .from('profile_claims')
      .select('*')
      .eq('athlete_id', primaryAthleteId)
      .eq('user_id', userId)
      .eq('verification_status', 'verified')
      .single();

    if (!claim) {
      return res.status(403).json({ error: 'You must have a verified claim on the primary athlete to merge profiles' });
    }

    // Check if merge already exists
    const { data: existingMerge } = await supabase
      .from('athlete_merges')
      .select('id')
      .eq('primary_athlete_id', primaryAthleteId)
      .eq('merged_athlete_id', mergedAthleteId)
      .single();

    if (existingMerge) {
      return res.json({ success: true, message: 'Merge already exists', merge: existingMerge });
    }

    // Create merge record
    const { data: merge, error: mergeError } = await supabase
      .from('athlete_merges')
      .insert({
        primary_athlete_id: primaryAthleteId,
        merged_athlete_id: mergedAthleteId,
        merged_by: userId,
      } as any)
      .select()
      .single();

    if (mergeError) {
      throw new Error(`Failed to create merge: ${mergeError.message}`);
    }

    // Move all results from merged athlete to primary athlete
    const mergedResults = await getAthleteResults(mergedAthleteId);
    let movedCount = 0;

    for (const result of mergedResults) {
      try {
        await linkResultToAthlete(result.id, primaryAthleteId);
        movedCount++;
      } catch (error) {
        console.warn(`Failed to move result ${result.id}:`, error);
      }
    }

    return res.json({
      success: true,
      merge,
      resultsMoved: movedCount,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Result Hiding: Hide a result
app.post('/api/athletes/:id/results/:resultId/hide', async (req, res) => {
  try {
    const { supabase } = await import('./db/supabase.js');
    const athleteId = req.params.id;
    const resultId = req.params.resultId;
    const { userId, reason } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Verify user has claimed and verified the profile
    const { data: claim } = await supabase
      .from('profile_claims')
      .select('*')
      .eq('athlete_id', athleteId)
      .eq('user_id', userId)
      .eq('verification_status', 'verified')
      .single();

    if (!claim) {
      return res.status(403).json({ error: 'You must have a verified claim on this profile to hide results' });
    }

    // Check if already hidden
    const { data: existing } = await supabase
      .from('hidden_results')
      .select('id')
      .eq('athlete_id', athleteId)
      .eq('result_id', resultId)
      .single();

    if (existing) {
      return res.json({ success: true, message: 'Result already hidden', hidden: existing });
    }

    // Hide the result
    const { data: hidden, error } = await supabase
      .from('hidden_results')
      .insert({
        athlete_id: athleteId,
        result_id: resultId,
        reason: reason || null,
      } as any)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to hide result: ${error.message}`);
    }

    return res.json({ success: true, hidden });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Result Hiding: Unhide a result
app.delete('/api/athletes/:id/results/:resultId/hide', async (req, res) => {
  try {
    const { supabase } = await import('./db/supabase.js');
    const athleteId = req.params.id;
    const resultId = req.params.resultId;
    const userId = req.body.userId || req.query.user_id as string;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Verify user has claimed and verified the profile
    const { data: claim } = await supabase
      .from('profile_claims')
      .select('*')
      .eq('athlete_id', athleteId)
      .eq('user_id', userId)
      .eq('verification_status', 'verified')
      .single();

    if (!claim) {
      return res.status(403).json({ error: 'You must have a verified claim on this profile to unhide results' });
    }

    // Unhide the result
    const { error } = await supabase
      .from('hidden_results')
      .delete()
      .eq('athlete_id', athleteId)
      .eq('result_id', resultId);

    if (error) {
      throw new Error(`Failed to unhide result: ${error.message}`);
    }

    return res.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Performance: Get performance stats
app.get('/api/athletes/:id/performance/stats', async (req, res) => {
  try {
    const { calculatePerformanceStats } = await import('./analytics/performance.js');
    const stats = await calculatePerformanceStats(req.params.id);
    return res.json({ stats });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Performance: Get performance trends
app.get('/api/athletes/:id/performance/trends', async (req, res) => {
  try {
    const { getPerformanceTrends } = await import('./analytics/performance.js');
    const trends = await getPerformanceTrends(req.params.id);
    return res.json({ trends });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Performance: Compare to category
app.get('/api/athletes/:id/performance/comparison', async (req, res) => {
  try {
    const { compareToCategory } = await import('./analytics/performance.js');
    const category = (req.query.category as string) || '';
    const comparison = await compareToCategory(req.params.id, category);
    return res.json({ comparison });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// AGE-GRADING & SEASON BESTS API ENDPOINTS
// ============================================================================

// Age-Grading: Get age-graded performance over time
app.get('/api/athletes/:id/age-graded-performance', async (req, res) => {
  try {
    const { getAgeGradedPerformanceOverTime } = await import('./analytics/age-grading.js');
    const { getAthleteResults, getAthleteById } = await import('./storage/supabase.js');
    const athleteId = req.params.id;
    const distance = (req.query.distance as string) || '10K';

    const athlete = await getAthleteById(athleteId);
    if (!athlete) {
      return res.status(404).json({ error: 'Athlete not found' });
    }

    const results = await getAthleteResults(athleteId);
    const performance = await getAgeGradedPerformanceOverTime(
      results,
      athlete.date_of_birth,
      distance
    );

    return res.json({ performance });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Season Bests: Get season bests
app.get('/api/athletes/:id/season-bests', async (req, res) => {
  try {
    const { calculateSeasonBests } = await import('./analytics/season-bests.js');
    const athleteId = req.params.id;
    const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;

    const seasonBests = await calculateSeasonBests(athleteId, year);
    return res.json({ seasonBests });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Badges: Get achievement badges
app.get('/api/athletes/:id/badges', async (req, res) => {
  try {
    const { getSeasonBestBadges } = await import('./analytics/season-bests.js');
    const athleteId = req.params.id;

    const badges = await getSeasonBestBadges(athleteId);
    return res.json({ badges });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// COMPETITIVE INTELLIGENCE API ENDPOINTS
// ============================================================================

// Head-to-Head: Compare two athletes
app.get('/api/athletes/:id1/vs/:id2', async (req, res) => {
  try {
    const { calculateHeadToHead } = await import('./analytics/head-to-head.js');
    const h2h = await calculateHeadToHead(req.params.id1, req.params.id2);
    return res.json({ h2h });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Percentiles: Get performance percentile
app.get('/api/athletes/:id/percentiles', async (req, res) => {
  try {
    const { calculatePercentile } = await import('./analytics/percentiles.js');
    const athleteId = req.params.id;
    const distance = (req.query.distance as string) || '10K';
    const location = req.query.location as string | undefined;

    const percentile = await calculatePercentile(athleteId, distance, location);
    if (!percentile) {
      return res.status(404).json({ error: 'Insufficient data to calculate percentile' });
    }

    return res.json({ percentile });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Course Difficulty: Get CDI for event
app.get('/api/events/:id/difficulty', async (req, res) => {
  try {
    const { calculateCourseDifficulty } = await import('./analytics/course-difficulty.js');
    const cdi = await calculateCourseDifficulty(req.params.id);
    if (!cdi) {
      return res.status(404).json({ error: 'Could not calculate course difficulty' });
    }
    return res.json({ cdi });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// LEAGUES API ENDPOINTS
// ============================================================================

// Leagues: List all leagues
app.get('/api/leagues', async (req, res) => {
  try {
    const { supabase } = await import('./db/supabase.js');
    const type = req.query.type as string | undefined;

    let query = supabase.from('leagues').select('*');
    if (type) {
      query = query.eq('type', type);
    }

    const { data: leagues, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to get leagues: ${error.message}`);
    }

    return res.json({ leagues: leagues || [] });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Leagues: Get league details
app.get('/api/leagues/:id', async (req, res) => {
  try {
    const { supabase } = await import('./db/supabase.js');
    const leagueId = req.params.id;

    const { data: league, error } = await supabase
      .from('leagues')
      .select('*')
      .eq('id', leagueId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'League not found' });
      }
      throw new Error(`Failed to get league: ${error.message}`);
    }

    return res.json({ league });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Leagues: Get league rankings
app.get('/api/leagues/:id/rankings', async (req, res) => {
  try {
    const { calculateLeagueRankings } = await import('./analytics/leagues.js');
    const leagueId = req.params.id;

    // Recalculate rankings
    const rankings = await calculateLeagueRankings(leagueId);
    return res.json({ rankings });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Leagues: Get leagues for athlete
app.get('/api/athletes/:id/leagues', async (req, res) => {
  try {
    const { supabase } = await import('./db/supabase.js');
    const athleteId = req.params.id;

    const { data: rankings, error } = await supabase
      .from('league_rankings')
      .select(`
        rank,
        points,
        leagues!inner (
          id,
          name,
          description,
          type,
          criteria
        )
      `)
      .eq('athlete_id', athleteId)
      .order('rank', { ascending: true });

    if (error) {
      throw new Error(`Failed to get athlete leagues: ${error.message}`);
    }

    return res.json({ leagues: rankings || [] });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Following: Follow athlete
app.post('/api/athletes/:id/follow', async (req, res) => {
  try {
    const { followAthlete } = await import('./social/following.js');
    const { getAthleteByUserId: getAthlete } = await import('./storage/supabase.js');
    
    // Get follower athlete ID (from userId in request or body)
    const userId = req.body.userId || req.headers['x-user-id'];
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const followerAthlete = await getAthlete(userId as string);
    if (!followerAthlete) {
      return res.status(404).json({ error: 'Follower athlete profile not found' });
    }

    await followAthlete(followerAthlete.id, req.params.id);
    return res.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Following: Unfollow athlete
app.delete('/api/athletes/:id/follow', async (req, res) => {
  try {
    const { unfollowAthlete } = await import('./social/following.js');
    const { getAthleteByUserId: getAthlete } = await import('./storage/supabase.js');
    
    const userId = req.body.userId || req.headers['x-user-id'];
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const followerAthlete = await getAthlete(userId as string);
    if (!followerAthlete) {
      return res.status(404).json({ error: 'Follower athlete profile not found' });
    }

    await unfollowAthlete(followerAthlete.id, req.params.id);
    return res.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Following: Get followers
app.get('/api/athletes/:id/followers', async (req, res) => {
  try {
    const { getFollowers } = await import('./social/following.js');
    const followers = await getFollowers(req.params.id);
    return res.json({ followers });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Following: Get following list
app.get('/api/athletes/:id/following', async (req, res) => {
  try {
    const { getFollowing } = await import('./social/following.js');
    const following = await getFollowing(req.params.id);
    return res.json({ following });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// WATCHLISTS API ENDPOINTS
// ============================================================================

// Watchlists: Get all watchlists for athlete
app.get('/api/athletes/:id/watchlists', async (req, res) => {
  try {
    const { supabase } = await import('./db/supabase.js');
    const { getAthleteByUserId } = await import('./storage/supabase.js');
    const athleteId = req.params.id;
    const userId = req.query.user_id as string;

    if (!userId) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    // Verify user owns the athlete profile
    const athlete = await getAthleteByUserId(userId);
    if (!athlete || athlete.id !== athleteId) {
      return res.status(403).json({ error: 'You can only view your own watchlists' });
    }

    const { data: watchlists, error } = await supabase
      .from('watchlists')
      .select('*')
      .eq('athlete_id', athleteId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to get watchlists: ${error.message}`);
    }

    // Get items for each watchlist
    const watchlistsWithItems = await Promise.all(
      (watchlists || []).map(async (watchlist: any) => {
        const { data: items } = await supabase
          .from('watchlist_items')
          .select('watched_athlete_id')
          .eq('watchlist_id', watchlist.id);

        return {
          ...watchlist,
          itemCount: items?.length || 0,
        };
      })
    );

    return res.json({ watchlists: watchlistsWithItems });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Watchlists: Create watchlist
app.post('/api/athletes/:id/watchlists', async (req, res) => {
  try {
    const { supabase } = await import('./db/supabase.js');
    const { getAthleteByUserId } = await import('./storage/supabase.js');
    const athleteId = req.params.id;
    const { userId, name, description } = req.body;

    if (!userId || !name) {
      return res.status(400).json({ error: 'userId and name are required' });
    }

    // Verify user owns the athlete profile
    const athlete = await getAthleteByUserId(userId);
    if (!athlete || athlete.id !== athleteId) {
      return res.status(403).json({ error: 'You can only create watchlists for your own profile' });
    }

    const { data: watchlist, error } = await supabase
      .from('watchlists')
      .insert({
        athlete_id: athleteId,
        name,
        description: description || null,
      } as any)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Watchlist with this name already exists' });
      }
      throw new Error(`Failed to create watchlist: ${error.message}`);
    }

    return res.json({ watchlist });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Watchlists: Update watchlist
app.put('/api/watchlists/:id', async (req, res) => {
  try {
    const { supabase } = await import('./db/supabase.js');
    const { getAthleteByUserId } = await import('./storage/supabase.js');
    const watchlistId = req.params.id;
    const { userId, name, description } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Get watchlist and verify ownership
    const { data: watchlist } = await supabase
      .from('watchlists')
      .select('athlete_id')
      .eq('id', watchlistId)
      .single();

    if (!watchlist) {
      return res.status(404).json({ error: 'Watchlist not found' });
    }

    const athlete = await getAthleteByUserId(userId);
    if (!athlete || athlete.id !== (watchlist as any).athlete_id) {
      return res.status(403).json({ error: 'You can only update your own watchlists' });
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;

    const { data: updated, error } = await (supabase
      .from('watchlists') as any)
      .update(updateData)
      .eq('id', watchlistId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update watchlist: ${error.message}`);
    }

    return res.json({ watchlist: updated });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Watchlists: Delete watchlist
app.delete('/api/watchlists/:id', async (req, res) => {
  try {
    const { supabase } = await import('./db/supabase.js');
    const { getAthleteByUserId } = await import('./storage/supabase.js');
    const watchlistId = req.params.id;
    const userId = req.body.userId || req.query.user_id as string;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Get watchlist and verify ownership
    const { data: watchlist } = await supabase
      .from('watchlists')
      .select('athlete_id')
      .eq('id', watchlistId)
      .single();

    if (!watchlist) {
      return res.status(404).json({ error: 'Watchlist not found' });
    }

    const athlete = await getAthleteByUserId(userId);
    if (!athlete || athlete.id !== (watchlist as any).athlete_id) {
      return res.status(403).json({ error: 'You can only delete your own watchlists' });
    }

    const { error } = await supabase
      .from('watchlists')
      .delete()
      .eq('id', watchlistId);

    if (error) {
      throw new Error(`Failed to delete watchlist: ${error.message}`);
    }

    return res.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Watchlists: Add athlete to watchlist
app.post('/api/watchlists/:id/athletes/:athleteId', async (req, res) => {
  try {
    const { supabase } = await import('./db/supabase.js');
    const { getAthleteByUserId } = await import('./storage/supabase.js');
    const watchlistId = req.params.id;
    const watchedAthleteId = req.params.athleteId;
    const userId = req.body.userId;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Get watchlist and verify ownership
    const { data: watchlist } = await supabase
      .from('watchlists')
      .select('athlete_id')
      .eq('id', watchlistId)
      .single();

    if (!watchlist) {
      return res.status(404).json({ error: 'Watchlist not found' });
    }

    const athlete = await getAthleteByUserId(userId);
    if (!athlete || athlete.id !== (watchlist as any).athlete_id) {
      return res.status(403).json({ error: 'You can only add athletes to your own watchlists' });
    }

    const { data: item, error } = await supabase
      .from('watchlist_items')
      .insert({
        watchlist_id: watchlistId,
        watched_athlete_id: watchedAthleteId,
      } as any)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Athlete already in watchlist' });
      }
      throw new Error(`Failed to add athlete to watchlist: ${error.message}`);
    }

    return res.json({ item });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Watchlists: Remove athlete from watchlist
app.delete('/api/watchlists/:id/athletes/:athleteId', async (req, res) => {
  try {
    const { supabase } = await import('./db/supabase.js');
    const { getAthleteByUserId } = await import('./storage/supabase.js');
    const watchlistId = req.params.id;
    const watchedAthleteId = req.params.athleteId;
    const userId = req.body.userId || req.query.user_id as string;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Get watchlist and verify ownership
    const { data: watchlist } = await supabase
      .from('watchlists')
      .select('athlete_id')
      .eq('id', watchlistId)
      .single();

    if (!watchlist) {
      return res.status(404).json({ error: 'Watchlist not found' });
    }

    const athlete = await getAthleteByUserId(userId);
    if (!athlete || athlete.id !== (watchlist as any).athlete_id) {
      return res.status(403).json({ error: 'You can only remove athletes from your own watchlists' });
    }

    const { error } = await supabase
      .from('watchlist_items')
      .delete()
      .eq('watchlist_id', watchlistId)
      .eq('watched_athlete_id', watchedAthleteId);

    if (error) {
      throw new Error(`Failed to remove athlete from watchlist: ${error.message}`);
    }

    return res.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Watchlists: Get watchlist items (athletes being watched)
app.get('/api/watchlists/:id/athletes', async (req, res) => {
  try {
    const { supabase } = await import('./db/supabase.js');
    const watchlistId = req.params.id;

    const { data: items, error } = await supabase
      .from('watchlist_items')
      .select(`
        id,
        watched_athlete_id,
        created_at,
        athletes:watched_athlete_id (
          id,
          name,
          gender,
          country
        )
      `)
      .eq('watchlist_id', watchlistId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to get watchlist items: ${error.message}`);
    }

    return res.json({ items: items || [] });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Watchlists: Get notification settings
app.get('/api/watchlists/:id/notifications', async (req, res) => {
  try {
    const { supabase } = await import('./db/supabase.js');
    const watchlistId = req.params.id;

    const { data: notifications, error } = await supabase
      .from('watchlist_notifications')
      .select(`
        *,
        watchlist_items!inner (
          watchlist_id
        )
      `)
      .eq('watchlist_items.watchlist_id', watchlistId);

    if (error) {
      throw new Error(`Failed to get notifications: ${error.message}`);
    }

    return res.json({ notifications: notifications || [] });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Watchlists: Configure notifications
app.post('/api/watchlists/:id/notifications', async (req, res) => {
  try {
    const { supabase } = await import('./db/supabase.js');
    const { getAthleteByUserId } = await import('./storage/supabase.js');
    const watchlistId = req.params.id;
    const { userId, watchlistItemId, notificationType, thresholdValue, enabled } = req.body;

    if (!userId || !watchlistItemId || !notificationType) {
      return res.status(400).json({ error: 'userId, watchlistItemId, and notificationType are required' });
    }

    // Get watchlist and verify ownership
    const { data: watchlist } = await supabase
      .from('watchlists')
      .select('athlete_id')
      .eq('id', watchlistId)
      .single();

    if (!watchlist) {
      return res.status(404).json({ error: 'Watchlist not found' });
    }

    const athlete = await getAthleteByUserId(userId);
    if (!athlete || athlete.id !== (watchlist as any).athlete_id) {
      return res.status(403).json({ error: 'You can only configure notifications for your own watchlists' });
    }

    // Check if notification already exists
    const { data: existing } = await supabase
      .from('watchlist_notifications')
      .select('id')
      .eq('watchlist_item_id', watchlistItemId)
      .eq('notification_type', notificationType)
      .single();

    const notificationData: any = {
      watchlist_item_id: watchlistItemId,
      notification_type: notificationType,
      threshold_value: thresholdValue || null,
      enabled: enabled !== undefined ? enabled : true,
    };

    let notification;
    if (existing) {
      // Update existing
      const { data: updated, error: updateError } = await (supabase
        .from('watchlist_notifications') as any)
        .update(notificationData)
        .eq('id', (existing as any).id)
        .select()
        .single();

      if (updateError) {
        throw new Error(`Failed to update notification: ${updateError.message}`);
      }
      notification = updated;
    } else {
      // Create new
      const { data: created, error: createError } = await (supabase
        .from('watchlist_notifications') as any)
        .insert(notificationData)
        .select()
        .single();

      if (createError) {
        throw new Error(`Failed to create notification: ${createError.message}`);
      }
      notification = created;
    }

    return res.json({ notification });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Feed: Get results from followed athletes
app.get('/api/feed', async (req, res) => {
  try {
    const { getFollowing } = await import('./social/following.js');
    const { getAthleteResults, getAthleteByUserId: getAthlete } = await import('./storage/supabase.js');
    
    const userIdParam = req.query.userId;
    const userId = (Array.isArray(userIdParam) ? userIdParam[0] : userIdParam) as string || req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }
    const followerAthlete = await getAthlete(userId);
    if (!followerAthlete) {
      return res.status(404).json({ error: 'Athlete profile not found' });
    }

    const following = await getFollowing(followerAthlete.id);
    const allResults = [];

    for (const athlete of following) {
      const results = await getAthleteResults(athlete.id);
      allResults.push(...results.map(r => ({ ...r, athleteName: athlete.name })));
    }

    // Sort by date (most recent first)
    allResults.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return dateB - dateA;
    });

    // Apply filters
    const limit = parseInt(req.query.limit as string || '50', 10);
    const filteredResults = allResults.slice(0, limit);

    return res.json({ results: filteredResults, total: allResults.length });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Matching: Get match suggestions for unmatched results
app.get('/api/matching/suggestions', requireAdmin, async (req, res) => {
  try {
    const { findMatchesForUnmatchedResults } = await import('./matching/athlete-matcher.js');
    const eventId = req.query.eventId as string | undefined;
    const threshold = parseFloat(req.query.threshold as string || '0.6');
    
    const matches = await findMatchesForUnmatchedResults(eventId, threshold);
    return res.json({ matches: Object.fromEntries(matches) });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Matching: Auto-match results
app.post('/api/matching/auto-match', requireAdmin, async (req, res) => {
  try {
    const { autoMatchResults } = await import('./matching/athlete-matcher.js');
    const confidenceThreshold = parseInt(req.body.confidenceThreshold || '90', 10);
    const eventId = req.body.eventId;
    
    const result = await autoMatchResults(confidenceThreshold, eventId);
    return res.json({ success: true, ...result });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// MONITORING API ENDPOINTS
// ============================================================================

// Monitoring: List all monitored endpoints
app.get('/api/admin/monitoring/endpoints', requireAdmin, async (req, res) => {
  try {
    const { getAllMonitoredEndpoints } = await import('./storage/monitoring.js');
    const enabledOnly = req.query.enabled === 'true';
    const endpoints = await getAllMonitoredEndpoints(enabledOnly);
    
    // Get current status for each endpoint
    const { getEndpointStatus } = await import('./storage/monitoring.js');
    const endpointsWithStatus = await Promise.all(
      endpoints.map(async (endpoint) => {
        const status = await getEndpointStatus(endpoint.id);
        return { ...endpoint, currentStatus: status };
      })
    );
    
    return res.json({ endpoints: endpointsWithStatus });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Monitoring: Add endpoint to monitor
app.post('/api/admin/monitoring/endpoints', requireAdmin, async (req, res) => {
  try {
    const { createMonitoredEndpoint } = await import('./storage/monitoring.js');
    const { organiser, endpointUrl, name, enabled, checkIntervalMinutes } = req.body;
    
    if (!organiser || !endpointUrl || !name) {
      return res.status(400).json({ error: 'organiser, endpointUrl, and name are required' });
    }
    
    const endpoint = await createMonitoredEndpoint({
      organiser,
      endpointUrl,
      name,
      enabled,
      checkIntervalMinutes,
    });
    
    return res.json({ endpoint });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Monitoring: Update endpoint configuration
app.put('/api/admin/monitoring/endpoints/:id', requireAdmin, async (req, res) => {
  try {
    const { updateMonitoredEndpoint } = await import('./storage/monitoring.js');
    const { name, enabled, checkIntervalMinutes } = req.body;
    
    const endpoint = await updateMonitoredEndpoint(req.params.id, {
      name,
      enabled,
      checkIntervalMinutes,
    });
    
    return res.json({ endpoint });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Monitoring: Delete endpoint
app.delete('/api/admin/monitoring/endpoints/:id', requireAdmin, async (req, res) => {
  try {
    const { deleteMonitoredEndpoint } = await import('./storage/monitoring.js');
    await deleteMonitoredEndpoint(req.params.id);
    
    return res.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Monitoring: Manually trigger check
app.post('/api/admin/monitoring/check/:id', requireAdmin, async (req, res) => {
  try {
    const { getMonitoredEndpoint } = await import('./storage/monitoring.js');
    const { monitorEndpoint, formatStatusMessage } = await import('./monitoring/endpoint-monitor.js');
    
    const endpoint = await getMonitoredEndpoint(req.params.id);
    if (!endpoint) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }
    
    const result = await monitorEndpoint(endpoint);
    const message = formatStatusMessage(result, endpoint.endpointUrl, endpoint.name);
    
    return res.json({
      success: true,
      result,
      message,
      endpoint: endpoint.name,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Monitoring: Get current status
app.get('/api/admin/monitoring/status/:id', requireAdmin, async (req, res) => {
  try {
    const { getEndpointStatus, getMonitoredEndpoint } = await import('./storage/monitoring.js');
    
    const endpoint = await getMonitoredEndpoint(req.params.id);
    if (!endpoint) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }
    
    const status = await getEndpointStatus(req.params.id);
    return res.json({ endpoint, status });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Monitoring: Get status history
app.get('/api/admin/monitoring/history/:id', requireAdmin, async (req, res) => {
  try {
    const { getEndpointStatusHistory, getMonitoredEndpoint } = await import('./storage/monitoring.js');
    const limit = parseInt(req.query.limit as string || '100', 10);
    
    const endpoint = await getMonitoredEndpoint(req.params.id);
    if (!endpoint) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }
    
    const history = await getEndpointStatusHistory(req.params.id, limit);
    return res.json({ endpoint, history });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Monitoring: Quick check (test endpoint without saving)
app.post('/api/admin/monitoring/quick-check', requireAdmin, async (req, res) => {
  try {
    const { quickCheckEndpoint } = await import('./monitoring/endpoint-monitor.js');
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'url is required' });
    }

    const status = await quickCheckEndpoint(url);
    return res.json({ status });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// ENHANCED SCRAPER API ENDPOINTS (URL Analysis, Progress SSE, Reconciliation)
// ============================================================================

// Store active scrape jobs for SSE progress streaming
const activeScrapeJobs = new Map<string, {
  progress: any;
  clients: Set<express.Response>;
}>();

// Admin: Pre-scrape URL analysis
app.post('/api/admin/scrape/analyze', requireAdminAuth, async (req, res) => {
  try {
    const { getScraperForUrl } = await import('./scraper/index.js');
    const { eventUrl } = req.body;

    if (!eventUrl) {
      return res.status(400).json({ error: 'eventUrl is required' });
    }

    const scraper = getScraperForUrl(eventUrl);
    if (!scraper) {
      return res.json({
        isValid: false,
        detectedOrganiser: 'unknown',
        issues: ['No scraper available for this URL'],
        estimatedDistances: [],
        requiresHeadlessBrowser: false,
      });
    }

    // Check if scraper has analyzeUrl capability
    if (scraper.analyzeUrl) {
      const analysis = await scraper.analyzeUrl(eventUrl);
      return res.json(analysis);
    }

    // Fallback for legacy scrapers without analyzeUrl
    return res.json({
      isValid: true,
      detectedOrganiser: scraper.organiser,
      estimatedDistances: [],
      requiresHeadlessBrowser: scraper.capabilities?.supportsHeadlessBrowser || false,
      issues: [],
      suggestions: ['This scraper does not support pre-analysis. Results will be determined during scraping.'],
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Admin: SSE endpoint for real-time scrape progress
app.get('/api/admin/scrape/:jobId/progress', requireAdminAuth, async (req, res) => {
  const jobId = req.params.jobId;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Add client to active job
  let job = activeScrapeJobs.get(jobId);
  if (!job) {
    job = { progress: { stage: 'initializing', message: 'Waiting for scrape to start...' }, clients: new Set() };
    activeScrapeJobs.set(jobId, job);
  }

  job.clients.add(res);

  // Send initial state
  res.write(`data: ${JSON.stringify(job.progress)}\n\n`);

  // Send heartbeat every 30 seconds
  const heartbeat = setInterval(() => {
    res.write(`:heartbeat\n\n`);
  }, 30000);

  // Clean up on close
  req.on('close', () => {
    clearInterval(heartbeat);
    const j = activeScrapeJobs.get(jobId);
    if (j) {
      j.clients.delete(res);
      if (j.clients.size === 0) {
        // Keep job for 5 minutes after last client disconnects
        setTimeout(() => {
          const current = activeScrapeJobs.get(jobId);
          if (current && current.clients.size === 0) {
            activeScrapeJobs.delete(jobId);
          }
        }, 5 * 60 * 1000);
      }
    }
  });
});

// Helper to broadcast progress to SSE clients
function broadcastProgress(jobId: string, progress: any) {
  const job = activeScrapeJobs.get(jobId);
  if (job) {
    job.progress = progress;
    const message = `data: ${JSON.stringify(progress)}\n\n`;
    for (const client of job.clients) {
      client.write(message);
    }
  }
}

// Admin: Enhanced scrape with SSE progress
app.post('/api/admin/scrape/start', requireAdminAuth, async (req, res) => {
  try {
    const { getScraperForUrl, getScraperByOrganiser } = await import('./scraper/index.js');
    const { createScrapeJob, updateScrapeJob, saveEnhancedResults, saveEventDistances, saveEvent, checkEventDuplicate } = await import('./storage/supabase.js');
    const { validateResults } = await import('./scraper/validation.js');
    const { eventUrl, organiser, overwrite, useHeadlessBrowser } = req.body;

    if (!eventUrl) {
      return res.status(400).json({ error: 'eventUrl is required' });
    }

    // Create job
    const job = await createScrapeJob({
      organiser: organiser || 'unknown',
      eventUrl,
      startedBy: (req as any).user?.id,
    });

    // Initialize SSE tracking
    activeScrapeJobs.set(job.id, {
      progress: { stage: 'initializing', message: 'Starting scrape...', resultsScraped: 0 },
      clients: new Set(),
    });

    // Start scrape asynchronously
    (async () => {
      try {
        const scraper = organiser
          ? getScraperByOrganiser(organiser)
          : getScraperForUrl(eventUrl);

        if (!scraper) {
          broadcastProgress(job.id, {
            stage: 'error',
            message: `No scraper available for URL: ${eventUrl}`,
          });
          await updateScrapeJob(job.id, { status: 'failed', errorMessage: 'No scraper available' });
          return;
        }

        await updateScrapeJob(job.id, { status: 'running' });
        broadcastProgress(job.id, { stage: 'connecting', message: 'Connecting to event page...', resultsScraped: 0 });

        // Create progress callback
        const onProgress = (progress: any) => {
          broadcastProgress(job.id, progress);
        };

        // Scrape with progress
        const scrapedData = await scraper.scrapeEvent(eventUrl, { useHeadlessBrowser }, onProgress);

        // Check for duplicate
        const duplicate = await checkEventDuplicate(scrapedData.event.eventName, scrapedData.event.eventDate);
        if (duplicate && !overwrite) {
          broadcastProgress(job.id, {
            stage: 'error',
            message: 'Duplicate event found. Use overwrite=true to proceed.',
          });
          await updateScrapeJob(job.id, { status: 'failed', errorMessage: 'Duplicate event found' });
          return;
        }

        broadcastProgress(job.id, { stage: 'validating', message: 'Validating results...', resultsScraped: scrapedData.results.length });

        // Handle both legacy and enhanced result formats
        const eventData = scrapedData.event as any;
        const hasDistances = 'distances' in eventData && Array.isArray(eventData.distances);
        const distance = hasDistances
          ? eventData.distances[0]?.distanceName
          : eventData.distance || 'Unknown';

        // Convert legacy results to enhanced format if needed
        const enhancedResults = scrapedData.results.map((r: any) => ({
          position: r.position,
          bibNumber: r.bibNumber || '',
          name: r.name,
          gender: r.gender || '',
          category: r.category || '',
          finishTime: r.finishTime || '',
          gunTime: r.gunTime,
          chipTime: r.chipTime,
          pace: r.pace,
          genderPosition: r.genderPosition,
          categoryPosition: r.categoryPosition,
          country: r.country,
          club: r.club,
          age: r.age,
          status: r.status || 'finished',
          timeBehind: r.timeBehind,
          checkpoints: r.checkpoints || [],
          // Legacy time fields
          time5km: r.time5km,
          time10km: r.time10km,
          time13km: r.time13km,
          time15km: r.time15km,
        }));

        // Validate results using enhanced format
        const enhancedScrapedData = {
          event: {
            ...eventData,
            distances: hasDistances ? eventData.distances : [],
          },
          results: enhancedResults,
          scrapeMetadata: scrapedData.scrapeMetadata || {
            startedAt: new Date(),
            completedAt: new Date(),
            totalPages: 1,
            totalResults: enhancedResults.length,
            usedHeadlessBrowser: false,
            errors: [],
            warnings: [],
          },
        };

        const validation = validateResults(enhancedScrapedData);

        broadcastProgress(job.id, {
          stage: 'saving',
          message: 'Saving to database...',
          resultsScraped: scrapedData.results.length,
          validation: { isValid: validation.isValid, completenessScore: validation.completenessScore },
        });

        // Save event
        const eventId = await saveEvent({
          organiser: scrapedData.event.organiser,
          eventName: scrapedData.event.eventName,
          eventDate: scrapedData.event.eventDate,
          eventUrl: scrapedData.event.eventUrl,
          location: scrapedData.event.location,
          distance,
          metadata: scrapedData.event.metadata,
        });

        // Save distances if available
        if (hasDistances && eventData.distances.length > 0) {
          await saveEventDistances(eventId, eventData.distances);
        }

        // Save results
        const { savedCount } = await saveEnhancedResults(eventId, enhancedResults, {
          distance,
          sourceOrganiser: scraper.organiser,
          sourceUrl: eventUrl,
        });

        await updateScrapeJob(job.id, { status: 'completed', resultsCount: savedCount });

        broadcastProgress(job.id, {
          stage: 'complete',
          message: `Successfully scraped ${savedCount} results`,
          resultsScraped: savedCount,
          eventId,
          validation: { isValid: validation.isValid, completenessScore: validation.completenessScore },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        broadcastProgress(job.id, { stage: 'error', message: errorMessage });
        await updateScrapeJob(job.id, { status: 'failed', errorMessage });
      }
    })();

    return res.json({
      success: true,
      jobId: job.id,
      message: 'Scrape started. Use SSE endpoint for progress updates.',
      sseUrl: `/api/admin/scrape/${job.id}/progress`,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Admin: Get data quality report for an event
app.get('/api/admin/events/:id/quality', requireAdminAuth, async (req, res) => {
  try {
    const { getDataQualityReport } = await import('./storage/supabase.js');
    const eventId = req.params.id;

    const report = await getDataQualityReport(eventId);
    return res.json({ report });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Admin: Link events for reconciliation
app.post('/api/admin/events/link', requireAdminAuth, async (req, res) => {
  try {
    const { linkEvents, getEventById, findPotentialDuplicateEvents } = await import('./storage/supabase.js');
    const { primaryEventId, linkedEventId, autoDetect } = req.body;

    if (autoDetect) {
      // Auto-detect potential duplicates
      const event = await getEventById(primaryEventId);
      if (!event) {
        return res.status(404).json({ error: 'Primary event not found' });
      }

      const potentials = await findPotentialDuplicateEvents(event.event_date, event.event_name);
      const candidates = potentials.filter(e => e.id !== primaryEventId);

      return res.json({
        success: true,
        candidates: candidates.map(e => ({
          id: e.id,
          name: e.event_name,
          organiser: e.organiser,
          date: e.event_date,
        })),
      });
    }

    if (!primaryEventId || !linkedEventId) {
      return res.status(400).json({ error: 'primaryEventId and linkedEventId are required' });
    }

    await linkEvents(primaryEventId, linkedEventId, {
      linkedBy: (req as any).user?.id,
    });

    return res.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Admin: Get linked events
app.get('/api/admin/events/:id/links', requireAdminAuth, async (req, res) => {
  try {
    const { getLinkedEvents, getEventById } = await import('./storage/supabase.js');
    const eventId = req.params.id;

    const links = await getLinkedEvents(eventId);

    // Fetch event details for each link
    const linksWithDetails = await Promise.all(
      links.map(async (link) => {
        const linkedId = link.primary_event_id === eventId ? link.linked_event_id : link.primary_event_id;
        const event = await getEventById(linkedId);
        return {
          ...link,
          linkedEvent: event,
        };
      })
    );

    return res.json({ links: linksWithDetails });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Admin: Reconcile linked events
app.post('/api/admin/events/reconcile', requireAdminAuth, async (req, res) => {
  try {
    const { getEnhancedResults, getEventById } = await import('./storage/supabase.js');
    const { reconcileResults, generateReconciliationReport } = await import('./scraper/reconciliation.js');
    const { primaryEventId, secondaryEventId, autoMergeThreshold } = req.body;

    if (!primaryEventId || !secondaryEventId) {
      return res.status(400).json({ error: 'primaryEventId and secondaryEventId are required' });
    }

    // Get events
    const [primaryEvent, secondaryEvent] = await Promise.all([
      getEventById(primaryEventId),
      getEventById(secondaryEventId),
    ]);

    if (!primaryEvent || !secondaryEvent) {
      return res.status(404).json({ error: 'One or both events not found' });
    }

    // Get results with checkpoints
    const [primaryResults, secondaryResults] = await Promise.all([
      getEnhancedResults(primaryEventId, { includeCheckpoints: true }),
      getEnhancedResults(secondaryEventId, { includeCheckpoints: true }),
    ]);

    // Convert to EnhancedRaceResult format for reconciliation
    const mapToEnhanced = (r: any) => ({
      position: r.position,
      bibNumber: r.bib_number || '',
      name: r.name,
      gender: r.gender || '',
      category: r.category || '',
      finishTime: r.finish_time || '',
      gunTime: r.gun_time || undefined,
      chipTime: r.chip_time || undefined,
      pace: r.pace || undefined,
      genderPosition: r.gender_position || undefined,
      categoryPosition: r.category_position || undefined,
      country: r.country || undefined,
      club: r.club || undefined,
      age: r.age || undefined,
      status: (r.status || 'finished') as 'finished' | 'dnf' | 'dns' | 'dq',
      timeBehind: r.time_behind || undefined,
      checkpoints: (r.checkpoints || []).map((cp: any) => ({
        checkpointType: cp.checkpoint_type as 'distance' | 'transition' | 'discipline',
        checkpointName: cp.checkpoint_name,
        checkpointOrder: cp.checkpoint_order,
        splitTime: cp.split_time || undefined,
        cumulativeTime: cp.cumulative_time || undefined,
        pace: cp.pace || undefined,
      })),
    });

    const result = reconcileResults(
      primaryResults.map(mapToEnhanced),
      secondaryResults.map(mapToEnhanced),
      {
        sourceAName: primaryEvent.organiser,
        sourceBName: secondaryEvent.organiser,
        autoMergeThreshold: autoMergeThreshold || 85,
      }
    );

    const report = generateReconciliationReport(result);

    return res.json({
      success: true,
      reconciliation: {
        matchedCount: result.matchedCount,
        unmatchedFromPrimary: result.unmatchedFromA,
        unmatchedFromSecondary: result.unmatchedFromB,
        conflictCount: result.conflicts.length,
        statistics: result.statistics,
      },
      report,
      // Only return first few conflicts for preview
      sampleConflicts: result.conflicts.slice(0, 10),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Admin: Get enhanced results with checkpoints
app.get('/api/admin/events/:id/results', requireAdminAuth, async (req, res) => {
  try {
    const { getEnhancedResults } = await import('./storage/supabase.js');
    const eventId = req.params.id;
    const includeCheckpoints = req.query.checkpoints !== 'false';
    const includeSource = req.query.source === 'true';

    const results = await getEnhancedResults(eventId, { includeCheckpoints, includeSource });
    return res.json({ results, total: results.length });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Admin: Get event distances
app.get('/api/admin/events/:id/distances', requireAdminAuth, async (req, res) => {
  try {
    const { getEventDistances } = await import('./storage/supabase.js');
    const eventId = req.params.id;

    const distances = await getEventDistances(eventId);
    return res.json({ distances });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Admin: Get results with validation errors
app.get('/api/admin/events/:id/validation-errors', requireAdminAuth, async (req, res) => {
  try {
    const { getResultsWithValidationErrors } = await import('./storage/supabase.js');
    const eventId = req.params.id;

    const results = await getResultsWithValidationErrors(eventId);
    return res.json({ results, count: results.length });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
});

// Serve admin page route
if (enableStaticFiles) {
  app.get('/admin', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
}

// Serve the main HTML page for all other routes (only if static files are enabled)
if (enableStaticFiles) {
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🏃 GRAAFIN server running on port ${PORT}`);
  console.log(`📁 Results files: ${getResultsFilePath('dcs')}, ${getResultsFilePath('plus500')}`);
  console.log(`📦 Static files: ${enableStaticFiles ? 'enabled' : 'disabled (API-only mode)'}`);
});
