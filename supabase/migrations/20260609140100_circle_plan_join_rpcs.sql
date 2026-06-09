-- Circle-aware plans. 2/4: join / start-a-chat / read-context RPCs.
--
-- REVIEW ONLY. Not applied by the agent. Verified 2026-06-09 against prod.
-- These three functions are inert until the gated client calls them; nothing
-- on prod references them yet.
--
-- Why a NEW join RPC instead of editing join_event_atomic: the shipped
-- join_event_atomic is on the hot normal-plan path (recount-and-trust, no early
-- 'full' exit, re-join handling, 12+ AFTER triggers fire off its write). We
-- reuse the exact same primitives (row lock + upsert into event_members) but
-- swap only the capacity predicate, leaving the shipped function and the
-- sync_event_member_count trigger untouched. The client dispatches to this RPC
-- only when the plan is a circle plan (see get_circle_plan_context).
--
-- Capacity model: strangers vs members are distinguished by LIVE circle
-- membership (is_circle_member), not a stored role, so attendance semantics
-- follow current membership. Circle members are uncapped; feed strangers are
-- capped at events.stranger_cap. The cap check runs under the same FOR UPDATE
-- row lock so concurrent stranger joins cannot both slip past it.
--
-- The server stays greeting-agnostic (exactly like join_event_atomic): the
-- "post an intro to join" gate, and the circle-member bypass of it, are client
-- decisions (the client shows or skips the required-greeting modal based on
-- get_circle_plan_context.viewer_is_member).
--
-- Idempotent. BEGIN/COMMIT with grants + a self-test that smoke-calls
-- get_circle_plan_context under SET LOCAL request.jwt.claims and rolls back.

BEGIN;

-- ---------------------------------------------------------------------------
-- join_circle_plan_atomic: a circle member or a feed stranger joins a circle
-- plan. Members uncapped; strangers capped at stranger_cap. Returns one of
-- 'joined' | 'not_found' | 'not_circle_plan' | 'not_eligible' | 'full'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_circle_plan_atomic(
  p_event_id      uuid,
  p_user_id       uuid,
  p_age_at_join   integer DEFAULT NULL,
  p_gender_at_join text   DEFAULT NULL
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_event      RECORD;
  v_is_member  boolean;
  v_strangers  integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  -- Tighter than join_event_atomic (which trusts the param): new code, so we
  -- only let a caller join themselves.
  IF p_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'can only join as yourself';
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF v_event IS NULL THEN
    RETURN 'not_found';
  END IF;
  IF v_event.circle_id IS NULL THEN
    RETURN 'not_circle_plan';
  END IF;

  v_is_member := public.is_circle_member(v_event.circle_id, p_user_id);

  -- A circle_only plan is reachable only by its circle's members.
  IF NOT v_is_member AND v_event.circle_visibility = 'circle_only' THEN
    RETURN 'not_eligible';
  END IF;

  -- Strangers (non-members on an open plan) are capped; members are not.
  IF NOT v_is_member THEN
    SELECT count(*)::int INTO v_strangers
    FROM public.event_members em
    WHERE em.event_id = p_event_id
      AND em.status = 'joined'
      AND NOT public.is_circle_member(v_event.circle_id, em.user_id);

    IF v_strangers >= COALESCE(v_event.stranger_cap, 0) THEN
      RETURN 'full';
    END IF;
  END IF;

  -- Upsert the member row (re-join aware), identical shape to join_event_atomic.
  UPDATE public.event_members
  SET status = 'joined', role = 'guest',
      age_at_join    = COALESCE(p_age_at_join, age_at_join),
      gender_at_join = COALESCE(p_gender_at_join, gender_at_join)
  WHERE event_id = p_event_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO public.event_members (event_id, user_id, role, status, age_at_join, gender_at_join)
    VALUES (p_event_id, p_user_id, 'guest', 'joined', p_age_at_join, p_gender_at_join);
  END IF;

  RETURN 'joined';
END;
$$;

-- ---------------------------------------------------------------------------
-- spawn_plan_chat: the "Start a chat for this" affordance. Flips a whole-circle
-- just-us plan from "lives in the circle chat" to its own event-parented chat.
-- One-directional and idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.spawn_plan_chat(p_event_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_event RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF v_event IS NULL THEN
    RAISE EXCEPTION 'plan not found';
  END IF;
  IF v_event.circle_id IS NULL THEN
    RAISE EXCEPTION 'not a circle plan';
  END IF;
  IF NOT public.is_circle_member(v_event.circle_id, v_uid) THEN
    RAISE EXCEPTION 'not a member of this circle';
  END IF;

  IF v_event.has_own_chat THEN
    RETURN; -- already has its own chat
  END IF;

  UPDATE public.events SET has_own_chat = true WHERE id = p_event_id;

  -- Open the event-parented chat with a system line. event_id set, circle_id
  -- NULL satisfies the messages parent XOR.
  INSERT INTO public.messages (event_id, user_id, content, message_type)
  VALUES (p_event_id, v_uid, 'Started a chat for this plan', 'system');
END;
$$;

-- ---------------------------------------------------------------------------
-- get_circle_plan_context: one read the plan-detail screen makes to decide the
-- join path and the intro gate. Works for a normal plan (returns
-- is_circle_plan=false), for a member, and for a stranger viewing an open plan.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_circle_plan_context(p_event_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_event     RECORD;
  v_is_member boolean := false;
  v_spots     integer := NULL;
BEGIN
  SELECT circle_id, circle_visibility, stranger_cap, has_own_chat
    INTO v_event
  FROM public.events WHERE id = p_event_id;

  IF NOT FOUND OR v_event.circle_id IS NULL THEN
    RETURN jsonb_build_object('is_circle_plan', false);
  END IF;

  v_is_member := (v_uid IS NOT NULL) AND public.is_circle_member(v_event.circle_id, v_uid);

  IF v_event.stranger_cap IS NOT NULL THEN
    v_spots := GREATEST(0, v_event.stranger_cap - (
      SELECT count(*)::int FROM public.event_members em
      WHERE em.event_id = p_event_id
        AND em.status = 'joined'
        AND NOT public.is_circle_member(v_event.circle_id, em.user_id)
    ));
  END IF;

  RETURN jsonb_build_object(
    'is_circle_plan', true,
    'circle_id', v_event.circle_id,
    'circle_visibility', v_event.circle_visibility,
    'stranger_cap', v_event.stranger_cap,
    'has_own_chat', v_event.has_own_chat,
    'viewer_is_member', v_is_member,
    'viewer_stranger_spots_left', v_spots
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants: authenticated only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.join_circle_plan_atomic(uuid, uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.spawn_plan_chat(uuid)                              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_circle_plan_context(uuid)                      FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.join_circle_plan_atomic(uuid, uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spawn_plan_chat(uuid)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_circle_plan_context(uuid)                      TO authenticated;

-- ---------------------------------------------------------------------------
-- Self-test: all three exist + SECURITY DEFINER, and get_circle_plan_context
-- actually executes for a real (normal) event under a real jwt, returning
-- is_circle_plan=false. Wrapped in a savepoint and rolled back.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn    text;
  v_eid   uuid;
  v_uid   uuid;
  v_out   jsonb;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['join_circle_plan_atomic','spawn_plan_chat','get_circle_plan_context']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = v_fn AND prosecdef) THEN
      RAISE EXCEPTION 'RPC % missing or not SECURITY DEFINER', v_fn;
    END IF;
  END LOOP;

  -- Smoke-call against any existing normal event under its creator's identity.
  SELECT id, creator_user_id INTO v_eid, v_uid
  FROM public.events
  WHERE circle_id IS NULL AND creator_user_id IS NOT NULL
  LIMIT 1;

  IF v_eid IS NULL THEN
    RAISE NOTICE 'no normal event available; skipping smoke-call';
  ELSE
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
      v_out := public.get_circle_plan_context(v_eid);
      IF (v_out->>'is_circle_plan')::boolean <> false THEN
        RAISE EXCEPTION 'get_circle_plan_context smoke-call: expected is_circle_plan=false, got %', v_out;
      END IF;
      PERFORM set_config('request.jwt.claims', NULL, true);
    END;
  END IF;
END $$;

COMMIT;
