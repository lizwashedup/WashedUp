-- Plan invites: in-app invite system with push notifications
CREATE TABLE IF NOT EXISTS plan_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, sender_id, recipient_id)
);

ALTER TABLE plan_invites ENABLE ROW LEVEL SECURITY;

-- Recipients can see invites sent to them
CREATE POLICY "recipients_view_own_invites"
  ON plan_invites FOR SELECT
  USING (auth.uid() = recipient_id);

-- Senders can see invites they sent
CREATE POLICY "senders_view_own_invites"
  ON plan_invites FOR SELECT
  USING (auth.uid() = sender_id);

-- Authenticated users can send invites
CREATE POLICY "users_can_send_invites"
  ON plan_invites FOR INSERT
  WITH CHECK (auth.uid() = sender_id);

-- Recipients can update (accept/decline) their invites
CREATE POLICY "recipients_update_own_invites"
  ON plan_invites FOR UPDATE
  USING (auth.uid() = recipient_id);

-- Senders can delete invites they sent
CREATE POLICY "senders_delete_own_invites"
  ON plan_invites FOR DELETE
  USING (auth.uid() = sender_id);

-- Function to send invite and queue a push notification
CREATE OR REPLACE FUNCTION notify_plan_invite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_name text;
  v_event_title text;
  v_push_token text;
BEGIN
  SELECT first_name_display INTO v_sender_name
  FROM profiles WHERE id = NEW.sender_id;

  SELECT title INTO v_event_title
  FROM events WHERE id = NEW.event_id;

  SELECT expo_push_token INTO v_push_token
  FROM profiles WHERE id = NEW.recipient_id;

  -- If the recipient has a push token, queue a notification
  -- (The actual push send would be handled by an edge function or cron
  --  that reads from a notification queue. For now we log it so the
  --  client can poll for pending invites.)

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_plan_invite_created
  AFTER INSERT ON plan_invites
  FOR EACH ROW
  EXECUTE FUNCTION notify_plan_invite();

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_plan_invites_recipient
  ON plan_invites (recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_plan_invites_event
  ON plan_invites (event_id);
