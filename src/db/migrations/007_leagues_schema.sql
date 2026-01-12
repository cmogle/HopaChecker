-- Migration 007: Virtual Leagues Schema
-- This migration is idempotent - safe to run multiple times

-- Leagues table
CREATE TABLE IF NOT EXISTS leagues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  type text NOT NULL, -- 'geographic', 'age_group', 'custom'
  criteria jsonb, -- Store league criteria (location, distance, age_group, etc.)
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- League rankings table
CREATE TABLE IF NOT EXISTS league_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid REFERENCES leagues(id) ON DELETE CASCADE,
  athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE,
  rank integer NOT NULL,
  points numeric,
  last_updated timestamptz DEFAULT now(),
  UNIQUE(league_id, athlete_id)
);

-- League rankings history (for tracking rank changes over time)
CREATE TABLE IF NOT EXISTS league_rankings_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid REFERENCES leagues(id) ON DELETE CASCADE,
  athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE,
  rank integer NOT NULL,
  points numeric,
  recorded_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_leagues_type ON leagues(type);
CREATE INDEX IF NOT EXISTS idx_league_rankings_league_id ON league_rankings(league_id);
CREATE INDEX IF NOT EXISTS idx_league_rankings_athlete_id ON league_rankings(athlete_id);
CREATE INDEX IF NOT EXISTS idx_league_rankings_rank ON league_rankings(league_id, rank);
CREATE INDEX IF NOT EXISTS idx_league_rankings_history_league ON league_rankings_history(league_id, recorded_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_leagues_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_leagues_updated_at ON leagues;
CREATE TRIGGER update_leagues_updated_at BEFORE UPDATE ON leagues
  FOR EACH ROW EXECUTE FUNCTION update_leagues_updated_at();

-- Row Level Security (RLS) Policies

-- Enable RLS
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_rankings_history ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Leagues are viewable by everyone" ON leagues;
DROP POLICY IF EXISTS "League rankings are viewable by everyone" ON league_rankings;
DROP POLICY IF EXISTS "League rankings history is viewable by everyone" ON league_rankings_history;

-- Leagues: Public read
CREATE POLICY "Leagues are viewable by everyone" ON leagues
  FOR SELECT USING (true);

-- League rankings: Public read
CREATE POLICY "League rankings are viewable by everyone" ON league_rankings
  FOR SELECT USING (true);

-- League rankings history: Public read
CREATE POLICY "League rankings history is viewable by everyone" ON league_rankings_history
  FOR SELECT USING (true);
