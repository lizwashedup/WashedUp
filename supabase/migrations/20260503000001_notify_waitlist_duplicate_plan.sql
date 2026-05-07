-- duplicate_plan notification: when a user creates a plan as a duplicate of
-- another (via the "post a duplicate plan" CTA in the waitlist sheet),
-- notify everyone on the ORIGINAL plan's waitlist so they can hop into the
-- new one without waiting.
--
-- Two changes:
--   1. Add 'duplicate_plan' to app_notifications.type CHECK constraint.
--   2. Create RPC notify_waitlist_duplicate_plan(...) that fans an
--      app_notifications row to each waitlist user (excluding the duplicator).
--
-- The notification rows write event_id = p_new_event_id, so tapping in-app
-- (InboxModal) or via the OneSignal click handler in app/_layout.tsx routes
-- the user to the duplicate (new) plan.

-- ────────────────────────────────────────────────────────────────────
-- 1. Expand the type constraint
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE app_notifications
  DROP CONSTRAINT IF EXISTS app_notifications_type_check;

ALTER TABLE app_notifications
  ADD CONSTRAINT app_notifications_type_check
  CHECK (type IN (
    'waitlist_spot', 'broadcast', 'event_reminder',
    'member_joined', 'plan_invite', 'invite_accepted', 'new_message',
    'album_ready', 'plan_cancelled', 'duplicate_plan'
  ));

-- ────────────────────────────────────────────────────────────────────
-- 2. Notification fanout RPC
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_waitlist_duplicate_plan(
  p_original_event_id uuid,
  p_new_event_id uuid,
  p_creator_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_creator_name text;
  v_original_title text;
  v_waitlist_user record;
BEGIN
  SELECT first_name_display INTO v_creator_name
  FROM profiles WHERE id = p_creator_user_id;

  SELECT title INTO v_original_title
  FROM events WHERE id = p_original_event_id;

  FOR v_waitlist_user IN
    SELECT user_id
    FROM event_waitlist
    WHERE event_id = p_original_event_id
      AND user_id != p_creator_user_id
  LOOP
    INSERT INTO app_notifications (user_id, type, title, body, event_id)
    VALUES (
      v_waitlist_user.user_id,
      'duplicate_plan',
      'no need to wait!',
      COALESCE(v_creator_name, 'someone') || ' just posted a similar plan to "' || COALESCE(v_original_title, 'a plan') || '". join now instead of waiting!',
      p_new_event_id
    );
  END LOOP;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- Self-tests (Supabase branches are broken, embedded checks substitute)
-- ────────────────────────────────────────────────────────────────────
DO $do$
DECLARE
  v_constraint_def text;
  v_func_exists boolean;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
  INTO v_constraint_def
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'app_notifications'
    AND c.conname = 'app_notifications_type_check';

  IF v_constraint_def IS NULL OR position('duplicate_plan' IN v_constraint_def) = 0 THEN
    RAISE EXCEPTION
      'self-test failed: app_notifications_type_check does not include duplicate_plan';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'notify_waitlist_duplicate_plan'
  ) INTO v_func_exists;

  IF NOT v_func_exists THEN
    RAISE EXCEPTION
      'self-test failed: notify_waitlist_duplicate_plan was not created';
  END IF;
END
$do$;
