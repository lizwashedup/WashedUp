-- event_waitlist: users can join when plan is full, get notified when spot opens
-- DO NOT auto-join — just notify. Backend/trigger handles notifications.

CREATE TABLE IF NOT EXISTS event_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_waitlist_event ON event_waitlist(event_id);
CREATE INDEX IF NOT EXISTS idx_event_waitlist_user ON event_waitlist(user_id);

ALTER TABLE event_waitlist ENABLE ROW LEVEL SECURITY;

-- Users can see their own waitlist entries
CREATE POLICY "Users can view own waitlist"
ON event_waitlist FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Users can add themselves to waitlist
CREATE POLICY "Users can join waitlist"
ON event_waitlist FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Users can remove themselves from waitlist
CREATE POLICY "Users can leave waitlist"
ON event_waitlist FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
