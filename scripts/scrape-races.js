#!/usr/bin/env node
/**
 * Helper script to scrape races for the GRAAFIN platform
 * 
 * Usage:
 *   node scripts/scrape-races.js <event-url> [organiser]
 * 
 * Examples:
 *   node scripts/scrape-races.js "https://results.hopasports.com/event/marina-home-dubai-creek-striders-half-marathon-10km-2026"
 *   node scripts/scrape-races.js "https://results.hopasports.com/event/plus500-city-half-marathon-dubai-2025" hopasports
 *   node scripts/scrape-races.js "https://evochip.hu/results/result.php?distance=hm&category=none&timepoint=none&eventid=DubaiCreekHalf26DAd&year=&lang=en&css=evochip.css&iframe=0&mobile=0&viewport=device-width" evochip
 */

import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

// API_BASE can be set via environment variable
// For local backend: http://localhost:3000/api
// For remote backend (Render.com): https://graafin-web.onrender.com/api
// For custom domain: https://api.graafin.club/api
const API_BASE = process.env.API_BASE || process.env.API_URL || 'http://localhost:3000/api';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

if (!ADMIN_API_KEY) {
  console.error('❌ ERROR: ADMIN_API_KEY environment variable is required');
  console.error('   Set it in your .env file or export it:');
  console.error('   export ADMIN_API_KEY=your-admin-api-key');
  process.exit(1);
}

console.log(`🔗 Using API: ${API_BASE}`);

const eventUrl = process.argv[2];
const organiser = process.argv[3];

if (!eventUrl) {
  console.error('❌ ERROR: Event URL is required');
  console.error('');
  console.error('Usage: node scripts/scrape-races.js <event-url> [organiser]');
  console.error('');
  console.error('Examples:');
  console.error('  node scripts/scrape-races.js "https://results.hopasports.com/event/marina-home-dubai-creek-striders-half-marathon-10km-2026"');
  console.error('  node scripts/scrape-races.js "https://results.hopasports.com/event/plus500-city-half-marathon-dubai-2025" hopasports');
  console.error('  node scripts/scrape-races.js "https://evochip.hu/results/result.php?..." evochip');
  process.exit(1);
}

async function scrapeRace() {
  console.log('🚀 Starting race scrape...');
  console.log(`   URL: ${eventUrl}`);
  if (organiser) {
    console.log(`   Organiser: ${organiser}`);
  }
  console.log('');

  try {
    const response = await axios.post(
      `${API_BASE}/admin/scrape`,
      {
        eventUrl,
        organiser: organiser || undefined,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': ADMIN_API_KEY,
        },
      }
    );

    if (response.data.success) {
      console.log('✅ Scrape job started successfully!');
      console.log(`   Job ID: ${response.data.jobId}`);
      console.log(`   Event ID: ${response.data.eventId}`);
      console.log(`   Results Count: ${response.data.resultsCount}`);
      console.log('');
      console.log('📊 The race results are now being processed and will be available for search shortly.');
    } else {
      console.error('❌ Scrape failed:', response.data.error);
      process.exit(1);
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        console.error('❌ API Error:', error.response.status, error.response.data.error || error.response.data);
      } else if (error.request) {
        console.error('❌ Network Error: Could not reach the API');
        console.error('   Make sure your backend is running and API_BASE is correct');
        console.error(`   Current API_BASE: ${API_BASE}`);
      } else {
        console.error('❌ Error:', error.message);
      }
    } else {
      console.error('❌ Unexpected error:', error);
    }
    process.exit(1);
  }
}

scrapeRace();
