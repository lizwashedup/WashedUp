-- Albums v1: cron-driven RPCs and pg_cron schedules.
-- Documentation-only. Applied directly in production Supabase on 2026-05-05.
--
-- Depends on: 20260504210000_albums_v1_schema.sql.
--
-- Cron jobs (pg_cron uses UTC):
--   albums-send-upload-prompts          0 22 * * *   (≈15:00 PT, ≈14:00 PST)
--   albums-send-upload-reminders        30 22 * * *  (24h after prompts cron)
--   albums-mark-ready                   */15 * * * *
--   albums-creator-no-uploads-nudge     0 23 * * *
--   albums-flush-heart-batches          */30 * * * *
--
-- All RPCs are idempotent: re-running them produces no duplicate notifications.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Feature launch date (forward-only cutoff).
-- Plans whose end_time is BEFORE this timestamp get no album prompts/nudges.
-- Update via CREATE OR REPLACE FUNCTION when 1.0.4 actually ships.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION albums_feature_launch_date()
RETURNS timestamptz
LANGUAGE sql IMMUTABLE
AS $$ SELECT '2026-05-05T00:00:00-07:00'::timestamptz $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. send_album_upload_prompts() — daily at ~15:00 PT.
--   For each event whose end_time was at least 1 day ago AND post-launch,
--   if no plan_albums.prompt_sent_at exists, insert one album_upload_prompt
--   notification per joined member (skipping was_present=false), and either
--   create plan_albums (status=collecting, prompt_sent_at=now) or update an
--   existing row's prompt_sent_at.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION send_album_upload_prompts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event RECORD;
  v_album_id uuid;
  v_inserted int := 0;
  v_round int;
BEGIN
  FOR v_event IN
    SELECT e.id AS event_id, e.title
    FROM events e
    LEFT JOIN plan_albums pa ON pa.event_id = e.id
    WHERE COALESCE(e.end_time, e.start_time + interval '3 hours')
              + interval '1 day' <= now()
      AND COALESCE(e.end_time, e.start_time + interval '3 hours')
              >= albums_feature_launch_date()
      AND (pa.id IS NULL OR pa.prompt_sent_at IS NULL)
  LOOP
    -- Upsert plan_albums; mark prompt_sent_at.
    INSERT INTO plan_albums (event_id, status, prompt_sent_at)
    VALUES (v_event.event_id, 'collecting', now())
    ON CONFLICT (event_id) DO UPDATE
      SET prompt_sent_at = COALESCE(plan_albums.prompt_sent_at, now())
    RETURNING id INTO v_album_id;

    -- Notify each joined member who attended (or was not flagged not-present).
    INSERT INTO app_notifications (user_id, type, title, body, event_id)
    SELECT em.user_id,
           'album_upload_prompt',
           v_event.title,
           'Everyone took photos. Now put them together. Upload yours and get everyone else''s back.',
           v_event.event_id
    FROM event_members em
    WHERE em.event_id = v_event.event_id
      AND em.status   = 'joined'
      AND NOT EXISTS (
        SELECT 1 FROM plan_attendance pa2
        WHERE pa2.event_id = v_event.event_id
          AND pa2.user_id  = em.user_id
          AND pa2.was_present = false
      )
      AND NOT EXISTS (
        SELECT 1 FROM app_notifications n
        WHERE n.user_id  = em.user_id
          AND n.event_id = v_event.event_id
          AND n.type     = 'album_upload_prompt'
      );

    GET DIAGNOSTICS v_round = ROW_COUNT;
    v_inserted := v_inserted + v_round;
  END LOOP;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION send_album_upload_prompts() FROM PUBLIC;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. send_album_upload_reminders() — 24h after first prompt, one extra ping
--   to anyone who hasn't uploaded yet. Sends at most once per (user, event).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION send_album_upload_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted int;
BEGIN
  WITH due AS (
    SELECT pa.id AS plan_album_id, pa.event_id, e.title
    FROM plan_albums pa
    JOIN events e ON e.id = pa.event_id
    WHERE pa.prompt_sent_at IS NOT NULL
      AND pa.prompt_sent_at + interval '24 hours' <= now()
      AND pa.prompt_sent_at + interval '48 hours' > now()
  ),
  candidates AS (
    SELECT em.user_id, due.event_id, due.title
    FROM due
    JOIN event_members em ON em.event_id = due.event_id
    WHERE em.status = 'joined'
      AND NOT EXISTS (
        SELECT 1 FROM plan_attendance pa3
        WHERE pa3.event_id = due.event_id
          AND pa3.user_id  = em.user_id
          AND pa3.was_present = false
      )
      AND NOT EXISTS (
        SELECT 1 FROM album_uploads au
        JOIN plan_albums pa2 ON pa2.id = au.plan_album_id
        WHERE pa2.event_id = due.event_id
          AND au.user_id   = em.user_id
          AND au.deleted_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM app_notifications n
        WHERE n.user_id  = em.user_id
          AND n.event_id = due.event_id
          AND n.type     = 'album_upload_reminder'
      )
  )
  INSERT INTO app_notifications (user_id, type, title, body, event_id)
  SELECT user_id, 'album_upload_reminder', title,
         'Still have photos from ' || title ||
         '? Add them before your album develops.',
         event_id
  FROM candidates;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION send_album_upload_reminders() FROM PUBLIC;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. flip_albums_to_ready() — every 15 min.
--   Status developing → ready when first_upload_at + 24h <= now. One
--   album_ready notification per joined member (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION flip_albums_to_ready()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_album RECORD;
  v_total int := 0;
  v_inserted int;
BEGIN
  FOR v_album IN
    SELECT pa.id, pa.event_id, e.title
    FROM plan_albums pa
    JOIN events e ON e.id = pa.event_id
    WHERE pa.status = 'developing'
      AND pa.first_upload_at IS NOT NULL
      AND pa.first_upload_at + interval '24 hours' <= now()
  LOOP
    UPDATE plan_albums SET status = 'ready' WHERE id = v_album.id;

    INSERT INTO app_notifications (user_id, type, title, body, event_id)
    SELECT em.user_id,
           'album_ready',
           'Your ' || v_album.title || ' album is ready!',
           'Tap to take a look.',
           v_album.event_id
    FROM event_members em
    WHERE em.event_id = v_album.event_id
      AND em.status   = 'joined'
      AND NOT EXISTS (
        SELECT 1 FROM plan_attendance pa2
        WHERE pa2.event_id = v_album.event_id
          AND pa2.user_id  = em.user_id
          AND pa2.was_present = false
      )
      AND NOT EXISTS (
        SELECT 1 FROM app_notifications n
        WHERE n.user_id  = em.user_id
          AND n.event_id = v_album.event_id
          AND n.type     = 'album_ready'
      );

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_total := v_total + v_inserted;
  END LOOP;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION flip_albums_to_ready() FROM PUBLIC;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. nudge_creators_no_uploads() — daily at ~16:00 PT.
--   For events where prompt was sent ≥ 48h ago AND no upload landed, send
--   ONE album_creator_no_uploads_nudge to the creator (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION nudge_creators_no_uploads()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted int;
BEGIN
  INSERT INTO app_notifications (user_id, type, title, body, event_id)
  SELECT e.creator_user_id,
         'album_creator_no_uploads_nudge',
         e.title,
         'No one added photos from ' || e.title ||
         ' yet. You can still start the album.',
         e.id
  FROM plan_albums pa
  JOIN events e ON e.id = pa.event_id
  WHERE pa.prompt_sent_at IS NOT NULL
    AND pa.prompt_sent_at + interval '48 hours' <= now()
    AND pa.first_upload_at IS NULL
    AND e.creator_user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM app_notifications n
      WHERE n.user_id  = e.creator_user_id
        AND n.event_id = e.id
        AND n.type     = 'album_creator_no_uploads_nudge'
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION nudge_creators_no_uploads() FROM PUBLIC;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. flush_album_heart_batches() — every 30 min.
--   For each (uploader, plan_album) with new hearts since last_heart_notification_at
--   (or all-time if never), send ONE album_hearts_batched notification to the
--   uploader naming the count, then update last_heart_notification_at.
--   Skip uploaders who muted the album.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION flush_album_heart_batches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total int := 0;
BEGIN
  WITH new_hearts AS (
    SELECT
      au.user_id   AS uploader_id,
      au.plan_album_id,
      pa.event_id,
      e.title,
      COUNT(DISTINCT ah.user_id) AS hearter_count
    FROM album_hearts ah
    JOIN album_uploads au ON au.id = ah.upload_id AND au.deleted_at IS NULL
    JOIN plan_albums pa ON pa.id = au.plan_album_id
    JOIN events e ON e.id = pa.event_id
    LEFT JOIN album_user_metadata aum
      ON aum.plan_album_id = au.plan_album_id AND aum.user_id = au.user_id
    WHERE ah.created_at > COALESCE(aum.last_heart_notification_at, '-infinity'::timestamptz)
      AND COALESCE(aum.notifications_muted, false) = false
      AND ah.user_id <> au.user_id
    GROUP BY au.user_id, au.plan_album_id, pa.event_id, e.title
  ),
  inserted AS (
    INSERT INTO app_notifications (user_id, type, title, body, event_id)
    SELECT uploader_id, 'album_hearts_batched', title,
           CASE WHEN hearter_count = 1
                THEN 'Someone loved your photo from ' || title
                ELSE hearter_count || ' people loved your photos from ' || title
           END,
           event_id
    FROM new_hearts
    WHERE hearter_count > 0
    RETURNING user_id, event_id
  ),
  bumped AS (
    INSERT INTO album_user_metadata (plan_album_id, user_id, last_heart_notification_at)
    SELECT plan_album_id, uploader_id, now() FROM new_hearts
    ON CONFLICT (plan_album_id, user_id) DO UPDATE
      SET last_heart_notification_at = EXCLUDED.last_heart_notification_at
    RETURNING user_id
  )
  SELECT COUNT(*) INTO v_total FROM inserted;
  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION flush_album_heart_batches() FROM PUBLIC;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. pg_cron schedules
-- ═══════════════════════════════════════════════════════════════════════════
-- Existing prod jobs (verified): auto-complete-past-plans, capture-weekly-snapshot,
-- expire-stale-interests, monitor-push-health. We append four more.

SELECT cron.schedule(
  'albums-send-upload-prompts',
  '0 22 * * *',
  $cron$ SELECT public.send_album_upload_prompts(); $cron$
);

SELECT cron.schedule(
  'albums-send-upload-reminders',
  '30 22 * * *',
  $cron$ SELECT public.send_album_upload_reminders(); $cron$
);

SELECT cron.schedule(
  'albums-mark-ready',
  '*/15 * * * *',
  $cron$ SELECT public.flip_albums_to_ready(); $cron$
);

SELECT cron.schedule(
  'albums-creator-no-uploads-nudge',
  '0 23 * * *',
  $cron$ SELECT public.nudge_creators_no_uploads(); $cron$
);

SELECT cron.schedule(
  'albums-flush-heart-batches',
  '*/30 * * * *',
  $cron$ SELECT public.flush_album_heart_batches(); $cron$
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Self-test
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_jobs int;
  v_fns  int;
BEGIN
  SELECT COUNT(*) INTO v_jobs FROM cron.job
  WHERE jobname IN (
    'albums-send-upload-prompts','albums-send-upload-reminders',
    'albums-mark-ready','albums-creator-no-uploads-nudge',
    'albums-flush-heart-batches'
  );
  IF v_jobs <> 5 THEN
    RAISE EXCEPTION 'albums_v1_cron: expected 5 jobs, found %', v_jobs;
  END IF;

  SELECT COUNT(*) INTO v_fns FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'albums_feature_launch_date',
      'send_album_upload_prompts','send_album_upload_reminders',
      'flip_albums_to_ready','nudge_creators_no_uploads',
      'flush_album_heart_batches'
    );
  IF v_fns <> 6 THEN
    RAISE EXCEPTION 'albums_v1_cron: expected 6 functions, found %', v_fns;
  END IF;
END
$$ LANGUAGE plpgsql;
