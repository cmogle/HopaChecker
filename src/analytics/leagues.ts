import { supabase } from '../db/supabase.js';
import { getAthleteResults } from '../storage/supabase.js';
import { parseTimeToSeconds } from './age-grading.js';

export interface League {
  id: string;
  name: string;
  description: string | null;
  type: 'geographic' | 'age_group' | 'custom';
  criteria: Record<string, unknown>;
}

export interface LeagueRanking {
  rank: number;
  athleteId: string;
  athleteName: string;
  points: number | null;
}

/**
 * Generate geographic leagues based on event data
 */
export async function generateGeographicLeagues(
  location: string,
  distance: string
): Promise<League[]> {
  // Check if league already exists
  const { data: existing } = await supabase
    .from('leagues')
    .select('*')
    .eq('type', 'geographic')
    .eq('criteria->>location', location)
    .eq('criteria->>distance', distance)
    .single();

  if (existing) {
    return [existing as League];
  }

  // Create new league
  const { data: league, error } = await supabase
    .from('leagues')
    .insert({
      name: `${location} ${distance} League`,
      description: `Virtual league for ${distance} runners in ${location}`,
      type: 'geographic',
      criteria: { location, distance },
    } as any)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create league: ${error.message}`);
  }

  return [league as League];
}

/**
 * Calculate league rankings
 */
export async function calculateLeagueRankings(leagueId: string): Promise<LeagueRanking[]> {
  // Get league criteria
  const { data: league } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', leagueId)
    .single();

  if (!league) {
    throw new Error('League not found');
  }

  const criteria = (league as any).criteria as Record<string, unknown>;
  const distance = criteria.distance as string;
  const location = criteria.location as string;

  // Get all athletes who have results matching the criteria
  let query = supabase
    .from('race_results')
    .select(`
      athlete_id,
      finish_time,
      events!inner(location, distance, event_date)
    `)
    .not('athlete_id', 'is', null)
    .not('finish_time', 'is', null);

  if (location) {
    query = query.eq('events.location', location);
  }

  const { data: results, error } = await query;

  if (error || !results) {
    throw new Error(`Failed to get results: ${error?.message}`);
  }

  // Filter by distance and calculate best times per athlete
  const athleteBestTimes = new Map<string, { time: string; seconds: number }>();

  for (const result of results) {
    const event = (result as any).events;
    if (!matchesDistance(event?.distance, distance)) continue;

    const athleteId = (result as any).athlete_id;
    const finishTime = (result as any).finish_time;
    const seconds = parseTimeToSeconds(finishTime);

    if (seconds === null) continue;

    const current = athleteBestTimes.get(athleteId);
    if (!current || seconds < current.seconds) {
      athleteBestTimes.set(athleteId, { time: finishTime, seconds });
    }
  }

  // Get athlete names
  const athleteIds = Array.from(athleteBestTimes.keys());
  const { data: athletes } = await supabase
    .from('athletes')
    .select('id, name')
    .in('id', athleteIds);

  const athleteMap = new Map(
    (athletes || []).map((a: any) => [a.id, a.name])
  );

  // Sort by best time (fastest first)
  const rankings: LeagueRanking[] = Array.from(athleteBestTimes.entries())
    .map(([athleteId, { seconds }]) => ({
      athleteId,
      seconds,
      name: athleteMap.get(athleteId) || 'Unknown',
    }))
    .sort((a, b) => a.seconds - b.seconds)
    .map((entry, index) => ({
      rank: index + 1,
      athleteId: entry.athleteId,
      athleteName: entry.name,
      points: null, // TODO: Implement points system
    }));

  // Save rankings to database
  await saveLeagueRankings(leagueId, rankings);

  return rankings;
}

/**
 * Save league rankings to database
 */
async function saveLeagueRankings(leagueId: string, rankings: LeagueRanking[]): Promise<void> {
  // Delete existing rankings
  await supabase
    .from('league_rankings')
    .delete()
    .eq('league_id', leagueId);

  // Insert new rankings
  const rankingsToInsert = rankings.map((r) => ({
    league_id: leagueId,
    athlete_id: r.athleteId,
    rank: r.rank,
    points: r.points,
  }));

  if (rankingsToInsert.length > 0) {
    await supabase
      .from('league_rankings')
      .insert(rankingsToInsert as any);
  }
}

/**
 * Check if distance matches
 */
function matchesDistance(eventDistance: string | null, targetDistance: string): boolean {
  if (!eventDistance) return false;
  
  const event = eventDistance.toLowerCase();
  const target = targetDistance.toLowerCase();

  if (target.includes('5k') || target.includes('5000')) {
    return event.includes('5k') || event.includes('5000');
  }
  if (target.includes('10k') || target.includes('10000')) {
    return event.includes('10k') || event.includes('10000');
  }
  if (target.includes('half') || target.includes('21k')) {
    return event.includes('half') || event.includes('21k');
  }
  if (target.includes('marathon') || target.includes('42k')) {
    return event.includes('marathon') || event.includes('42k');
  }

  return event === target;
}
