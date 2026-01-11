import axios from 'axios';
import * as cheerio from 'cheerio';
import type { RaceResult, RaceData } from './types.js';
import type { EventId } from './types.js';
import { saveResults as storageSaveResults, loadResults as storageLoadResults, getStorageInfo } from './storage/index.js';

// Re-export EventId type for backwards compatibility
export type { EventId };

// Hopasports API configuration - extracted from the page HTML
interface RaceConfig {
  id: string;
  race_id: number;
  pt: string;
  title: string;
}

export function extractResultsApiUrl(html: string): { baseUrl: string; races: RaceConfig[] } | null {
  const $ = cheerio.load(html);

  // Find the results Vue component which contains the API URL
  const resultsComponent = $('#results_container results');
  if (resultsComponent.length === 0) return null;

  const resultsUrl = resultsComponent.attr('results_url');
  const racesAttr = resultsComponent.attr(':races_with_pt');

  if (!resultsUrl) return null;

  let races: RaceConfig[] = [];
  if (racesAttr) {
    try {
      // Parse the JSON.parse('...') wrapper
      const jsonMatch = racesAttr.match(/JSON\.parse\('(.+)'\)/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[1]
          .replace(/\\u0022/g, '"')
          .replace(/\\\//g, '/');
        races = JSON.parse(jsonStr);
      }
    } catch {
      // Failed to parse races config
    }
  }

  return { baseUrl: resultsUrl, races };
}

export async function fetchPage(url: string): Promise<string> {
  const response = await axios.get(url, {
    timeout: 60000,
    headers: {
      'User-Agent': 'HopaChecker/1.0 (Race Results Monitor)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  return response.data;
}

export async function fetchResultsFromApi(
  baseUrl: string,
  raceId: number,
  pt: string
): Promise<RaceResult[]> {
  const apiUrl = `${baseUrl}?race_id=${raceId}&pt=${pt}`;
  console.log(`Fetching from API: ${apiUrl}`);

  const response = await axios.get(apiUrl, {
    timeout: 60000,
    headers: {
      'User-Agent': 'HopaChecker/1.0 (Race Results Monitor)',
      'Accept': 'application/json, text/html, */*',
    },
  });

  const data = response.data;

  // If response is JSON, parse it directly
  if (typeof data === 'object' && data !== null) {
    return parseApiResponse(data);
  }

  // If HTML, try to extract results from it
  if (typeof data === 'string') {
    return parseHtmlResults(data);
  }

  return [];
}

function parseApiResponse(data: unknown): RaceResult[] {
  const results: RaceResult[] = [];

  // Handle different API response formats
  if (Array.isArray(data)) {
    // Direct array of results
    data.forEach((item: Record<string, unknown>, index) => {
      const result = parseResultItem(item, index + 1);
      if (result) results.push(result);
    });
  } else if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    // Check for results in common wrapper properties
    const resultsArray = obj.results || obj.data || obj.items || obj.athletes;
    if (Array.isArray(resultsArray)) {
      resultsArray.forEach((item: Record<string, unknown>, index) => {
        const result = parseResultItem(item, index + 1);
        if (result) results.push(result);
      });
    }
  }

  return results;
}

function parseResultItem(item: Record<string, unknown>, defaultPosition: number): RaceResult | null {
  const getString = (keys: string[]): string => {
    for (const key of keys) {
      const value = item[key];
      if (value !== undefined && value !== null) {
        return String(value).trim();
      }
    }
    return '';
  };

  const getNumber = (keys: string[], defaultValue: number = 0): number => {
    for (const key of keys) {
      if (item[key] !== undefined) {
        const num = parseInt(String(item[key]), 10);
        if (!isNaN(num)) return num;
      }
    }
    return defaultValue;
  };

  // Try various field names used by race timing systems
  const name = getString([
    'name', 'Name', 'athlete', 'Athlete', 'runner', 'Runner',
    'full_name', 'fullName', 'participant', 'firstname', 'first_name'
  ]);

  if (!name) return null;

  return {
    position: getNumber(['position', 'Position', 'pos', 'Pos', 'rank', 'Rank', 'place', 'Place', 'overall_rank'], defaultPosition),
    bibNumber: getString(['bib', 'Bib', 'bibNumber', 'BibNumber', 'number', 'Number', 'bib_number', 'bibNo']),
    name,
    gender: getString(['gender', 'Gender', 'sex', 'Sex', 'g']),
    category: getString(['category', 'Category', 'ageGroup', 'AgeGroup', 'division', 'Division', 'cat', 'age_group']),
    finishTime: getString(['time', 'Time', 'finishTime', 'FinishTime', 'chipTime', 'ChipTime', 'netTime', 'NetTime', 'finish_time', 'net_time', 'gun_time']),
    pace: getString(['pace', 'Pace', 'avgPace', 'AvgPace', 'avg_pace']) || undefined,
    genderPosition: getNumber(['gender_rank', 'genderRank', 'gender_position', 'sex_rank']) || undefined,
    categoryPosition: getNumber(['category_rank', 'categoryRank', 'cat_rank', 'age_group_rank']) || undefined,
  };
}

function parseHtmlResults(html: string): RaceResult[] {
  const $ = cheerio.load(html);
  const results: RaceResult[] = [];

  // Try to find table rows
  $('tr').each((index, row) => {
    const cells = $(row).find('td');
    if (cells.length >= 3) {
      const getText = (i: number) => $(cells.eq(i)).text().trim();
      const position = parseInt(getText(0), 10);

      if (!isNaN(position)) {
        results.push({
          position,
          bibNumber: getText(1) || '',
          name: getText(2) || '',
          gender: getText(3) || '',
          category: getText(4) || '',
          finishTime: getText(5) || getText(4) || '',
        });
      }
    }
  });

  return results;
}

export async function checkResultsApiStatus(url: string): Promise<{ isUp: boolean; statusCode: number; error?: string }> {
  try {
    // First fetch the main page to get the API URL
    const html = await fetchPage(url);
    const apiConfig = extractResultsApiUrl(html);

    if (!apiConfig || apiConfig.races.length === 0) {
      return { isUp: true, statusCode: 200 }; // Page loads but no races configured yet
    }

    // Try to fetch results from the first race
    const firstRace = apiConfig.races[0];
    const apiUrl = `${apiConfig.baseUrl}?race_id=${firstRace.race_id}&pt=${firstRace.pt}`;

    const response = await axios.get(apiUrl, {
      timeout: 30000,
      validateStatus: () => true,
      headers: {
        'User-Agent': 'HopaChecker/1.0 (Race Results Monitor)',
      },
    });

    return {
      isUp: response.status >= 200 && response.status < 400,
      statusCode: response.status,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { isUp: false, statusCode: 0, error: errorMessage };
  }
}

export async function scrapeAllResults(url: string): Promise<RaceData> {
  console.log(`Fetching page: ${url}`);
  const html = await fetchPage(url);

  const apiConfig = extractResultsApiUrl(html);

  const halfMarathon: RaceResult[] = [];
  const tenKm: RaceResult[] = [];

  if (apiConfig && apiConfig.races.length > 0) {
    console.log(`Found ${apiConfig.races.length} race(s) configured`);

    for (const race of apiConfig.races) {
      console.log(`Fetching results for: ${race.title}`);
      try {
        const results = await fetchResultsFromApi(apiConfig.baseUrl, race.race_id, race.pt);
        console.log(`  Found ${results.length} results`);

        // Categorize by race title
        const title = race.title.toLowerCase();
        if (title.includes('10k') || title.includes('10km')) {
          tenKm.push(...results);
        } else {
          halfMarathon.push(...results);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.log(`  Error fetching ${race.title}: ${errorMessage}`);
      }
    }
  } else {
    console.log('No API configuration found, trying HTML parsing...');
    const results = parseHtmlResults(html);
    halfMarathon.push(...results);
  }

  const raceData: RaceData = {
    eventName: 'Marina Home Dubai Creek Striders Half Marathon & 10km 2026',
    eventDate: '2026-01-11',
    url,
    scrapedAt: new Date().toISOString(),
    categories: {
      halfMarathon,
      tenKm,
    },
  };

  return raceData;
}

export async function scrapePlus500Results(url: string = 'https://results.hopasports.com/event/plus500-city-half-marathon-dubai-2025'): Promise<RaceData> {
  console.log(`Fetching page: ${url}`);
  const html = await fetchPage(url);

  const apiConfig = extractResultsApiUrl(html);

  const halfMarathon: RaceResult[] = [];
  const tenKm: RaceResult[] = [];

  if (apiConfig && apiConfig.races.length > 0) {
    console.log(`Found ${apiConfig.races.length} race(s) configured`);

    for (const race of apiConfig.races) {
      // Only fetch 21KM/Half Marathon races for Plus500 event
      const title = race.title.toLowerCase();
      const is21km = title.includes('21') || title.includes('half') || title.includes('21k') || title.includes('21km');
      
      if (!is21km) {
        console.log(`  Skipping ${race.title} (only fetching 21KM for Plus500 event)`);
        continue;
      }

      console.log(`Fetching results for: ${race.title}`);
      try {
        const results = await fetchResultsFromApi(apiConfig.baseUrl, race.race_id, race.pt);
        console.log(`  Found ${results.length} results`);
        halfMarathon.push(...results);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.log(`  Error fetching ${race.title}: ${errorMessage}`);
      }
    }
  } else {
    console.log('No API configuration found, trying HTML parsing...');
    const results = parseHtmlResults(html);
    halfMarathon.push(...results);
  }

  const raceData: RaceData = {
    eventName: 'Plus500 City Half Marathon Dubai 2025',
    eventDate: '2025-11-16',
    url,
    scrapedAt: new Date().toISOString(),
    categories: {
      halfMarathon,
      tenKm, // Empty for Plus500
    },
  };

  return raceData;
}

export async function scrapeEvoChipResults(url: string): Promise<RaceData> {
  console.log(`Fetching EvoChip page: ${url}`);
  
  const halfMarathon: RaceResult[] = [];
  const tenKm: RaceResult[] = [];

  // Parse the URL to extract base parameters
  const urlObj = new URL(url);
  const distance = urlObj.searchParams.get('distance') || 'hm';
  const eventId = urlObj.searchParams.get('eventid') || '';

  // Fetch first page to determine total pages
  const firstPageHtml = await fetchPage(url);
  const $ = cheerio.load(firstPageHtml);

  // Extract total pages from pagination
  let totalPages = 1;
  const paginationLinks = $('a[href*="page="]');
  const pageNumbers: number[] = [];
  
  paginationLinks.each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      const pageMatch = href.match(/[?&]page=(\d+)/);
      if (pageMatch) {
        const pageNum = parseInt(pageMatch[1], 10);
        if (!isNaN(pageNum)) {
          pageNumbers.push(pageNum);
        }
      }
    }
  });

  if (pageNumbers.length > 0) {
    totalPages = Math.max(...pageNumbers);
  } else {
    // Try to find "Last" link or total count
    const lastLink = $('a:contains("Last")');
    if (lastLink.length > 0) {
      const lastHref = lastLink.attr('href');
      if (lastHref) {
        const pageMatch = lastHref.match(/[?&]page=(\d+)/);
        if (pageMatch) {
          totalPages = parseInt(pageMatch[1], 10);
        }
      }
    }
  }

  console.log(`Found ${totalPages} page(s) to scrape`);

  // Scrape all pages
  for (let page = 1; page <= totalPages; page++) {
    let pageUrl = url;
    if (page > 1) {
      // Add or update page parameter
      const urlObj = new URL(url);
      urlObj.searchParams.set('page', page.toString());
      pageUrl = urlObj.toString();
    }

    console.log(`  Scraping page ${page}/${totalPages}...`);
    const pageHtml = await fetchPage(pageUrl);
    const $page = cheerio.load(pageHtml);

    // Find the results table - look for table with Bib and Name columns
    const tables = $page('table');
    let table = $page();
    
    // Find table that contains results (has Bib and Name headers)
    tables.each((_, el) => {
      const firstRow = $page(el).find('tr').first();
      const headerText = firstRow.text().toLowerCase();
      if (headerText.includes('bib') && headerText.includes('name')) {
        table = $page(el);
        return false; // Break
      }
    });

    if (table.length === 0) {
      console.log(`    No results table found on page ${page}`);
      continue;
    }

    // Find header row to determine column indices
    const headerRow = table.find('tr').first();
    const headerCells = headerRow.find('th, td');
    const columnMap: Record<string, number> = {};
    
    headerCells.each((index, cell) => {
      const headerText = $page(cell).text().toLowerCase().trim();
      if (headerText.includes('bib')) columnMap.bib = index;
      if (headerText.includes('name')) columnMap.name = index;
      if (headerText.includes('country')) columnMap.country = index;
      if (headerText.includes('5km') || headerText === '5km') columnMap.time5km = index;
      if (headerText.includes('10km') || headerText === '10km') columnMap.time10km = index;
      if (headerText.includes('13km') || headerText === '13km') columnMap.time13km = index;
      if (headerText.includes('15km') || headerText === '15km') columnMap.time15km = index;
      if (headerText.includes('finish')) columnMap.finish = index;
      if (headerText.includes('gender') && headerText.includes('rank')) columnMap.genderRank = index;
      if ((headerText.includes('cat') || headerText.includes('category')) && headerText.includes('rank')) columnMap.catRank = index;
    });

    // Parse table rows (skip header row)
    const rows = table.find('tr').slice(1); // Skip first row (header)
    let rowIndex = 0;
    
    rows.each((_, row) => {
      const cells = $page(row).find('td');
      if (cells.length < 3) return; // Skip rows with insufficient data

      // Extract data from cells using column map
      const bibText = columnMap.bib !== undefined ? $page(cells.eq(columnMap.bib)).text().trim() : '';
      const nameText = columnMap.name !== undefined ? $page(cells.eq(columnMap.name)).text().trim() : '';
      
      // Skip if name is empty (likely an empty row)
      if (!nameText || nameText === '') {
        return;
      }

      const countryText = columnMap.country !== undefined ? $page(cells.eq(columnMap.country)).text().trim() : '';
      const time5km = columnMap.time5km !== undefined ? $page(cells.eq(columnMap.time5km)).text().trim() : '';
      const time10km = columnMap.time10km !== undefined ? $page(cells.eq(columnMap.time10km)).text().trim() : '';
      const time13km = columnMap.time13km !== undefined ? $page(cells.eq(columnMap.time13km)).text().trim() : '';
      const time15km = columnMap.time15km !== undefined ? $page(cells.eq(columnMap.time15km)).text().trim() : '';
      const finishTime = columnMap.finish !== undefined ? $page(cells.eq(columnMap.finish)).text().trim() : '';
      const genderRankText = columnMap.genderRank !== undefined ? $page(cells.eq(columnMap.genderRank)).text().trim() : '';
      const catRankText = columnMap.catRank !== undefined ? $page(cells.eq(columnMap.catRank)).text().trim() : '';

      // Calculate position based on current results count + row index
      const currentCount = distance === '10k' || distance === '10km' ? tenKm.length : halfMarathon.length;
      const position = currentCount + rowIndex + 1;

      // Parse gender rank and category rank
      const genderPosition = genderRankText && genderRankText !== '-' && genderRankText !== '' 
        ? parseInt(genderRankText, 10) 
        : undefined;
      const categoryPosition = catRankText && catRankText !== '-' && catRankText !== '' 
        ? parseInt(catRankText, 10) 
        : undefined;

      // Gender and category are not in the table, leave empty
      const gender = '';
      const category = '';

      const result: RaceResult = {
        position,
        bibNumber: bibText,
        name: nameText,
        gender,
        category,
        finishTime: finishTime || '-',
        genderPosition,
        categoryPosition,
        country: countryText || undefined,
        time5km: time5km || undefined,
        time10km: time10km || undefined,
        time13km: time13km || undefined,
        time15km: time15km || undefined,
      };

      // Categorize based on distance parameter
      if (distance === '10k' || distance === '10km') {
        tenKm.push(result);
      } else {
        // Default to half marathon
        halfMarathon.push(result);
      }

      rowIndex++;
    });

    console.log(`    Found ${rowIndex} results on page ${page}`);
  }

  // Extract event name from the page
  let eventName = 'Marina Home Dubai Creek Striders Half Marathon & 10km 2026';
  const titleMatch = $('h1, h2, .event-title, title').first().text();
  if (titleMatch) {
    eventName = titleMatch.trim();
  }

  const raceData: RaceData = {
    eventName,
    eventDate: '2026-01-11', // Update if we can extract from page
    url,
    scrapedAt: new Date().toISOString(),
    categories: {
      halfMarathon,
      tenKm,
    },
  };

  console.log(`✅ Scraping complete: ${halfMarathon.length} HM, ${tenKm.length} 10K`);
  return raceData;
}

// Re-export storage functions for backwards compatibility
export async function saveResults(data: RaceData, eventId: EventId = 'dcs'): Promise<void> {
  await storageSaveResults(data, eventId);
}

export async function loadResults(eventId: EventId = 'dcs'): Promise<RaceData | null> {
  return await storageLoadResults(eventId);
}

// Legacy function for compatibility - returns storage info instead of file path
export function getResultsFilePath(eventId: EventId = 'dcs'): string {
  const info = getStorageInfo();
  if (info.mode === 's3') {
    return `s3://${info.location}/${eventId === 'plus500' ? 'results-plus500.json' : 'results.json'}`;
  }
  // For filesystem mode, return the path (legacy behavior)
  return info.location;
}

export function getDataDir(): string {
  const info = getStorageInfo();
  return info.location;
}
