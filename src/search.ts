import Fuse, { type IFuseOptions } from 'fuse.js';
import type { RaceResult, RaceData, SearchResult } from './types.js';

const FUSE_OPTIONS: IFuseOptions<RaceResult> = {
  keys: ['name'],
  threshold: 0.4, // Lower = more strict, higher = more fuzzy
  includeScore: true,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

export function searchByName(
  data: RaceData,
  query: string,
  raceType?: 'halfMarathon' | 'tenKm' | 'all'
): SearchResult[] {
  const results: SearchResult[] = [];
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return results;
  }

  // Search in half marathon results
  if (raceType === 'halfMarathon' || raceType === 'all' || !raceType) {
    if (data.categories.halfMarathon.length > 0) {
      const fuse = new Fuse(data.categories.halfMarathon, FUSE_OPTIONS);
      const matches = fuse.search(normalizedQuery);

      matches.forEach(match => {
        results.push({
          result: match.item,
          raceType: 'halfMarathon',
          score: match.score ?? 1,
        });
      });
    }
  }

  // Search in 10km results
  if (raceType === 'tenKm' || raceType === 'all' || !raceType) {
    if (data.categories.tenKm.length > 0) {
      const fuse = new Fuse(data.categories.tenKm, FUSE_OPTIONS);
      const matches = fuse.search(normalizedQuery);

      matches.forEach(match => {
        results.push({
          result: match.item,
          raceType: 'tenKm',
          score: match.score ?? 1,
        });
      });
    }
  }

  // Sort by score (lower is better in Fuse.js)
  results.sort((a, b) => a.score - b.score);

  return results;
}

export function searchMultipleNames(
  data: RaceData,
  names: string[],
  raceType?: 'halfMarathon' | 'tenKm' | 'all'
): Map<string, SearchResult[]> {
  const resultMap = new Map<string, SearchResult[]>();

  for (const name of names) {
    const trimmedName = name.trim();
    if (trimmedName) {
      const matches = searchByName(data, trimmedName, raceType);
      resultMap.set(trimmedName, matches);
    }
  }

  return resultMap;
}

export function formatSearchResult(searchResult: SearchResult): string {
  const { result, raceType, score } = searchResult;
  const raceLabel = raceType === 'halfMarathon' ? 'Half Marathon' : '10km';
  const confidence = Math.round((1 - score) * 100);

  let output = `\n📍 ${result.name}`;
  output += `\n   Race: ${raceLabel}`;
  output += `\n   Position: ${result.position}`;
  if (result.bibNumber) output += `\n   Bib: ${result.bibNumber}`;
  if (result.country) output += `\n   Country: ${result.country}`;
  if (result.finishTime) output += `\n   Time: ${result.finishTime}`;
  if (result.time5km) output += `\n   5km: ${result.time5km}`;
  if (result.time10km) output += `\n   10km: ${result.time10km}`;
  if (result.time13km) output += `\n   13km: ${result.time13km}`;
  if (result.time15km) output += `\n   15km: ${result.time15km}`;
  if (result.pace) output += `\n   Pace: ${result.pace}`;
  if (result.category) output += `\n   Category: ${result.category}`;
  if (result.genderPosition !== undefined) output += `\n   Gender Position: ${result.genderPosition}`;
  if (result.categoryPosition !== undefined) output += `\n   Category Position: ${result.categoryPosition}`;
  output += `\n   Match Confidence: ${confidence}%`;

  return output;
}

export function formatSearchResults(results: SearchResult[], query: string): string {
  if (results.length === 0) {
    return `\n❌ No results found for "${query}"`;
  }

  let output = `\n🔍 Results for "${query}" (${results.length} found):`;

  // Show top 5 results
  const topResults = results.slice(0, 5);
  for (const result of topResults) {
    output += formatSearchResult(result);
  }

  if (results.length > 5) {
    output += `\n\n   ... and ${results.length - 5} more matches`;
  }

  return output;
}

export async function searchFromFile(names: string[]): Promise<void> {
  const { loadResults } = await import('./scraper.js');
  const data: RaceData | null = await loadResults('dcs');

  if (!data) {
    console.log('❌ No results data found. Run "npm run scrape" first to fetch results.');
    return;
  }

  console.log(`\n📊 Searching in ${data.eventName}`);
  console.log(`   Scraped: ${new Date(data.scrapedAt).toLocaleString()}`);
  console.log(`   Half Marathon entries: ${data.categories.halfMarathon.length}`);
  console.log(`   10km entries: ${data.categories.tenKm.length}`);

  const resultsMap = searchMultipleNames(data, names);

  for (const [name, results] of resultsMap) {
    console.log(formatSearchResults(results, name));
  }
}
