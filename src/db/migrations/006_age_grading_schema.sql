-- Migration 006: Age-Grading and Season Bests Schema
-- This migration is idempotent - safe to run multiple times

-- Season bests table
CREATE TABLE IF NOT EXISTS season_bests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE,
  distance text NOT NULL,
  season_year integer NOT NULL,
  best_time text NOT NULL,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  result_id uuid REFERENCES race_results(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(athlete_id, distance, season_year)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_season_bests_athlete_id ON season_bests(athlete_id);
CREATE INDEX IF NOT EXISTS idx_season_bests_season_year ON season_bests(season_year);
CREATE INDEX IF NOT EXISTS idx_season_bests_distance ON season_bests(distance);
CREATE INDEX IF NOT EXISTS idx_season_bests_athlete_season ON season_bests(athlete_id, season_year);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_season_bests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_season_bests_updated_at ON season_bests;
CREATE TRIGGER update_season_bests_updated_at BEFORE UPDATE ON season_bests
  FOR EACH ROW EXECUTE FUNCTION update_season_bests_updated_at();

-- Row Level Security (RLS) Policies

-- Enable RLS
ALTER TABLE season_bests ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Season bests are viewable by everyone" ON season_bests;

-- Season bests: Public read
CREATE POLICY "Season bests are viewable by everyone" ON season_bests
  FOR SELECT USING (true);
