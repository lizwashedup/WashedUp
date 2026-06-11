-- ===========================================================================
-- NOT YET APPLIED. Batch 3, file 7/8. Reviewed at the batch-3 checkpoint;
-- applied to prod only on explicit go-ahead, in the batch order.
--
-- Post-plan survey v3 (post-plan-survey-spec.md): the who-made-it step is shown
-- ONLY per plan-type rules, which the client can't decide without plan-type facts.
-- Extend get_pending_post_plan_survey's `plan` object with three ADDITIVE keys:
--   circle_id           events.circle_id (NULL for organic plans)
--   is_featured         events.is_featured
--   any_stranger_joined for a circle plan, whether any JOINED member is not a
--                       circle member (a stranger committed); false otherwise
--
-- Live body is reproduced verbatim; only the final plan jsonb gains the keys.
-- Selection logic (which plan, dedup vs plan_feedback, 7-day PT window) unchanged.
--
-- Flag-off safety: gated survey; purely additive keys, existing consumers ignore
-- unknown keys.
-- ===========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.get_pending_post_plan_survey()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_plan_id uuid;
  v_title text;
  v_image_url text;
  v_circle_id uuid;
  v_is_featured boolean;
  v_any_stranger boolean;
  v_members jsonb;
BEGIN
  IF v_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT e.id, e.title, e.image_url, e.circle_id, e.is_featured
  INTO v_plan_id, v_title, v_image_url, v_circle_id, v_is_featured
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

  -- A stranger committed only matters on a circle plan: a joined member who is
  -- NOT a member of the plan's circle.
  IF v_circle_id IS NULL THEN
    v_any_stranger := false;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM event_members em2
      WHERE em2.event_id = v_plan_id AND em2.status = 'joined'
        AND NOT public.is_circle_member(v_circle_id, em2.user_id)
    ) INTO v_any_stranger;
  END IF;

  RETURN jsonb_build_object(
    'plan', jsonb_build_object(
      'id', v_plan_id,
      'title', v_title,
      'image_url', v_image_url,
      'circle_id', v_circle_id,
      'is_featured', COALESCE(v_is_featured, false),
      'any_stranger_joined', v_any_stranger
    ),
    'members', v_members
  );
END;
$function$;

-- --- in-transaction self-test (rolls back; leaves no trace) ------------------
DO $$
DECLARE
  v_member  uuid := 'cafe0001-0000-0000-0000-000000000001';   -- Sage (synthetic; no real plan history to collide with)
  v_stranger uuid := 'cafe0002-0000-0000-0000-000000000002';  -- Marlowe (not in circle)
  v_circle  uuid;
  v_event   uuid;
  v_out     jsonb;
BEGIN
  BEGIN
    INSERT INTO public.circles (name, creator_user_id, status)
    VALUES ('survey-facts-selftest', v_member, 'active') RETURNING id INTO v_circle;
    INSERT INTO public.circle_members (circle_id, user_id, role, status)
    VALUES (v_circle, v_member, 'admin', 'joined');

    -- A completed circle plan (yesterday PT) the member hasn't rated.
    -- start_time exactly 1 day ago is unambiguously "yesterday PT" (24h < today's
    -- date) and within the 7-day window the survey query requires.
    INSERT INTO public.events (title, creator_user_id, circle_id, is_featured, start_time, end_time, status, gender_rule, min_invites, max_invites, member_count, city)
    VALUES ('survey-facts-plan', v_member, v_circle, false,
            now() - interval '1 day', now() - interval '21 hours',
            'completed', 'mixed', 1, 8, 2, 'Los Angeles')
    RETURNING id INTO v_event;
    INSERT INTO public.event_members (event_id, user_id, role, status) VALUES (v_event, v_member, 'host', 'joined');

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_member, 'role', 'authenticated')::text, true);

    -- No stranger yet.
    v_out := public.get_pending_post_plan_survey();
    IF v_out->'plan'->>'circle_id' IS DISTINCT FROM v_circle::text THEN
      RAISE EXCEPTION 'self-test: circle_id missing, got %', v_out->'plan'->>'circle_id';
    END IF;
    IF (v_out->'plan'->>'any_stranger_joined')::boolean <> false THEN
      RAISE EXCEPTION 'self-test: expected no stranger yet';
    END IF;

    -- A stranger (not in the circle) joins -> any_stranger_joined flips true.
    INSERT INTO public.event_members (event_id, user_id, role, status) VALUES (v_event, v_stranger, 'guest', 'joined');
    v_out := public.get_pending_post_plan_survey();
    IF (v_out->'plan'->>'any_stranger_joined')::boolean <> true THEN
      RAISE EXCEPTION 'self-test: expected stranger detected';
    END IF;
    IF (v_out->'plan'->>'is_featured')::boolean <> false THEN
      RAISE EXCEPTION 'self-test: is_featured should be false';
    END IF;

    RAISE EXCEPTION 'SELFTEST_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'survey plan-type-facts self-test passed';
END $$;

COMMIT;
