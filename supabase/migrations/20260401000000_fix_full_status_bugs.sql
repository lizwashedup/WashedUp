-- ══════════════════════════════════════════════════════════════════════
-- Fix two compounding bugs that cause plans to be stuck as "full":
--
-- Bug 1: join_event_atomic checked >= max_invites but the creator is
--        also in event_members, so capacity is really max_invites + 1.
--        Changed to > max_invites (i.e., >= max_invites + 1).
--
-- Bug 2: decrement_member_count never reset events.status from 'full'
--        back to 'forming' when members left, so plans got permanently
--        stuck even after spots opened up.
-- ══════════════════════════════════════════════════════════════════════

-- ── Part 1: Fix join_event_atomic threshold ───────────────────────────

CREATE OR REPLACE FUNCTION join_event_atomic(
  p_event_id uuid,
  p_user_id uuid,
  p_age_at_join int DEFAULT NULL,
  p_gender_at_join text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_member_count int;
BEGIN
  -- Lock the event row to prevent concurrent updates
  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;

  IF v_event IS NULL THEN
    RETURN 'not_found';
  END IF;

  IF v_event.status = 'full' THEN
    RETURN 'full';
  END IF;

  -- Re-check actual member count inside the transaction
  SELECT count(*)::int INTO v_member_count
  FROM event_members
  WHERE event_id = p_event_id AND status = 'joined';

  -- Capacity = max_invites + 1 (creator counts as a member in event_members)
  IF v_member_count > COALESCE(v_event.max_invites, 7) THEN
    UPDATE events SET status = 'full' WHERE id = p_event_id;
    RETURN 'full';
  END IF;

  -- Insert or update the member (re-join if previously left)
  UPDATE event_members
  SET status = 'joined', role = 'guest',
      age_at_join = COALESCE(p_age_at_join, age_at_join),
      gender_at_join = COALESCE(p_gender_at_join, gender_at_join)
  WHERE event_id = p_event_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO event_members (event_id, user_id, role, status, age_at_join, gender_at_join)
    VALUES (p_event_id, p_user_id, 'guest', 'joined', p_age_at_join, p_gender_at_join);
  END IF;

  -- If the plan is now full, update its status
  IF (v_member_count + 1) > COALESCE(v_event.max_invites, 7) THEN
    UPDATE events SET status = 'full' WHERE id = p_event_id;
  END IF;

  RETURN 'joined';
END;
$$;

-- ── Part 2: Fix decrement_member_count to reset status on spot open ───

CREATE OR REPLACE FUNCTION public.decrement_member_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actual_count int;
  v_max_invites int;
BEGIN
  IF OLD.status = 'joined' THEN
    UPDATE events SET member_count = member_count - 1 WHERE id = OLD.event_id;

    -- Use actual count from event_members (source of truth)
    SELECT count(*) INTO v_actual_count
    FROM event_members
    WHERE event_id = OLD.event_id AND status = 'joined';

    SELECT max_invites INTO v_max_invites FROM events WHERE id = OLD.event_id;

    -- If a spot has opened up, reset the plan from 'full' to 'forming'
    IF v_actual_count <= COALESCE(v_max_invites, 7) THEN
      UPDATE events SET status = 'forming' WHERE id = OLD.event_id AND status = 'full';
    END IF;
  END IF;
  RETURN OLD;
END;
$function$;

-- ── Part 3: Fix notify_waitlist_on_spot_open threshold (same off-by-one) ─

CREATE OR REPLACE FUNCTION notify_waitlist_on_spot_open()
RETURNS TRIGGER AS $$
DECLARE
  v_event_id uuid;
  v_actual_count int;
  v_max_invites int;
BEGIN
  IF NEW.status <> 'left' OR (OLD.status = 'left' AND NEW.status = 'left') THEN
    RETURN NEW;
  END IF;

  v_event_id := NEW.event_id;

  SELECT max_invites INTO v_max_invites FROM events WHERE id = v_event_id;

  -- Use real count from event_members instead of potentially stale member_count
  SELECT count(*) INTO v_actual_count
  FROM event_members
  WHERE event_id = v_event_id AND status = 'joined';

  IF v_max_invites IS NULL THEN
    RETURN NEW;
  END IF;

  -- Capacity = max_invites + 1; spot is open when actual count <= max_invites
  IF v_actual_count > v_max_invites THEN
    RETURN NEW;
  END IF;

  -- Queue notifications for un-notified waitlist users
  INSERT INTO waitlist_notification_queue (event_id, user_id)
  SELECT w.event_id, w.user_id
  FROM event_waitlist w
  WHERE w.event_id = v_event_id
    AND w.notified = false;

  -- Mark them as notified so they won't be queued again
  UPDATE event_waitlist
  SET notified = true
  WHERE event_id = v_event_id
    AND notified = false;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Part 4: One-time data fix for plans currently stuck as 'full' ─────

UPDATE events e
SET
  status = 'forming',
  member_count = (
    SELECT count(*)
    FROM event_members em
    WHERE em.event_id = e.id AND em.status = 'joined'
  )
WHERE e.status = 'full'
  AND (
    SELECT count(*)
    FROM event_members em
    WHERE em.event_id = e.id AND em.status = 'joined'
  ) <= COALESCE(e.max_invites, 7);
