/**
 * Multi-Source Reconciliation Service
 * Merges race results from multiple sources (e.g., HopaSports + EvoChip)
 */

import type {
  EnhancedRaceResult,
  ScrapedResults,
  ReconciliationResult,
  MatchResult,
  FieldConflict,
  MatchMethod,
  TimingCheckpoint,
} from './types.js';

import { parseTimeToSeconds } from './validation.js';

// ============================================
// Configuration
// ============================================

/**
 * Matching thresholds
 */
const MATCH_CONFIG = {
  /** Minimum name similarity (0-1) for fuzzy matching */
  minNameSimilarity: 0.75,
  /** Maximum time difference in seconds for name+time matching */
  maxTimeDifferenceSeconds: 60,
  /** Confidence threshold for automatic merge (0-100) */
  autoMergeConfidence: 85,
  /** Fields that should be merged (not overwritten) */
  mergeableFields: ['checkpoints', 'club', 'country'],
  /** Fields where source A takes priority */
  priorityAFields: ['chipTime', 'pace'],
  /** Fields where source B takes priority */
  priorityBFields: ['gunTime'],
};

// ============================================
// Name Matching
// ============================================

/**
 * Normalize a name for comparison
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z\s]/g, '') // Remove non-letters
    .replace(/\s+/g, ' ') // Normalize spaces
    .trim();
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity between two names (0-1)
 */
export function calculateNameSimilarity(nameA: string, nameB: string): number {
  const normalizedA = normalizeName(nameA);
  const normalizedB = normalizeName(nameB);

  if (normalizedA === normalizedB) return 1;
  if (!normalizedA || !normalizedB) return 0;

  // Check if names are rearranged (e.g., "John Smith" vs "Smith, John")
  const partsA = normalizedA.split(' ').sort();
  const partsB = normalizedB.split(' ').sort();
  if (partsA.join(' ') === partsB.join(' ')) {
    return 0.98; // Very high but not perfect
  }

  // Levenshtein-based similarity
  const maxLen = Math.max(normalizedA.length, normalizedB.length);
  const distance = levenshteinDistance(normalizedA, normalizedB);
  const similarity = 1 - distance / maxLen;

  return similarity;
}

/**
 * Check if two names are likely the same person
 */
export function namesMatch(nameA: string, nameB: string): boolean {
  return calculateNameSimilarity(nameA, nameB) >= MATCH_CONFIG.minNameSimilarity;
}

// ============================================
// Result Matching
// ============================================

/**
 * Match two results and determine if they're the same athlete
 */
export function matchResults(
  resultA: EnhancedRaceResult,
  resultB: EnhancedRaceResult
): MatchResult {
  // Method 1: Exact bib number match (highest confidence)
  if (
    resultA.bibNumber &&
    resultB.bibNumber &&
    resultA.bibNumber === resultB.bibNumber
  ) {
    const nameSimilarity = calculateNameSimilarity(resultA.name, resultB.name);

    // Bib matches but names don't - could be data error
    if (nameSimilarity < 0.5) {
      return {
        isMatch: true,
        confidence: 75, // Lower confidence due to name mismatch
        method: 'bib',
        conflicts: [
          {
            field: 'name',
            valueA: resultA.name,
            valueB: resultB.name,
            resolution: 'manual',
            reason: 'Bib numbers match but names are different',
          },
        ],
      };
    }

    return {
      isMatch: true,
      confidence: 100,
      method: 'bib',
    };
  }

  // Method 2: Name + Time match
  const nameSimilarity = calculateNameSimilarity(resultA.name, resultB.name);

  if (nameSimilarity >= MATCH_CONFIG.minNameSimilarity) {
    const timeA = parseTimeToSeconds(resultA.finishTime);
    const timeB = parseTimeToSeconds(resultB.finishTime);

    if (timeA !== null && timeB !== null) {
      const timeDiff = Math.abs(timeA - timeB);

      if (timeDiff <= MATCH_CONFIG.maxTimeDifferenceSeconds) {
        // Name and time match closely
        const confidence = Math.round(
          80 + nameSimilarity * 15 - (timeDiff / 60) * 5
        );

        return {
          isMatch: true,
          confidence: Math.min(98, Math.max(80, confidence)),
          method: 'name_time',
        };
      }
    }

    // Name matches but no time match - check position
    if (resultA.position === resultB.position) {
      return {
        isMatch: true,
        confidence: Math.round(70 + nameSimilarity * 10),
        method: 'position_name',
      };
    }
  }

  // Method 3: Position + partial name (lower confidence)
  if (resultA.position === resultB.position && nameSimilarity >= 0.6) {
    return {
      isMatch: true,
      confidence: Math.round(60 + nameSimilarity * 15),
      method: 'position_name',
    };
  }

  // No match
  return {
    isMatch: false,
    confidence: 0,
    method: 'bib',
  };
}

// ============================================
// Field Merging
// ============================================

/**
 * Detect conflicts between two field values
 */
function detectFieldConflict(
  field: string,
  valueA: unknown,
  valueB: unknown
): FieldConflict | null {
  // Both null/undefined - no conflict
  if (valueA == null && valueB == null) return null;

  // Only one has value - no conflict, use the one that exists
  if (valueA == null || valueB == null) return null;

  // Same value - no conflict
  if (JSON.stringify(valueA) === JSON.stringify(valueB)) return null;

  // Different values - conflict
  let resolution: 'use_a' | 'use_b' | 'merge' | 'manual' = 'manual';
  let reason = 'Values differ between sources';

  // Priority fields
  if (MATCH_CONFIG.priorityAFields.includes(field)) {
    resolution = 'use_a';
    reason = `${field} priority is source A`;
  } else if (MATCH_CONFIG.priorityBFields.includes(field)) {
    resolution = 'use_b';
    reason = `${field} priority is source B`;
  } else if (MATCH_CONFIG.mergeableFields.includes(field)) {
    resolution = 'merge';
    reason = `${field} can be merged from both sources`;
  }

  // Time fields - prefer chip time over gun time
  if (field === 'finishTime') {
    resolution = 'manual';
    reason = 'Finish times differ - manual review needed';
  }

  return {
    field,
    valueA,
    valueB,
    resolution,
    reason,
  };
}

/**
 * Merge checkpoints from two sources
 */
function mergeCheckpoints(
  checkpointsA: TimingCheckpoint[],
  checkpointsB: TimingCheckpoint[]
): TimingCheckpoint[] {
  const merged = new Map<string, TimingCheckpoint>();

  // Add all from A
  for (const cp of checkpointsA) {
    merged.set(cp.checkpointName.toLowerCase(), cp);
  }

  // Merge from B (add missing, enrich existing)
  for (const cp of checkpointsB) {
    const key = cp.checkpointName.toLowerCase();
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, cp);
    } else {
      // Merge data - prefer A's time data, but fill in gaps
      merged.set(key, {
        ...existing,
        splitTime: existing.splitTime || cp.splitTime,
        cumulativeTime: existing.cumulativeTime || cp.cumulativeTime,
        pace: existing.pace || cp.pace,
        segmentDistanceMeters:
          existing.segmentDistanceMeters || cp.segmentDistanceMeters,
        metadata: { ...cp.metadata, ...existing.metadata },
      });
    }
  }

  // Sort by checkpoint order
  return Array.from(merged.values()).sort(
    (a, b) => a.checkpointOrder - b.checkpointOrder
  );
}

/**
 * Merge two matched results
 */
export function mergeResults(
  resultA: EnhancedRaceResult,
  resultB: EnhancedRaceResult,
  match: MatchResult
): { merged: EnhancedRaceResult; conflicts: FieldConflict[] } {
  const conflicts: FieldConflict[] = [];

  // Start with A as base
  const merged: EnhancedRaceResult = { ...resultA };

  // Check each field for conflicts and merge
  const fieldsToCheck: (keyof EnhancedRaceResult)[] = [
    'position',
    'bibNumber',
    'name',
    'gender',
    'category',
    'finishTime',
    'gunTime',
    'chipTime',
    'pace',
    'genderPosition',
    'categoryPosition',
    'country',
    'club',
    'age',
    'status',
    'timeBehind',
  ];

  for (const field of fieldsToCheck) {
    const conflict = detectFieldConflict(field, resultA[field], resultB[field]);

    if (conflict) {
      conflicts.push(conflict);

      // Apply resolution
      if (conflict.resolution === 'use_b') {
        (merged as unknown as Record<string, unknown>)[field] = resultB[field];
      }
      // use_a is default (already in merged)
    } else if (resultA[field] == null && resultB[field] != null) {
      // A is missing, use B
      (merged as unknown as Record<string, unknown>)[field] = resultB[field];
    }
  }

  // Merge checkpoints
  const checkpointsA = resultA.checkpoints || [];
  const checkpointsB = resultB.checkpoints || [];

  if (checkpointsA.length > 0 || checkpointsB.length > 0) {
    merged.checkpoints = mergeCheckpoints(checkpointsA, checkpointsB);
  }

  // Carry over any match conflicts
  if (match.conflicts) {
    conflicts.push(...match.conflicts);
  }

  return { merged, conflicts };
}

// ============================================
// Event Reconciliation
// ============================================

/**
 * Reconcile two sets of results from different sources
 */
export function reconcileResults(
  resultsA: EnhancedRaceResult[],
  resultsB: EnhancedRaceResult[],
  options: {
    sourceAName?: string;
    sourceBName?: string;
    autoMergeThreshold?: number;
  } = {}
): ReconciliationResult {
  const {
    sourceAName = 'Source A',
    sourceBName = 'Source B',
    autoMergeThreshold = MATCH_CONFIG.autoMergeConfidence,
  } = options;

  const mergedResults: EnhancedRaceResult[] = [];
  const allConflicts: FieldConflict[] = [];
  const matchedIndicesB = new Set<number>();
  const fieldsEnriched = new Set<string>();

  let matchedCount = 0;

  // Try to match each result from A with one from B
  for (const resultA of resultsA) {
    let bestMatch: { index: number; match: MatchResult } | null = null;

    for (let i = 0; i < resultsB.length; i++) {
      if (matchedIndicesB.has(i)) continue;

      const match = matchResults(resultA, resultsB[i]);

      if (match.isMatch) {
        if (!bestMatch || match.confidence > bestMatch.match.confidence) {
          bestMatch = { index: i, match };
        }
      }
    }

    if (bestMatch && bestMatch.match.confidence >= autoMergeThreshold) {
      // Auto-merge
      matchedIndicesB.add(bestMatch.index);
      matchedCount++;

      const resultB = resultsB[bestMatch.index];
      const { merged, conflicts } = mergeResults(resultA, resultB, bestMatch.match);

      mergedResults.push(merged);
      allConflicts.push(...conflicts);

      // Track enriched fields
      for (const key of Object.keys(resultB) as (keyof EnhancedRaceResult)[]) {
        if (resultA[key] == null && resultB[key] != null) {
          fieldsEnriched.add(key);
        }
      }
    } else if (bestMatch) {
      // Low confidence match - include A with conflict flag
      const resultB = resultsB[bestMatch.index];
      const { merged, conflicts } = mergeResults(resultA, resultB, bestMatch.match);

      // Add a conflict indicating manual review needed
      allConflicts.push({
        field: '_matchConfidence',
        valueA: resultA.name,
        valueB: resultB.name,
        resolution: 'manual',
        reason: `Low confidence match (${bestMatch.match.confidence}%) - review needed`,
      });

      mergedResults.push(merged);
      allConflicts.push(...conflicts);
      matchedIndicesB.add(bestMatch.index);
      matchedCount++;
    } else {
      // No match found - include A as-is
      mergedResults.push(resultA);
    }
  }

  // Add unmatched results from B
  for (let i = 0; i < resultsB.length; i++) {
    if (!matchedIndicesB.has(i)) {
      mergedResults.push(resultsB[i]);
    }
  }

  // Sort by position
  mergedResults.sort((a, b) => (a.position || 9999) - (b.position || 9999));

  const unmatchedFromA = resultsA.length - matchedCount;
  const unmatchedFromB = resultsB.length - matchedIndicesB.size;

  return {
    mergedResults,
    matchedCount,
    unmatchedFromA,
    unmatchedFromB,
    conflicts: allConflicts,
    statistics: {
      totalFromA: resultsA.length,
      totalFromB: resultsB.length,
      matchRate:
        resultsA.length > 0 ? (matchedCount / resultsA.length) * 100 : 0,
      fieldsEnriched: Array.from(fieldsEnriched),
    },
  };
}

/**
 * Reconcile two scraped events
 */
export function reconcileEvents(
  eventA: ScrapedResults,
  eventB: ScrapedResults,
  options?: {
    autoMergeThreshold?: number;
  }
): ReconciliationResult {
  return reconcileResults(eventA.results, eventB.results, {
    sourceAName: eventA.event.organiser,
    sourceBName: eventB.event.organiser,
    ...options,
  });
}

// ============================================
// Reconciliation Report
// ============================================

/**
 * Generate a human-readable reconciliation report
 */
export function generateReconciliationReport(result: ReconciliationResult): string {
  const lines: string[] = [];

  lines.push('=== Reconciliation Report ===\n');

  // Summary
  lines.push('Summary:');
  lines.push(`  Source A: ${result.statistics.totalFromA} results`);
  lines.push(`  Source B: ${result.statistics.totalFromB} results`);
  lines.push(`  Matched: ${result.matchedCount} (${result.statistics.matchRate.toFixed(1)}%)`);
  lines.push(`  Unmatched from A: ${result.unmatchedFromA}`);
  lines.push(`  Unmatched from B: ${result.unmatchedFromB}`);
  lines.push(`  Final merged: ${result.mergedResults.length} results`);
  lines.push('');

  // Fields enriched
  if (result.statistics.fieldsEnriched.length > 0) {
    lines.push('Fields enriched from Source B:');
    for (const field of result.statistics.fieldsEnriched) {
      lines.push(`  - ${field}`);
    }
    lines.push('');
  }

  // Conflicts
  if (result.conflicts.length > 0) {
    const conflictsByField = new Map<string, number>();
    for (const conflict of result.conflicts) {
      conflictsByField.set(conflict.field, (conflictsByField.get(conflict.field) || 0) + 1);
    }

    lines.push(`Conflicts (${result.conflicts.length} total):`);
    for (const [field, count] of conflictsByField) {
      lines.push(`  - ${field}: ${count} conflicts`);
    }
    lines.push('');

    // Show first few manual review conflicts
    const manualReview = result.conflicts.filter(c => c.resolution === 'manual');
    if (manualReview.length > 0) {
      lines.push('Manual review required:');
      for (const conflict of manualReview.slice(0, 10)) {
        lines.push(`  - ${conflict.field}: "${conflict.valueA}" vs "${conflict.valueB}"`);
        lines.push(`    Reason: ${conflict.reason}`);
      }
      if (manualReview.length > 10) {
        lines.push(`  ... and ${manualReview.length - 10} more`);
      }
    }
  }

  return lines.join('\n');
}

// ============================================
// Batch Processing
// ============================================

/**
 * Find potential duplicate events that could be reconciled
 */
export function findPotentialDuplicateEvents(
  events: Array<{ id: string; name: string; date: string; organiser: string }>
): Array<{ eventA: string; eventB: string; similarity: number }> {
  const potentialDuplicates: Array<{ eventA: string; eventB: string; similarity: number }> = [];

  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const eventA = events[i];
      const eventB = events[j];

      // Must be same date
      if (eventA.date !== eventB.date) continue;

      // Must be different organisers (otherwise it's the same event)
      if (eventA.organiser === eventB.organiser) continue;

      // Check name similarity
      const nameSimilarity = calculateNameSimilarity(eventA.name, eventB.name);

      if (nameSimilarity >= 0.7) {
        potentialDuplicates.push({
          eventA: eventA.id,
          eventB: eventB.id,
          similarity: Math.round(nameSimilarity * 100),
        });
      }
    }
  }

  return potentialDuplicates.sort((a, b) => b.similarity - a.similarity);
}
