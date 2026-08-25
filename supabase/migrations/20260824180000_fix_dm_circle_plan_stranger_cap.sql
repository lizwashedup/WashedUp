-- Fix: a DM-originated (2-person) circle plan could cap at 9 total instead of
-- the spec's 8 (WashedUp_Circles_Functional_Spec.md section 4, math shown:
-- "a DM-originated plan behaves like a standard 8-person plan... The 2 from
-- the DM occupy 2 of the 8, leaving up to 6 outsiders. The circle capacity
-- expansion (members excluded from the cap) applies only to real 3+ circles,
-- not a 2-person pair").
--
-- Root cause: create_circle_plan let p_stranger_cap go up to 7 regardless of
-- circle size, and join_circle_plan_atomic always excludes circle members
-- from the stranger count (by design, correct for real 3+ circles). For a
-- 2-person circle (a DM, see get_or_create_dm: "DMs as 2-person circles"),
-- that combination gives 2 uncapped members + up to 7 capped strangers = 9.
--
-- Fix is entirely in create_circle_plan: when the circle has exactly 2 joined
-- members, clamp the stranger cap to 6 (2 + 6 = 8), matching spec. No other
-- function needs to change -- join_circle_plan_atomic and the feed
-- spots-remaining query both already just trust whatever stranger_cap is
-- stored on the event; confirmed live via pg_get_functiondef before writing
-- this fix. Real circles (3+ members) are untouched, still 2..7.
--
-- Idempotent (CREATE OR REPLACE). Verified against a scratch Postgres running
-- the real schema before applying to prod.

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

  SELECT count(*)::int INTO v_member_count
  FROM public.circle_members
  WHERE circle_id = p_circle_id AND status = 'joined';

  IF p_visibility = 'open' THEN
    v_cap := COALESCE(p_stranger_cap, 4);
    IF v_cap < 2 OR v_cap > 7 THEN
      RAISE EXCEPTION 'stranger_cap must be 2..7';
    END IF;
    -- A 2-person circle is a DM under the hood (get_or_create_dm). The
    -- member-exclusion expansion is a real-circle (3+) feature only; a
    -- DM-originated plan is a standard 8-total plan (spec section 4).
    IF v_member_count = 2 THEN
      v_cap := LEAST(v_cap, 6);
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

  INSERT INTO public.event_members (event_id, user_id, role, status)
  VALUES (v_event_id, v_uid, 'host', 'joined');

  IF p_visibility = 'circle_only' AND NOT v_whole THEN
    SELECT array_agg(cm.user_id) INTO v_autoadd
    FROM public.circle_members cm
    WHERE cm.circle_id = p_circle_id AND cm.status = 'joined'
      AND cm.user_id = ANY(p_member_user_ids) AND cm.user_id <> v_uid;
  ELSIF v_whole AND v_member_count = 2 THEN
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

  SELECT first_name_display INTO v_name FROM public.profiles WHERE id = v_uid;

  IF v_has_own_chat THEN
    INSERT INTO public.messages (event_id, user_id, content, message_type, ref_event_id)
    VALUES (v_event_id, v_uid, COALESCE(v_name,'Someone') || ' started this plan', 'system', v_event_id);
  END IF;

  IF NOT (p_visibility = 'circle_only' AND NOT v_whole) THEN
    INSERT INTO public.messages (circle_id, user_id, content, message_type, ref_event_id)
    VALUES (p_circle_id, v_uid, COALESCE(v_name,'Someone') || ' started a plan: ' || btrim(p_title), 'system', v_event_id);
  END IF;

  RETURN jsonb_build_object('event_id', v_event_id, 'has_own_chat', v_has_own_chat);
END;
$$;

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc WHERE proname = 'create_circle_plan';
  IF v_def IS NULL OR v_def NOT LIKE '%v_member_count = 2%' THEN
    RAISE EXCEPTION 'create_circle_plan self-test failed: DM stranger-cap clamp not found in deployed function';
  END IF;
  RAISE NOTICE 'create_circle_plan self-test passed: DM (2-member circle) stranger-cap clamp present';
END $$;

COMMIT;
