-- ===========================================================================
-- REVIEW ONLY - NOT YET APPLIED (await Liz's go-ahead).
--
-- Notification copy (M4). The people_request notification is written by the
-- notify_people_connection trigger (not the client), so the copy change lives
-- here. Per the copy-system doc, "Notification (people request)":
--   title: "New people request"            -> "{Name} wants to add you"
--   body:  "{Name} wants to add you to their people"
--          -> "{Name} wants to add you to {his/her/their} people"  (gendered)
--
-- Pronoun: man->his, woman->her, else (non_binary OR null)->their.
-- (149 prod profiles have gender NULL -> "their"; see M3 note / flag for Liz.)
-- Only the people_request branch changes; people_request_accepted is untouched.
-- CREATE OR REPLACE FUNCTION keeps the existing trg_notify_people_connection.
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
  v_requester_gender text;
  v_recipient_name text;
  v_pronoun text;
BEGIN
  IF NEW.status = 'pending'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pending') THEN
    SELECT first_name_display, gender INTO v_requester_name, v_requester_gender
    FROM public.profiles WHERE id = NEW.requester_user_id;

    v_pronoun := CASE v_requester_gender
                   WHEN 'man'   THEN 'his'
                   WHEN 'woman' THEN 'her'
                   ELSE 'their'
                 END;

    INSERT INTO public.app_notifications
      (user_id, type, title, body, actor_user_id, status)
    VALUES (
      NEW.recipient_user_id,
      'people_request',
      COALESCE(v_requester_name, 'Someone') || ' wants to add you',
      COALESCE(v_requester_name, 'Someone')
        || ' wants to add you to ' || v_pronoun || ' people',
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

-- --- in-transaction self-test (rolls back; leaves no trace) -----------------
DO $$
DECLARE
  v_me   uuid := 'ae8006dc-5bca-42b8-975a-e11ad14b796f';   -- Liz
  v_them uuid := 'cafe0001-0000-0000-0000-000000000001';   -- Sage (test)
  v_title text;
  v_body  text;
BEGIN
  BEGIN
    DELETE FROM public.people_connections
      WHERE requester_user_id = v_them AND recipient_user_id = v_me;
    -- inserting a pending request fires the trigger
    INSERT INTO public.people_connections
      (requester_user_id, recipient_user_id, status, context, can_re_request)
    VALUES (v_them, v_me, 'pending', 'handle_lookup', true);

    SELECT title, body INTO v_title, v_body
    FROM public.app_notifications
    WHERE user_id = v_me AND actor_user_id = v_them AND type = 'people_request'
    ORDER BY created_at DESC LIMIT 1;

    IF v_title NOT LIKE '% wants to add you'
       OR v_body NOT LIKE '% wants to add you to %people' THEN
      RAISE EXCEPTION 'self-test: notif copy wrong (title "%", body "%")', v_title, v_body;
    END IF;

    RAISE EXCEPTION 'SELFTEST_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'notify_people_connection self-test passed';
END $$;

COMMIT;
