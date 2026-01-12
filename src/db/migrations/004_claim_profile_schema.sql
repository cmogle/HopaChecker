-- Migration 004: Claim Profile Schema
-- This migration is idempotent - safe to run multiple times

-- Profile claims table
CREATE TABLE IF NOT EXISTS profile_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  verification_method text NOT NULL DEFAULT 'strava', -- 'strava', 'email', 'race_quiz'
  verification_status text NOT NULL DEFAULT 'pending', -- 'pending', 'verified', 'rejected'
  strava_athlete_id text,
  created_at timestamptz DEFAULT now(),
  verified_at timestamptz,
  UNIQUE(athlete_id, user_id)
);

-- Athlete merges table (for merging duplicate profiles)
CREATE TABLE IF NOT EXISTS athlete_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE,
  merged_athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE,
  merged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(primary_athlete_id, merged_athlete_id),
  CHECK (primary_athlete_id != merged_athlete_id)
);

-- Hidden results table (Result Eraser feature)
CREATE TABLE IF NOT EXISTS hidden_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE,
  result_id uuid REFERENCES race_results(id) ON DELETE CASCADE,
  reason text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(athlete_id, result_id)
);

-- Strava links table (for OAuth tokens)
CREATE TABLE IF NOT EXISTS strava_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  strava_athlete_id text NOT NULL,
  access_token text NOT NULL,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(athlete_id, strava_athlete_id),
  UNIQUE(user_id, strava_athlete_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_profile_claims_athlete_id ON profile_claims(athlete_id);
CREATE INDEX IF NOT EXISTS idx_profile_claims_user_id ON profile_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_claims_status ON profile_claims(verification_status);
CREATE INDEX IF NOT EXISTS idx_athlete_merges_primary ON athlete_merges(primary_athlete_id);
CREATE INDEX IF NOT EXISTS idx_athlete_merges_merged ON athlete_merges(merged_athlete_id);
CREATE INDEX IF NOT EXISTS idx_hidden_results_athlete_id ON hidden_results(athlete_id);
CREATE INDEX IF NOT EXISTS idx_hidden_results_result_id ON hidden_results(result_id);
CREATE INDEX IF NOT EXISTS idx_strava_links_athlete_id ON strava_links(athlete_id);
CREATE INDEX IF NOT EXISTS idx_strava_links_user_id ON strava_links(user_id);
CREATE INDEX IF NOT EXISTS idx_strava_links_strava_id ON strava_links(strava_athlete_id);

-- Function to update updated_at timestamp for strava_links
CREATE OR REPLACE FUNCTION update_strava_links_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at for strava_links
DROP TRIGGER IF EXISTS update_strava_links_updated_at ON strava_links;
CREATE TRIGGER update_strava_links_updated_at BEFORE UPDATE ON strava_links
  FOR EACH ROW EXECUTE FUNCTION update_strava_links_updated_at();

-- Row Level Security (RLS) Policies

-- Enable RLS
ALTER TABLE profile_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE athlete_merges ENABLE ROW LEVEL SECURITY;
ALTER TABLE hidden_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE strava_links ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Profile claims are viewable by everyone" ON profile_claims;
DROP POLICY IF EXISTS "Users can create their own profile claims" ON profile_claims;
DROP POLICY IF EXISTS "Users can update their own profile claims" ON profile_claims;
DROP POLICY IF EXISTS "Athlete merges are viewable by everyone" ON athlete_merges;
DROP POLICY IF EXISTS "Users can create merges for their claimed profiles" ON athlete_merges;
DROP POLICY IF EXISTS "Hidden results are viewable by profile owner" ON hidden_results;
DROP POLICY IF EXISTS "Users can hide results for their claimed profiles" ON hidden_results;
DROP POLICY IF EXISTS "Users can unhide results for their claimed profiles" ON hidden_results;
DROP POLICY IF EXISTS "Strava links are viewable by owner" ON strava_links;
DROP POLICY IF EXISTS "Users can create their own Strava links" ON strava_links;
DROP POLICY IF EXISTS "Users can update their own Strava links" ON strava_links;

-- Profile claims: Public read, users can create/update their own
CREATE POLICY "Profile claims are viewable by everyone" ON profile_claims
  FOR SELECT USING (true);

CREATE POLICY "Users can create their own profile claims" ON profile_claims
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile claims" ON profile_claims
  FOR UPDATE USING (auth.uid() = user_id);

-- Athlete merges: Public read, users can create for their claimed profiles
CREATE POLICY "Athlete merges are viewable by everyone" ON athlete_merges
  FOR SELECT USING (true);

CREATE POLICY "Users can create merges for their claimed profiles" ON athlete_merges
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profile_claims
      WHERE athlete_id = primary_athlete_id 
        AND user_id = auth.uid()
        AND verification_status = 'verified'
    )
  );

-- Hidden results: Users can view/manage for their claimed profiles
CREATE POLICY "Hidden results are viewable by profile owner" ON hidden_results
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profile_claims
      WHERE athlete_id = hidden_results.athlete_id
        AND user_id = auth.uid()
        AND verification_status = 'verified'
    )
  );

CREATE POLICY "Users can hide results for their claimed profiles" ON hidden_results
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profile_claims
      WHERE athlete_id = hidden_results.athlete_id
        AND user_id = auth.uid()
        AND verification_status = 'verified'
    )
  );

CREATE POLICY "Users can unhide results for their claimed profiles" ON hidden_results
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profile_claims
      WHERE athlete_id = hidden_results.athlete_id
        AND user_id = auth.uid()
        AND verification_status = 'verified'
    )
  );

-- Strava links: Users can view/manage their own
CREATE POLICY "Strava links are viewable by owner" ON strava_links
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own Strava links" ON strava_links
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own Strava links" ON strava_links
  FOR UPDATE USING (auth.uid() = user_id);
