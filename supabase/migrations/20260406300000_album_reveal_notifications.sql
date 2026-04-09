-- Album reveal notifications: push notify members when developing photos are ready.
-- Documentation-only. Applied directly in production Supabase on 2026-04-06.

-- 1. Add 'album_ready' to the notification type constraint
ALTER TABLE app_notifications
  DROP CONSTRAINT IF EXISTS app_notifications_type_check;

ALTER TABLE app_notifications
  ADD CONSTRAINT app_notifications_type_check
  CHECK (type IN (
    'waitlist_spot', 'broadcast', 'event_reminder',
    'member_joined', 'plan_invite', 'invite_accepted', 'new_message',
    'album_ready'
  ));

-- 2. Function to reveal photos and notify members.
--    Called by the reveal-album-photos edge function on a cron schedule.
--    Finds all plan_photos where reveal_at <= now AND is_developing = true,
--    flips is_developing to false, and inserts one app_notification per eligible member
--    (joined event_members who are NOT marked as no-shows).
CREATE OR REPLACE FUNCTION reveal_album_photos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec RECORD;
BEGIN
  -- Get distinct event_ids that have photos ready to reveal
  FOR rec IN
    SELECT DISTINCT pp.event_id, e.title AS plan_title
    FROM plan_photos pp
    JOIN events e ON e.id = pp.event_id
    WHERE pp.is_developing = true
      AND pp.reveal_at IS NOT NULL
      AND pp.reveal_at <= now()
  LOOP
    -- Mark all developing photos for this event as revealed
    UPDATE plan_photos
    SET is_developing = false
    WHERE event_id = rec.event_id
      AND is_developing = true
      AND reveal_at IS NOT NULL
      AND reveal_at <= now();

    -- Notify eligible members (joined + not marked no-show)
    INSERT INTO app_notifications (user_id, type, title, body, event_id)
    SELECT em.user_id,
           'album_ready',
           'Your photos are ready!',
           'Photos from ' || rec.plan_title || ' just dropped — go take a look',
           rec.event_id
    FROM event_members em
    WHERE em.event_id = rec.event_id
      AND em.status = 'joined'
      AND NOT EXISTS (
        SELECT 1 FROM plan_attendance pa
        WHERE pa.event_id = rec.event_id
          AND pa.user_id = em.user_id
          AND pa.was_present = false
      )
      -- Don't double-notify
      AND NOT EXISTS (
        SELECT 1 FROM app_notifications an
        WHERE an.event_id = rec.event_id
          AND an.user_id = em.user_id
          AND an.type = 'album_ready'
      );
  END LOOP;
END;
$$;
