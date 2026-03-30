-- Fix add_friend to be one-way only.
-- The previous version inserted both (caller→target) and (target→caller),
-- causing the target user to automatically see the caller in their "Your People."
-- This replaces it with a single insert for the caller's row only.

CREATE OR REPLACE FUNCTION public.add_friend(p_friend_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
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
    SELECT 1 FROM profiles
    WHERE id = p_friend_id AND v_user_id = ANY(COALESCE(blocked_users, '{}'))
  ) INTO is_blocked;

  IF is_blocked THEN
    -- Appear to succeed silently
    RETURN;
  END IF;

  -- One-way only: only insert the caller's row
  INSERT INTO friends (user_id, friend_id) VALUES (v_user_id, p_friend_id)
  ON CONFLICT (user_id, friend_id) DO NOTHING;
END;
$$;
