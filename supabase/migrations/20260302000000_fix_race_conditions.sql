-- Fix #1: Prevent adding a user who has blocked you.
CREATE OR REPLACE FUNCTION add_friend(p_friend_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  is_blocked boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_friend_id = v_user_id THEN
    RAISE EXCEPTION 'Cannot add yourself';
  END IF;

  -- Check if the target user has blocked the current user
  SELECT EXISTS (
    SELECT 1
    FROM profiles
    WHERE id = p_friend_id AND v_user_id = ANY(COALESCE(blocked_users, '{}'))
  ) INTO is_blocked;

  IF is_blocked THEN
    -- Do nothing if blocked (appear to succeed)
    RETURN;
  END IF;

  -- If not blocked, insert the symmetric relationship
  INSERT INTO friends (user_id, friend_id) VALUES (v_user_id, p_friend_id)
  ON CONFLICT (user_id, friend_id) DO NOTHING;
  INSERT INTO friends (user_id, friend_id) VALUES (p_friend_id, v_user_id)
  ON CONFLICT (user_id, friend_id) DO NOTHING;
END;
$$;

-- Fix #2: Atomically check and join an event to prevent race conditions.
CREATE OR REPLACE FUNCTION join_event_atomic(p_event_id uuid, p_user_id uuid, p_age_at_join int DEFAULT NULL, p_gender_at_join text DEFAULT NULL)
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

  -- Re-check member count inside the transaction
  SELECT count(*)::int INTO v_member_count
  FROM event_members
  WHERE event_id = p_event_id AND status = 'joined';

  IF v_member_count >= COALESCE(v_event.max_invites, 8) THEN
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
  IF (v_member_count + 1) >= COALESCE(v_event.max_invites, 8) THEN
    UPDATE events SET status = 'full' WHERE id = p_event_id;
  END IF;

  RETURN 'joined';
END;
$$;
