import { getAthleteResults } from '../storage/supabase.js';
import { parseTimeToSeconds } from './age-grading.js';
import type { RaceResultRow } from '../types.js';

export interface H2HStats {
  athlete1Id: string;
  athlete2Id: string;
  commonRaces: number;
  athlete1Wins: number;
  athlete2Wins: number;
  ties: number;
  averageGapSeconds: number;
  races: Array<{
    eventId: string;
    eventName: string;
    date: string;
    athlete1Time: string;
    athlete2Time: string;
    winner: string;
    gapSeconds: number;
  }>;
}

/**
 * Calculate head-to-head comparison between two athletes
 */
export async function calculateHeadToHead(
  athlete1Id: string,
  athlete2Id: string
): Promise<H2HStats> {
  const results1 = await getAthleteResults(athlete1Id);
  const results2 = await getAthleteResults(athlete2Id);

  // Find common events (races where both athletes participated)
  const events1 = new Map<string, RaceResultRow>();
  const events2 = new Map<string, RaceResultRow>();

  for (const result of results1) {
    if (result.finish_time && result.event_id) {
      events1.set(result.event_id, result);
    }
  }

  for (const result of results2) {
    if (result.finish_time && result.event_id) {
      events2.set(result.event_id, result);
    }
  }

  const commonEventIds = Array.from(events1.keys()).filter(id => events2.has(id));

  const races: H2HStats['races'] = [];
  let athlete1Wins = 0;
  let athlete2Wins = 0;
  let ties = 0;
  let totalGap = 0;

  for (const eventId of commonEventIds) {
    const result1 = events1.get(eventId)!;
    const result2 = events2.get(eventId)!;

    const time1 = parseTimeToSeconds(result1.finish_time);
    const time2 = parseTimeToSeconds(result2.finish_time);

    if (time1 === null || time2 === null) continue;

    const gap = Math.abs(time1 - time2);
    totalGap += gap;

    let winner = athlete1Id;
    if (time2 < time1) {
      winner = athlete2Id;
      athlete2Wins++;
    } else if (time1 < time2) {
      athlete1Wins++;
    } else {
      winner = 'tie';
      ties++;
    }

    races.push({
      eventId,
      eventName: 'Event', // TODO: Get event name from event_id
      date: result1.created_at,
      athlete1Time: result1.finish_time,
      athlete2Time: result2.finish_time,
      winner,
      gapSeconds: gap,
    });
  }

  return {
    athlete1Id,
    athlete2Id,
    commonRaces: races.length,
    athlete1Wins,
    athlete2Wins,
    ties,
    averageGapSeconds: races.length > 0 ? Math.round(totalGap / races.length) : 0,
    races: races.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
  };
}
