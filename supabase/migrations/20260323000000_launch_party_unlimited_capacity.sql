-- Reset launch party status if it was set to 'full' by the capacity trigger
UPDATE events
SET status = 'active'
WHERE id = 'c7acdfab-e775-4b27-b70c-fe503bb71589'
  AND status = 'full';

-- Patch join_event_atomic to skip all capacity checks for the launch party.
-- The launch party is open to everyone — no 8-person cap applies.
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
  v_is_launch_party boolean;
BEGIN
  -- Lock the event row to prevent concurrent updates
  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;

  IF v_event IS NULL THEN
    RETURN 'not_found';
  END IF;

  -- The WashedUp launch party has no capacity limit — skip all full checks
  v_is_launch_party := (p_event_id = 'c7acdfab-e775-4b27-b70c-fe503bb71589');

  IF NOT v_is_launch_party THEN
    IF v_event.status = 'full' THEN
      RETURN 'full';
    END IF;

    -- Re-check member count inside the transaction
    SELECT count(*)::int INTO v_member_count
    FROM event_members
    WHERE event_id = p_event_id AND status = 'joined';

    IF v_member_count >= COALESCE(v_event.max_invites, 8) THEN
      UPDATE events SET status = 'full' WHERE id = p_event_id;
      RETURN 'full';
    END IF;
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

  -- For non-launch-party plans: update status to 'full' when capacity is reached
  IF NOT v_is_launch_party THEN
    IF (v_member_count + 1) >= COALESCE(v_event.max_invites, 8) THEN
      UPDATE events SET status = 'full' WHERE id = p_event_id;
    END IF;
  END IF;

  RETURN 'joined';
END;
$$;
