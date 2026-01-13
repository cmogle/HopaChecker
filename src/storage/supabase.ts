import { supabase, normalizeName, type Database } from '../db/supabase.js';
import type { RaceResult } from '../types.js';
import type {
  EnhancedRaceResult,
  TimingCheckpoint,
  EventDistance,
  ScrapedResults,
  ValidationResult,
  ReconciliationResult,
} from '../scraper/types.js';

export type Athlete = Database['public']['Tables']['athletes']['Row'];
type Event = Database['public']['Tables']['events']['Row'];
export type RaceResultRow = Database['public']['Tables']['race_results']['Row'];
export type ScrapeJob = Database['public']['Tables']['scrape_jobs']['Row'];
export type TimingCheckpointRow = Database['public']['Tables']['timing_checkpoints']['Row'];
export type EventDistanceRow = Database['public']['Tables']['event_distances']['Row'];
export type ResultSourceRow = Database['public']['Tables']['result_sources']['Row'];
export type EventSourceLinkRow = Database['public']['Tables']['event_source_links']['Row'];

// Event storage functions
export async function saveEvent(event: {
  organiser: string;
  eventName: string;
  eventDate: string;
  eventUrl?: string;
  distance?: string;
  location?: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const { data, error } = await supabase
    .from('events')
    .insert({
      organiser: event.organiser,
      event_name: event.eventName,
      event_date: event.eventDate,
      event_url: event.eventUrl || null,
      distance: event.distance || null,
      location: event.location || null,
      scraped_at: new Date().toISOString(),
      metadata: event.metadata || null,
    } as any)
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to save event: ${error.message}`);
  }

  return (data as any).id;
}

export async function getEventByUrl(eventUrl: string): Promise<Event | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('event_url', eventUrl)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to get event: ${error.message}`);
  }

  return data;
}

export async function getEventById(eventId: string): Promise<Event | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to get event: ${error.message}`);
  }

  return data;
}

// Race results storage functions
export async function saveResults(
  eventId: string,
  results: RaceResult[],
  distance: string
): Promise<number> {
  if (results.length === 0) {
    return 0;
  }

  const resultsToInsert = results.map((result) => ({
    event_id: eventId,
    athlete_id: null, // Will be matched later
    position: result.position,
    bib_number: result.bibNumber || null,
    name: result.name,
    normalized_name: normalizeName(result.name),
    gender: result.gender || null,
    category: result.category || null,
    finish_time: result.finishTime || null,
    pace: result.pace || null,
    gender_position: result.genderPosition || null,
    category_position: result.categoryPosition || null,
    country: result.country || null,
    time_5km: result.time5km || null,
    time_10km: result.time10km || null,
    time_13km: result.time13km || null,
    time_15km: result.time15km || null,
    metadata: {
      distance,
    },
  }));

  // Insert in batches to avoid payload size limits
  const batchSize = 500;
  let totalInserted = 0;

  for (let i = 0; i < resultsToInsert.length; i += batchSize) {
    const batch = resultsToInsert.slice(i, i + batchSize);
    const { error } = await supabase.from('race_results').insert(batch as any);

    if (error) {
      throw new Error(`Failed to save results batch: ${error.message}`);
    }

    totalInserted += batch.length;
  }

  return totalInserted;
}

export async function getAthleteResults(athleteId: string): Promise<RaceResultRow[]> {
  const { data, error } = await supabase
    .from('race_results')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to get athlete results: ${error.message}`);
  }

  return data || [];
}

export async function getUnmatchedResults(eventId?: string): Promise<RaceResultRow[]> {
  let query = supabase
    .from('race_results')
    .select('*')
    .is('athlete_id', null);

  if (eventId) {
    query = query.eq('event_id', eventId);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to get unmatched results: ${error.message}`);
  }

  return data || [];
}

export async function linkResultToAthlete(resultId: string, athleteId: string): Promise<void> {
  const { error } = await supabase
    .from('race_results')
    // @ts-ignore - Supabase type inference issue
    .update({ athlete_id: athleteId })
    .eq('id', resultId);

  if (error) {
    throw new Error(`Failed to link result to athlete: ${error.message}`);
  }
}

export async function unlinkResultFromAthlete(resultId: string): Promise<void> {
  const { error } = await supabase
    .from('race_results')
    // @ts-ignore - Supabase type inference issue
    .update({ athlete_id: null })
    .eq('id', resultId);

  if (error) {
    throw new Error(`Failed to unlink result from athlete: ${error.message}`);
  }
}

// Athlete functions
export async function createAthlete(athlete: {
  userId?: string;
  name: string;
  gender?: string;
  dateOfBirth?: string;
  country?: string;
}): Promise<Athlete> {
  const { data, error } = await supabase
    .from('athletes')
    .insert({
      user_id: athlete.userId || null,
      name: athlete.name,
      normalized_name: normalizeName(athlete.name),
      gender: athlete.gender || null,
      date_of_birth: athlete.dateOfBirth || null,
      country: athlete.country || null,
    } as any)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create athlete: ${error.message}`);
  }

  return data;
}

export async function getAthleteById(athleteId: string): Promise<Athlete | null> {
  const { data, error } = await supabase
    .from('athletes')
    .select('*')
    .eq('id', athleteId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to get athlete: ${error.message}`);
  }

  return data;
}

export async function getAthleteByUserId(userId: string): Promise<Athlete | null> {
  const { data, error } = await supabase
    .from('athletes')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to get athlete by user ID: ${error.message}`);
  }

  return data;
}

export async function searchAthletes(query: string, limit: number = 20): Promise<Athlete[]> {
  const normalizedQuery = normalizeName(query);

  const { data, error } = await supabase
    .from('athletes')
    .select('*')
    .ilike('normalized_name', `%${normalizedQuery}%`)
    .limit(limit);

  if (error) {
    throw new Error(`Failed to search athletes: ${error.message}`);
  }

  return data || [];
}

export async function updateAthlete(
  athleteId: string,
  updates: {
    name?: string;
    gender?: string;
    dateOfBirth?: string;
    country?: string;
  }
): Promise<Athlete> {
  const updateData: Record<string, unknown> = {};

  if (updates.name) {
    updateData.name = updates.name;
    updateData.normalized_name = normalizeName(updates.name);
  }
  if (updates.gender !== undefined) updateData.gender = updates.gender;
  if (updates.dateOfBirth !== undefined) updateData.date_of_birth = updates.dateOfBirth;
  if (updates.country !== undefined) updateData.country = updates.country;

  const { data, error } = await supabase
    .from('athletes')
    // @ts-ignore - Supabase type inference issue
    .update(updateData)
    .eq('id', athleteId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update athlete: ${error.message}`);
  }

  return data;
}

// Scrape job functions
export async function createScrapeJob(job: {
  organiser: string;
  eventUrl: string;
  startedBy?: string;
}): Promise<ScrapeJob> {
  const { data, error } = await supabase
    .from('scrape_jobs')
    .insert({
      organiser: job.organiser,
      event_url: job.eventUrl,
      status: 'pending',
      started_by: job.startedBy || null,
    } as any)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create scrape job: ${error.message}`);
  }

  return data;
}

export async function updateScrapeJob(
  jobId: string,
  updates: {
    status?: 'pending' | 'running' | 'completed' | 'failed';
    resultsCount?: number;
    errorMessage?: string;
  }
): Promise<ScrapeJob> {
  const updateData: Record<string, unknown> = {};

  if (updates.status) {
    updateData.status = updates.status;
    if (updates.status === 'completed' || updates.status === 'failed') {
      updateData.completed_at = new Date().toISOString();
    }
  }
  if (updates.resultsCount !== undefined) updateData.results_count = updates.resultsCount;
  if (updates.errorMessage !== undefined) updateData.error_message = updates.errorMessage;

  const { data, error } = await supabase
    .from('scrape_jobs')
    // @ts-ignore - Supabase type inference issue
    .update(updateData)
    .eq('id', jobId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update scrape job: ${error.message}`);
  }

  return data;
}

export async function getScrapeJob(jobId: string): Promise<ScrapeJob | null> {
  const { data, error } = await supabase
    .from('scrape_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to get scrape job: ${error.message}`);
  }

  return data;
}

export async function getScrapeJobs(limit: number = 50): Promise<ScrapeJob[]> {
  const { data, error } = await supabase
    .from('scrape_jobs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to get scrape jobs: ${error.message}`);
  }

  return data || [];
}

// Admin functions for event management

export interface EventSummary {
  id: string;
  organiser: string;
  event_name: string;
  event_date: string;
  event_url: string | null;
  distance: string | null;
  location: string | null;
  scraped_at: string | null;
  created_at: string;
  result_count: number;
  last_scrape_time: string | null;
}

export async function getAllEventsWithSummary(): Promise<EventSummary[]> {
  // Get all events
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('*')
    .order('created_at', { ascending: false });

  if (eventsError) {
    throw new Error(`Failed to get events: ${eventsError.message}`);
  }

  if (!events || events.length === 0) {
    return [];
  }

  // Get result counts for each event
  const eventIds = (events as Array<{ id: string }>).map(e => e.id);
  const { data: results, error: resultsError } = await supabase
    .from('race_results')
    .select('event_id, created_at')
    .in('event_id', eventIds);

  if (resultsError) {
    throw new Error(`Failed to get results: ${resultsError.message}`);
  }

  // Aggregate results by event
  const resultCounts = new Map<string, { count: number; lastScrape: string | null }>();
  const typedResults = (results || []) as Array<{ event_id: string; created_at: string }>;

  for (const result of typedResults) {
    const eventId = result.event_id;
    const current = resultCounts.get(eventId) || { count: 0, lastScrape: null };
    current.count += 1;
    if (!current.lastScrape || result.created_at > current.lastScrape) {
      current.lastScrape = result.created_at;
    }
    resultCounts.set(eventId, current);
  }

  // Combine event data with result counts
  const typedEvents = events as Database['public']['Tables']['events']['Row'][];
  return typedEvents.map(event => ({
    ...event,
    result_count: resultCounts.get(event.id)?.count || 0,
    last_scrape_time: resultCounts.get(event.id)?.lastScrape || event.scraped_at,
  }));
}

export interface EventSchema {
  fields: Array<{
    name: string;
    populated: number;
    total: number;
    percentage: number;
  }>;
  distances: string[];
  totalResults: number;
}

export async function getEventSchema(eventId: string): Promise<EventSchema> {
  // Get all results for this event
  const { data: results, error } = await supabase
    .from('race_results')
    .select('*')
    .eq('event_id', eventId);

  if (error) {
    throw new Error(`Failed to get event results: ${error.message}`);
  }

  if (!results || results.length === 0) {
    return {
      fields: [],
      distances: [],
      totalResults: 0,
    };
  }

  const typedResults = results as RaceResultRow[];
  const total = typedResults.length;
  const fields = [
    { name: 'position', key: 'position' },
    { name: 'bib_number', key: 'bib_number' },
    { name: 'name', key: 'name' },
    { name: 'gender', key: 'gender' },
    { name: 'category', key: 'category' },
    { name: 'finish_time', key: 'finish_time' },
    { name: 'pace', key: 'pace' },
    { name: 'gender_position', key: 'gender_position' },
    { name: 'category_position', key: 'category_position' },
    { name: 'country', key: 'country' },
    { name: 'time_5km', key: 'time_5km' },
    { name: 'time_10km', key: 'time_10km' },
    { name: 'time_13km', key: 'time_13km' },
    { name: 'time_15km', key: 'time_15km' },
  ];

  const fieldStats = fields.map(field => {
    const populated = typedResults.filter(r => r[field.key as keyof RaceResultRow] != null).length;
    return {
      name: field.name,
      populated,
      total,
      percentage: total > 0 ? Math.round((populated / total) * 100) : 0,
    };
  });

  // Extract unique distances from metadata
  const distances = new Set<string>();
  typedResults.forEach(r => {
    if (r.metadata && typeof r.metadata === 'object' && 'distance' in r.metadata) {
      const dist = String((r.metadata as Record<string, unknown>).distance);
      if (dist) distances.add(dist);
    }
  });

  return {
    fields: fieldStats,
    distances: Array.from(distances),
    totalResults: total,
  };
}

export async function checkEventDuplicate(eventName: string, eventDate: string): Promise<Event | null> {
  // Normalize event name for comparison
  const normalizedName = normalizeName(eventName);

  // Query events with matching date
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('event_date', eventDate);

  if (error) {
    throw new Error(`Failed to check for duplicates: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return null;
  }

  const typedData = data as Event[];

  // Check if any event has a normalized name that matches
  for (const event of typedData) {
    const eventNormalizedName = normalizeName(event.event_name);
    if (eventNormalizedName === normalizedName) {
      return event;
    }
  }

  return null;
}

export async function getFailedScrapeJobs(): Promise<ScrapeJob[]> {
  const { data, error } = await supabase
    .from('scrape_jobs')
    .select('*')
    .eq('status', 'failed')
    .order('started_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to get failed scrape jobs: ${error.message}`);
  }

  return data || [];
}

/**
 * Get jobs that are due for retry
 * Finds failed jobs where next_retry_at <= now and retry_count < max_retries
 */
export async function getJobsForRetry(): Promise<ScrapeJob[]> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('scrape_jobs')
    .select('*')
    .eq('status', 'failed')
    .lte('next_retry_at', now)
    .lt('retry_count', 3) // max_retries default is 3
    .order('next_retry_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to get jobs for retry: ${error.message}`);
  }

  return data || [];
}

/**
 * Schedule a job for retry with a specific retry time
 */
export async function scheduleJobRetry(
  jobId: string,
  nextRetryAt: Date,
  retryCount: number
): Promise<ScrapeJob> {
  const { data, error } = await supabase
    .from('scrape_jobs')
    // @ts-ignore - Supabase type inference issue
    .update({
      next_retry_at: nextRetryAt.toISOString(),
      retry_count: retryCount,
    })
    .eq('id', jobId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to schedule job retry: ${error.message}`);
  }

  return data;
}

/**
 * Mark a job's notification as sent
 */
export async function markJobNotificationSent(jobId: string): Promise<void> {
  const { error } = await supabase
    .from('scrape_jobs')
    // @ts-ignore - Supabase type inference issue
    .update({ notification_sent: true })
    .eq('id', jobId);

  if (error) {
    throw new Error(`Failed to mark notification sent: ${error.message}`);
  }
}

/**
 * Reset a job for retry (set status back to pending)
 */
export async function resetJobForRetry(jobId: string): Promise<ScrapeJob> {
  const { data, error } = await supabase
    .from('scrape_jobs')
    // @ts-ignore - Supabase type inference issue
    .update({
      status: 'running',
      error_message: null,
      completed_at: null,
    })
    .eq('id', jobId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to reset job for retry: ${error.message}`);
  }

  return data;
}

// ============================================
// Enhanced Storage Functions (New Tables)
// ============================================

// Event Distance Functions

/**
 * Save event distances
 */
export async function saveEventDistances(
  eventId: string,
  distances: EventDistance[]
): Promise<void> {
  if (distances.length === 0) return;

  const distancesToInsert = distances.map((d) => ({
    event_id: eventId,
    distance_name: d.distanceName,
    distance_meters: d.distanceMeters,
    race_type: d.raceType,
    expected_checkpoints: d.expectedCheckpoints,
    participant_count: d.participantCount || null,
    metadata: d.metadata || null,
  }));

  const { error } = await supabase
    .from('event_distances')
    .insert(distancesToInsert as any);

  if (error) {
    throw new Error(`Failed to save event distances: ${error.message}`);
  }
}

/**
 * Get event distances
 */
export async function getEventDistances(eventId: string): Promise<EventDistanceRow[]> {
  const { data, error } = await supabase
    .from('event_distances')
    .select('*')
    .eq('event_id', eventId);

  if (error) {
    throw new Error(`Failed to get event distances: ${error.message}`);
  }

  return data || [];
}

/**
 * Update participant count for a distance
 */
export async function updateDistanceParticipantCount(
  distanceId: string,
  count: number
): Promise<void> {
  const { error } = await supabase
    .from('event_distances')
    // @ts-ignore - Supabase type inference issue
    .update({ participant_count: count })
    .eq('id', distanceId);

  if (error) {
    throw new Error(`Failed to update participant count: ${error.message}`);
  }
}

// Timing Checkpoint Functions

/**
 * Save timing checkpoints for a result
 */
export async function saveTimingCheckpoints(
  resultId: string,
  checkpoints: TimingCheckpoint[]
): Promise<void> {
  if (checkpoints.length === 0) return;

  const checkpointsToInsert = checkpoints.map((cp) => ({
    result_id: resultId,
    checkpoint_type: cp.checkpointType,
    checkpoint_name: cp.checkpointName,
    checkpoint_order: cp.checkpointOrder,
    split_time: cp.splitTime || null,
    cumulative_time: cp.cumulativeTime || null,
    pace: cp.pace || null,
    segment_distance_meters: cp.segmentDistanceMeters || null,
    metadata: cp.metadata || null,
  }));

  const { error } = await supabase
    .from('timing_checkpoints')
    .insert(checkpointsToInsert as any);

  if (error) {
    throw new Error(`Failed to save timing checkpoints: ${error.message}`);
  }
}

/**
 * Get timing checkpoints for a result
 */
export async function getTimingCheckpoints(resultId: string): Promise<TimingCheckpointRow[]> {
  const { data, error } = await supabase
    .from('timing_checkpoints')
    .select('*')
    .eq('result_id', resultId)
    .order('checkpoint_order', { ascending: true });

  if (error) {
    throw new Error(`Failed to get timing checkpoints: ${error.message}`);
  }

  return data || [];
}

/**
 * Get all checkpoints for an event's results
 */
export async function getEventCheckpoints(eventId: string): Promise<
  Array<{ result_id: string; checkpoints: TimingCheckpointRow[] }>
> {
  // First get all result IDs for this event
  const { data: results, error: resultsError } = await supabase
    .from('race_results')
    .select('id')
    .eq('event_id', eventId);

  if (resultsError) {
    throw new Error(`Failed to get results: ${resultsError.message}`);
  }

  if (!results || results.length === 0) {
    return [];
  }

  const resultIds = (results as Array<{ id: string }>).map((r) => r.id);

  // Get all checkpoints for these results
  const { data: checkpoints, error: cpError } = await supabase
    .from('timing_checkpoints')
    .select('*')
    .in('result_id', resultIds)
    .order('checkpoint_order', { ascending: true });

  if (cpError) {
    throw new Error(`Failed to get checkpoints: ${cpError.message}`);
  }

  // Group by result_id
  const checkpointsByResult = new Map<string, TimingCheckpointRow[]>();
  for (const cp of checkpoints || []) {
    const existing = checkpointsByResult.get(cp.result_id) || [];
    existing.push(cp);
    checkpointsByResult.set(cp.result_id, existing);
  }

  return Array.from(checkpointsByResult.entries()).map(([result_id, cps]) => ({
    result_id,
    checkpoints: cps,
  }));
}

// Result Source Functions (Provenance Tracking)

/**
 * Record the source of scraped results
 */
export async function saveResultSource(
  resultId: string,
  source: {
    sourceOrganiser: string;
    sourceUrl: string;
    scrapedAt: Date;
    fieldsProvided: string[];
    confidenceScore?: number;
    isPrimary?: boolean;
  }
): Promise<void> {
  const { error } = await supabase.from('result_sources').insert({
    result_id: resultId,
    source_organiser: source.sourceOrganiser,
    source_url: source.sourceUrl,
    scraped_at: source.scrapedAt.toISOString(),
    fields_provided: source.fieldsProvided,
    confidence_score: source.confidenceScore || null,
    is_primary: source.isPrimary ?? true,
  } as any);

  if (error) {
    throw new Error(`Failed to save result source: ${error.message}`);
  }
}

/**
 * Get all sources for a result
 */
export async function getResultSources(resultId: string): Promise<ResultSourceRow[]> {
  const { data, error } = await supabase
    .from('result_sources')
    .select('*')
    .eq('result_id', resultId)
    .order('scraped_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to get result sources: ${error.message}`);
  }

  return data || [];
}

// Event Linking Functions (Multi-Source Reconciliation)

/**
 * Link two events as the same event from different sources
 */
export async function linkEvents(
  primaryEventId: string,
  linkedEventId: string,
  options?: {
    linkType?: string;
    linkConfidence?: number;
    linkedBy?: string;
  }
): Promise<void> {
  const { error } = await supabase.from('event_source_links').insert({
    primary_event_id: primaryEventId,
    linked_event_id: linkedEventId,
    link_type: options?.linkType || 'same_event',
    link_confidence: options?.linkConfidence || 100,
    linked_by: options?.linkedBy || null,
  } as any);

  if (error) {
    throw new Error(`Failed to link events: ${error.message}`);
  }
}

/**
 * Get linked events
 */
export async function getLinkedEvents(eventId: string): Promise<EventSourceLinkRow[]> {
  const { data, error } = await supabase
    .from('event_source_links')
    .select('*')
    .or(`primary_event_id.eq.${eventId},linked_event_id.eq.${eventId}`);

  if (error) {
    throw new Error(`Failed to get linked events: ${error.message}`);
  }

  return data || [];
}

/**
 * Find potential duplicate events for reconciliation
 */
export async function findPotentialDuplicateEvents(
  eventDate: string,
  eventName?: string
): Promise<Event[]> {
  let query = supabase
    .from('events')
    .select('*')
    .eq('event_date', eventDate);

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to find potential duplicates: ${error.message}`);
  }

  if (!eventName || !data) {
    return data || [];
  }

  // Filter by name similarity
  const normalizedSearch = normalizeName(eventName);
  return (data as Event[]).filter((event) => {
    const normalizedEventName = normalizeName(event.event_name);
    // Simple contains check - could be enhanced with fuzzy matching
    return (
      normalizedEventName.includes(normalizedSearch) ||
      normalizedSearch.includes(normalizedEventName)
    );
  });
}

// Enhanced Results Storage (with checkpoints)

/**
 * Save enhanced results with checkpoints and provenance
 */
export async function saveEnhancedResults(
  eventId: string,
  results: EnhancedRaceResult[],
  options: {
    distance: string;
    distanceId?: string;
    sourceOrganiser: string;
    sourceUrl: string;
  }
): Promise<{ savedCount: number; resultIds: string[] }> {
  if (results.length === 0) {
    return { savedCount: 0, resultIds: [] };
  }

  const resultIds: string[] = [];
  const batchSize = 100;

  for (let i = 0; i < results.length; i += batchSize) {
    const batch = results.slice(i, i + batchSize);

    // Insert results
    const resultsToInsert = batch.map((result) => ({
      event_id: eventId,
      distance_id: options.distanceId || null,
      athlete_id: null,
      position: result.position,
      bib_number: result.bibNumber || null,
      name: result.name,
      normalized_name: normalizeName(result.name),
      gender: result.gender || null,
      category: result.category || null,
      finish_time: result.finishTime || null,
      gun_time: result.gunTime || null,
      chip_time: result.chipTime || null,
      pace: result.pace || null,
      gender_position: result.genderPosition || null,
      category_position: result.categoryPosition || null,
      country: result.country || null,
      club: result.club || null,
      age: result.age || null,
      status: result.status || 'finished',
      time_behind: result.timeBehind || null,
      // Legacy fields
      time_5km: result.time5km || null,
      time_10km: result.time10km || null,
      time_13km: result.time13km || null,
      time_15km: result.time15km || null,
      metadata: { distance: options.distance },
    }));

    const { data: insertedResults, error: insertError } = await supabase
      .from('race_results')
      .insert(resultsToInsert as any)
      .select('id');

    if (insertError) {
      throw new Error(`Failed to save results batch: ${insertError.message}`);
    }

    const insertedIds = (insertedResults as Array<{ id: string }>).map((r) => r.id);
    resultIds.push(...insertedIds);

    // Save checkpoints for each result
    for (let j = 0; j < batch.length; j++) {
      const result = batch[j];
      const resultId = insertedIds[j];

      if (result.checkpoints && result.checkpoints.length > 0) {
        await saveTimingCheckpoints(resultId, result.checkpoints);
      }

      // Record source provenance
      const providedFields = Object.keys(result).filter(
        (key) => result[key as keyof EnhancedRaceResult] != null
      );

      await saveResultSource(resultId, {
        sourceOrganiser: options.sourceOrganiser,
        sourceUrl: options.sourceUrl,
        scrapedAt: new Date(),
        fieldsProvided: providedFields,
        isPrimary: true,
      });
    }
  }

  return { savedCount: resultIds.length, resultIds };
}

/**
 * Get enhanced results with checkpoints for an event
 */
export async function getEnhancedResults(
  eventId: string,
  options?: { includeCheckpoints?: boolean; includeSource?: boolean }
): Promise<
  Array<
    RaceResultRow & {
      checkpoints?: TimingCheckpointRow[];
      sources?: ResultSourceRow[];
    }
  >
> {
  const { data: results, error } = await supabase
    .from('race_results')
    .select('*')
    .eq('event_id', eventId)
    .order('position', { ascending: true });

  if (error) {
    throw new Error(`Failed to get results: ${error.message}`);
  }

  if (!results || results.length === 0) {
    return [];
  }

  const typedResults = results as RaceResultRow[];

  if (!options?.includeCheckpoints && !options?.includeSource) {
    return typedResults;
  }

  // Fetch checkpoints and sources if requested
  const resultIds = typedResults.map((r: RaceResultRow) => r.id);

  let checkpointsByResult: Map<string, TimingCheckpointRow[]> = new Map();
  let sourcesByResult: Map<string, ResultSourceRow[]> = new Map();

  if (options.includeCheckpoints) {
    const { data: checkpoints } = await supabase
      .from('timing_checkpoints')
      .select('*')
      .in('result_id', resultIds);

    if (checkpoints) {
      for (const cp of checkpoints) {
        const existing = checkpointsByResult.get(cp.result_id) || [];
        existing.push(cp);
        checkpointsByResult.set(cp.result_id, existing);
      }
    }
  }

  if (options.includeSource) {
    const { data: sources } = await supabase
      .from('result_sources')
      .select('*')
      .in('result_id', resultIds);

    if (sources) {
      for (const src of sources) {
        const existing = sourcesByResult.get(src.result_id) || [];
        existing.push(src);
        sourcesByResult.set(src.result_id, existing);
      }
    }
  }

  return typedResults.map((result) => ({
    ...result,
    checkpoints: checkpointsByResult.get(result.id) || [],
    sources: sourcesByResult.get(result.id) || [],
  }));
}

// Validation Storage

/**
 * Store validation results for a result
 */
export async function saveValidationResult(
  resultId: string,
  validation: { errors: unknown[]; warnings: unknown[] }
): Promise<void> {
  const hasErrors = validation.errors.length > 0;

  const { error } = await supabase
    .from('race_results')
    // @ts-ignore - Supabase type inference issue
    .update({
      validated_at: new Date().toISOString(),
      validation_errors: hasErrors ? validation.errors : null,
    })
    .eq('id', resultId);

  if (error) {
    throw new Error(`Failed to save validation result: ${error.message}`);
  }
}

/**
 * Get results with validation errors
 */
export async function getResultsWithValidationErrors(eventId?: string): Promise<RaceResultRow[]> {
  let query = supabase
    .from('race_results')
    .select('*')
    .not('validation_errors', 'is', null);

  if (eventId) {
    query = query.eq('event_id', eventId);
  }

  const { data, error } = await query.order('position', { ascending: true });

  if (error) {
    throw new Error(`Failed to get results with errors: ${error.message}`);
  }

  return data || [];
}

// Data Quality Report

export interface DataQualityReport {
  eventId: string;
  totalResults: number;
  fieldPopulation: Record<string, { count: number; percentage: number }>;
  checkpointCoverage: {
    resultsWithCheckpoints: number;
    averageCheckpointsPerResult: number;
    checkpointTypes: Record<string, number>;
  };
  validationSummary: {
    validatedCount: number;
    withErrorsCount: number;
    errorTypes: Record<string, number>;
  };
  sources: Array<{
    organiser: string;
    resultCount: number;
    percentage: number;
  }>;
}

/**
 * Generate data quality report for an event
 */
export async function getDataQualityReport(eventId: string): Promise<DataQualityReport> {
  // Get all results
  const { data: results, error: resultsError } = await supabase
    .from('race_results')
    .select('*')
    .eq('event_id', eventId);

  if (resultsError) {
    throw new Error(`Failed to get results: ${resultsError.message}`);
  }

  const typedResults = (results || []) as RaceResultRow[];
  const total = typedResults.length;

  // Field population
  const fields = [
    'position', 'bib_number', 'name', 'gender', 'category',
    'finish_time', 'gun_time', 'chip_time', 'pace',
    'gender_position', 'category_position', 'country', 'club', 'age',
  ];

  const fieldPopulation: Record<string, { count: number; percentage: number }> = {};
  for (const field of fields) {
    const count = typedResults.filter(
      (r) => r[field as keyof RaceResultRow] != null
    ).length;
    fieldPopulation[field] = {
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
    };
  }

  // Checkpoint coverage
  const resultIds = typedResults.map((r) => r.id);
  let checkpoints: TimingCheckpointRow[] = [];

  if (resultIds.length > 0) {
    const { data: cpData } = await supabase
      .from('timing_checkpoints')
      .select('*')
      .in('result_id', resultIds);
    checkpoints = cpData || [];
  }

  const resultsWithCheckpoints = new Set(checkpoints.map((cp) => cp.result_id)).size;
  const checkpointTypes: Record<string, number> = {};
  for (const cp of checkpoints) {
    checkpointTypes[cp.checkpoint_type] = (checkpointTypes[cp.checkpoint_type] || 0) + 1;
  }

  // Validation summary
  const validatedResults = typedResults.filter((r) => r.validated_at != null);
  const resultsWithErrors = typedResults.filter(
    (r) => r.validation_errors != null && Array.isArray(r.validation_errors) && r.validation_errors.length > 0
  );

  const errorTypes: Record<string, number> = {};
  for (const result of resultsWithErrors) {
    const errors = (result.validation_errors as unknown) as Array<{ field?: string }> | null;
    if (errors && Array.isArray(errors)) {
      for (const error of errors) {
        if (error.field) {
          errorTypes[error.field] = (errorTypes[error.field] || 0) + 1;
        }
      }
    }
  }

  // Sources
  let sources: ResultSourceRow[] = [];
  if (resultIds.length > 0) {
    const { data: srcData } = await supabase
      .from('result_sources')
      .select('*')
      .in('result_id', resultIds);
    sources = srcData || [];
  }

  const sourceCount: Record<string, number> = {};
  for (const src of sources) {
    sourceCount[src.source_organiser] = (sourceCount[src.source_organiser] || 0) + 1;
  }

  return {
    eventId,
    totalResults: total,
    fieldPopulation,
    checkpointCoverage: {
      resultsWithCheckpoints,
      averageCheckpointsPerResult: total > 0 ? checkpoints.length / total : 0,
      checkpointTypes,
    },
    validationSummary: {
      validatedCount: validatedResults.length,
      withErrorsCount: resultsWithErrors.length,
      errorTypes,
    },
    sources: Object.entries(sourceCount).map(([organiser, count]) => ({
      organiser,
      resultCount: count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
    })),
  };
}
