-- Add reports table to delete_own_account (Lovable may have this table)
-- reporter_user_id and reported_user_id both reference the user

CREATE OR REPLACE FUNCTION delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p_user_id uuid := auth.uid();
  event_ids uuid[];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Events created by user: delete dependents first, then events
  SELECT array_agg(id) INTO event_ids FROM events WHERE creator_user_id = p_user_id;
  IF event_ids IS NOT NULL AND array_length(event_ids, 1) > 0 THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'message_likes') THEN
      DELETE FROM message_likes WHERE message_id IN (SELECT id FROM messages WHERE event_id = ANY(event_ids));
    END IF;
    DELETE FROM messages WHERE event_id = ANY(event_ids);
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'chat_reads') THEN
      DELETE FROM chat_reads WHERE event_id = ANY(event_ids);
    END IF;
    DELETE FROM event_waitlist WHERE event_id = ANY(event_ids);
    DELETE FROM waitlist_notification_queue WHERE event_id = ANY(event_ids);
    DELETE FROM wishlists WHERE event_id = ANY(event_ids);
    DELETE FROM event_members WHERE event_id = ANY(event_ids);
    DELETE FROM events WHERE id = ANY(event_ids);
  END IF;

  -- 2. User's participation in other events
  DELETE FROM messages WHERE user_id = p_user_id;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'chat_reads') THEN
    DELETE FROM chat_reads WHERE user_id = p_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'message_likes') THEN
    DELETE FROM message_likes WHERE user_id = p_user_id;
  END IF;
  DELETE FROM event_members WHERE user_id = p_user_id;
  DELETE FROM event_waitlist WHERE user_id = p_user_id;
  DELETE FROM waitlist_notification_queue WHERE user_id = p_user_id;
  DELETE FROM wishlists WHERE user_id = p_user_id;

  -- 3. Friends (both directions)
  DELETE FROM friends WHERE user_id = p_user_id OR friend_id = p_user_id;

  -- 4. Reports (reporter or reported) — Lovable may have this table
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'reports') THEN
    DELETE FROM reports WHERE reporter_user_id = p_user_id OR reported_user_id = p_user_id;
  END IF;

  -- 5. Explore wishlists (if table exists)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'explore_wishlists') THEN
    DELETE FROM explore_wishlists WHERE user_id = p_user_id;
  END IF;

  -- 6. Profile last (references from other tables cleared)
  DELETE FROM profiles WHERE id = p_user_id;

  -- Auth user deletion is handled by the delete-user Edge Function (called from app after this RPC)
END;
$$;
