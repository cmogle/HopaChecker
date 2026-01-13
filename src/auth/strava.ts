import axios from 'axios';
import { supabase } from '../db/supabase.js';
import { normalizeName } from '../db/supabase.js';
import type { Athlete } from '../storage/supabase.js';
import { getAthleteResults } from '../storage/supabase.js';
import { getEventById } from '../storage/supabase.js';

export interface StravaAthlete {
  id: number;
  username: string;
  firstname: string;
  lastname: string;
  profile_medium: string;
  profile: string;
}

export interface StravaActivity {
  id: number;
  name: string;
  distance: number; // meters
  moving_time: number; // seconds
  elapsed_time: number; // seconds
  start_date: string; // ISO 8601
  start_date_local: string;
  timezone: string;
  location_city: string | null;
  location_state: string | null;
  location_country: string | null;
  type: string; // 'Run', 'Ride', etc.
}

export interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp
  athlete: StravaAthlete;
}

/**
 * Get Strava OAuth authorization URL
 */
export function getStravaAuthUrl(redirectUri: string): string {
  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) {
    throw new Error('STRAVA_CLIENT_ID environment variable not set');
  }

  const scopes = 'read,activity:read';
  const baseUrl = 'https://www.strava.com/oauth/authorize';
  
  return `${baseUrl}?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scopes}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeStravaCode(
  code: string,
  redirectUri: string
): Promise<StravaTokenResponse> {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Strava OAuth credentials not configured');
  }

  try {
    const response = await axios.post<StravaTokenResponse>(
      'https://www.strava.com/oauth/token',
      {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }
    );

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Strava token exchange failed: ${error.response?.data?.message || error.message}`);
    }
    throw error;
  }
}

/**
 * Refresh Strava access token
 */
export async function refreshStravaToken(refreshToken: string): Promise<StravaTokenResponse> {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Strava OAuth credentials not configured');
  }

  try {
    const response = await axios.post<StravaTokenResponse>(
      'https://www.strava.com/oauth/token',
      {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }
    );

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Strava token refresh failed: ${error.response?.data?.message || error.message}`);
    }
    throw error;
  }
}

/**
 * Get Strava athlete profile
 */
export async function getStravaAthlete(accessToken: string): Promise<StravaAthlete> {
  try {
    const response = await axios.get<StravaAthlete>(
      'https://www.strava.com/api/v3/athlete',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Failed to get Strava athlete: ${error.response?.data?.message || error.message}`);
    }
    throw error;
  }
}

/**
 * Get Strava athlete activities
 */
export async function getStravaActivities(
  accessToken: string,
  before?: number,
  after?: number,
  perPage: number = 30
): Promise<StravaActivity[]> {
  try {
    const params: Record<string, string> = {
      per_page: perPage.toString(),
    };
    if (before) params.before = before.toString();
    if (after) params.after = after.toString();

    const response = await axios.get<StravaActivity[]>(
      'https://www.strava.com/api/v3/athlete/activities',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        params,
      }
    );

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Failed to get Strava activities: ${error.response?.data?.message || error.message}`);
    }
    throw error;
  }
}

/**
 * Store Strava link in database
 */
export async function storeStravaLink(
  athleteId: string,
  userId: string,
  stravaAthleteId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: number
): Promise<void> {
  const expiresAtDate = new Date(expiresAt * 1000).toISOString();

  // Check if link already exists
  const { data: existing } = await supabase
    .from('strava_links')
    .select('id')
    .eq('athlete_id', athleteId)
    .eq('strava_athlete_id', stravaAthleteId)
    .single();

  if (existing) {
    // Update existing link
    const { error } = await (supabase
      .from('strava_links') as any)
      .update({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAtDate,
        updated_at: new Date().toISOString(),
      })
      .eq('id', (existing as any).id);

    if (error) {
      throw new Error(`Failed to update Strava link: ${error.message}`);
    }
  } else {
    // Insert new link
    const { error } = await (supabase
      .from('strava_links') as any)
      .insert({
        athlete_id: athleteId,
        user_id: userId,
        strava_athlete_id: stravaAthleteId,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAtDate,
      });

    if (error) {
      throw new Error(`Failed to store Strava link: ${error.message}`);
    }
  }
}

/**
 * Get Strava link for athlete
 */
export async function getStravaLink(athleteId: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  stravaAthleteId: string;
} | null> {
  const { data, error } = await supabase
    .from('strava_links')
    .select('access_token, refresh_token, expires_at, strava_athlete_id')
    .eq('athlete_id', athleteId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to get Strava link: ${error.message}`);
  }

  const typedData = data as {
    access_token: string;
    refresh_token: string | null;
    expires_at: string | null;
    strava_athlete_id: string;
  };
  return {
    accessToken: typedData.access_token,
    refreshToken: typedData.refresh_token,
    expiresAt: typedData.expires_at,
    stravaAthleteId: typedData.strava_athlete_id,
  };
}

/**
 * Verify athlete identity using Strava
 * Matches Strava profile name with athlete name and checks activity alignment
 */
export async function verifyAthleteWithStrava(
  athleteId: string,
  userId: string,
  stravaAthlete: StravaAthlete,
  accessToken: string
): Promise<{ verified: boolean; confidence: number; reason?: string }> {
  // Get athlete profile
  const { getAthleteById } = await import('../storage/supabase.js');
  const athlete = await getAthleteById(athleteId);

  if (!athlete) {
    return { verified: false, confidence: 0, reason: 'Athlete not found' };
  }

  let confidence = 0;
  const reasons: string[] = [];

  // 1. Name matching (fuzzy)
  const stravaFullName = `${stravaAthlete.firstname} ${stravaAthlete.lastname}`.trim();
  const normalizedStravaName = normalizeName(stravaFullName);
  const normalizedAthleteName = normalizeName(athlete.name);

  // Simple name matching
  if (normalizedStravaName === normalizedAthleteName) {
    confidence += 50;
    reasons.push('Exact name match');
  } else if (
    normalizedStravaName.includes(normalizedAthleteName) ||
    normalizedAthleteName.includes(normalizedStravaName)
  ) {
    confidence += 30;
    reasons.push('Partial name match');
  } else {
    // Use fuzzy matching
    const similarity = calculateNameSimilarity(normalizedStravaName, normalizedAthleteName);
    if (similarity > 0.7) {
      confidence += Math.round(similarity * 30);
      reasons.push(`Name similarity: ${Math.round(similarity * 100)}%`);
    }
  }

  // 2. Activity alignment check
  try {
    const athleteResults = await getAthleteResults(athleteId);
    
    if (athleteResults.length > 0) {
      // Get activities from last 2 years
      const twoYearsAgo = Math.floor(Date.now() / 1000) - 2 * 365 * 24 * 60 * 60;
      const activities = await getStravaActivities(accessToken, undefined, twoYearsAgo, 100);

      // Check if race dates align with Strava activities
      let alignedRaces = 0;
      for (const result of athleteResults.slice(0, 10)) { // Check last 10 results
        const event = await getEventById(result.event_id);
        if (!event) continue;

        const raceDate = new Date(event.event_date);
        const raceDateStart = new Date(raceDate);
        raceDateStart.setHours(0, 0, 0, 0);
        const raceDateEnd = new Date(raceDate);
        raceDateEnd.setHours(23, 59, 59, 999);

        // Check if there's a run activity on or near the race date
        const matchingActivity = activities.find((activity) => {
          if (activity.type !== 'Run') return false;
          const activityDate = new Date(activity.start_date_local);
          return activityDate >= raceDateStart && activityDate <= raceDateEnd;
        });

        if (matchingActivity) {
          alignedRaces++;
        }
      }

      if (alignedRaces > 0) {
        const alignmentScore = Math.min((alignedRaces / Math.min(athleteResults.length, 10)) * 50, 50);
        confidence += alignmentScore;
        reasons.push(`${alignedRaces} race(s) aligned with Strava activities`);
      }
    }
  } catch (error) {
    // If we can't fetch activities, don't fail verification, just skip this check
    console.warn('Could not verify activity alignment:', error);
  }

  const verified = confidence >= 50; // Minimum 50% confidence to verify

  return {
    verified,
    confidence: Math.min(confidence, 100),
    reason: reasons.join('; '),
  };
}

/**
 * Simple name similarity calculation (Levenshtein-based)
 */
function calculateNameSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) {
    return 1.0;
  }

  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}
