import { supabase } from '../db/supabase.js';
import { getEventById } from '../storage/supabase.js';
import { parseTimeToSeconds, formatTimeFromSeconds } from './age-grading.js';

export interface CourseDifficulty {
  eventId: string;
  difficultyIndex: number; // Positive = harder, negative = easier
  courseAdjustedTime?: string;
}

/**
 * Calculate Course Difficulty Index (CDI) for an event
 * Algorithm: Compare top 10% finishers' times in this race vs their historical averages
 */
export async function calculateCourseDifficulty(eventId: string): Promise<CourseDifficulty | null> {
  const event = await getEventById(eventId);
  if (!event) {
    return null;
  }

  // Get all results for this event, sorted by position
  const { data: eventResults, error } = await supabase
    .from('race_results')
    .select('*')
    .eq('event_id', eventId)
    .not('finish_time', 'is', null)
    .not('position', 'is', null)
    .order('position', { ascending: true });

  if (error || !eventResults || eventResults.length === 0) {
    return null;
  }

  // Get top 10% of finishers
  const top10PercentCount = Math.max(1, Math.floor(eventResults.length * 0.1));
  const topFinishers = eventResults.slice(0, top10PercentCount);

  // Get their athlete IDs
  const athleteIds = topFinishers
    .map((r: any) => r.athlete_id)
    .filter((id: any): id is string => id !== null);

  if (athleteIds.length === 0) {
    return null;
  }

  // Calculate their average time in this race
  const raceTimes = topFinishers
    .map((r: any) => parseTimeToSeconds(r.finish_time))
    .filter((t): t is number => t !== null);

  if (raceTimes.length === 0) {
    return null;
  }

  const raceAverage = raceTimes.reduce((sum, t) => sum + t, 0) / raceTimes.length;

  // Calculate their historical average (all other races)
  const historicalAverages: number[] = [];

  for (const athleteId of athleteIds) {
    const { data: athleteResults } = await supabase
      .from('race_results')
      .select('finish_time')
      .eq('athlete_id', athleteId)
      .neq('event_id', eventId)
      .not('finish_time', 'is', null);

    if (athleteResults && athleteResults.length > 0) {
      const times = athleteResults
        .map((r: any) => parseTimeToSeconds(r.finish_time))
        .filter((t): t is number => t !== null);

      if (times.length > 0) {
        const avg = times.reduce((sum, t) => sum + t, 0) / times.length;
        historicalAverages.push(avg);
      }
    }
  }

  if (historicalAverages.length === 0) {
    return null;
  }

  const historicalAverage = historicalAverages.reduce((sum, a) => sum + a, 0) / historicalAverages.length;

  // Calculate CDI: (race_avg - historical_avg) / historical_avg * 100
  const difficultyIndex = ((raceAverage - historicalAverage) / historicalAverage) * 100;

  return {
    eventId,
    difficultyIndex: Math.round(difficultyIndex * 10) / 10, // Round to 1 decimal
  };
}

interface ResultWithEvent {
  finish_time: string | null;
  event_id: string;
}

/**
 * Get course-adjusted time for a result
 */
export async function getCourseAdjustedTime(resultId: string): Promise<string | null> {
  // Get result and event
  const { data: result } = await supabase
    .from('race_results')
    .select('finish_time, event_id')
    .eq('id', resultId)
    .single();

  const typedResult = result as ResultWithEvent | null;

  if (!typedResult || !typedResult.finish_time || !typedResult.event_id) {
    return null;
  }

  const cdi = await calculateCourseDifficulty(typedResult.event_id);
  if (!cdi) {
    return typedResult.finish_time;
  }

  // Adjust time: if course is 5% harder, subtract 5% from time
  const rawSeconds = parseTimeToSeconds(typedResult.finish_time);
  if (rawSeconds === null) {
    return typedResult.finish_time;
  }

  // Negative difficulty = easier course = faster time, so subtract
  // Positive difficulty = harder course = slower time, so add
  const adjustedSeconds = rawSeconds * (1 - cdi.difficultyIndex / 100);

  return formatTimeFromSeconds(adjustedSeconds);
}
