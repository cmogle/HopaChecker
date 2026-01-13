import { supabase } from '../db/supabase.js';
import { getAthleteResults } from '../storage/supabase.js';
import { parseTimeToSeconds } from './age-grading.js';

export interface PercentileStats {
  athleteId: string;
  distance: string;
  location?: string;
  percentile: number;
  rank: number;
  totalAthletes: number;
  athleteTime: string;
  medianTime: string;
}

/**
 * Calculate performance percentile for an athlete
 */
export async function calculatePercentile(
  athleteId: string,
  distance: string,
  location?: string
): Promise<PercentileStats | null> {
  const athleteResults = await getAthleteResults(athleteId);
  
  // Get athlete's best time for this distance
  const athleteTimes = athleteResults
    .filter(r => matchesDistance(r, distance))
    .map(r => ({ time: r.finish_time, seconds: parseTimeToSeconds(r.finish_time) }))
    .filter(t => t.seconds !== null)
    .sort((a, b) => (a.seconds || 0) - (b.seconds || 0));

  if (athleteTimes.length === 0) {
    return null;
  }

  const athleteBestSeconds = athleteTimes[0].seconds!;
  const athleteBestTime = athleteTimes[0].time!; // Non-null (filtered for valid seconds which requires valid time)

  // Get all results for this distance (and location if specified)
  let query = supabase
    .from('race_results')
    .select('finish_time, events!inner(location, distance)')
    .not('finish_time', 'is', null);

  if (location) {
    query = query.eq('events.location', location);
  }

  const { data: allResults, error } = await query;

  if (error || !allResults) {
    return null;
  }

  // Filter by distance and parse times
  const allTimes = allResults
    .filter((r: any) => {
      const eventDistance = r.events?.distance || '';
      return matchesDistanceString(eventDistance, distance);
    })
    .map((r: any) => parseTimeToSeconds(r.finish_time))
    .filter((t: number | null): t is number => t !== null)
    .sort((a: number, b: number) => a - b);

  if (allTimes.length === 0) {
    return null;
  }

  // Calculate percentile
  const rank = allTimes.filter((t: number) => t < athleteBestSeconds).length;
  const percentile = Math.round((rank / allTimes.length) * 100);

  // Calculate median
  const medianIndex = Math.floor(allTimes.length / 2);
  const medianSeconds = allTimes[medianIndex];
  const medianTime = formatTimeFromSeconds(medianSeconds);

  return {
    athleteId,
    distance,
    location,
    percentile: 100 - percentile, // Top X% (higher is better)
    rank: rank + 1,
    totalAthletes: allTimes.length,
    athleteTime: athleteBestTime || '',
    medianTime,
  };
}

/**
 * Check if result matches distance
 */
function matchesDistance(result: any, distance: string): boolean {
  if (result.metadata && typeof result.metadata === 'object') {
    const metadata = result.metadata as Record<string, unknown>;
    if (metadata.distance) {
      return matchesDistanceString(String(metadata.distance), distance);
    }
  }
  return false;
}

/**
 * Check if distance string matches
 */
function matchesDistanceString(resultDistance: string, targetDistance: string): boolean {
  const result = resultDistance.toLowerCase();
  const target = targetDistance.toLowerCase();

  if (target.includes('5k') || target.includes('5000')) {
    return result.includes('5k') || result.includes('5000');
  }
  if (target.includes('10k') || target.includes('10000')) {
    return result.includes('10k') || result.includes('10000');
  }
  if (target.includes('half') || target.includes('21k')) {
    return result.includes('half') || result.includes('21k');
  }
  if (target.includes('marathon') || target.includes('42k')) {
    return result.includes('marathon') || result.includes('42k');
  }

  return result === target;
}

/**
 * Format seconds to time string
 */
function formatTimeFromSeconds(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
