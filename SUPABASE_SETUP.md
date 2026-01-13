# Supabase Setup Guide

This guide walks you through setting up Supabase for the Athlete Performance Platform.

## Prerequisites

- A Supabase account (sign up at https://supabase.com if needed)
- A Supabase project created (Pro tier as mentioned)

## Step 1: Get Supabase Credentials

### 1.1 Get Your Supabase URL

1. Log in to your [Supabase Dashboard](https://app.supabase.com)
2. Select your project (or create a new one)
3. Go to **Settings** (gear icon in the left sidebar)
4. Click on **API** in the settings menu
5. Under **Project URL**, copy the URL (e.g., `https://xxxxxxxxxxxxx.supabase.co`)
   - This is your `SUPABASE_URL`

### 1.2 Get Your Service Role Key

1. Still in **Settings** > **API**
2. Scroll down to **Project API keys**
3. Find the **service_role** key (⚠️ **Keep this secret!** It bypasses Row Level Security)
4. Click **Reveal** and copy the key
   - This is your `SUPABASE_SERVICE_ROLE_KEY`
   - ⚠️ **Never expose this in client-side code or commit it to git**

### 1.3 Generate an Admin API Key (Optional but Recommended)

For the admin endpoints, you can use any secure random string. Generate one:

**Option A: Using Node.js**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Option B: Using OpenSSL**
```bash
openssl rand -hex 32
```

**Option C: Using an online generator**
- Visit https://www.random.org/strings/
- Generate a 64-character hexadecimal string

Copy this value - this is your `ADMIN_API_KEY`

## Step 2: Run Database Migration

### 2.1 Access SQL Editor

1. In your Supabase Dashboard, click **SQL Editor** in the left sidebar
2. Click **New query**

### 2.2 Run the Migration

1. Open the file `src/db/migrations/001_initial_schema.sql` in your project
2. Copy the entire contents of the file
3. Paste it into the SQL Editor in Supabase
4. Click **Run** (or press `Cmd+Enter` / `Ctrl+Enter`)

You should see a success message. The migration creates:
- All necessary tables (athletes, events, race_results, athlete_follows, scrape_jobs)
- Indexes for performance
- Row Level Security (RLS) policies
- Triggers for auto-updating timestamps

### 2.3 Verify Tables Were Created

1. In Supabase Dashboard, click **Table Editor** in the left sidebar
2. You should see these tables:
   - `athletes`
   - `events`
   - `race_results`
   - `athlete_follows`
   - `scrape_jobs`

## Step 3: Configure OAuth Providers

### 3.1 Configure Google OAuth

1. In Supabase Dashboard, go to **Settings** > **Authentication**
2. Scroll down to **Auth Providers**
3. Find **Google** in the list and click on it
4. Toggle **Enable Google provider** to ON
5. You'll need to create OAuth credentials in Google Cloud Console:

   **Creating Google OAuth Credentials:**
   
   **Important:** The Google account you use here is for **managing the OAuth application**, not for end-user sign-in. This account will:
   - Own and manage the OAuth credentials
   - Have access to the Google Cloud project
   - Receive billing/quota notifications (if applicable)
   - Control who can sign in with Google
   
   **Which account to use:**
   - **For production:** Use a business/organization Google account (Google Workspace recommended)
   - **For development/testing:** Your personal Google account is fine
   - **Best practice:** Create a dedicated service account or use your organization's admin account
   
   a. Go to [Google Cloud Console](https://console.cloud.google.com/)
      - Sign in with the Google account you want to use for managing the OAuth app
      - This account will be the project owner/administrator
   
   b. Create a new project or select an existing one
      - **Project name:** "Athlete Performance Platform" (or your choice)
      - **Organization:** Select your organization if using Google Workspace (optional)
      - **Location:** Choose your preferred location
   
   c. Go to **APIs & Services** > **Credentials**
   
   d. Click **Create Credentials** > **OAuth client ID**
   
   e. If prompted, configure the OAuth consent screen:
      - **User Type:** Choose **External** (unless you have a Google Workspace with internal users only)
      - **App information:**
        - **App name:** "Athlete Performance Platform" (or your choice)
        - **User support email:** Use the email of the Google account managing this app (or your support email)
        - **Developer contact information:** The email of the Google account owner (you)
      - **Scopes:** Add `email` and `profile` (these are usually added by default)
      - **Test users:** Add test email addresses if your app is in testing mode
        - Note: Only these test users can sign in until your app is verified by Google
      - **Publishing status:** 
        - For development: Leave as "Testing" (limited to test users)
        - For production: Submit for verification (allows any Google user to sign in)
   
   f. Create OAuth client:
      - Application type: **Web application**
      - Name: "Athlete Performance Platform" (or your choice)
      - Authorized redirect URIs: 
        ```
        https://fazdbecnxwgkvbxwlrfn.supabase.co/auth/v1/callback
        http://graafin.club/auth/v1/callback
        ```
        (Add both: Supabase callback and your production domain callback)
   
   g. Copy the **Client ID** and **Client Secret**

6. Back in Supabase, paste:
   - **Client ID (for Google OAuth)**: Your Google Client ID
   - **Client Secret (for Google OAuth)**: Your Google Client Secret

7. Click **Save**

   **Note:** 
   - The Google account used to create these credentials is only for **managing the OAuth app**
   - **Any Google user** can sign in to your platform (once the app is verified/published)
   - The managing account doesn't need to be the same as users who sign in
   - Keep the Client Secret secure - it's used to authenticate your app with Google

### 3.2 Configure GitHub OAuth

1. Still in **Settings** > **Authentication** > **Auth Providers**
2. Find **GitHub** and click on it
3. Toggle **Enable GitHub provider** to ON
4. You'll need to create a GitHub OAuth App:

   **Creating GitHub OAuth App:**
   
   a. Go to your GitHub account settings: https://github.com/settings/developers
   
   b. Click **OAuth Apps** > **New OAuth App**
   
   c. Fill in the form:
      - **Application name**: "Athlete Performance Platform" (or your choice)
      - **Homepage URL**: `http://graafin.club` (production) or `http://localhost:3000` (dev)
      - **Authorization callback URL**: 
        ```
        https://fazdbecnxwgkvbxwlrfn.supabase.co/auth/v1/callback
        ```
        (For production, also add: `http://graafin.club/auth/v1/callback` if using custom domain)
   
   d. Click **Register application**
   
   e. Copy the **Client ID**
   
   f. Click **Generate a new client secret** and copy the secret

5. Back in Supabase, paste:
   - **Client ID (for GitHub OAuth)**: Your GitHub Client ID
   - **Client Secret (for GitHub OAuth)**: Your GitHub Client Secret

6. Click **Save**

### 3.3 Configure Apple OAuth (Sign in with Apple)

1. Still in **Settings** > **Authentication** > **Auth Providers**
2. Find **Apple** and click on it
3. Toggle **Enable Apple provider** to ON
4. You'll need to create an Apple Services ID:

   **Creating Apple Services ID:**
   
   a. Go to [Apple Developer Portal](https://developer.apple.com/account/)
   
   b. Navigate to **Certificates, Identifiers & Profiles**
   
   c. Click **Identifiers** > **+** (plus button)
   
   d. Select **Services IDs** and click **Continue**
   
   e. Fill in the form:
      - **Description**: "Athlete Performance Platform" (or your choice)
      - **Identifier**: `com.yourcompany.athleteplatform` (must be unique, reverse domain format)
   
   f. Click **Continue** > **Register**
   
   g. Select your newly created Services ID
   
   h. Check **Sign in with Apple** and click **Configure**
   
   i. Configure Sign in with Apple:
      - **Primary App ID**: Select your app (or create one if needed)
      - **Website URLs**:
        - **Domains and Subdomains**: `fazdbecnxwgkvbxwlrfn.supabase.co` and `graafin.club`
        - **Return URLs**: 
          ```
          https://fazdbecnxwgkvbxwlrfn.supabase.co/auth/v1/callback
          http://graafin.club/auth/v1/callback
          ```
          (Add both: Supabase callback and your production domain callback)
      - Click **Save** > **Continue** > **Save**
   
   j. Go back to your Services ID and click **Edit**
   
   k. Under **Sign in with Apple**, click **Configure** again
   
   l. Create a **Key** for Sign in with Apple:
      - Go to **Keys** section
      - Click **+** (plus button)
      - **Key Name**: "Sign in with Apple Key"
      - Check **Sign in with Apple**
      - Click **Configure** > Select your Primary App ID > **Save**
      - Click **Continue** > **Register**
      - **Download the key file** (`.p8` file) - you can only download it once!
      - Note the **Key ID**
   
   m. Back in Services ID, note your:
      - **Services ID** (this is your Client ID)
      - **Team ID** (found in top right of Apple Developer portal)
      - **Key ID** (from step l)
      - **Key file** (`.p8` file downloaded in step l)

5. Back in Supabase, paste:
   - **Services ID (for Apple OAuth)**: Your Services ID (Client ID)
   - **Secret Key**: Generate a JWT secret using one of these methods:
     
     **Method 1: Using the provided helper script** (recommended):
     
     A helper script is included in the project at `scripts/generate-apple-secret.js`
     
     First, install the required dependency:
     ```bash
     npm install jsonwebtoken @types/jsonwebtoken
     ```
     
     Then run:
     ```bash
     APPLE_TEAM_ID=your_team_id \
     APPLE_KEY_ID=your_key_id \
     APPLE_KEY_FILE=./path/to/AuthKey_KEYID.p8 \
     node scripts/generate-apple-secret.js
     ```
     
     The script will output your Apple Secret Key to copy into Supabase.
     
     **Method 2: Using online tool** (less secure, use only for testing):
     - Visit: https://appleid.apple.com/account/manage
     - Or use a JWT generator tool that supports ES256
     
     **Method 3: Supabase CLI** (if available):
     ```bash
     supabase gen apple-secret --team-id YOUR_TEAM_ID --key-id YOUR_KEY_ID --key-file AuthKey_KEYID.p8
     ```
   
   - **Team ID (for Apple OAuth)**: Your Apple Team ID (found in top right of Apple Developer portal)
   - **Key ID (for Apple OAuth)**: Your Key ID (from the key you created)

6. Click **Save**

   **Note:** Apple requires your app to be verified and may require additional setup for production use. For development, you can use a test configuration.

### 3.4 Configure Facebook OAuth

1. Still in **Settings** > **Authentication** > **Auth Providers**
2. Find **Facebook** and click on it
3. Toggle **Enable Facebook provider** to ON
4. You'll need to create a Facebook App:

   **Creating Facebook App:**
   
   a. Go to [Facebook Developers](https://developers.facebook.com/)
   
   b. Click **My Apps** > **Create App**
   
   c. Select **Consumer** as the app type (or **Business** if you have a business account)
   
   d. Fill in the form:
      - **App Name**: "Athlete Performance Platform" (or your choice)
      - **App Contact Email**: Your email
      - **Business Account** (optional): Select if applicable
   
   e. Click **Create App**
   
   f. In the app dashboard, go to **Settings** > **Basic**
   
   g. Add **App Domains**:
      - `fazdbecnxwgkvbxwlrfn.supabase.co`
      - `graafin.club` (your production domain)
   
   h. Under **Settings** > **Basic**, add **Platform**:
      - Click **Add Platform** > Select **Website**
      - **Site URL**: 
        ```
        http://graafin.club
        ```
   
   i. Go to **Products** in the left sidebar
   
   j. Find **Facebook Login** and click **Set Up**
   
   k. In Facebook Login settings:
      - **Valid OAuth Redirect URIs**: 
        ```
        https://fazdbecnxwgkvbxwlrfn.supabase.co/auth/v1/callback
        http://graafin.club/auth/v1/callback
        ```
      - **Deauthorize Callback URL**: (optional)
        ```
        https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
        ```
      - **Data Deletion Request URL**: (optional, for GDPR compliance)
   
   l. Go back to **Settings** > **Basic**
   
   m. Copy:
      - **App ID** (this is your Client ID)
      - **App Secret** (click **Show** to reveal it)

5. Back in Supabase, paste:
   - **App ID (for Facebook OAuth)**: Your Facebook App ID
   - **App Secret (for Facebook OAuth)**: Your Facebook App Secret

6. Click **Save**

   **Note:** 
   - Facebook apps start in **Development Mode** - only you and added test users can sign in
   - To make it public, submit your app for review in **App Review** section
   - For development, add test users in **Roles** > **Test Users**

### 3.5 Configure Site URL (Important!)

1. In **Settings** > **Authentication**
2. Scroll to **URL Configuration**
3. Set **Site URL** to your production application URL:
   - **Production:** `https://graafin.club` (MUST be HTTPS!)
   - (For development, you can temporarily change this to `http://localhost:3000`)
4. Add **Redirect URLs** for all environments:
   - `http://localhost:3000/**` (development)
   - `https://graafin.club/**` (production - MUST be HTTPS!)
   - `https://fazdbecnxwgkvbxwlrfn.supabase.co/**` (Supabase auth callbacks)

## Step 4: Set Environment Variables

### 4.1 Create .env File

1. In your project root, create a `.env` file (if it doesn't exist)
2. Make sure `.env` is in your `.gitignore` file (it should be)

### 4.2 Add Environment Variables

Add these lines to your `.env` file:

```bash
# Supabase Configuration
SUPABASE_URL=https://fazdbecnxwgkvbxwlrfn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Admin API Key (for admin endpoints)
ADMIN_API_KEY=your_generated_admin_key_here

# Optional: Keep existing variables
PORT=3000
CORS_ORIGIN=*
```

**Replace:**
- `your_service_role_key_here` with your actual service role key (already set if you followed earlier steps)
- `your_generated_admin_key_here` with your generated admin API key (already set if you followed earlier steps)

**Note:** Your Supabase project reference is `fazdbecnxwgkvbxwlrfn` and production domain is `https://graafin.club`

### 4.3 Example .env File

```bash
# Supabase
SUPABASE_URL=https://fazdbecnxwgkvbxwlrfn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
ADMIN_API_KEY=your_generated_admin_key_here

# Server
PORT=3000
CORS_ORIGIN=*

# Optional: Existing Twilio config (if you want to keep notifications)
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
NOTIFY_WHATSAPP=+1234567890
```

## Step 5: Verify Setup

### 5.1 Test Database Connection

Run this command to test if your environment variables are set correctly:

```bash
node -e "
require('dotenv').config();
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? '✅ Set' : '❌ Missing');
console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Set (' + process.env.SUPABASE_SERVICE_ROLE_KEY.substring(0, 20) + '...)' : '❌ Missing');
console.log('ADMIN_API_KEY:', process.env.ADMIN_API_KEY ? '✅ Set' : '❌ Missing');
"
```

### 5.2 Test the Server

1. Start the server:
   ```bash
   npm run dev:server
   ```

2. Check the health endpoint:
   ```bash
   curl http://localhost:3000/api/health
   ```

3. If you see a JSON response, the server is running correctly!

### 5.3 Test Admin Endpoint (Optional)

Test the admin scraping endpoint (replace `YOUR_ADMIN_KEY` with your actual key):

```bash
curl -X POST http://localhost:3000/api/admin/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_ADMIN_KEY" \
  -d '{
    "eventUrl": "https://results.hopasports.com/event/test-event",
    "organiser": "hopasports"
  }'
```

## Troubleshooting

### Issue: "Missing Supabase environment variables"

**Solution:** Make sure your `.env` file is in the project root and contains all three variables.

### Issue: "Failed to save event" or database errors

**Solution:** 
1. Verify the migration ran successfully in Supabase SQL Editor
2. Check that your `SUPABASE_SERVICE_ROLE_KEY` is correct
3. Ensure your Supabase project is active (not paused)

### Issue: OAuth not working

**Solution:**
1. Verify redirect URIs match exactly in both the OAuth provider and Supabase
2. Check that Site URL is set correctly in Supabase Auth settings
3. Ensure OAuth providers are enabled in Supabase
4. For **Apple**: 
   - Verify your Services ID is configured correctly
   - Ensure the secret key is valid and not expired (Apple secrets expire after 180 days)
   - Check that your Team ID, Key ID, and Services ID are correct
   - Verify the `.p8` key file is valid
5. For **Facebook**: 
   - Ensure your app is out of Development Mode (or you've added test users)
   - Verify App Domains and Site URL are configured correctly
   - Check that Facebook Login product is enabled
6. Check browser console for specific error messages
7. Verify OAuth consent screens are properly configured (for Google/Apple)

### Issue: "Unauthorized - Admin access required"

**Solution:** Make sure you're sending the `X-API-Key` header with the correct `ADMIN_API_KEY` value.

## Security Notes

1. **Never commit `.env` to git** - it's already in `.gitignore`
2. **Never expose `SUPABASE_SERVICE_ROLE_KEY`** - it bypasses all security
3. **Rotate keys regularly** - especially if they're exposed
4. **Use different keys for different environments** - dev, staging, production

## Next Steps

Once setup is complete:

1. Run your first scrape via the admin interface
2. Search for athletes in the frontend
3. View athlete performance dashboards
4. Test the following/feed features

For production deployment at `https://graafin.club`, set these environment variables in your hosting platform (Render, AWS, etc.) instead of using a `.env` file.

**Production Domain Configuration:**
- **Production URL:** `https://graafin.club` (MUST be HTTPS!)
- **Supabase Project:** `fazdbecnxwgkvbxwlrfn`
- Make sure all OAuth redirect URIs include both:
  - `https://fazdbecnxwgkvbxwlrfn.supabase.co/auth/v1/callback`
  - `https://graafin.club/auth/v1/callback` (if using custom domain for auth)

## Security Notes

**CRITICAL:** Never commit secrets to git! The following must be kept secret:
- `SUPABASE_SERVICE_ROLE_KEY` - bypasses all Row Level Security
- `ADMIN_API_KEY` - grants admin access to scraping endpoints
- OAuth client secrets

If any secrets are accidentally committed, you MUST:
1. Rotate the key immediately in the respective dashboard
2. Update the new key in your deployment environment (Render.com)
3. Consider the old key compromised and monitor for unauthorized access
