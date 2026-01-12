#!/usr/bin/env node
/**
 * Build script to inject API URL and Supabase config into config.js
 * Usage: node build-config.js
 * 
 * Reads API_URL, SUPABASE_URL, and SUPABASE_ANON_KEY from environment variables
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.join(__dirname, 'config.js');
const apiUrl = process.env.API_URL || 'https://graafin-web.onrender.com/api';
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

// Read current config
let config = fs.readFileSync(configPath, 'utf8');

// Replace API URL placeholder
config = config.replace(
  /window\.API_BASE = window\.API_BASE \|\| '[^']*';/,
  `window.API_BASE = window.API_BASE || '${apiUrl}';`
);

// Replace Supabase URL placeholder
if (supabaseUrl) {
  config = config.replace(
    /const envSupabaseUrl = '%SUPABASE_URL%';/,
    `const envSupabaseUrl = '${supabaseUrl}';`
  );
}

// Replace Supabase Anon Key placeholder
if (supabaseAnonKey) {
  config = config.replace(
    /const envSupabaseKey = '%SUPABASE_ANON_KEY%';/,
    `const envSupabaseKey = '${supabaseAnonKey}';`
  );
}

// Write back
fs.writeFileSync(configPath, config, 'utf8');

console.log(`✓ Updated config.js`);
console.log(`  API_URL: ${apiUrl}`);
if (supabaseUrl) console.log(`  SUPABASE_URL: ${supabaseUrl.substring(0, 30)}...`);
if (supabaseAnonKey) console.log(`  SUPABASE_ANON_KEY: ${supabaseAnonKey.substring(0, 20)}...`);
