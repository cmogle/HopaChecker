import { getScraperForUrl } from './index.js';
import {
  createScrapeJob,
  updateScrapeJob,
  saveEvent,
  saveResults,
  getEventByUrl,
  type ScrapeJob,
} from '../storage/supabase.js';
import type { ScrapedResults } from './organisers/base.js';

// Quick connectivity check using fetch (Node 18+)
async function quickConnectivityCheck(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(url, { 
      method: 'HEAD',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

export interface ScrapeJobRequest {
  organiser?: string;
  eventUrl: string;
  startedBy?: string;
}

export interface ScrapeJobResult {
  job: ScrapeJob;
  eventId: string;
  resultsCount: number;
}

/**
 * Process a scraping job
 */
export async function processScrapeJob(request: ScrapeJobRequest): Promise<ScrapeJobResult> {
  // Create the job record
  const job = await createScrapeJob({
    organiser: request.organiser || 'unknown',
    eventUrl: request.eventUrl,
    startedBy: request.startedBy,
  });

  try {
    // Update job status to running
    await updateScrapeJob(job.id, { status: 'running' });

    // Get the appropriate scraper
    // First try by organiser name (if provided and not 'unknown'), then fall back to URL matching
    let scraper = (request.organiser && request.organiser !== 'unknown')
      ? (await import('./index.js')).getScraperByOrganiser(request.organiser)
      : null;

    // If no scraper found by organiser, try URL matching
    if (!scraper) {
      scraper = getScraperForUrl(request.eventUrl);
    }

    if (!scraper) {
      throw new Error(`No scraper available for URL: ${request.eventUrl}`);
    }

    // Check if event already exists
    let eventId: string;
    const existingEvent = await getEventByUrl(request.eventUrl);

    if (existingEvent) {
      eventId = existingEvent.id;
      console.log(`[Job ${job.id}] Event already exists: ${eventId}`);
    } else {
      // Scrape the event
      console.log(`[Job ${job.id}] Scraping event: ${request.eventUrl}`);
      
      // Quick connectivity check first (5 second timeout)
      const isReachable = await quickConnectivityCheck(request.eventUrl);
      if (!isReachable) {
        throw new Error(`Site appears to be down or unreachable. Please verify ${request.eventUrl} is accessible before scraping.`);
      }
      
      const scrapedData: ScrapedResults = await scraper.scrapeEvent(request.eventUrl);

      // Save the event
      eventId = await saveEvent({
        organiser: scrapedData.event.organiser,
        eventName: scrapedData.event.eventName,
        eventDate: scrapedData.event.eventDate,
        eventUrl: scrapedData.event.eventUrl,
        distance: scrapedData.event.distance,
        location: scrapedData.event.location,
        metadata: scrapedData.event.metadata,
      });

      console.log(`[Job ${job.id}] Event saved: ${eventId}`);
    }

    // If we have results, save them
    let totalResultsCount = 0;
    if (!existingEvent) {
      // Only save results if this is a new event
      // For existing events, we might want to update/merge results in the future
      const scrapedData: ScrapedResults = await scraper.scrapeEvent(request.eventUrl);
      
      if (scrapedData.results.length > 0) {
        // Save results by distance (if we can determine it)
        const distance = scrapedData.event.distance || 'Unknown';
        const savedCount = await saveResults(eventId, scrapedData.results, distance);
        totalResultsCount = savedCount;
        console.log(`[Job ${job.id}] Saved ${totalResultsCount} results`);
      }
    } else {
      // For existing events, we could re-scrape and update, but for MVP we'll skip
      console.log(`[Job ${job.id}] Event already exists, skipping result save`);
    }

    // Update job as completed
    const completedJob = await updateScrapeJob(job.id, {
      status: 'completed',
      resultsCount: totalResultsCount,
    });

    return {
      job: completedJob,
      eventId,
      resultsCount: totalResultsCount,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Job ${job.id}] Error: ${errorMessage}`);

    // Update job as failed
    const failedJob = await updateScrapeJob(job.id, {
      status: 'failed',
      errorMessage,
    });

    throw new Error(`Scraping job failed: ${errorMessage}`);
  }
}
