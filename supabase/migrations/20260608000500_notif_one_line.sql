-- ===========================================================================
-- APPLIED to prod 2026-06-08 via Supabase MCP (verbatim, self-test passed).
--
-- D1: collapse the people_request notification to ONE clean line. After M4 the
-- inbox stacked title "{Name} wants to add you" + body "{Name} wants to add you
-- to their people" - a near-duplicate stutter (and the push stuttered too).
-- Now: the full sentence is the TITLE (NOT NULL), body is NULL (InboxModal
-- renders body conditionally, so it shows a single line). people_request_accepted
-- branch unchanged. "their" for everyone, no gender lookup.
-- ===========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.notify_people_connection()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_requester_name text;
  v_recipient_name text;
BEGIN
  IF NEW.status = 'pending'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pending') THEN
    SELECT first_name_display INTO v_requester_name
    FROM public.profiles WHERE id = NEW.requester_user_id;

    INSERT INTO public.app_notifications
      (user_id, type, title, body, actor_user_id, status)
    VALUES (
      NEW.recipient_user_id,
      'people_request',
      COALESCE(v_requester_name, 'Someone') || ' wants to add you to their people',
      NULL,
      NEW.requester_user_id,
      'unread'
    );

  ELSIF NEW.status = 'accepted'
        AND TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    SELECT first_name_display INTO v_recipient_name
    FROM public.profiles WHERE id = NEW.recipient_user_id;

    INSERT INTO public.app_notifications
      (user_id, type, title, body, actor_user_id, status)
    VALUES (
      NEW.requester_user_id,
      'people_request_accepted',
      'You are now people',
      COALESCE(v_recipient_name, 'Someone')
        || ' is now one of your people',
      NEW.recipient_user_id,
      'unread'
    );
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_me   uuid := 'ae8006dc-5bca-42b8-975a-e11ad14b796f';
  v_them uuid := 'cafe0001-0000-0000-0000-000000000001';
  v_title text;
  v_body  text;
BEGIN
  BEGIN
    DELETE FROM public.people_connections
      WHERE requester_user_id = v_them AND recipient_user_id = v_me;
    INSERT INTO public.people_connections
      (requester_user_id, recipient_user_id, status, context, can_re_request)
    VALUES (v_them, v_me, 'pending', 'handle_lookup', true);

    SELECT title, body INTO v_title, v_body
    FROM public.app_notifications
    WHERE user_id = v_me AND actor_user_id = v_them AND type = 'people_request'
    ORDER BY created_at DESC LIMIT 1;

    IF v_title NOT LIKE '% wants to add you to their people' OR v_body IS NOT NULL THEN
      RAISE EXCEPTION 'self-test: one-line notif wrong (title "%", body "%")', v_title, v_body;
    END IF;

    RAISE EXCEPTION 'SELFTEST_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'notify_people_connection one-line self-test passed';
END $$;

COMMIT;
