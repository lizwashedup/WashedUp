-- ══════════════════════════════════════════════════════════════════════
-- Make friends one-directional: adding someone only adds them to YOUR list
-- ══════════════════════════════════════════════════════════════════════

-- Fix add_friend: only insert the caller's row, not the reverse
CREATE OR REPLACE FUNCTION add_friend(p_friend_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p_user_id uuid := auth.uid();
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_friend_id = p_user_id THEN
    RAISE EXCEPTION 'Cannot add yourself';
  END IF;
  INSERT INTO friends (user_id, friend_id) VALUES (p_user_id, p_friend_id)
  ON CONFLICT (user_id, friend_id) DO NOTHING;
END;
$$;

-- Fix remove_friend: only delete the caller's row, not the reverse
CREATE OR REPLACE FUNCTION remove_friend(p_friend_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p_user_id uuid := auth.uid();
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  DELETE FROM friends WHERE user_id = p_user_id AND friend_id = p_friend_id;
END;
$$;
