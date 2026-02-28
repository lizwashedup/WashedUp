-- Add notified column to event_waitlist
-- Queue table + trigger so users get notified when a spot opens

ALTER TABLE event_waitlist ADD COLUMN IF NOT EXISTS notified BOOLEAN DEFAULT false;

-- Queue table: edge function/cron processes these and sends push, then sets notified = true
CREATE TABLE IF NOT EXISTS waitlist_notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_queue_event ON waitlist_notification_queue(event_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_queue_created ON waitlist_notification_queue(created_at);

-- Trigger: when someone leaves a plan, queue notifications for waitlist users
CREATE OR REPLACE FUNCTION notify_waitlist_on_spot_open()
RETURNS TRIGGER AS $$
DECLARE
  v_event_id uuid;
  v_member_count int;
  v_max_invites int;
BEGIN
  -- Only care when status changes to 'left'
  IF NEW.status <> 'left' OR (OLD.status = 'left' AND NEW.status = 'left') THEN
    RETURN NEW;
  END IF;

  v_event_id := NEW.event_id;

  -- Check if a spot opened (member_count now < max_invites)
  SELECT e.member_count, e.max_invites
  INTO v_member_count, v_max_invites
  FROM events e
  WHERE e.id = v_event_id;

  IF v_member_count IS NULL OR v_max_invites IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_member_count >= v_max_invites THEN
    RETURN NEW;  -- Still full, no spot opened
  END IF;

  -- Insert one queue row per waitlist user who hasn't been notified
  INSERT INTO waitlist_notification_queue (event_id, user_id)
  SELECT w.event_id, w.user_id
  FROM event_waitlist w
  WHERE w.event_id = v_event_id
    AND w.notified = false;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_notify_waitlist_on_spot_open ON event_members;
CREATE TRIGGER trigger_notify_waitlist_on_spot_open
  AFTER UPDATE OF status ON event_members
  FOR EACH ROW
  EXECUTE FUNCTION notify_waitlist_on_spot_open();
