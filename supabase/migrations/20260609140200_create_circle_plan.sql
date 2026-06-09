-- Circle-aware plans. 3/4: create_circle_plan.
--
-- REVIEW ONLY. Not applied by the agent. Verified 2026-06-09 against prod.
--
-- Creates a circle plan as a REAL events row in one transaction: insert the
-- event, add the creator (and, for a picked subset / DM, the invited members),
-- decide own-chat vs circle-chat, and post the opening system line. Returns
-- { event_id, has_own_chat }.
--
-- Decisions baked in (see docs/circle-plans-build-notes.md):
--   * Audience "who is this for" is the only new question. p_visibility is
--     'circle_only' (stays in the circle, never public) or 'open' (posts to the
--     feed). p_member_user_ids NULL/empty = the whole circle; a subset = picked.
--   * has_own_chat: open => true (always its own chat); circle_only + whole =>
--     false (lives in the circle chat); circle_only + subset => true.
--   * Auto-add: creator always (role 'host'). Whole-circle & open => creator
--     only; everyone else opts in via the card ("Join if you're around"). Picked
--     subset => creator + picked members (picking = inviting). A 2-person circle
--     (a DM) whole audience => auto-add the other member.
--   * max_invites = 15 (non-featured max; the real cap is stranger_cap, enforced
--     in join_circle_plan_atomic). gender_rule carries over unchanged.
--   * post_circle_system_message is not on prod, so the system lines are inlined
--     here (messages parent XOR: event_id XOR circle_id).
--   * Creating the event fires the existing notify_plan_posted trigger, which is
--     an internal admin-only alert (email + admin push); left as-is.
--
-- Idempotent. BEGIN/COMMIT with grants + a self-test that smoke-calls
-- create_circle_plan for both an open and a whole-circle plan under a real jwt
-- in a sub-block that is rolled back.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_circle_plan(
  p_circle_id       uuid,
  p_title           text,
  p_start_time      timestamptz,
  p_visibility      text,
  p_stranger_cap    integer     DEFAULT NULL,
  p_gender_rule     text        DEFAULT 'mixed',
  p_member_user_ids uuid[]      DEFAULT NULL,
  p_description     text        DEFAULT NULL,
  p_end_time        timestamptz DEFAULT NULL,
  p_drop_in         boolean     DEFAULT true,
  p_location_text   text        DEFAULT NULL,
  p_location_lat    numeric     DEFAULT NULL,
  p_location_lng    numeric     DEFAULT NULL,
  p_primary_vibe    text        DEFAULT NULL,
  p_target_age_min  integer     DEFAULT NULL,
  p_target_age_max  integer     DEFAULT NULL,
  p_host_message    text        DEFAULT NULL,
  p_image_url       text        DEFAULT NULL,
  p_neighborhood    text        DEFAULT NULL,
  p_tickets_url     text        DEFAULT NULL,
  p_city            text        DEFAULT 'Los Angeles'
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_event_id     uuid;
  v_whole        boolean;
  v_member_count integer;
  v_has_own_chat boolean;
  v_cap          integer;
  v_name         text;
  v_autoadd      uuid[] := '{}';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_circle_member(p_circle_id, v_uid) THEN
    RAISE EXCEPTION 'not a member of this circle';
  END IF;
  IF p_title IS NULL OR length(btrim(p_title)) = 0 THEN
    RAISE EXCEPTION 'plan title required';
  END IF;
  IF p_visibility NOT IN ('circle_only','open') THEN
    RAISE EXCEPTION 'invalid visibility %', p_visibility;
  END IF;

  IF p_visibility = 'open' THEN
    v_cap := COALESCE(p_stranger_cap, 4);
    IF v_cap < 2 OR v_cap > 7 THEN
      RAISE EXCEPTION 'stranger_cap must be 2..7';
    END IF;
  ELSE
    v_cap := NULL; -- circle_only never has a stranger cap
  END IF;

  -- Whole circle vs picked subset.
  IF p_member_user_ids IS NULL OR cardinality(p_member_user_ids) = 0 THEN
    v_whole := true;
  ELSE
    v_whole := NOT EXISTS (
      SELECT 1 FROM public.circle_members cm
      WHERE cm.circle_id = p_circle_id AND cm.status = 'joined'
        AND NOT (cm.user_id = ANY(p_member_user_ids))
    );
  END IF;

  SELECT count(*)::int INTO v_member_count
  FROM public.circle_members
  WHERE circle_id = p_circle_id AND status = 'joined';

  -- Own chat exactly when the attendees are not the whole circle, or it's open.
  v_has_own_chat := (p_visibility = 'open') OR (NOT v_whole);

  INSERT INTO public.events (
    title, description, start_time, end_time, drop_in,
    location_text, location_lat, location_lng, tickets_url,
    primary_vibe, gender_rule, target_age_min, target_age_max,
    host_message, image_url, neighborhood, city,
    creator_user_id, status, min_invites, max_invites,
    circle_id, circle_visibility, stranger_cap, has_own_chat
  )
  VALUES (
    btrim(p_title), p_description, p_start_time, p_end_time, COALESCE(p_drop_in, true),
    p_location_text, p_location_lat, p_location_lng, p_tickets_url,
    p_primary_vibe, COALESCE(p_gender_rule,'mixed')::gender_rule, p_target_age_min, p_target_age_max,
    p_host_message, p_image_url, p_neighborhood, COALESCE(p_city,'Los Angeles'),
    v_uid, 'forming', 1, 15,
    p_circle_id, p_visibility, v_cap, v_has_own_chat
  )
  RETURNING id INTO v_event_id;

  -- Creator is the single creator/poster (role 'host' is the DB column value;
  -- never surfaced as the word "host" in UI).
  INSERT INTO public.event_members (event_id, user_id, role, status)
  VALUES (v_event_id, v_uid, 'host', 'joined');

  -- Determine auto-added attendees beyond the creator.
  IF p_visibility = 'circle_only' AND NOT v_whole THEN
    -- Picked subset: invite exactly the picked, joined members.
    SELECT array_agg(cm.user_id) INTO v_autoadd
    FROM public.circle_members cm
    WHERE cm.circle_id = p_circle_id AND cm.status = 'joined'
      AND cm.user_id = ANY(p_member_user_ids) AND cm.user_id <> v_uid;
  ELSIF v_whole AND v_member_count = 2 THEN
    -- A DM (2-person circle): the other person is automatically added.
    SELECT array_agg(cm.user_id) INTO v_autoadd
    FROM public.circle_members cm
    WHERE cm.circle_id = p_circle_id AND cm.status = 'joined' AND cm.user_id <> v_uid;
  END IF;

  IF v_autoadd IS NOT NULL AND cardinality(v_autoadd) > 0 THEN
    INSERT INTO public.event_members (event_id, user_id, role, status)
    SELECT v_event_id, u, 'guest', 'joined'
    FROM unnest(v_autoadd) u
    ON CONFLICT (event_id, user_id) DO NOTHING;
  END IF;

  -- Opening system line(s). Inlined (post_circle_system_message not on prod).
  SELECT first_name_display INTO v_name FROM public.profiles WHERE id = v_uid;

  IF v_has_own_chat THEN
    INSERT INTO public.messages (event_id, user_id, content, message_type)
    VALUES (v_event_id, v_uid, COALESCE(v_name,'Someone') || ' started this plan', 'system');
  END IF;

  -- Announce in the circle chat unless this is a private picked subset.
  IF NOT (p_visibility = 'circle_only' AND NOT v_whole) THEN
    INSERT INTO public.messages (circle_id, user_id, content, message_type)
    VALUES (p_circle_id, v_uid, COALESCE(v_name,'Someone') || ' started a plan: ' || btrim(p_title), 'system');
  END IF;

  RETURN jsonb_build_object('event_id', v_event_id, 'has_own_chat', v_has_own_chat);
END;
$$;

REVOKE ALL ON FUNCTION public.create_circle_plan(uuid, text, timestamptz, text, integer, text, uuid[], text, timestamptz, boolean, text, numeric, numeric, text, integer, integer, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_circle_plan(uuid, text, timestamptz, text, integer, text, uuid[], text, timestamptz, boolean, text, numeric, numeric, text, integer, integer, text, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Self-test: exists + SECURITY DEFINER, then smoke-call for an open plan and a
-- whole-circle just-us plan under a real circle member's jwt. The DML runs in a
-- sub-block that is force-rolled-back via a sentinel exception, so no test rows
-- (and no enqueued notify-plan-posted http) survive.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_cid uuid;
  v_uid uuid;
  v_res jsonb;
  v_row RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='create_circle_plan' AND prosecdef) THEN
    RAISE EXCEPTION 'create_circle_plan missing or not SECURITY DEFINER';
  END IF;

  SELECT cm.circle_id, cm.user_id INTO v_cid, v_uid
  FROM public.circle_members cm
  WHERE cm.status = 'joined'
  LIMIT 1;

  IF v_cid IS NULL THEN
    RAISE NOTICE 'no circle member available; skipping create_circle_plan smoke-call';
    RETURN;
  END IF;

  BEGIN
    -- Suppress AFTER triggers for the smoke-test so the test event INSERTs do
    -- not enqueue the notify-plan-posted admin email/push (the txn rolls back,
    -- but this removes even the tiny enqueue-then-rollback race). Ignore if the
    -- apply role may not set it; the rollback is still the real safety net.
    BEGIN
      PERFORM set_config('session_replication_role', 'replica', true);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);

    -- open plan -> own chat, stranger_cap 4, status forming
    v_res := public.create_circle_plan(
      v_cid, 'selftest open plan', now() + interval '1 day', 'open', 4
    );
    IF (v_res->>'has_own_chat')::boolean <> true THEN
      RAISE EXCEPTION 'open plan should have_own_chat=true: %', v_res;
    END IF;
    SELECT circle_id, circle_visibility, stranger_cap, status, has_own_chat
      INTO v_row FROM public.events WHERE id = (v_res->>'event_id')::uuid;
    IF v_row.circle_id <> v_cid OR v_row.circle_visibility <> 'open'
       OR v_row.stranger_cap <> 4 OR v_row.status <> 'forming' THEN
      RAISE EXCEPTION 'open plan row wrong: %', to_jsonb(v_row);
    END IF;

    -- whole-circle just-us -> no own chat, null cap
    v_res := public.create_circle_plan(
      v_cid, 'selftest just us', now() + interval '1 day', 'circle_only'
    );
    IF (v_res->>'has_own_chat')::boolean <> false THEN
      RAISE EXCEPTION 'just-us whole plan should have_own_chat=false: %', v_res;
    END IF;
    SELECT circle_visibility, stranger_cap INTO v_row
      FROM public.events WHERE id = (v_res->>'event_id')::uuid;
    IF v_row.circle_visibility <> 'circle_only' OR v_row.stranger_cap IS NOT NULL THEN
      RAISE EXCEPTION 'just-us plan row wrong: %', to_jsonb(v_row);
    END IF;

    RAISE EXCEPTION 'ROLLBACK_SELFTEST_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM <> 'ROLLBACK_SELFTEST_OK' THEN
        RAISE;
      END IF;
  END;
END $$;

COMMIT;
