-- ══════════════════════════════════════════════════════════════════════
-- Fix three waitlist bugs that silently remove users from waitlists:
--
--   1. Notification expiry deletes the waitlist row, so users who never
--      opened the notification lose their spot without knowing.
--   2. When N users race for 1 spot and tap "Claim", the losers get
--      removed from the waitlist permanently instead of staying eligible.
--   3. When a plan's status changes to 'cancelled' or 'completed', the
--      waitlist rows stick around — people end up waiting for a dead plan.
--
-- Behavior after this migration:
--   - "Pass" (status=read)        → user is removed (explicit decline)
--   - "Claim Spot" (status=acted) → row stays, notified flag is reset.
--                                   If they successfully join the plan,
--                                   cleanup_waitlist_on_join removes them.
--                                   If they hit "full", they remain on
--                                   the waitlist for the next spot.
--   - Notification expired        → row stays, notified flag is reset.
--                                   They get re-notified next time.
--   - Plan cancelled              → all waitlist rows for that plan are
--                                   deleted and a 'plan_cancelled' app
--                                   notification is sent to each user.
--   - Plan completed              → all waitlist rows for that plan are
--                                   deleted (no notification — the event
--                                   already happened).
-- ══════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────
-- Bugs #1 + #2: cleanup_waitlist_on_response
-- ────────────────────────────────────────────────────────────────────
-- Only an explicit "Pass" (read) deletes the waitlist row. For 'acted'
-- (clicked Claim Spot) and 'expired' (timed out unread) we instead
-- reset the notified flag so the user is eligible for the next round.
CREATE OR REPLACE FUNCTION cleanup_waitlist_on_response()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.type <> 'waitlist_spot' THEN
    RETURN NEW;
  END IF;

  IF OLD.status <> 'unread' THEN
    RETURN NEW;
  END IF;

  -- Explicit decline: remove from the waitlist.
  IF NEW.status = 'read' THEN
    DELETE FROM event_waitlist
    WHERE event_id = NEW.event_id
      AND user_id = NEW.user_id;
    RETURN NEW;
  END IF;

  -- Tapped "Claim" or notification expired unread: keep the row, but
  -- reset notified so they'll be re-notified the next time a spot opens.
  -- (If they actually succeed in joining, cleanup_waitlist_on_join
  --  will remove the row via the event_members trigger below.)
  IF NEW.status IN ('acted', 'expired') THEN
    UPDATE event_waitlist
    SET notified = false,
        notified_at = NULL
    WHERE event_id = NEW.event_id
      AND user_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- The trigger itself was created in 20260304000000_fix_waitlist_lifecycle.sql.
-- Recreate idempotently in case the function signature changed.
DROP TRIGGER IF EXISTS on_waitlist_notification_response ON app_notifications;
CREATE TRIGGER on_waitlist_notification_response
  AFTER UPDATE OF status ON app_notifications
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_waitlist_on_response();

-- ────────────────────────────────────────────────────────────────────
-- Supporting trigger: cleanup_waitlist_on_join
-- ────────────────────────────────────────────────────────────────────
-- Production already has this (per 20260405200000_waitlist_system_overhaul.sql)
-- but it isn't defined in any migration file. Create it idempotently so the
-- new "Claim Spot" flow above works whether or not the prod copy exists.
CREATE OR REPLACE FUNCTION cleanup_waitlist_on_join()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'joined' THEN
    DELETE FROM event_waitlist
    WHERE event_id = NEW.event_id
      AND user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_cleanup_waitlist_on_join_insert ON event_members;
CREATE TRIGGER trg_cleanup_waitlist_on_join_insert
  AFTER INSERT ON event_members
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_waitlist_on_join();

DROP TRIGGER IF EXISTS trg_cleanup_waitlist_on_join_update ON event_members;
CREATE TRIGGER trg_cleanup_waitlist_on_join_update
  AFTER UPDATE OF status ON event_members
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_waitlist_on_join();

-- ────────────────────────────────────────────────────────────────────
-- Bug #3: clear waitlist when a plan reaches a terminal state
-- ────────────────────────────────────────────────────────────────────

-- Add 'plan_cancelled' to the allowed notification types.
ALTER TABLE app_notifications
  DROP CONSTRAINT IF EXISTS app_notifications_type_check;

ALTER TABLE app_notifications
  ADD CONSTRAINT app_notifications_type_check
  CHECK (type IN (
    'waitlist_spot', 'broadcast', 'event_reminder',
    'member_joined', 'plan_invite', 'invite_accepted', 'new_message',
    'album_ready', 'plan_cancelled'
  ));

CREATE OR REPLACE FUNCTION cleanup_waitlist_on_event_terminal()
RETURNS TRIGGER AS $$
DECLARE
  v_title text;
BEGIN
  -- Only fire on a transition INTO a terminal state.
  IF NEW.status NOT IN ('cancelled', 'completed') THEN
    RETURN NEW;
  END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Cancellation: notify waitlisted users so they know the plan is dead.
  -- Completion: skip the notification — the event already happened.
  IF NEW.status = 'cancelled' THEN
    v_title := COALESCE(NEW.title, 'a plan');

    INSERT INTO app_notifications (user_id, type, title, body, event_id)
    SELECT
      w.user_id,
      'plan_cancelled',
      'Plan cancelled',
      v_title || ' was cancelled by the creator.',
      NEW.id
    FROM event_waitlist w
    WHERE w.event_id = NEW.id;
  END IF;

  -- In both cases, drop the waitlist rows.
  DELETE FROM event_waitlist WHERE event_id = NEW.id;

  -- Expire any pending "spot opened" notifications for this plan so they
  -- don't pop up after the plan is dead.
  UPDATE app_notifications
  SET status = 'expired'
  WHERE event_id = NEW.id
    AND type = 'waitlist_spot'
    AND status = 'unread';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_cleanup_waitlist_on_event_terminal ON events;
CREATE TRIGGER trg_cleanup_waitlist_on_event_terminal
  AFTER UPDATE OF status ON events
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_waitlist_on_event_terminal();
