-- Migration 005: Watchlists Schema
-- This migration is idempotent - safe to run multiple times

-- Watchlists table (replaces simple follows with named lists)
CREATE TABLE IF NOT EXISTS watchlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(athlete_id, name)
);

-- Watchlist items (athletes being watched)
CREATE TABLE IF NOT EXISTS watchlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id uuid REFERENCES watchlists(id) ON DELETE CASCADE,
  watched_athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(watchlist_id, watched_athlete_id)
);

-- Watchlist notifications (configure alerts for specific benchmarks)
CREATE TABLE IF NOT EXISTS watchlist_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_item_id uuid REFERENCES watchlist_items(id) ON DELETE CASCADE,
  notification_type text NOT NULL, -- 'new_result', 'benchmark', 'rank_change'
  threshold_value text, -- e.g., '20:00' for sub-20:00 5K, or distance like '10k'
  enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_watchlists_athlete_id ON watchlists(athlete_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_items_watchlist_id ON watchlist_items(watchlist_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_items_watched_athlete_id ON watchlist_items(watched_athlete_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_notifications_item_id ON watchlist_notifications(watchlist_item_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_notifications_enabled ON watchlist_notifications(enabled) WHERE enabled = true;

-- Function to update updated_at timestamp for watchlists
CREATE OR REPLACE FUNCTION update_watchlists_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at for watchlists
DROP TRIGGER IF EXISTS update_watchlists_updated_at ON watchlists;
CREATE TRIGGER update_watchlists_updated_at BEFORE UPDATE ON watchlists
  FOR EACH ROW EXECUTE FUNCTION update_watchlists_updated_at();

-- Function to update updated_at timestamp for watchlist_notifications
CREATE OR REPLACE FUNCTION update_watchlist_notifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at for watchlist_notifications
DROP TRIGGER IF EXISTS update_watchlist_notifications_updated_at ON watchlist_notifications;
CREATE TRIGGER update_watchlist_notifications_updated_at BEFORE UPDATE ON watchlist_notifications
  FOR EACH ROW EXECUTE FUNCTION update_watchlist_notifications_updated_at();

-- Row Level Security (RLS) Policies

-- Enable RLS
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist_notifications ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Watchlists are viewable by owner" ON watchlists;
DROP POLICY IF EXISTS "Users can create their own watchlists" ON watchlists;
DROP POLICY IF EXISTS "Users can update their own watchlists" ON watchlists;
DROP POLICY IF EXISTS "Users can delete their own watchlists" ON watchlists;
DROP POLICY IF EXISTS "Watchlist items are viewable by watchlist owner" ON watchlist_items;
DROP POLICY IF EXISTS "Users can add items to their watchlists" ON watchlist_items;
DROP POLICY IF EXISTS "Users can remove items from their watchlists" ON watchlist_items;
DROP POLICY IF EXISTS "Watchlist notifications are viewable by watchlist owner" ON watchlist_notifications;
DROP POLICY IF EXISTS "Users can manage notifications for their watchlists" ON watchlist_notifications;

-- Watchlists: Users can manage their own
CREATE POLICY "Watchlists are viewable by owner" ON watchlists
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM athletes
      WHERE id = watchlists.athlete_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create their own watchlists" ON watchlists
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM athletes
      WHERE id = watchlists.athlete_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own watchlists" ON watchlists
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM athletes
      WHERE id = watchlists.athlete_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own watchlists" ON watchlists
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM athletes
      WHERE id = watchlists.athlete_id AND user_id = auth.uid()
    )
  );

-- Watchlist items: Users can manage items in their watchlists
CREATE POLICY "Watchlist items are viewable by watchlist owner" ON watchlist_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM watchlists
      JOIN athletes ON athletes.id = watchlists.athlete_id
      WHERE watchlists.id = watchlist_items.watchlist_id
        AND athletes.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can add items to their watchlists" ON watchlist_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM watchlists
      JOIN athletes ON athletes.id = watchlists.athlete_id
      WHERE watchlists.id = watchlist_items.watchlist_id
        AND athletes.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can remove items from their watchlists" ON watchlist_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM watchlists
      JOIN athletes ON athletes.id = watchlists.athlete_id
      WHERE watchlists.id = watchlist_items.watchlist_id
        AND athletes.user_id = auth.uid()
    )
  );

-- Watchlist notifications: Users can manage notifications for their watchlists
CREATE POLICY "Watchlist notifications are viewable by watchlist owner" ON watchlist_notifications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM watchlist_items
      JOIN watchlists ON watchlists.id = watchlist_items.watchlist_id
      JOIN athletes ON athletes.id = watchlists.athlete_id
      WHERE watchlist_items.id = watchlist_notifications.watchlist_item_id
        AND athletes.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage notifications for their watchlists" ON watchlist_notifications
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM watchlist_items
      JOIN watchlists ON watchlists.id = watchlist_items.watchlist_id
      JOIN athletes ON athletes.id = watchlists.athlete_id
      WHERE watchlist_items.id = watchlist_notifications.watchlist_item_id
        AND athletes.user_id = auth.uid()
    )
  );
