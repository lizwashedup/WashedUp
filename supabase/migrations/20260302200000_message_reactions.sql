-- Message reactions: users can heart/like messages in group chats

CREATE TABLE IF NOT EXISTS message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reaction text NOT NULL DEFAULT 'heart',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id, user_id, reaction)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_message_reactions_user ON message_reactions(user_id);

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

-- Users can see reactions on messages in events they're members of
CREATE POLICY "Users can view reactions in their events"
ON message_reactions FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN event_members em ON em.event_id = m.event_id
    WHERE m.id = message_reactions.message_id
      AND em.user_id = auth.uid()
      AND em.status = 'joined'
  )
);

-- Users can add reactions
CREATE POLICY "Users can add reactions"
ON message_reactions FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Users can remove their own reactions
CREATE POLICY "Users can remove own reactions"
ON message_reactions FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
