import { getAthleteResults } from '../storage/supabase.js';
import { parseTimeToSeconds, formatTimeFromSeconds } from './age-grading.js';

// Database row type (snake_case) - matches Supabase schema
interface DbRaceResultRow {
  id: string;
  event_id: string;
  athlete_id: string | null;
  finish_time: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export interface SeasonBest {
  distance: string;
  seasonYear: number;
  bestTime: string;
  eventId: string;
  resultId: string;
  date: string;
  improved: boolean; // Whether this is an improvement over previous season
}

export interface Badge {
  id: string;
  type: 'season_best' | 'personal_best' | 'improvement';
  title: string;
  description: string;
  earnedDate: string;
  distance?: string;
  seasonYear?: number;
}

/**
 * Calculate season bests for an athlete
 */
export async function calculateSeasonBests(
  athleteId: string,
  year?: number
): Promise<SeasonBest[]> {
  const results = await getAthleteResults(athleteId) as DbRaceResultRow[];

  // Use current year if not specified
  const targetYear = year || new Date().getFullYear();

  // Filter results for the target year
  const yearResults = results.filter((result) => {
    const resultDate = new Date(result.created_at);
    return resultDate.getFullYear() === targetYear;
  });

  // Group by distance
  const distanceMap = new Map<string, DbRaceResultRow[]>();

  for (const result of yearResults) {
    // Extract distance from metadata or event
    const distance = extractDistance(result);
    if (!distance) continue;

    if (!distanceMap.has(distance)) {
      distanceMap.set(distance, []);
    }
    distanceMap.get(distance)!.push(result);
  }

  // Find best time for each distance
  const seasonBests: SeasonBest[] = [];

  for (const [distance, distanceResults] of distanceMap.entries()) {
    let bestResult: DbRaceResultRow | null = null;
    let bestSeconds: number | null = null;

    for (const result of distanceResults) {
      if (!result.finish_time) continue;

      const seconds = parseTimeToSeconds(result.finish_time);
      if (seconds === null) continue;

      if (bestSeconds === null || seconds < bestSeconds) {
        bestSeconds = seconds;
        bestResult = result;
      }
    }

    if (bestResult && bestResult.finish_time && bestSeconds !== null) {
      // Check if this is an improvement over previous season
      const previousYear = targetYear - 1;
      const previousBest = await getBestTimeForDistance(athleteId, distance, previousYear);
      const improved = previousBest === null || bestSeconds < previousBest;

      seasonBests.push({
        distance,
        seasonYear: targetYear,
        bestTime: bestResult.finish_time,
        eventId: bestResult.event_id,
        resultId: bestResult.id,
        date: bestResult.created_at,
        improved,
      });
    }
  }

  return seasonBests.sort((a, b) => {
    // Sort by distance (shorter first)
    const distA = parseDistance(a.distance);
    const distB = parseDistance(b.distance);
    return distA - distB;
  });
}

/**
 * Get best time for a specific distance and year
 */
async function getBestTimeForDistance(
  athleteId: string,
  distance: string,
  year: number
): Promise<number | null> {
  const results = await getAthleteResults(athleteId) as DbRaceResultRow[];

  const yearResults = results.filter((result) => {
    const resultDate = new Date(result.created_at);
    return resultDate.getFullYear() === year;
  });

  let bestSeconds: number | null = null;

  for (const result of yearResults) {
    const resultDistance = extractDistance(result);
    if (resultDistance !== distance) continue;

    if (!result.finish_time) continue;
    const seconds = parseTimeToSeconds(result.finish_time);
    if (seconds === null) continue;

    if (bestSeconds === null || seconds < bestSeconds) {
      bestSeconds = seconds;
    }
  }

  return bestSeconds;
}

/**
 * Extract distance from result metadata or event
 */
function extractDistance(result: DbRaceResultRow): string | null {
  // Try metadata first
  if (result.metadata && typeof result.metadata === 'object') {
    const metadata = result.metadata as Record<string, unknown>;
    if (metadata.distance && typeof metadata.distance === 'string') {
      return normalizeDistance(metadata.distance);
    }
  }

  // TODO: Could also check event distance if available
  return null;
}

/**
 * Normalize distance string
 */
function normalizeDistance(distance: string): string {
  const dist = distance.toLowerCase().trim();
  
  // Common patterns
  if (dist.includes('5k') || dist.includes('5000') || dist === '5') {
    return '5K';
  }
  if (dist.includes('10k') || dist.includes('10000') || dist === '10') {
    return '10K';
  }
  if (dist.includes('half') || dist.includes('21k') || dist.includes('21097') || dist.includes('21.1')) {
    return 'Half Marathon';
  }
  if (dist.includes('marathon') || dist.includes('42k') || dist.includes('42195') || dist.includes('42.2')) {
    return 'Marathon';
  }

  return distance; // Return as-is if can't normalize
}

/**
 * Parse distance to meters for sorting
 */
function parseDistance(distance: string): number {
  const dist = distance.toLowerCase();
  
  if (dist.includes('5k') || dist.includes('5000')) return 5000;
  if (dist.includes('10k') || dist.includes('10000')) return 10000;
  if (dist.includes('half') || dist.includes('21k')) return 21097;
  if (dist.includes('marathon') || dist.includes('42k')) return 42195;
  
  return 0;
}

/**
 * Get achievement badges for an athlete
 */
export async function getSeasonBestBadges(athleteId: string): Promise<Badge[]> {
  const badges: Badge[] = [];
  const currentYear = new Date().getFullYear();

  // Get season bests for current year
  const seasonBests = await calculateSeasonBests(athleteId, currentYear);

  for (const sb of seasonBests) {
    if (sb.improved) {
      badges.push({
        id: `sb-${sb.distance}-${sb.seasonYear}`,
        type: 'season_best',
        title: `${sb.distance} Season Best`,
        description: `Improved your ${sb.distance} season best to ${sb.bestTime}`,
        earnedDate: sb.date,
        distance: sb.distance,
        seasonYear: sb.seasonYear,
      });
    }
  }

  // Get personal bests (all-time)
  const allResults = await getAthleteResults(athleteId) as DbRaceResultRow[];
  const pbMap = new Map<string, { time: string; date: string }>();

  for (const result of allResults) {
    if (!result.finish_time) continue;
    const distance = extractDistance(result);
    if (!distance) continue;

    const currentPB = pbMap.get(distance);
    if (!currentPB) {
      pbMap.set(distance, { time: result.finish_time, date: result.created_at });
    } else {
      const currentSeconds = parseTimeToSeconds(currentPB.time);
      const resultSeconds = parseTimeToSeconds(result.finish_time);

      if (currentSeconds !== null && resultSeconds !== null && resultSeconds < currentSeconds) {
        pbMap.set(distance, { time: result.finish_time, date: result.created_at });
      }
    }
  }

  // Check if any season bests are also personal bests
  for (const sb of seasonBests) {
    const pb = pbMap.get(sb.distance);
    if (pb && pb.time === sb.bestTime) {
      badges.push({
        id: `pb-${sb.distance}-${sb.seasonYear}`,
        type: 'personal_best',
        title: `${sb.distance} Personal Best`,
        description: `New personal best in ${sb.distance}: ${sb.bestTime}`,
        earnedDate: sb.date,
        distance: sb.distance,
        seasonYear: sb.seasonYear,
      });
    }
  }

  return badges.sort((a, b) => new Date(b.earnedDate).getTime() - new Date(a.earnedDate).getTime());
}
