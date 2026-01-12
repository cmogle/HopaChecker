# GRAAFIN Frontend

This is the frontend application for GRAAFIN.club, designed to be deployed on Cloudflare Pages.

## Features

- **Premium Dark Theme**: Beautiful dark UI with gold accents
- **Hero Section**: Animated landing page with smooth scroll effects
- **Real-time Search**: Debounced athlete search with instant results
- **Athlete Profiles**: Detailed performance stats, charts, and race history
- **Optional Authentication**: Sign in with Google, GitHub, Apple, or Facebook
- **Performance Charts**: Visualize athlete trends with Chart.js
- **Responsive Design**: Mobile-first design with hamburger menu

## Local Development

1. Serve the files using any static file server:
   ```bash
   # Using Python
   cd frontend
   python3 -m http.server 8000
   
   # Using Node.js (http-server)
   npx http-server frontend -p 8000
   ```

2. Update `config.js` to point to your local backend:
   ```javascript
   window.API_BASE = 'http://localhost:3000/api';
   ```

3. For authentication, add Supabase credentials to `config.js`:
   ```javascript
   window.SUPABASE_URL = 'https://your-project.supabase.co';
   window.SUPABASE_ANON_KEY = 'your-anon-key';
   ```

## Deployment to Cloudflare Pages

### Option 1: Manual Configuration (Simplest)

1. Edit `config.js` and update the default values:
   ```javascript
   window.API_BASE = window.API_BASE || 'https://graafin-web.onrender.com/api';
   window.SUPABASE_URL = window.SUPABASE_URL || 'https://your-project.supabase.co';
   window.SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'your-anon-key';
   ```
2. Push to Git repository
3. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) > Pages
4. Click "Create a project" > "Connect to Git"
5. Build settings:
   - **Build command**: (leave empty)
   - **Build output directory**: `frontend`

### Option 2: Automated Build Script (Recommended)

1. Push to Git repository
2. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) > Pages
3. Click "Create a project" > "Connect to Git"
4. Build settings:
   - **Build command**: `cd frontend && node build-config.js`
   - **Build output directory**: `frontend`
5. Add environment variables in Cloudflare Pages:
   - **Variable name**: `API_URL`
     - **Value**: Your backend API URL (e.g., `https://graafin-web.onrender.com/api`)
   - **Variable name**: `SUPABASE_URL`
     - **Value**: Your Supabase project URL (e.g., `https://your-project.supabase.co`)
   - **Variable name**: `SUPABASE_ANON_KEY`
     - **Value**: Your Supabase anon/public key

The build script will automatically inject these values into `config.js` during deployment.

## Custom Domain Setup

1. In Cloudflare Pages project settings, go to "Custom domains"
2. Add `graafin.club` and `www.graafin.club`
3. Update your domain's DNS records to point to Cloudflare Pages:
   - Add an A record or CNAME pointing to Cloudflare Pages
   - Cloudflare will provide the exact DNS settings

## Configuration

### Environment Variables

**📖 For detailed explanations of each environment variable, see [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md)**

Quick summary:
- **`API_URL`**: Your backend API server URL (e.g., `https://graafin-web.onrender.com/api`)
- **`SUPABASE_URL`**: Your Supabase project URL (e.g., `https://your-project.supabase.co`)
- **`SUPABASE_ANON_KEY`**: Your Supabase anonymous/public key (safe for client-side use)

### API Configuration

The API base URL is configured via `config.js`. The build script (`build-config.js`) can inject environment variables during deployment.

### Supabase Authentication

To enable authentication features:

1. Get your Supabase credentials from your [Supabase Dashboard](https://app.supabase.com)
   - Go to Settings > API
   - Copy your Project URL → `SUPABASE_URL`
   - Copy your `anon` public key → `SUPABASE_ANON_KEY`

2. Configure OAuth providers in Supabase:
   - Go to Settings > Authentication > Providers
   - Enable Google, GitHub, Apple, or Facebook
   - Follow the setup instructions for each provider

3. Set environment variables in Cloudflare Pages (if using build script) or update `config.js` directly

### CORS Configuration

Ensure your backend API (e.g., Render) has CORS configured to allow requests from:
- `https://graafin.club`
- `https://www.graafin.club`
- Your Cloudflare Pages preview URLs

## File Structure

```
frontend/
├── index.html          # Main HTML file
├── config.js           # API and Supabase configuration
├── build-config.js      # Build script for environment variables
├── _redirects           # Cloudflare Pages routing rules
├── css/
│   └── styles.css      # Premium dark theme stylesheet
└── js/
    ├── app.js          # Main application logic
    ├── auth.js         # Supabase authentication
    ├── search.js       # Search functionality
    └── animations.js   # Scroll animations and effects
```

## Browser Support

- Modern browsers with ES6 module support
- Chrome, Firefox, Safari, Edge (latest versions)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Performance

- Lazy loading for images and content
- Debounced search requests (300ms)
- Cached API responses
- CSS animations (hardware accelerated)
- Minimal JavaScript bundle size
