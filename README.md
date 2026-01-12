# GRAAFIN

Monitor, scrape, and search Dubai Creek Striders Half Marathon results with WhatsApp notifications and a hosted search UI.

## Features

- **Monitor** - Check if the results API is up and get notified via WhatsApp when it comes back online
- **Auto-Scrape** - Automatically scrape results when the API recovers
- **Search UI** - Web-based fuzzy search for participants (shareable URL)
- **Download** - Export all results as CSV or JSON
- **CLI** - Command-line tools for local use

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your settings (see `.env.example` for all options).

### 3. Run locally

```bash
# Check current site status
npm run status

# Start the web search UI
npm run dev:server
# Open http://localhost:3000

# Run continuous monitoring with auto-scrape
npm run monitor -- --continuous --notify --auto-scrape

# Manual scrape
npm run scrape

# CLI search
npm run search "John Smith"
```

## Deploy to Render (Free)

1. Push this repo to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com)
3. Click **New** > **Blueprint**
4. Connect your GitHub repo
5. Render will create:
   - **Web Service** - Search UI at `GRAAFIN-web.onrender.com`
   - **Cron Job** - Monitors every 5 min, auto-scrapes on recovery
   - **Persistent Disk** - Stores results across deploys
6. Add environment variables in Render dashboard:
   - `TWILIO_ACCOUNT_SID` - Your Twilio Account SID
   - `TWILIO_AUTH_TOKEN` - Your Twilio Auth Token
   - `TWILIO_WHATSAPP_FROM` - Twilio WhatsApp number to send FROM (format: `whatsapp:+14155238886` for sandbox, or your approved Twilio WhatsApp number)
   - `NOTIFY_WHATSAPP` - Your phone number to receive notifications TO (format: `+1234567890` or `whatsapp:+1234567890` - the `whatsapp:` prefix is added automatically if missing)

Once deployed, share your Render URL with friends to search results!

## Twilio Setup (WhatsApp)

1. Create a [Twilio account](https://www.twilio.com/try-twilio)
2. Go to **Messaging** > **Try it Out** > **Send a WhatsApp message**
3. Follow instructions to connect your phone (send "join \<sandbox-code\>" to the Twilio number)
4. Copy your Account SID and Auth Token from the console
5. Add them to your `.env` file or Render environment variables:
   - `TWILIO_ACCOUNT_SID` - Your Account SID
   - `TWILIO_AUTH_TOKEN` - Your Auth Token
   - `TWILIO_WHATSAPP_FROM` - The Twilio WhatsApp number (usually `whatsapp:+14155238886` for sandbox, or your approved number in production)
   - `NOTIFY_WHATSAPP` - Your phone number where you want to receive notifications (e.g., `+1234567890` - the `whatsapp:` prefix is optional)

## CLI Commands

| Command | Description |
|---------|-------------|
| `npm run status` | Check current API status |
| `npm run monitor` | Single check (for cron jobs) |
| `npm run monitor -- --continuous` | Continuous polling |
| `npm run monitor -- --notify` | Send WhatsApp on status change |
| `npm run monitor -- --auto-scrape` | Auto-scrape when API recovers |
| `npm run scrape` | Download all results |
| `npm run search "name"` | Fuzzy search for participant |
| `npm run dev:server` | Start local web server |
| `npm run dev test-notify` | Send test WhatsApp message |

## API Endpoints

When running the web server:

| Endpoint | Description |
|----------|-------------|
| `GET /` | Search UI |
| `GET /api/status` | Monitor status + result count |
| `GET /api/search?q=name` | Fuzzy search (JSON) |
| `GET /api/results` | All results (JSON) |
| `GET /api/download/csv` | Download as CSV |
| `GET /api/download/json` | Download as JSON |

## Project Structure

```
GRAAFIN/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── server.ts             # Express web server
│   ├── monitor.ts            # Health check logic
│   ├── scraper.ts            # Results scraper
│   ├── search.ts             # Fuzzy name search
│   ├── notifications/
│   │   ├── twilio.ts         # WhatsApp integration
│   │   └── index.ts          # Notification dispatcher
│   ├── public/
│   │   └── index.html        # Search UI
│   └── types.ts              # TypeScript interfaces
├── data/
│   ├── results.json          # Scraped results
│   └── state.json            # Monitor state
├── render.yaml               # Render deployment config
└── .env                      # Your configuration (not in git)
```

## How It Works

1. **Cron job** runs every 5 minutes on Render
2. Checks if the results API returns 200 (currently 504)
3. When API recovers:
   - Auto-scrapes all results to persistent disk
   - Sends WhatsApp notification with search URL
4. **Web service** serves the search UI
5. Anyone with the URL can search/download results

## Local Development

```bash
# Run CLI with tsx (no build needed)
npm run dev status
npm run dev monitor --continuous --notify --auto-scrape

# Run web server
npm run dev:server

# Build for production
npm run build
npm run server
```
