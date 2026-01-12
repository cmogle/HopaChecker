import Fuse from 'fuse.js';
import { normalizeName } from '../db/supabase.js';
import { getUnmatchedResults, searchAthletes, linkResultToAthlete, type RaceResultRow, type Athlete } from '../storage/supabase.js';

interface MatchCandidate {
  athlete: Athlete;
  result: RaceResultRow;
  score: number;
  confidence: number;
}

/**
 * Find potential athlete matches for a race result
 * Enhanced with multi-factor matching (name, position proximity, club, geography)
 */
export async function findMatchesForResult(
  result: RaceResultRow,
  threshold: number = 0.6
): Promise<MatchCandidate[]> {
  // Search for athletes with similar normalized names
  const normalizedResultName = normalizeName(result.name);
  
  // Get all athletes for fuzzy matching
  const allAthletes = await searchAthletes(result.name, 50);
  
  if (allAthletes.length === 0) {
    return [];
  }

  // Use Fuse.js for fuzzy matching
  const fuse = new Fuse(allAthletes, {
    keys: ['normalized_name', 'name'],
    threshold,
    includeScore: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  const nameMatches = fuse.search(normalizedResultName);
  
  // Calculate multi-factor confidence scores
  const candidates = await Promise.all(
    nameMatches
      .filter((match) => match.score !== undefined && match.score < threshold)
      .map(async (match) => {
        const baseScore = match.score || 1;
        const nameConfidence = Math.round((1 - baseScore) * 100);
        
        // Additional factors
        const positionScore = await calculatePositionProximityScore(result, match.item.id);
        const clubScore = await calculateClubMatchScore(result, match.item);
        const geographyScore = await calculateGeographyScore(result, match.item);
        
        // Weighted confidence: name (60%), position (20%), club (10%), geography (10%)
        const totalConfidence = Math.min(100, Math.round(
          nameConfidence * 0.6 +
          positionScore * 0.2 +
          clubScore * 0.1 +
          geographyScore * 0.1
        ));

        return {
          athlete: match.item,
          result,
          score: baseScore,
          confidence: totalConfidence,
        };
      })
  );

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Calculate position proximity score (if athletes finish near each other in multiple races)
 */
async function calculatePositionProximityScore(
  result: RaceResultRow,
  athleteId: string
): Promise<number> {
  if (!result.position || !result.event_id) return 0;

  const { getAthleteResults } = await import('../storage/supabase.js');
  const athleteResults = await getAthleteResults(athleteId);

  // Find results in the same event
  const sameEventResults = athleteResults.filter(r => r.event_id === result.event_id);
  
  if (sameEventResults.length === 0) return 0;

  // Check if positions are close (within 10 positions)
  for (const athleteResult of sameEventResults) {
    if (athleteResult.position && Math.abs(athleteResult.position - result.position) <= 10) {
      return 50; // Moderate confidence boost
    }
  }

  return 0;
}

/**
 * Calculate club match score (if both have same club affiliation)
 */
async function calculateClubMatchScore(
  result: RaceResultRow,
  athlete: Athlete
): Promise<number> {
  // TODO: Extract club from result metadata or athlete profile
  // For now, return 0 as club data may not be available
  return 0;
}

/**
 * Calculate geography score (if both are from same location)
 */
async function calculateGeographyScore(
  result: RaceResultRow,
  athlete: Athlete
): Promise<number> {
  if (!athlete.country) return 0;

  // Check if result country matches athlete country
  if (result.country && result.country.toLowerCase() === athlete.country.toLowerCase()) {
    return 30; // Small confidence boost
  }

  return 0;
}

/**
 * Find all unmatched results and suggest matches
 */
export async function findMatchesForUnmatchedResults(
  eventId?: string,
  threshold: number = 0.6
): Promise<Map<string, MatchCandidate[]>> {
  const unmatchedResults = await getUnmatchedResults(eventId);
  const matchesMap = new Map<string, MatchCandidate[]>();

  for (const result of unmatchedResults) {
    const matches = await findMatchesForResult(result, threshold);
    if (matches.length > 0) {
      matchesMap.set(result.id, matches);
    }
  }

  return matchesMap;
}

/**
 * Link a result to an athlete
 */
export async function linkResult(resultId: string, athleteId: string): Promise<void> {
  await linkResultToAthlete(resultId, athleteId);
}

/**
 * Auto-match results based on name similarity
 * This will automatically link results where confidence is very high
 */
export async function autoMatchResults(
  confidenceThreshold: number = 90,
  eventId?: string
): Promise<{ matched: number; skipped: number }> {
  const unmatchedResults = await getUnmatchedResults(eventId);
  let matched = 0;
  let skipped = 0;

  for (const result of unmatchedResults) {
    const matches = await findMatchesForResult(result, 0.3); // Lower threshold for auto-match
    
    // Only auto-match if there's exactly one high-confidence match
    if (matches.length === 1 && matches[0].confidence >= confidenceThreshold) {
      await linkResult(result.id, matches[0].athlete.id);
      matched++;
    } else {
      skipped++;
    }
  }

  return { matched, skipped };
}

/**
 * Suggest matches for a specific athlete
 */
export async function suggestMatchesForAthlete(
  athleteId: string,
  threshold: number = 0.6
): Promise<MatchCandidate[]> {
  const { getAthleteById } = await import('../storage/supabase.js');
  const athlete = await getAthleteById(athleteId);
  
  if (!athlete) {
    return [];
  }

  const unmatchedResults = await getUnmatchedResults();
  const candidates: MatchCandidate[] = [];

  for (const result of unmatchedResults) {
    const normalizedResultName = normalizeName(result.name);
    const normalizedAthleteName = normalizeName(athlete.name);

    // Simple string similarity check
    if (normalizedResultName.includes(normalizedAthleteName) || 
        normalizedAthleteName.includes(normalizedResultName)) {
      // Use Fuse for more accurate scoring
      const fuse = new Fuse([result], {
        keys: ['normalized_name', 'name'],
        threshold,
        includeScore: true,
      });

      const matches = fuse.search(normalizedAthleteName);
      if (matches.length > 0 && matches[0].score !== undefined && matches[0].score < threshold) {
        candidates.push({
          athlete,
          result,
          score: matches[0].score || 1,
          confidence: Math.round((1 - (matches[0].score || 1)) * 100),
        });
      }
    }
  }

  return candidates.sort((a, b) => a.score - b.score);
}
