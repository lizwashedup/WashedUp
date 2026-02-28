-- delete_own_account: Full cascade + direct auth.users delete
-- Run in Supabase SQL Editor. Matches Lovable deployment schema.

CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_event_ids UUID[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Collect events created by this user
  SELECT ARRAY_AGG(id) INTO v_event_ids
  FROM events WHERE creator_user_id = v_user_id;

  -- Clean up events the user created
  IF v_event_ids IS NOT NULL AND array_length(v_event_ids, 1) > 0 THEN
    DELETE FROM message_likes WHERE message_id IN (SELECT id FROM messages WHERE event_id = ANY(v_event_ids));
    DELETE FROM messages WHERE event_id = ANY(v_event_ids);
    DELETE FROM event_members WHERE event_id = ANY(v_event_ids);
    DELETE FROM chat_reads WHERE event_id = ANY(v_event_ids);
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'event_feedback') THEN
      DELETE FROM event_feedback WHERE event_id = ANY(v_event_ids);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'email_notification_log') THEN
      DELETE FROM email_notification_log WHERE event_id = ANY(v_event_ids);
    END IF;
    DELETE FROM wishlists WHERE event_id = ANY(v_event_ids);
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'short_codes') THEN
      DELETE FROM short_codes WHERE event_id = ANY(v_event_ids);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'event_waitlist') THEN
      DELETE FROM event_waitlist WHERE event_id = ANY(v_event_ids);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'waitlist_notification_queue') THEN
      DELETE FROM waitlist_notification_queue WHERE event_id = ANY(v_event_ids);
    END IF;
    DELETE FROM events WHERE creator_user_id = v_user_id;
  END IF;

  -- Clean up user's own participation/data
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'message_likes') THEN
    DELETE FROM message_likes WHERE user_id = v_user_id;
  END IF;
  DELETE FROM messages WHERE user_id = v_user_id;
  DELETE FROM event_members WHERE user_id = v_user_id;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'chat_reads') THEN
    DELETE FROM chat_reads WHERE user_id = v_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'event_feedback') THEN
    DELETE FROM event_feedback WHERE user_id = v_user_id;
  END IF;
  DELETE FROM wishlists WHERE user_id = v_user_id;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'explore_wishlists') THEN
    DELETE FROM explore_wishlists WHERE user_id = v_user_id;
  END IF;
  DELETE FROM friends WHERE user_id = v_user_id OR friend_id = v_user_id;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'reports') THEN
    DELETE FROM reports WHERE reporter_user_id = v_user_id OR reported_user_id = v_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'founder_messages') THEN
    DELETE FROM founder_messages WHERE recipient_user_id = v_user_id OR sender_admin_id = v_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'announcements') THEN
    DELETE FROM announcements WHERE sent_by = v_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'broadcast_message_reads') THEN
    DELETE FROM broadcast_message_reads WHERE user_id = v_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'email_verification_codes') THEN
    DELETE FROM email_verification_codes WHERE user_id = v_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sms_verification_codes') THEN
    DELETE FROM sms_verification_codes WHERE user_id = v_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_roles') THEN
    DELETE FROM user_roles WHERE user_id = v_user_id;
  END IF;
  DELETE FROM profiles WHERE id = v_user_id;

  DELETE FROM auth.users WHERE id = v_user_id;
END;
$function$;
