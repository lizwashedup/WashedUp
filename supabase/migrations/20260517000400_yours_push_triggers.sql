-- Yours page rebuild — 5/6: notification type values + new triggers.
--
-- REVIEW ONLY. Not applied by the agent. See 1/6..4/6 headers.
--
-- Delivery contract (verified against prod 2026-05-16):
--   * app_notifications AFTER INSERT fires on_app_notification_inserted ->
--     trigger_send_push_notifications() (the protected v14 dual-send edge
--     function). We ONLY insert rows; we never touch that function.
--   * app_notifications columns used: user_id, type, title, body, event_id,
--     actor_user_id, status('unread').
--   * The 18 existing type values are preserved verbatim below; 4 are added.
--     RE-READ the live app_notifications_type_check before applying in case
--     more types shipped after 2026-05-16, and union them in.
--   * pgcrypto lives in the `extensions` schema; digest is schema-qualified.
--
-- Referral phone-hash contract: the client stores SHA-256 hex (lowercase)
-- of the SAME E.164 string saved to profiles.phone_number. The signup
-- trigger recomputes encode(extensions.digest(phone_number,'sha256'),'hex')
-- and must match exactly.
--
-- Idempotent. Self-test asserts the constraint + triggers.

BEGIN;

-- ---------------------------------------------------------------------------
-- Extend the type whitelist (preserve all existing values).
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_notifications
  DROP CONSTRAINT IF EXISTS app_notifications_type_check;
ALTER TABLE public.app_notifications
  ADD CONSTRAINT app_notifications_type_check CHECK (type = ANY (ARRAY[
    'waitlist_spot','broadcast','event_reminder','member_joined',
    'plan_invite','invite_accepted','new_message','album_ready',
    'plan_cancelled','duplicate_plan','interest_signal','interest_invite',
    'album_upload_prompt','album_upload_reminder','album_someone_uploaded',
    'album_more_photos_added','album_creator_no_uploads_nudge',
    'album_hearts_batched',
    -- Yours rebuild:
    'people_request','people_request_accepted','people_ping','referral_joined'
  ]::text[]));

-- ---------------------------------------------------------------------------
-- people_connections -> request / accepted notifications.
--   people_request           = bell notification      -> Yours request stack
--   people_request_accepted  = bell notification      -> their profile card
-- ---------------------------------------------------------------------------
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
      'New people request',
      COALESCE(v_requester_name, 'Someone')
        || ' wants to add you to their people',
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

DROP TRIGGER IF EXISTS trg_notify_people_connection ON public.people_connections;
CREATE TRIGGER trg_notify_people_connection
  AFTER INSERT OR UPDATE ON public.people_connections
  FOR EACH ROW EXECUTE FUNCTION public.notify_people_connection();

-- ---------------------------------------------------------------------------
-- people_pings -> ping notification (bell) -> plan detail.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_people_ping()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_sender_name text;
  v_event_title text;
BEGIN
  SELECT first_name_display INTO v_sender_name
  FROM public.profiles WHERE id = NEW.sender_user_id;
  SELECT title INTO v_event_title
  FROM public.events WHERE id = NEW.event_id;

  INSERT INTO public.app_notifications
    (user_id, type, title, body, event_id, actor_user_id, status)
  VALUES (
    NEW.recipient_user_id,
    'people_ping',
    COALESCE(v_event_title, 'A plan'),
    COALESCE(v_sender_name, 'Someone')
      || ' is doing ' || COALESCE(v_event_title, 'a plan'),
    NEW.event_id,
    NEW.sender_user_id,
    'unread'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_people_ping ON public.people_pings;
CREATE TRIGGER trg_notify_people_ping
  AFTER INSERT ON public.people_pings
  FOR EACH ROW EXECUTE FUNCTION public.notify_people_ping();

-- ---------------------------------------------------------------------------
-- profiles phone -> link pending referral ghosts on signup.
-- Marks ghosts signed_up, auto-creates an inviter->new-user pending
-- connection (which fires the people_request notification above), and
-- sends each inviter a referral_joined bell notification.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_referral_on_signup()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_hash text;
  v_new_name text;
  r RECORD;
BEGIN
  IF NEW.phone_number IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.phone_number IS NOT DISTINCT FROM NEW.phone_number THEN
    RETURN NEW;
  END IF;

  v_hash := encode(extensions.digest(NEW.phone_number, 'sha256'), 'hex');
  SELECT first_name_display INTO v_new_name
  FROM public.profiles WHERE id = NEW.id;

  FOR r IN
    SELECT id, inviter_user_id
    FROM public.referral_invites
    WHERE invited_phone_hash = v_hash
      AND status = 'pending'
      AND inviter_user_id <> NEW.id
  LOOP
    UPDATE public.referral_invites
      SET referred_user_id = NEW.id,
          status = 'signed_up',
          signed_up_at = now()
    WHERE id = r.id;

    -- Auto people-request inviter -> new user (notifies the new user via
    -- trg_notify_people_connection). Skip if a row already exists.
    INSERT INTO public.people_connections
      (requester_user_id, recipient_user_id, status, context, requested_at)
    VALUES (r.inviter_user_id, NEW.id, 'pending', 'referral_invite', now())
    ON CONFLICT (requester_user_id, recipient_user_id) DO NOTHING;

    -- Bell notification to the inviter.
    INSERT INTO public.app_notifications
      (user_id, type, title, body, actor_user_id, status)
    VALUES (
      r.inviter_user_id,
      'referral_joined',
      'Your invite worked',
      COALESCE(v_new_name, 'Someone you invited')
        || ' just joined WashedUp',
      NEW.id,
      'unread'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_referral_on_signup ON public.profiles;
CREATE TRIGGER trg_link_referral_on_signup
  AFTER INSERT OR UPDATE OF phone_number ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.link_referral_on_signup();

-- ---------------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conname = 'app_notifications_type_check'
    AND conrelid = 'public.app_notifications'::regclass;

  IF v_def IS NULL
     OR position('people_request' in v_def) = 0
     OR position('people_request_accepted' in v_def) = 0
     OR position('people_ping' in v_def) = 0
     OR position('referral_joined' in v_def) = 0
     OR position('member_joined' in v_def) = 0      -- preserved legacy value
     OR position('album_hearts_batched' in v_def) = 0 THEN
    RAISE EXCEPTION 'self-test: app_notifications type constraint wrong';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgname = 'trg_notify_people_connection')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgname = 'trg_notify_people_ping')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgname = 'trg_link_referral_on_signup') THEN
    RAISE EXCEPTION 'self-test: a yours trigger is missing';
  END IF;

  IF NOT (SELECT prosecdef FROM pg_proc
          WHERE proname = 'link_referral_on_signup'
            AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'self-test: link_referral_on_signup not SECURITY DEFINER';
  END IF;
END $$;

COMMIT;
