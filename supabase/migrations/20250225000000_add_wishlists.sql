-- wishlists: users can save/heart plans for later
-- Mirrors the heart button on PlanCard

CREATE TABLE IF NOT EXISTS wishlists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at    timestamptz DEFAULT now(),

  -- one heart per plan per user
  CONSTRAINT wishlists_user_event_unique UNIQUE (user_id, event_id)
);

-- Fast lookups: all wishlisted plans for a user, all users who wishlisted a plan
CREATE INDEX IF NOT EXISTS wishlists_user_id_idx  ON wishlists (user_id);
CREATE INDEX IF NOT EXISTS wishlists_event_id_idx ON wishlists (event_id);

-- RLS
ALTER TABLE wishlists ENABLE ROW LEVEL SECURITY;

-- Users can only see their own wishlists
CREATE POLICY "wishlists_select_own"
  ON wishlists FOR SELECT
  USING (auth.uid() = user_id);

-- Users can only insert their own wishlists
CREATE POLICY "wishlists_insert_own"
  ON wishlists FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can only delete their own wishlists
CREATE POLICY "wishlists_delete_own"
  ON wishlists FOR DELETE
  USING (auth.uid() = user_id);
