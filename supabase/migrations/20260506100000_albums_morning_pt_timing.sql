-- Albums + survey timing: shift to next-morning PT.
-- Documentation-only. Applied directly in production Supabase on 2026-05-06.
--
-- Two semantic changes:
--
-- 1. Album upload prompt cron now fires "the morning AFTER the day the plan
--    ended in PT", not "24 hours after end_time wall-clock". The eligibility
--    WHERE clause uses date(... AT TIME ZONE 'America/Los_Angeles') < date(now()
--    AT TIME ZONE 'America/Los_Angeles') so a plan that ends at any point on
--    Tuesday PT is prompted Wednesday at 10 AM PT, regardless of whether it
--    ended at 9 AM or 11 PM. Cron schedule shifts from 22 UTC (15:00 PT PDT)
--    to 17 UTC (10:00 PT PDT). Sibling crons (reminders, creator nudge) shift
--    in the same morning band so all album notifications happen in the same
--    PT window.
--
-- 2. Post-plan survey now eligibility-checks the same way. Currently the
--    survey check lives entirely in app/_layout.tsx as two queries; this
--    migration adds get_pending_post_plan_survey() so the client can do it
--    in one round trip with the TZ math on the server side. Eligibility:
--    plan status='completed', start_time was on a PT day strictly before
--    today PT, within last 7 days, no plan_feedback row from this user yet.

-- ─── 1. Album upload prompt RPC ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION send_album_upload_prompts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  v_event RECORD;
  v_album_id uuid;
  v_inserted int := 0;
  v_round int;
BEGIN
  FOR v_event IN
    SELECT e.id AS event_id, e.title FROM events e
    LEFT JOIN plan_albums pa ON pa.event_id = e.id
    WHERE date(COALESCE(e.end_time, e.start_time + interval '3 hours') AT TIME ZONE 'America/Los_Angeles')
            < date((now()) AT TIME ZONE 'America/Los_Angeles')
      AND COALESCE(e.end_time, e.start_time + interval '3 hours') >= albums_feature_launch_date()
      AND (pa.id IS NULL OR pa.prompt_sent_at IS NULL)
  LOOP
    INSERT INTO plan_albums (event_id, status, prompt_sent_at)
    VALUES (v_event.event_id, 'collecting', now())
    ON CONFLICT (event_id) DO UPDATE
      SET prompt_sent_at = COALESCE(plan_albums.prompt_sent_at, now())
    RETURNING id INTO v_album_id;

    INSERT INTO app_notifications (user_id, type, title, body, event_id)
    SELECT em.user_id, 'album_upload_prompt', v_event.title,
      'Everyone took photos. Now put them together. Upload yours and get everyone else''s back.',
      v_event.event_id
    FROM event_members em
    WHERE em.event_id = v_event.event_id AND em.status = 'joined'
      AND NOT EXISTS (SELECT 1 FROM plan_attendance pa2
                      WHERE pa2.event_id = v_event.event_id
                        AND pa2.user_id = em.user_id
                        AND pa2.was_present = false)
      AND NOT EXISTS (SELECT 1 FROM app_notifications n
                      WHERE n.user_id = em.user_id
                        AND n.event_id = v_event.event_id
                        AND n.type = 'album_upload_prompt');
    GET DIAGNOSTICS v_round = ROW_COUNT;
    v_inserted := v_inserted + v_round;
  END LOOP;
  RETURN v_inserted;
END;
$func$;

-- ─── 2. Post-plan survey RPC ─────────────────────────────────────────────────
-- Returns a single JSONB { plan: {id, title, image_url}, members: [...] }
-- or NULL if no eligible plan. Caller (app/_layout.tsx) sets surveyPlan and
-- surveyMembers from this in one round trip.

CREATE OR REPLACE FUNCTION get_pending_post_plan_survey()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  v_user_id uuid := auth.uid();
  v_plan_id uuid;
  v_title text;
  v_image_url text;
  v_members jsonb;
BEGIN
  IF v_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT e.id, e.title, e.image_url
  INTO v_plan_id, v_title, v_image_url
  FROM events e
  JOIN event_members em ON em.event_id = e.id
                       AND em.user_id = v_user_id
                       AND em.status = 'joined'
  WHERE e.status = 'completed'
    AND date(e.start_time AT TIME ZONE 'America/Los_Angeles')
          < date((now()) AT TIME ZONE 'America/Los_Angeles')
    AND e.start_time >= (now() - interval '7 days')
    AND NOT EXISTS (
      SELECT 1 FROM plan_feedback pf
      WHERE pf.user_id = v_user_id AND pf.event_id = e.id
    )
  ORDER BY e.start_time DESC
  LIMIT 1;

  IF v_plan_id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', pp.id,
    'first_name_display', pp.first_name_display,
    'profile_photo_url', pp.profile_photo_url
  )), '[]'::jsonb)
  INTO v_members
  FROM event_members em
  JOIN profiles_public pp ON pp.id = em.user_id
  WHERE em.event_id = v_plan_id AND em.status = 'joined';

  RETURN jsonb_build_object(
    'plan', jsonb_build_object('id', v_plan_id, 'title', v_title, 'image_url', v_image_url),
    'members', v_members
  );
END;
$func$;

REVOKE ALL ON FUNCTION get_pending_post_plan_survey() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_pending_post_plan_survey() TO authenticated;

-- ─── 3. Reschedule album crons to the morning PT band ────────────────────────

SELECT cron.unschedule('albums-send-upload-prompts');
SELECT cron.schedule('albums-send-upload-prompts', '0 17 * * *',
  $cron$ SELECT public.send_album_upload_prompts(); $cron$);

SELECT cron.unschedule('albums-send-upload-reminders');
SELECT cron.schedule('albums-send-upload-reminders', '30 17 * * *',
  $cron$ SELECT public.send_album_upload_reminders(); $cron$);

SELECT cron.unschedule('albums-creator-no-uploads-nudge');
SELECT cron.schedule('albums-creator-no-uploads-nudge', '0 18 * * *',
  $cron$ SELECT public.nudge_creators_no_uploads(); $cron$);

-- ─── 4. Self-test ────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_def text;
  v_schedule text;
BEGIN
  -- send_album_upload_prompts now contains AT TIME ZONE
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'send_album_upload_prompts';
  IF v_def NOT LIKE '%AT TIME ZONE ''America/Los_Angeles''%' THEN
    RAISE EXCEPTION 'send_album_upload_prompts: AT TIME ZONE missing from new body';
  END IF;

  -- get_pending_post_plan_survey exists with TZ math
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'get_pending_post_plan_survey';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'get_pending_post_plan_survey: not created';
  END IF;
  IF v_def NOT LIKE '%AT TIME ZONE ''America/Los_Angeles''%' THEN
    RAISE EXCEPTION 'get_pending_post_plan_survey: AT TIME ZONE missing';
  END IF;

  -- Three crons land on the morning PT band
  SELECT schedule INTO v_schedule FROM cron.job WHERE jobname = 'albums-send-upload-prompts';
  IF v_schedule <> '0 17 * * *' THEN
    RAISE EXCEPTION 'albums-send-upload-prompts schedule wrong: %', v_schedule;
  END IF;
  SELECT schedule INTO v_schedule FROM cron.job WHERE jobname = 'albums-send-upload-reminders';
  IF v_schedule <> '30 17 * * *' THEN
    RAISE EXCEPTION 'albums-send-upload-reminders schedule wrong: %', v_schedule;
  END IF;
  SELECT schedule INTO v_schedule FROM cron.job WHERE jobname = 'albums-creator-no-uploads-nudge';
  IF v_schedule <> '0 18 * * *' THEN
    RAISE EXCEPTION 'albums-creator-no-uploads-nudge schedule wrong: %', v_schedule;
  END IF;
END
$$ LANGUAGE plpgsql;
