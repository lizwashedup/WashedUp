-- chat_reads: tracks last-read timestamp per user per event for unread badges
CREATE TABLE IF NOT EXISTS chat_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_reads_user_event ON chat_reads(user_id, event_id);

ALTER TABLE chat_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own chat_reads"
  ON chat_reads FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
