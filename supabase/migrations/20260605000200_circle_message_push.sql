-- Circles (Step 9b): push routing for circle chat messages.
--
-- REVIEW ONLY. NOT applied by the agent.
--
-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ DO NOT APPLY THIS ALONE. It writes app_notifications rows for circle  ║
-- ║ messages with event_id NULL + circle_id set. The send-push-           ║
-- ║ notifications edge function (PROTECTED — not edited here) currently   ║
-- ║ builds its deep-link from event_id, so until it is taught to route    ║
-- ║ circle_id rows to /(tabs)/chats/circle/[circle_id], these pushes will ║
-- ║ have a missing/wrong tap target. Apply this together with the         ║
-- ║ approved send-push change. See the proposal:                          ║
-- ║   "WashedUp x Claude/WashedUp Q2/2026-06-05-circle-push-proposal.md"  ║
-- ║ Also needs the circle notification-clear wiring (useChat circle       ║
-- ║ branch currently skips clearing new_message rows) — see the proposal. ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- DESIGN NOTES
-- * Reuses the EXISTING app_notifications type 'new_message' (added by
--   20260305000000). Deliberately does NOT touch the type CHECK: that
--   constraint has been re-altered by many later migrations and
--   reconstructing its full value list here would risk dropping a value and
--   breaking all notifications. A circle row is distinguished by circle_id,
--   not a new type.
-- * Additive circle_id column only (nullable, FK, ON DELETE CASCADE).
--   event_id is already nullable on app_notifications, so a circle row is
--   valid as-is.
-- * SEPARATE trigger from on_new_chat_message (per the "new trigger, don't
--   modify the existing one" convention). The existing event trigger is a
--   no-op for circle rows anyway (its event_members lookup on a NULL event_id
--   matches nobody), so the two coexist cleanly.
-- * Skips system messages (join/leave lines never push), matching the event
--   trigger.
--
-- Idempotent; wrapped in a self-test.

BEGIN;

-- ---------------------------------------------------------------------------
-- Additive circle parent on the notification row, so the push pipeline can
-- route the tap to the circle chat.
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_notifications
  ADD COLUMN IF NOT EXISTS circle_id uuid REFERENCES public.circles(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Fan a circle message out to every other joined member as a notification.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_new_circle_message()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_sender_name text;
  v_circle_name text;
  v_body        text;
  v_member_row  RECORD;
  v_recent      boolean;
BEGIN
  -- Only circle rows; skip system join/leave lines.
  IF NEW.circle_id IS NULL OR NEW.message_type = 'system' THEN
    RETURN NEW;
  END IF;

  SELECT first_name_display INTO v_sender_name FROM public.profiles WHERE id = NEW.user_id;
  SELECT name INTO v_circle_name FROM public.circles WHERE id = NEW.circle_id;

  -- v1 circle messages are text only (the composer sends nothing else), so the
  -- body covers text + a defensive image case (image_url is a plain column, not
  -- an enum value, so no enum-literal risk). When the circle composer gains
  -- voice/location, add those branches here alongside the parity work.
  v_body := CASE
    WHEN NEW.image_url IS NOT NULL AND (NEW.content IS NULL OR NEW.content = '')
                                   THEN COALESCE(v_sender_name, 'Someone') || ' sent a photo'
    WHEN length(NEW.content) > 120 THEN left(NEW.content, 117) || '...'
    ELSE NEW.content
  END;

  FOR v_member_row IN
    SELECT cm.user_id
    FROM public.circle_members cm
    WHERE cm.circle_id = NEW.circle_id
      AND cm.status = 'joined'
      AND cm.user_id <> NEW.user_id
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.app_notifications
      WHERE user_id = v_member_row.user_id
        AND circle_id = NEW.circle_id
        AND type = 'new_message'
        AND status = 'unread'
        AND created_at > now() - interval '30 seconds'
    ) INTO v_recent;

    IF NOT v_recent THEN
      INSERT INTO public.app_notifications (user_id, type, title, body, circle_id)
      VALUES (
        v_member_row.user_id,
        'new_message',
        COALESCE(v_sender_name, 'Someone') || ' in ' || COALESCE(v_circle_name, 'your circle'),
        v_body,
        NEW.circle_id
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_new_circle_message ON public.messages;
CREATE TRIGGER on_new_circle_message
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_new_circle_message();

-- ---------------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='app_notifications' AND column_name='circle_id') THEN
    RAISE EXCEPTION 'app_notifications.circle_id missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='notify_new_circle_message' AND prosecdef) THEN
    RAISE EXCEPTION 'notify_new_circle_message missing or not SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='on_new_circle_message') THEN
    RAISE EXCEPTION 'on_new_circle_message trigger missing';
  END IF;
END $$;

COMMIT;
