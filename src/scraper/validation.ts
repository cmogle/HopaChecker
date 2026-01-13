/**
 * Validation Service
 * Comprehensive validation for scraped race results
 */

import type {
  ScrapedResults,
  EnhancedRaceResult,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ValidationStatistics,
  TimingCheckpoint,
  RaceType,
} from './types.js';

import {
  RUNNING_CHECKPOINTS,
  TRIATHLON_CHECKPOINTS,
  DUATHLON_CHECKPOINTS,
  WORLD_RECORDS,
  REASONABLE_CUTOFFS,
  getExpectedCheckpoints,
  getDistanceMeters,
  detectRaceType,
  validateCheckpointProgression,
} from './checkpoints.js';

// ============================================
// Validation Rules
// ============================================

/**
 * Validation rules by distance
 */
interface DistanceValidationRules {
  distanceMeters: number;
  minTimeSeconds: number;
  maxTimeSeconds: number;
  worldRecordMale?: number;
  worldRecordFemale?: number;
  expectedCheckpoints: string[];
  raceType: RaceType;
}

const DISTANCE_RULES: Record<string, DistanceValidationRules> = {
  '5K': {
    distanceMeters: 5000,
    minTimeSeconds: 12 * 60, // 12 minutes (world record ~12:35)
    maxTimeSeconds: 60 * 60, // 1 hour
    worldRecordMale: 12 * 60 + 35,
    worldRecordFemale: 14 * 60,
    expectedCheckpoints: ['2.5km', 'finish'],
    raceType: 'running',
  },
  '10K': {
    distanceMeters: 10000,
    minTimeSeconds: 26 * 60, // 26 minutes (world record ~26:11)
    maxTimeSeconds: 2 * 60 * 60, // 2 hours
    worldRecordMale: 26 * 60 + 11,
    worldRecordFemale: 28 * 60 + 54,
    expectedCheckpoints: ['5km', 'finish'],
    raceType: 'running',
  },
  'Half Marathon': {
    distanceMeters: 21097,
    minTimeSeconds: 57 * 60, // 57 minutes (world record ~57:30)
    maxTimeSeconds: 4 * 60 * 60, // 4 hours
    worldRecordMale: 57 * 60 + 30,
    worldRecordFemale: 63 * 60 + 44,
    expectedCheckpoints: ['5km', '10km', '15km', '20km', 'finish'],
    raceType: 'running',
  },
  'Marathon': {
    distanceMeters: 42195,
    minTimeSeconds: 2 * 60 * 60, // 2 hours (world record ~2:00:35)
    maxTimeSeconds: 8 * 60 * 60, // 8 hours
    worldRecordMale: 2 * 3600 + 35,
    worldRecordFemale: 2 * 3600 + 11 * 60 + 53,
    expectedCheckpoints: ['5km', '10km', '15km', '21.1km', '25km', '30km', '35km', '40km', 'finish'],
    raceType: 'running',
  },
  'Ultra 50K': {
    distanceMeters: 50000,
    minTimeSeconds: 2.5 * 60 * 60, // 2.5 hours
    maxTimeSeconds: 12 * 60 * 60, // 12 hours
    expectedCheckpoints: ['10km', '20km', '30km', '40km', 'finish'],
    raceType: 'ultra',
  },
  'Ultra 100K': {
    distanceMeters: 100000,
    minTimeSeconds: 6 * 60 * 60, // 6 hours
    maxTimeSeconds: 24 * 60 * 60, // 24 hours
    expectedCheckpoints: ['25km', '50km', '75km', 'finish'],
    raceType: 'ultra',
  },
  'Sprint Triathlon': {
    distanceMeters: 25750, // 750m swim + 20km bike + 5km run
    minTimeSeconds: 50 * 60, // 50 minutes
    maxTimeSeconds: 3 * 60 * 60, // 3 hours
    expectedCheckpoints: ['swim', 'T1', 'bike', 'T2', 'run', 'finish'],
    raceType: 'triathlon',
  },
  'Olympic Triathlon': {
    distanceMeters: 51500, // 1500m swim + 40km bike + 10km run
    minTimeSeconds: 1.5 * 60 * 60, // 1.5 hours
    maxTimeSeconds: 5 * 60 * 60, // 5 hours
    expectedCheckpoints: ['swim', 'T1', 'bike', 'T2', 'run', 'finish'],
    raceType: 'triathlon',
  },
  'Half Ironman': {
    distanceMeters: 112997, // 1.9km swim + 90km bike + 21.1km run
    minTimeSeconds: 3.5 * 60 * 60, // 3.5 hours
    maxTimeSeconds: 9 * 60 * 60, // 9 hours
    expectedCheckpoints: ['swim', 'T1', 'bike', 'T2', 'run_10km', 'finish'],
    raceType: 'triathlon',
  },
  'Ironman': {
    distanceMeters: 225995, // 3.8km swim + 180km bike + 42.2km run
    minTimeSeconds: 7 * 60 * 60, // 7 hours
    maxTimeSeconds: 17 * 60 * 60, // 17 hours
    expectedCheckpoints: ['swim', 'T1', 'bike', 'T2', 'run_21km', 'finish'],
    raceType: 'triathlon',
  },
  'Sprint Duathlon': {
    distanceMeters: 27500, // 5km run + 20km bike + 2.5km run
    minTimeSeconds: 50 * 60, // 50 minutes
    maxTimeSeconds: 3 * 60 * 60, // 3 hours
    expectedCheckpoints: ['run1', 'T1', 'bike', 'T2', 'run2', 'finish'],
    raceType: 'duathlon',
  },
};

// ============================================
// Time Parsing
// ============================================

/**
 * Parse time string to seconds
 * Handles formats: HH:MM:SS, H:MM:SS, MM:SS, M:SS
 */
export function parseTimeToSeconds(time: string | undefined | null): number | null {
  if (!time || typeof time !== 'string') return null;

  const cleaned = time.trim();
  if (!cleaned) return null;

  // Handle DNF, DNS, DQ
  if (/^(dnf|dns|dq)$/i.test(cleaned)) {
    return null;
  }

  const parts = cleaned.split(':').map((p) => parseFloat(p.trim()));

  if (parts.some(isNaN)) return null;

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 1) {
    // Assume seconds
    return parts[0];
  }

  return null;
}

/**
 * Format seconds to time string
 */
export function formatSecondsToTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// ============================================
// Field Validators
// ============================================

/**
 * Validate required fields are present
 */
function validateRequiredFields(
  result: EnhancedRaceResult,
  index: number
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!result.name || result.name.trim() === '') {
    errors.push({
      field: 'name',
      resultIndex: index,
      message: 'Missing athlete name',
      severity: 'critical',
    });
  }

  if (result.position === undefined || result.position === null || result.position < 0) {
    errors.push({
      field: 'position',
      resultIndex: index,
      message: 'Invalid or missing position',
      severity: 'error',
    });
  }

  if (!result.finishTime && result.status === 'finished') {
    errors.push({
      field: 'finishTime',
      resultIndex: index,
      message: 'Missing finish time for finished athlete',
      severity: 'error',
    });
  }

  return errors;
}

/**
 * Validate time is within reasonable bounds
 */
function validateTimeReasonable(
  result: EnhancedRaceResult,
  distanceName: string,
  index: number
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!result.finishTime || result.status !== 'finished') {
    return errors;
  }

  const timeSeconds = parseTimeToSeconds(result.finishTime);
  if (timeSeconds === null) {
    errors.push({
      field: 'finishTime',
      resultIndex: index,
      message: `Invalid time format: ${result.finishTime}`,
      severity: 'error',
    });
    return errors;
  }

  // Find matching rules
  const rules = DISTANCE_RULES[distanceName];
  if (rules) {
    // Check minimum time (faster than world record)
    if (timeSeconds < rules.minTimeSeconds) {
      errors.push({
        field: 'finishTime',
        resultIndex: index,
        message: `Time ${result.finishTime} is impossibly fast for ${distanceName} (minimum: ${formatSecondsToTime(rules.minTimeSeconds)})`,
        severity: 'error',
      });
    }

    // Check maximum time (beyond reasonable cutoff)
    if (timeSeconds > rules.maxTimeSeconds) {
      errors.push({
        field: 'finishTime',
        resultIndex: index,
        message: `Time ${result.finishTime} exceeds reasonable cutoff for ${distanceName} (maximum: ${formatSecondsToTime(rules.maxTimeSeconds)})`,
        severity: 'error',
      });
    }
  }

  return errors;
}

/**
 * Validate checkpoint progression
 */
function validateCheckpoints(
  result: EnhancedRaceResult,
  index: number
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!result.checkpoints || result.checkpoints.length === 0) {
    return errors;
  }

  // Check cumulative times are monotonically increasing
  let lastTime = 0;
  const sortedCheckpoints = [...result.checkpoints].sort(
    (a, b) => a.checkpointOrder - b.checkpointOrder
  );

  for (const cp of sortedCheckpoints) {
    if (!cp.cumulativeTime) continue;

    const time = parseTimeToSeconds(cp.cumulativeTime);
    if (time === null) {
      errors.push({
        field: `checkpoints.${cp.checkpointName}.cumulativeTime`,
        resultIndex: index,
        message: `Invalid checkpoint time format: ${cp.cumulativeTime}`,
        severity: 'error',
      });
      continue;
    }

    if (time < lastTime) {
      errors.push({
        field: `checkpoints.${cp.checkpointName}.cumulativeTime`,
        resultIndex: index,
        message: `Checkpoint time goes backwards: ${cp.checkpointName} (${cp.cumulativeTime}) is before previous checkpoint`,
        severity: 'error',
      });
    }

    lastTime = time;
  }

  // Verify final checkpoint matches finish time
  if (result.finishTime && sortedCheckpoints.length > 0) {
    const lastCheckpoint = sortedCheckpoints[sortedCheckpoints.length - 1];
    if (lastCheckpoint.cumulativeTime) {
      const finishTime = parseTimeToSeconds(result.finishTime);
      const lastCpTime = parseTimeToSeconds(lastCheckpoint.cumulativeTime);

      if (finishTime !== null && lastCpTime !== null) {
        const diff = Math.abs(finishTime - lastCpTime);
        if (diff > 60) {
          // More than 1 minute difference
          errors.push({
            field: 'checkpoints',
            resultIndex: index,
            message: `Last checkpoint time (${lastCheckpoint.cumulativeTime}) doesn't match finish time (${result.finishTime})`,
            severity: 'error',
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Validate gender field
 */
function validateGender(
  result: EnhancedRaceResult,
  index: number
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (result.gender) {
    const normalized = result.gender.toUpperCase().trim();
    if (!['M', 'F', 'X', 'MALE', 'FEMALE', 'OTHER'].includes(normalized)) {
      errors.push({
        field: 'gender',
        resultIndex: index,
        message: `Invalid gender value: ${result.gender}`,
        severity: 'error',
      });
    }
  }

  return errors;
}

/**
 * Validate bib number
 */
function validateBibNumber(
  result: EnhancedRaceResult,
  index: number
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (result.bibNumber) {
    // Check for suspicious patterns
    if (result.bibNumber.length > 20) {
      errors.push({
        field: 'bibNumber',
        resultIndex: index,
        message: `Suspiciously long bib number: ${result.bibNumber}`,
        severity: 'error',
      });
    }
  }

  return errors;
}

// ============================================
// Aggregate Validators
// ============================================

/**
 * Check for duplicate bib numbers
 */
function findDuplicateBibs(results: EnhancedRaceResult[]): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const bibCounts = new Map<string, number>();

  for (const result of results) {
    if (result.bibNumber) {
      const count = bibCounts.get(result.bibNumber) || 0;
      bibCounts.set(result.bibNumber, count + 1);
    }
  }

  const duplicates = Array.from(bibCounts.entries())
    .filter(([_, count]) => count > 1)
    .map(([bib, count]) => ({ bib, count }));

  if (duplicates.length > 0) {
    warnings.push({
      field: 'bibNumber',
      message: `Found ${duplicates.length} duplicate bib numbers: ${duplicates.slice(0, 5).map(d => `${d.bib} (${d.count}x)`).join(', ')}${duplicates.length > 5 ? '...' : ''}`,
      affectedCount: duplicates.reduce((sum, d) => sum + d.count, 0),
      percentage: (duplicates.reduce((sum, d) => sum + d.count, 0) / results.length) * 100,
    });
  }

  return warnings;
}

/**
 * Check for position gaps
 */
function findPositionGaps(results: EnhancedRaceResult[]): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const positions = results
    .filter(r => r.status === 'finished')
    .map(r => r.position)
    .sort((a, b) => a - b);

  const gaps: number[] = [];
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] - positions[i - 1] > 1) {
      gaps.push(positions[i]);
    }
  }

  if (gaps.length > 0) {
    warnings.push({
      field: 'position',
      message: `Found ${gaps.length} position gaps in results (positions may have been filtered or DNFs removed)`,
      affectedCount: gaps.length,
      percentage: (gaps.length / positions.length) * 100,
    });
  }

  return warnings;
}

/**
 * Check field population rates
 */
function analyzeFieldPopulation(results: EnhancedRaceResult[]): Record<string, number> {
  if (results.length === 0) return {};

  const fields = {
    name: 0,
    position: 0,
    bibNumber: 0,
    gender: 0,
    category: 0,
    finishTime: 0,
    gunTime: 0,
    chipTime: 0,
    pace: 0,
    genderPosition: 0,
    categoryPosition: 0,
    country: 0,
    club: 0,
    age: 0,
    checkpoints: 0,
  };

  for (const result of results) {
    if (result.name) fields.name++;
    if (result.position !== undefined && result.position !== null) fields.position++;
    if (result.bibNumber) fields.bibNumber++;
    if (result.gender) fields.gender++;
    if (result.category) fields.category++;
    if (result.finishTime) fields.finishTime++;
    if (result.gunTime) fields.gunTime++;
    if (result.chipTime) fields.chipTime++;
    if (result.pace) fields.pace++;
    if (result.genderPosition) fields.genderPosition++;
    if (result.categoryPosition) fields.categoryPosition++;
    if (result.country) fields.country++;
    if (result.club) fields.club++;
    if (result.age) fields.age++;
    if (result.checkpoints && result.checkpoints.length > 0) fields.checkpoints++;
  }

  const population: Record<string, number> = {};
  for (const [field, count] of Object.entries(fields)) {
    population[field] = Math.round((count / results.length) * 100);
  }

  return population;
}

/**
 * Check for missing expected checkpoints
 */
function analyzeMissingCheckpoints(
  results: EnhancedRaceResult[],
  distanceName: string
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const raceType = detectRaceType(distanceName);
  const expectedCheckpoints = getExpectedCheckpoints(distanceName, raceType);

  if (expectedCheckpoints.length === 0) {
    return warnings;
  }

  // Count how many results have each checkpoint
  const checkpointCounts: Record<string, number> = {};
  for (const cp of expectedCheckpoints) {
    checkpointCounts[cp] = 0;
  }

  const resultsWithCheckpoints = results.filter(r => r.checkpoints && r.checkpoints.length > 0);

  for (const result of resultsWithCheckpoints) {
    for (const cp of result.checkpoints) {
      const normalizedName = cp.checkpointName.toLowerCase();
      for (const expected of expectedCheckpoints) {
        if (normalizedName.includes(expected.toLowerCase()) || expected.toLowerCase().includes(normalizedName)) {
          checkpointCounts[expected]++;
          break;
        }
      }
    }
  }

  // Warn about missing checkpoints
  for (const [checkpoint, count] of Object.entries(checkpointCounts)) {
    if (count === 0 && resultsWithCheckpoints.length > 0) {
      warnings.push({
        field: 'checkpoints',
        message: `Expected checkpoint "${checkpoint}" not found in any result`,
        affectedCount: results.length,
        percentage: 100,
      });
    } else if (count < resultsWithCheckpoints.length * 0.5) {
      warnings.push({
        field: 'checkpoints',
        message: `Checkpoint "${checkpoint}" only present in ${Math.round((count / resultsWithCheckpoints.length) * 100)}% of results`,
        affectedCount: resultsWithCheckpoints.length - count,
        percentage: ((resultsWithCheckpoints.length - count) / resultsWithCheckpoints.length) * 100,
      });
    }
  }

  return warnings;
}

// ============================================
// Main Validation Function
// ============================================

/**
 * Validate scraped results
 */
export function validateResults(scrapedResults: ScrapedResults): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const results = scrapedResults.results;

  // Get distance name (from first distance or event metadata)
  const distanceName = scrapedResults.event.distances?.[0]?.distanceName || '';

  // Validate each result
  for (let i = 0; i < results.length; i++) {
    const result = results[i];

    // Required fields
    errors.push(...validateRequiredFields(result, i));

    // Time validation
    errors.push(...validateTimeReasonable(result, distanceName, i));

    // Checkpoint validation
    errors.push(...validateCheckpoints(result, i));

    // Gender validation
    errors.push(...validateGender(result, i));

    // Bib number validation
    errors.push(...validateBibNumber(result, i));
  }

  // Aggregate validations
  warnings.push(...findDuplicateBibs(results));
  warnings.push(...findPositionGaps(results));
  warnings.push(...analyzeMissingCheckpoints(results, distanceName));

  // Calculate statistics
  const fieldPopulation = analyzeFieldPopulation(results);
  const resultsWithCheckpoints = results.filter(r => r.checkpoints && r.checkpoints.length > 0).length;
  const totalCheckpoints = results.reduce((sum, r) => sum + (r.checkpoints?.length || 0), 0);

  const statistics: ValidationStatistics = {
    totalResults: results.length,
    resultsWithAllFields: results.filter(r =>
      r.name && r.position !== undefined && r.finishTime && r.gender && r.category
    ).length,
    resultsWithCheckpoints,
    fieldPopulation,
    averageCheckpointsPerResult: results.length > 0 ? totalCheckpoints / results.length : 0,
  };

  // Calculate completeness score
  const criticalErrors = errors.filter(e => e.severity === 'critical').length;
  const regularErrors = errors.filter(e => e.severity === 'error').length;

  // Score based on: field population, checkpoint coverage, error rate
  const avgFieldPopulation = Object.values(fieldPopulation).reduce((a, b) => a + b, 0) / Object.keys(fieldPopulation).length;
  const checkpointCoverage = results.length > 0 ? (resultsWithCheckpoints / results.length) * 100 : 0;
  const errorPenalty = Math.min(50, (criticalErrors * 5 + regularErrors * 2));

  let completenessScore = Math.round(
    (avgFieldPopulation * 0.5) +
    (checkpointCoverage * 0.3) +
    (20 - Math.min(20, warnings.length)) -
    errorPenalty
  );

  // Clamp between 0-100
  completenessScore = Math.max(0, Math.min(100, completenessScore));

  // Overall validity
  const isValid = criticalErrors === 0 && regularErrors < results.length * 0.1;

  return {
    isValid,
    completenessScore,
    errors,
    warnings,
    statistics,
  };
}

// ============================================
// Quick Validation (for real-time feedback)
// ============================================

/**
 * Quick validation for a single result (for real-time progress updates)
 */
export function quickValidateResult(result: EnhancedRaceResult): {
  isValid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (!result.name) {
    issues.push('Missing name');
  }

  if (result.position === undefined || result.position < 0) {
    issues.push('Invalid position');
  }

  if (!result.finishTime && result.status === 'finished') {
    issues.push('Missing finish time');
  }

  const timeSeconds = parseTimeToSeconds(result.finishTime);
  if (result.finishTime && timeSeconds === null) {
    issues.push('Invalid time format');
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}

// ============================================
// Validation Report Generation
// ============================================

/**
 * Generate a human-readable validation report
 */
export function generateValidationReport(validation: ValidationResult): string {
  const lines: string[] = [];

  lines.push('=== Validation Report ===\n');

  // Summary
  lines.push(`Status: ${validation.isValid ? 'VALID' : 'INVALID'}`);
  lines.push(`Completeness Score: ${validation.completenessScore}/100`);
  lines.push(`Total Results: ${validation.statistics.totalResults}`);
  lines.push('');

  // Errors
  if (validation.errors.length > 0) {
    lines.push(`Errors (${validation.errors.length}):`);
    const errorsByType = new Map<string, number>();
    for (const error of validation.errors) {
      const key = `[${error.severity}] ${error.message}`;
      errorsByType.set(key, (errorsByType.get(key) || 0) + 1);
    }
    for (const [message, count] of errorsByType) {
      lines.push(`  - ${message} (${count}x)`);
    }
    lines.push('');
  }

  // Warnings
  if (validation.warnings.length > 0) {
    lines.push(`Warnings (${validation.warnings.length}):`);
    for (const warning of validation.warnings) {
      lines.push(`  - ${warning.message}`);
    }
    lines.push('');
  }

  // Statistics
  lines.push('Field Population:');
  for (const [field, percentage] of Object.entries(validation.statistics.fieldPopulation)) {
    const bar = '█'.repeat(Math.round(percentage / 10)) + '░'.repeat(10 - Math.round(percentage / 10));
    lines.push(`  ${field.padEnd(20)} ${bar} ${percentage}%`);
  }
  lines.push('');

  lines.push(`Results with checkpoints: ${validation.statistics.resultsWithCheckpoints}/${validation.statistics.totalResults}`);
  lines.push(`Average checkpoints per result: ${validation.statistics.averageCheckpointsPerResult.toFixed(1)}`);

  return lines.join('\n');
}

// ============================================
// Export validation rules for external use
// ============================================

export { DISTANCE_RULES };
