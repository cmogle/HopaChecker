# Environment Variables Explained

This document clarifies what each environment variable is, where to find it, and how to use it.

## API_URL

### What it is:
The **API_URL** is the base URL of your backend API server. This is where your Express.js backend (the one that handles athlete searches, profile data, etc.) is running.

### Where to find it:
1. **If deployed on Render.com:**
   - Go to your Render dashboard: https://dashboard.render.com
   - Find your web service (likely named `graafin-web` or similar)
   - Copy the service URL (e.g., `https://graafin-web.onrender.com`)
   - Add `/api` to the end: `https://graafin-web.onrender.com/api`

2. **If deployed elsewhere:**
   - Use your backend server's public URL
   - Make sure it includes the `/api` path if your API routes are under `/api`

### Example values:
```
https://graafin-web.onrender.com/api
https://api.graafin.club/api
http://localhost:3000/api  (for local development)
```

### How it's used:
The frontend uses this URL to make API calls like:
- `GET ${API_URL}/athletes/search?q=john` - Search for athletes
- `GET ${API_URL}/athletes/123` - Get athlete profile
- `GET ${API_URL}/athletes/123/results` - Get athlete results

### Where to set it:
- **Cloudflare Pages:** Environment Variables section → Add `API_URL`
- **Local development:** Edit `frontend/config.js` directly or set in your shell

---

## SUPABASE_URL

### What it is:
The **SUPABASE_URL** is your Supabase project's API URL. This is where your Supabase database and authentication services are hosted.

### Where to find it:
1. Go to your [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Go to **Settings** → **API**
4. Under **Project URL**, you'll see something like:
   ```
   https://xxxxxxxxxxxxx.supabase.co
   ```
5. Copy this entire URL (including `https://`)

### Example values:
```
https://fazdbecnxwgkvbxwlrfn.supabase.co
https://abcdefghijklmnop.supabase.co
```

### How it's used:
The frontend uses this URL to:
- Initialize the Supabase client for authentication
- Make authenticated API calls to Supabase
- Handle OAuth redirects

### Where to set it:
- **Cloudflare Pages:** Environment Variables section → Add `SUPABASE_URL`
- **Local development:** Edit `frontend/config.js` directly

---

## SUPABASE_ANON_KEY

### What it is:
The **SUPABASE_ANON_KEY** (also called "anon public key" or "public key") is a **public, client-side safe** API key that allows your frontend to authenticate users and make read-only database queries. This key is safe to expose in client-side code.

### ⚠️ Important Security Note:
- ✅ **SAFE** to use in frontend/browser code
- ✅ **SAFE** to commit to public repositories (it's designed to be public)
- ❌ **NOT** the same as `SUPABASE_SERVICE_ROLE_KEY` (which is secret and server-only)
- ✅ Has Row Level Security (RLS) policies that limit what it can access

### Where to find it:
1. Go to your [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Go to **Settings** → **API**
4. Under **Project API keys**, find the **`anon` `public`** key
5. Click **Reveal** to show the key
6. Copy the entire key (it's a long JWT token)

### Example format:
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhemRiZWNueHdna3ZieHdscmZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyMDg3NTksImV4cCI6MjA4Mzc4NDc1OX0.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### How it's used:
The frontend uses this key to:
- Initialize the Supabase client: `supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)`
- Sign users in with OAuth (Google, GitHub, Apple, Facebook)
- Read data from Supabase tables (subject to RLS policies)
- Get the current user's session

### Where to set it:
- **Cloudflare Pages:** Environment Variables section → Add `SUPABASE_ANON_KEY`
- **Local development:** Edit `frontend/config.js` directly

---

## Quick Reference

### For Cloudflare Pages Deployment:

1. **Go to:** Cloudflare Dashboard → Your Pages Project → Settings → Environment Variables

2. **Add these three variables:**

   | Variable Name | Example Value | Required? |
   |--------------|---------------|----------|
   | `API_URL` | `https://graafin-web.onrender.com/api` | ✅ Yes |
   | `SUPABASE_URL` | `https://fazdbecnxwgkvbxwlrfn.supabase.co` | ⚠️ Optional (only if using auth) |
   | `SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` | ⚠️ Optional (only if using auth) |

3. **Set for:** Production (and Preview if you want)

4. **Build command:** `cd frontend && node build-config.js`

### For Local Development:

Edit `frontend/config.js` directly:

```javascript
window.API_BASE = window.API_BASE || 'http://localhost:3000/api';
window.SUPABASE_URL = window.SUPABASE_URL || 'https://your-project.supabase.co';
window.SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'your-anon-key-here';
```

---

## What's the Difference Between SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY?

| Feature | SUPABASE_ANON_KEY | SUPABASE_SERVICE_ROLE_KEY |
|---------|-------------------|---------------------------|
| **Location** | Frontend/client-side | Backend/server-side only |
| **Safety** | ✅ Safe to expose publicly | ❌ **NEVER** expose publicly |
| **Permissions** | Limited by RLS policies | Bypasses RLS (full access) |
| **Use Case** | User authentication, public reads | Admin operations, migrations |
| **Where to find** | Settings → API → `anon` `public` | Settings → API → `service_role` |

**For the frontend, you ONLY need `SUPABASE_ANON_KEY`.**

---

## Testing Your Configuration

### Test API_URL:
Open browser console and check:
```javascript
console.log(window.API_BASE);
// Should show: https://graafin-web.onrender.com/api
```

### Test Supabase:
Open browser console and check:
```javascript
console.log(window.SUPABASE_URL);
console.log(window.SUPABASE_ANON_KEY);
// Should show your Supabase URL and key
```

If authentication doesn't work, check:
1. Supabase URL is correct
2. Anon key is correct (not the service role key!)
3. OAuth providers are configured in Supabase dashboard
4. Site URL is set correctly in Supabase → Settings → Authentication
