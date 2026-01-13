// API Configuration
// This file can be customized for different environments
// For Cloudflare Pages, set the API_URL environment variable
// It will be injected at build time or can be set via window.__API_BASE__

(function() {
  // Check for window variable (can be set via script tag in HTML)
  if (window.__API_BASE__) {
    window.API_BASE = window.__API_BASE__;
  } else {
    // Check for environment variable (set during build)
    // Cloudflare Pages will replace %API_URL% during build
    const envApiUrl = '%API_URL%';
    if (envApiUrl && envApiUrl !== '%API_URL%') {
      window.API_BASE = envApiUrl;
    } else {
      // Default fallback
      // For production, update this URL to your backend API
      // Or use build-config.js script to inject API_URL environment variable
      window.API_BASE = window.API_BASE || 'https://graafin-web.onrender.com/api';
    }
  }

  // Supabase Configuration
  // Check for environment variables or window variables
  if (window.__SUPABASE_URL__) {
    window.SUPABASE_URL = window.__SUPABASE_URL__;
  } else {
    const envSupabaseUrl = '%SUPABASE_URL%';
    if (envSupabaseUrl && envSupabaseUrl !== '%SUPABASE_URL%') {
      window.SUPABASE_URL = envSupabaseUrl;
    } else {
      // Production fallback - Supabase URL is not sensitive
      window.SUPABASE_URL = 'https://fazdbecnxwgkvbxwlrfn.supabase.co';
    }
  }

  if (window.__SUPABASE_ANON_KEY__) {
    window.SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__;
  } else {
    const envSupabaseKey = '%SUPABASE_ANON_KEY%';
    if (envSupabaseKey && envSupabaseKey !== '%SUPABASE_ANON_KEY%') {
      window.SUPABASE_ANON_KEY = envSupabaseKey;
    } else {
      // Production fallback - anon key is designed for client-side use (safe to expose)
      window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhemRiZWNueHdna3ZieHdscmZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyMDg3NTksImV4cCI6MjA4Mzc4NDc1OX0.tmMXTCajrrv2GhPwOhxB_QSu00nIJ0eBExuNRcDPong';
    }
  }

  // Admin email configuration (centralized)
  window.ADMIN_EMAIL = window.ADMIN_EMAIL || 'conorogle@gmail.com';
})();
