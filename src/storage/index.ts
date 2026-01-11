import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import type { RaceData, MonitorState } from '../types.js';
import * as s3Storage from './s3.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Storage mode: 'filesystem' or 's3'
const STORAGE_MODE = (process.env.STORAGE_MODE || 'filesystem').toLowerCase();

// File system paths (for filesystem mode or local development)
const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, '..', '..', 'data');
const RESULTS_FILE = path.join(DATA_DIR, 'results.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// S3 key prefixes (for S3 mode)
function getResultsKey(eventId: string = 'dcs'): string {
  if (eventId === 'plus500') {
    return 'results-plus500.json';
  }
  return 'results.json';
}

function getStateKey(): string {
  return 'state.json';
}

// Results storage functions
export async function saveResults(data: RaceData, eventId: string = 'dcs'): Promise<void> {
  if (STORAGE_MODE === 's3') {
    const key = getResultsKey(eventId);
    await s3Storage.saveToS3(key, data);
  } else {
    // File system mode
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    const filePath = eventId === 'plus500' 
      ? path.join(DATA_DIR, 'results-plus500.json')
      : RESULTS_FILE;
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`Results saved to: ${filePath}`);
  }
}

export async function loadResults(eventId: string = 'dcs'): Promise<RaceData | null> {
  if (STORAGE_MODE === 's3') {
    const key = getResultsKey(eventId);
    return await s3Storage.loadFromS3<RaceData>(key);
  } else {
    // File system mode
    try {
      const filePath = eventId === 'plus500'
        ? path.join(DATA_DIR, 'results-plus500.json')
        : RESULTS_FILE;
      if (existsSync(filePath)) {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
      }
    } catch {
      // File doesn't exist or is corrupted
    }
    return null;
  }
}

// State storage functions
export async function saveState(state: MonitorState): Promise<void> {
  if (STORAGE_MODE === 's3') {
    const key = getStateKey();
    await s3Storage.saveToS3(key, state);
  } else {
    // File system mode
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  }
}

export async function loadState(): Promise<MonitorState | null> {
  if (STORAGE_MODE === 's3') {
    const key = getStateKey();
    return await s3Storage.loadFromS3<MonitorState>(key);
  } else {
    // File system mode
    try {
      if (existsSync(STATE_FILE)) {
        const data = await fs.readFile(STATE_FILE, 'utf-8');
        return JSON.parse(data);
      }
    } catch {
      // State file doesn't exist or is corrupted
    }
    return null;
  }
}

// Utility function to get storage info (for logging/debugging)
export function getStorageInfo(): { mode: string; location: string } {
  if (STORAGE_MODE === 's3') {
    return {
      mode: 's3',
      location: process.env.S3_BUCKET_NAME || 'not configured',
    };
  }
  return {
    mode: 'filesystem',
    location: DATA_DIR,
  };
}