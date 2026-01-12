# Scraping Races for GRAAFIN

This guide helps you find and scrape races so athletes can search for themselves.

## Supported Organisers

1. **Hopasports** (`hopasports`) - https://results.hopasports.com
2. **EvoChip** (`evochip`) - https://evochip.hu

## Quick Start: Scrape a Race

### Option 1: Using the Script (Recommended)

**For Remote Backend (Render.com):**
```bash
# Set your admin API key and remote API URL
export ADMIN_API_KEY=your-admin-api-key
export API_BASE=https://graafin-web.onrender.com/api

# Scrape a Hopasports race
node scripts/scrape-races.js "https://results.hopasports.com/event/marina-home-dubai-creek-striders-half-marathon-10km-2026"

# Scrape with explicit organiser
node scripts/scrape-races.js "https://results.hopasports.com/event/plus500-city-half-marathon-dubai-2025" hopasports
```

**For Local Backend:**
```bash
# Set your admin API key (API_BASE defaults to localhost)
export ADMIN_API_KEY=your-admin-api-key

# Scrape a race
node scripts/scrape-races.js "https://results.hopasports.com/event/marina-home-dubai-creek-striders-half-marathon-10km-2026"
```

**Using .env file:**
Create or update `.env` in the project root:
```bash
ADMIN_API_KEY=your-admin-api-key
API_BASE=https://graafin-web.onrender.com/api
```

Then run:
```bash
node scripts/scrape-races.js "https://results.hopasports.com/event/marina-home-dubai-creek-striders-half-marathon-10km-2026"
```

### Option 2: Using the Admin API Directly

```bash
curl -X POST https://graafin-web.onrender.com/api/admin/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-admin-api-key" \
  -d '{
    "eventUrl": "https://results.hopasports.com/event/marina-home-dubai-creek-striders-half-marathon-10km-2026",
    "organiser": "hopasports"
  }'
```

### Option 3: Using the Frontend Admin Panel

1. Visit `https://graafin.club` (or your frontend URL)
2. Navigate to the Admin page
3. Enter your Admin API Key
4. Enter the event URL
5. Click "Start Scraping"

## Finding Races to Scrape

### Hopasports Races

1. Go to https://results.hopasports.com
2. Browse events or search for specific races
3. Copy the event URL (format: `https://results.hopasports.com/event/event-name-year`)
4. Use the URL to scrape

**Example Hopasports URLs:**
- Marina Home Dubai Creek Striders: `https://results.hopasports.com/event/marina-home-dubai-creek-striders-half-marathon-10km-2026`
- Plus500 City Half Marathon: `https://results.hopasports.com/event/plus500-city-half-marathon-dubai-2025`

### EvoChip Races

1. Go to https://evochip.hu
2. Navigate to results section
3. Find your event and copy the full results URL
4. Use the URL to scrape

**Example EvoChip URL:**
```
https://evochip.hu/results/result.php?distance=hm&category=none&timepoint=none&eventid=DubaiCreekHalf26DAd&year=&lang=en&css=evochip.css&iframe=0&mobile=0&viewport=device-width
```

## Recommended Races to Start With

Here are some good races to scrape to get started:

### 1. Marina Home Dubai Creek Striders Half Marathon & 10km 2026
```bash
node scripts/scrape-races.js "https://results.hopasports.com/event/marina-home-dubai-creek-striders-half-marathon-10km-2026" hopasports
```

### 2. Plus500 City Half Marathon Dubai 2025
```bash
node scripts/scrape-races.js "https://results.hopasports.com/event/plus500-city-half-marathon-dubai-2025" hopasports
```

### 3. Dubai Creek Half Marathon (EvoChip)
```bash
node scripts/scrape-races.js "https://evochip.hu/results/result.php?distance=hm&category=none&timepoint=none&eventid=DubaiCreekHalf26DAd&year=&lang=en&css=evochip.css&iframe=0&mobile=0&viewport=device-width" evochip
```

## Checking Scrape Status

### View All Scrape Jobs

```bash
curl -H "X-API-Key: your-admin-api-key" \
  https://graafin-web.onrender.com/api/admin/scrape-jobs
```

### Check in Frontend

1. Go to Admin page
2. Enter your API key
3. Click "Refresh" on "Scraping Jobs" section

## Verifying Results

After scraping, verify athletes can be found:

1. Go to https://graafin.club
2. Use the search bar to search for athlete names
3. If results appear, the scrape was successful!

## Configuration

### Setting API_BASE for Remote Backend

If your backend is deployed on Render.com (or another remote server), set `API_BASE`:

**Option 1: Environment Variable**
```bash
export API_BASE=https://graafin-web.onrender.com/api
```

**Option 2: .env File**
Add to `.env`:
```bash
API_BASE=https://graafin-web.onrender.com/api
```

**Option 3: API_URL (also works)**
The script also accepts `API_URL`:
```bash
export API_URL=https://graafin-web.onrender.com/api
```

**Default:** If not set, defaults to `http://localhost:3000/api` (for local development)

### Finding Your Backend URL

1. **Render.com:**
   - Go to https://dashboard.render.com
   - Find your web service
   - Copy the service URL (e.g., `https://graafin-web.onrender.com`)
   - Add `/api`: `https://graafin-web.onrender.com/api`

2. **Custom Domain:**
   - If you have `api.graafin.club` set up: `https://api.graafin.club/api`

## Troubleshooting

### Error: "No scraper available for URL"

- Make sure the URL is from a supported organiser (hopasports or evochip)
- Try specifying the organiser explicitly: `node scripts/scrape-races.js "<url>" hopasports`

### Error: "Site appears to be down or unreachable"

- Verify the event URL is accessible in your browser
- The event page might be temporarily down
- Try again later

### Error: "Unauthorized - Admin access required"

- Make sure `ADMIN_API_KEY` is set correctly
- Verify the API key matches what's configured in your backend

### No Results After Scraping

- Check the scrape job status - it might still be running
- Verify the event URL has results published
- Check backend logs for any errors during scraping

## Batch Scraping Multiple Races

Create a simple script to scrape multiple races:

```bash
#!/bin/bash
export ADMIN_API_KEY=your-admin-api-key

# List of race URLs
races=(
  "https://results.hopasports.com/event/marina-home-dubai-creek-striders-half-marathon-10km-2026"
  "https://results.hopasports.com/event/plus500-city-half-marathon-dubai-2025"
)

for race in "${races[@]}"; do
  echo "Scraping: $race"
  node scripts/scrape-races.js "$race" hopasports
  sleep 5  # Wait 5 seconds between scrapes
done
```

## Next Steps

After scraping races:

1. **Test Search**: Try searching for athlete names on graafin.club
2. **Check Profiles**: Click on athletes to see their profiles
3. **Monitor**: Set up endpoint monitoring for future races
4. **Share**: Let athletes know they can search for themselves!

## Adding More Organisers

To add support for a new race organiser:

1. Create a new scraper in `src/scraper/organisers/`
2. Implement the `OrganiserScraper` interface
3. Register it in `src/scraper/index.ts`
4. Test with a sample race URL

See existing scrapers (`hopasports.ts`, `evochip.ts`) for examples.
