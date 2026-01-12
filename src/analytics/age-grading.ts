import type { RaceResultRow } from '../types.js';

export interface AgeGradedResult {
  rawTime: string;
  ageGradedTime: string;
  ageGradedPercentage: number;
  age: number;
  distance: string;
  gender: string;
}

/**
 * Calculate age from date of birth
 */
export function calculateAge(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  
  const birthDate = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  return age;
}

/**
 * Parse time string to seconds
 */
export function parseTimeToSeconds(timeStr: string | null): number | null {
  if (!timeStr) return null;

  // Format: HH:MM:SS or MM:SS
  const parts = timeStr.split(':').map(Number);
  
  if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return null;
}

/**
 * Format seconds to time string (MM:SS or HH:MM:SS)
 */
export function formatTimeFromSeconds(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Get WMA age factor for a given age, distance, and gender
 * This is a simplified implementation. For production, use official WMA tables.
 * 
 * Age factors are approximate based on WMA standards:
 * - Factors increase with age (older athletes get more favorable grading)
 * - Factors vary by distance (longer distances have different factors)
 * - Factors differ by gender
 */
function getWMAAgeFactor(age: number, distance: string, gender: string): number {
  // Base factors (simplified - should use official WMA tables)
  // These are approximate factors for common distances
  
  // Normalize distance
  const dist = distance.toLowerCase();
  let baseFactor = 1.0;
  
  // Distance-specific base factors (approximate)
  if (dist.includes('5k') || dist.includes('5000')) {
    baseFactor = gender === 'M' || gender === 'Male' ? 0.95 : 0.97;
  } else if (dist.includes('10k') || dist.includes('10000')) {
    baseFactor = gender === 'M' || gender === 'Male' ? 0.96 : 0.98;
  } else if (dist.includes('half') || dist.includes('21k') || dist.includes('21097')) {
    baseFactor = gender === 'M' || gender === 'Male' ? 0.97 : 0.99;
  } else if (dist.includes('marathon') || dist.includes('42k') || dist.includes('42195')) {
    baseFactor = gender === 'M' || gender === 'Male' ? 0.98 : 1.0;
  }

  // Age adjustment (simplified linear model - should use WMA lookup table)
  // WMA factors increase with age, with different curves for different age groups
  let ageAdjustment = 1.0;
  
  if (age < 35) {
    // Under 35: minimal adjustment
    ageAdjustment = 1.0 - (35 - age) * 0.001;
  } else if (age < 40) {
    // 35-39: small adjustment
    ageAdjustment = 1.0 + (age - 35) * 0.01;
  } else if (age < 50) {
    // 40-49: moderate adjustment
    ageAdjustment = 1.05 + (age - 40) * 0.02;
  } else if (age < 60) {
    // 50-59: larger adjustment
    ageAdjustment = 1.25 + (age - 50) * 0.03;
  } else if (age < 70) {
    // 60-69: significant adjustment
    ageAdjustment = 1.55 + (age - 60) * 0.04;
  } else {
    // 70+: very significant adjustment
    ageAdjustment = 1.95 + (age - 70) * 0.05;
  }

  // Gender adjustment (women generally have slightly different factors)
  const genderMultiplier = (gender === 'F' || gender === 'Female') ? 1.02 : 1.0;

  return baseFactor * ageAdjustment * genderMultiplier;
}

/**
 * Calculate age-graded time
 */
export function getAgeGradedTime(
  rawTime: string,
  age: number,
  gender: string,
  distance: string
): string {
  const rawSeconds = parseTimeToSeconds(rawTime);
  if (rawSeconds === null || age < 5) {
    return rawTime; // Return original if can't calculate
  }

  const ageFactor = getWMAAgeFactor(age, distance, gender);
  const ageGradedSeconds = rawSeconds / ageFactor;

  return formatTimeFromSeconds(ageGradedSeconds);
}

/**
 * Calculate age-graded percentage
 * This represents how close the performance is to the world record for that age
 * 100% = world record level, higher is better
 */
export function getAgeGradedPercentage(
  rawTime: string,
  age: number,
  gender: string,
  distance: string
): number {
  const rawSeconds = parseTimeToSeconds(rawTime);
  if (rawSeconds === null || age < 5) {
    return 0;
  }

  // Get world record times for the distance (approximate - should use official records)
  const worldRecordSeconds = getWorldRecordSeconds(distance, gender);
  if (!worldRecordSeconds) {
    return 0;
  }

  // Calculate age-graded equivalent
  const ageFactor = getWMAAgeFactor(age, distance, gender);
  const ageGradedSeconds = rawSeconds / ageFactor;

  // Percentage = (world record / age-graded time) * 100
  const percentage = (worldRecordSeconds / ageGradedSeconds) * 100;

  return Math.round(percentage * 10) / 10; // Round to 1 decimal
}

/**
 * Get world record time in seconds (approximate - should use official records)
 */
function getWorldRecordSeconds(distance: string, gender: string): number | null {
  const dist = distance.toLowerCase();
  
  // Approximate world records in seconds
  // These should be replaced with official WMA world records
  if (dist.includes('5k') || dist.includes('5000')) {
    return gender === 'M' || gender === 'Male' ? 12 * 60 + 35 : 14 * 60 + 11; // ~12:35 / ~14:11
  } else if (dist.includes('10k') || dist.includes('10000')) {
    return gender === 'M' || gender === 'Male' ? 26 * 60 + 11 : 29 * 60 + 17; // ~26:11 / ~29:17
  } else if (dist.includes('half') || dist.includes('21k') || dist.includes('21097')) {
    return gender === 'M' || gender === 'Male' ? 57 * 60 + 31 : 62 * 60 + 52; // ~57:31 / ~62:52
  } else if (dist.includes('marathon') || dist.includes('42k') || dist.includes('42195')) {
    return gender === 'M' || gender === 'Male' ? 2 * 3600 + 1 * 60 + 39 : 2 * 3600 + 14 * 60 + 4; // ~2:01:39 / ~2:14:04
  }

  return null;
}

/**
 * Calculate age grade for a race result
 */
export function calculateAgeGrade(
  result: RaceResultRow,
  dateOfBirth: string | null,
  distance: string
): AgeGradedResult | null {
  if (!result.finish_time) {
    return null;
  }

  const age = calculateAge(dateOfBirth);
  if (age === null || age < 5) {
    return null;
  }

  const gender = result.gender || 'M';
  const ageGradedTime = getAgeGradedTime(result.finish_time, age, gender, distance);
  const ageGradedPercentage = getAgeGradedPercentage(result.finish_time, age, gender, distance);

  return {
    rawTime: result.finish_time,
    ageGradedTime,
    ageGradedPercentage,
    age,
    distance,
    gender,
  };
}

/**
 * Get age-graded performance over time
 */
export async function getAgeGradedPerformanceOverTime(
  results: RaceResultRow[],
  dateOfBirth: string | null,
  distance: string
): Promise<Array<{
  date: string;
  rawTime: string;
  ageGradedTime: string;
  ageGradedPercentage: number;
  age: number;
}>> {
  const performanceData = [];

  for (const result of results) {
    const ageGrade = calculateAgeGrade(result, dateOfBirth, distance);
    if (ageGrade) {
      performanceData.push({
        date: result.created_at,
        rawTime: ageGrade.rawTime,
        ageGradedTime: ageGrade.ageGradedTime,
        ageGradedPercentage: ageGrade.ageGradedPercentage,
        age: ageGrade.age,
      });
    }
  }

  return performanceData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}
