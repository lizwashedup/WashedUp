-- Community topic chat (rooms): push routing for topic messages.
--
-- REVIEW ONLY. NOT applied by the agent.
--
-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ DO NOT APPLY THIS ALONE. It writes app_notifications rows for topic   ║
-- ║ messages with event_id NULL + topic_id set. The send-push-            ║
-- ║ notifications edge function (PROTECTED - not edited here) currently   ║
-- ║ only builds its deep-link/tap payload from event_id, so until it is   ║
-- ║ taught to carry topic_id (and the client's notification-tap router in ║
-- ║ app/_layout.tsx is taught a branch for it), these pushes will fire    ║
-- ║ but tap to nowhere useful. Same class of gap already flagged in       ║
-- ║ 20260605000200_circle_message_push.sql for circle_id -- confirmed     ║
-- ║ still true 2026-08-27: the edge function's payload is still           ║
-- ║ eventId-only (grepped send-push-notifications/index.ts directly).     ║
-- ║ Apply this together with an edge-function + tap-router change, not    ║
-- ║ alone.                                                                 ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- DESIGN NOTES
-- * Root cause of the 2026-08-27 founder report ("community chat
--   notifications not reaching phones even with notifications on"):
--   community_topic_messages has never had ANY push trigger, in any
--   migration, since the table was created
--   (20260702184012_communities_skeleton.sql). This is the missing half.
-- * Reuses the EXISTING app_notifications type 'new_message' (added by
--   20260305000000), same convention circle push uses. Does not touch the
--   type CHECK constraint (same reasoning as the circle migration: many
--   later migrations have re-altered it, reconstructing the full value
--   list here would risk dropping one).
-- * Additive topic_id column only (nullable, FK, ON DELETE CASCADE).
-- * Respects community_topic_members.notifications_on (defaults true on
--   join, mutable via the per-topic bell toggle) -- a member who muted the
--   room does not get pushed. The existing UI toggle currently has no
--   backend effect at all (nothing reads it); this trigger is what makes
--   it real.
-- * Separate trigger from on_new_chat_message / on_new_circle_message; this
--   fires on community_topic_messages, a different table entirely, so
--   nothing about existing plan/circle push changes.
-- * The main community feed (community_broadcasts, the leader-post +
--   open-composer stream) is a SEPARATE, deliberate gap --
--   notify_community_broadcast() explicitly skips kind='message' (see
--   20260708220000_open_composer.sql lines 72-96, self-tested to do so).
--   Not touched here; that one reads as a product decision to revisit, not
--   a wiring bug, and is out of scope for this fix.
--
-- Idempotent; wrapped in a self-test.

BEGIN;

-- ---------------------------------------------------------------------------
-- Additive topic parent on the notification row, so the push pipeline can
-- (once taught to) route the tap to the right room.
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_notifications
  ADD COLUMN IF NOT EXISTS topic_id uuid REFERENCES public.community_topics(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Fan a topic message out to every other subscribed member as a notification.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_new_topic_message()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_sender_name text;
  v_topic_name  text;
  v_body        text;
  v_member_row  RECORD;
  v_recent      boolean;
BEGIN
  SELECT first_name_display INTO v_sender_name FROM public.profiles WHERE id = NEW.sender_id;
  SELECT name INTO v_topic_name FROM public.community_topics WHERE id = NEW.topic_id;

  -- Mirrors 20260605000200_circle_message_push.sql's photo-only case: a
  -- caption-less image insert leaves body empty, which would otherwise push
  -- a blank notification.
  v_body := CASE
    WHEN NEW.image_url IS NOT NULL AND (NEW.body IS NULL OR NEW.body = '')
                                   THEN COALESCE(v_sender_name, 'Someone') || ' sent a photo'
    WHEN length(NEW.body) > 120 THEN left(NEW.body, 117) || '...'
    ELSE NEW.body
  END;

  FOR v_member_row IN
    SELECT ctm.user_id
    FROM public.community_topic_members ctm
    WHERE ctm.topic_id = NEW.topic_id
      AND ctm.notifications_on = true
      AND ctm.user_id <> NEW.sender_id
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.app_notifications
      WHERE user_id = v_member_row.user_id
        AND topic_id = NEW.topic_id
        AND type = 'new_message'
        AND status = 'unread'
        AND created_at > now() - interval '30 seconds'
    ) INTO v_recent;

    IF NOT v_recent THEN
      INSERT INTO public.app_notifications (user_id, type, title, body, topic_id)
      VALUES (
        v_member_row.user_id,
        'new_message',
        COALESCE(v_sender_name, 'Someone') || ' in ' || COALESCE(v_topic_name, 'a room'),
        v_body,
        NEW.topic_id
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_new_topic_message ON public.community_topic_messages;
CREATE TRIGGER on_new_topic_message
  AFTER INSERT ON public.community_topic_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_new_topic_message();

-- ---------------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='app_notifications' AND column_name='topic_id') THEN
    RAISE EXCEPTION 'app_notifications.topic_id missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='notify_new_topic_message' AND prosecdef) THEN
    RAISE EXCEPTION 'notify_new_topic_message missing or not SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='on_new_topic_message') THEN
    RAISE EXCEPTION 'on_new_topic_message trigger missing';
  END IF;
END $$;

COMMIT;
