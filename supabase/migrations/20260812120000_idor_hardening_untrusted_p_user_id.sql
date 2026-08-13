-- Security hardening: 4 SECURITY DEFINER functions trust a caller-supplied
-- p_user_id with no auth.uid() check and no REVOKE/GRANT, so any caller
-- (any authenticated user, and per this project's own documented Supabase
-- default-grant behavior, very possibly anon too) can pass someone else's
-- real uuid and act or read as them. Same bug class as the delete-account
-- IDOR fixed elsewhere tonight. Found and independently double-verified via
-- direct file read against a second pass, 2026-08-12.
--
-- NOT YET APPLIED to production. Built and held locally pending Josh's
-- deploy approval, per standing rule (nothing touches Liz's live Supabase
-- without her review first, and no push without Josh's own separate
-- deploy-phrase approval).
--
-- 1. join_event_atomic — HIGH. Any caller can force ANY real user into ANY
--    event, and fabricate that user's age_at_join/gender_at_join, bypassing
--    gender_rule/age-range restrictions entirely (no trigger/CHECK
--    revalidates them). This is the live path every normal plan-join uses.
--    Self-admitted gap in-repo: 20260609140100_circle_plan_join_rpcs.sql
--    line 56-57, of the newer join_circle_plan_atomic, "Tighter than
--    join_event_atomic (which trusts the param): new code, so we only let
--    a caller join themselves."
--    ** OPEN QUESTION, CHECK BEFORE TREATING THIS AS FIXED: no migration
--    anywhere in this repo ever enabled RLS or added a policy on
--    event_members (grepped, zero hits, unlike 25+ other tables that do
--    have both). The real bypass if RLS is off is a RAW POSTGREST CALL
--    against the table's REST endpoint, not the client's own fallback code
--    (that fallback only fires on error 42883/"function does not exist";
--    after this migration an unauthorized RPC call gets 42501/"permission
--    denied" instead, so the client's own fallback branch never triggers --
--    the risk is a direct HTTP call to /rest/v1/event_members that never
--    goes through the RPC at all). Confirmed live write paths to this table
--    today, any of which need an equivalent RLS policy once RLS is turned
--    on or plan-creation/joining/leaving will start silently failing:
--      - WashedUp/app/plan/[id].tsx:1002-1010 (native, join fallback)
--      - washedup-web/src/app/app/plan/[id]/page.tsx:911-932 (web, join fallback)
--      - WashedUp/app/plan/[id].tsx:1112 (native, leave -- UPDATE status='left')
--      - washedup-web/src/app/app/plan/[id]/page.tsx:339 (web, leave -- same)
--      - washedup-web/src/app/app/create/page.tsx:850,855 (web, publish --
--        INSERT with a retry, this is the real plan-creation write; line 995
--        cited in an earlier draft of this comment is only the draft-save
--        path, not the publish path)
--      - WashedUp/components/post/PlanComposerV2.tsx:799-810 (native, plan
--        creation -- this is the LIVE composer per YOURS_PAGE_ENABLED in
--        app/(tabs)/post/index.tsx; components/post/LegacyComposer.tsx has
--        the same pattern but is dead code, confirmed unreachable by a
--        separate sweep the same night, and does not need a policy)
--    The DO block below asserts this at apply time (RAISE WARNING, not
--    EXCEPTION -- it still lands the fix, but no `supabase db push` run can
--    silently miss it the way a comment can). If it fires, event_members
--    needs real RLS + policies as its own follow-up (a bigger, separate
--    change covering all six paths above -- not guessed at here).
-- 2. get_user_moments — MEDIUM. Any caller can read every private plan
--    reflection (incl. is_public=false) any real user has ever written,
--    across their entire event history, just by passing their uuid. Not
--    called by the shipped client, but live and directly callable via the
--    anon key against PostgREST.
-- 3. search_users_by_handle — LOW. p_user_id is used to filter by THAT
--    user's block list, not the caller's own, so a caller can pass a
--    different real uuid to see search results as if they were never
--    blocked by that profile. Name + photo only, no messaging bypass.
-- 4. get_filtered_feed — LOW as a direct read, but the real gap here is
--    STRUCTURAL: this function has TWO live overloads. The one-arg version
--    (p_user_id uuid), created at 20260504000002_get_filtered_feed_drop_in.sql
--    with no matching DROP first (every other CREATE OR REPLACE in this
--    function's history pairs a DROP with it; this is the one exception),
--    was never dropped by anything after it and still has no auth.uid()
--    check and no REVOKE -- hardening only the four-arg signature (added
--    later, a separate overload, does not replace the one-arg) leaves the
--    one-arg fully exposed. This is not dormant: washedup-web/src/app/app/
--    feed/page.tsx:400 calls it with only p_user_id, and WashedUp/lib/
--    fetchPlans.ts:109-114 omits the geo params outside Near-me, so
--    PostgREST resolves both default-feed paths to the vulnerable one-arg
--    overload. Every real client call that DOES pass all four args passes
--    its own id, so nothing server-side enforced it either way -- an
--    inference leak of the caller's real age bracket, gender, and blocks,
--    plus a way to dodge plans hidden by their OWN blocks.
--    Fixed below by dropping the one-arg overload outright (behavior-safe:
--    a one-arg-shaped call then resolves to the four-arg version with NULL
--    geo defaults, which already handles NULL lat/lng/radius by skipping
--    every geo filter and ORDER BY clause -- same rows, same order, the
--    response just gains a null distance_km). The self-test below asserts
--    the one-arg overload is actually gone, not just that the four-arg one
--    has the guard -- the first version of this self-test only checked the
--    hardened signature and would have reported green with this gap open.
--
-- All four get the same fix: an auth.uid() identity check at the top of
-- the function body, plus REVOKE/GRANT matching this repo's own convention
-- (join_circle_plan_atomic, create_circle, get_or_create_dm, etc. all
-- already do this; these four never got it).
--
-- Ship as a new forward migration (CREATE OR REPLACE) per this repo's
-- convention — never hand-edit an already-applied migration file in place.

BEGIN;

-- ── 1. join_event_atomic ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION join_event_atomic(
  p_event_id uuid,
  p_user_id uuid,
  p_age_at_join int DEFAULT NULL,
  p_gender_at_join text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_member_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'can only join as yourself';
  END IF;

  -- Lock the event row to prevent concurrent updates
  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;

  IF v_event IS NULL THEN
    RETURN 'not_found';
  END IF;

  IF v_event.status = 'full' THEN
    RETURN 'full';
  END IF;

  -- Re-check actual member count inside the transaction
  SELECT count(*)::int INTO v_member_count
  FROM event_members
  WHERE event_id = p_event_id AND status = 'joined';

  -- Capacity = max_invites + 1 (creator counts as a member in event_members)
  IF v_member_count > COALESCE(v_event.max_invites, 7) THEN
    UPDATE events SET status = 'full' WHERE id = p_event_id;
    RETURN 'full';
  END IF;

  -- Insert or update the member (re-join if previously left)
  UPDATE event_members
  SET status = 'joined', role = 'guest',
      age_at_join = COALESCE(p_age_at_join, age_at_join),
      gender_at_join = COALESCE(p_gender_at_join, gender_at_join)
  WHERE event_id = p_event_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO event_members (event_id, user_id, role, status, age_at_join, gender_at_join)
    VALUES (p_event_id, p_user_id, 'guest', 'joined', p_age_at_join, p_gender_at_join);
  END IF;

  -- If the plan is now full, update its status
  IF (v_member_count + 1) > COALESCE(v_event.max_invites, 7) THEN
    UPDATE events SET status = 'full' WHERE id = p_event_id;
  END IF;

  RETURN 'joined';
END;
$$;

REVOKE ALL ON FUNCTION join_event_atomic(uuid, uuid, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION join_event_atomic(uuid, uuid, int, text) TO authenticated;

-- ── 2. get_user_moments ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_user_moments(p_user_id uuid)
RETURNS TABLE(
  moment_id uuid,
  event_id uuid,
  user_id uuid,
  content text,
  created_at timestamptz,
  is_public boolean,
  writer_name text,
  writer_photo text,
  plan_title text,
  plan_date timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    pm.id AS moment_id,
    pm.event_id,
    pm.user_id,
    pm.content,
    pm.created_at,
    pm.is_public,
    p.first_name_display AS writer_name,
    p.profile_photo_url AS writer_photo,
    e.title AS plan_title,
    e.start_time AS plan_date
  FROM plan_moments pm
  JOIN events e ON e.id = pm.event_id
  JOIN profiles p ON p.id = pm.user_id
  JOIN event_members em ON em.event_id = pm.event_id
    AND em.user_id = p_user_id
    AND em.status = 'joined'
  WHERE NOT EXISTS (
    SELECT 1 FROM plan_attendance pa
    WHERE pa.event_id = pm.event_id
      AND pa.user_id = p_user_id
      AND pa.was_present = false
  )
  ORDER BY pm.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION get_user_moments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_user_moments(uuid) TO authenticated;

-- ── 3. search_users_by_handle ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION search_users_by_handle(p_query text, p_user_id uuid)
RETURNS TABLE(id uuid, first_name_display text, profile_photo_url text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT p.id, p.first_name_display, p.profile_photo_url
  FROM profiles p
  WHERE p.handle ILIKE '%' || p_query || '%'
    AND p.id != p_user_id
    AND p.onboarding_status = 'complete'
    AND NOT (p_user_id = ANY(COALESCE(p.blocked_users, ARRAY[]::UUID[])))
  LIMIT 20;
END;
$$;

REVOKE ALL ON FUNCTION search_users_by_handle(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION search_users_by_handle(text, uuid) TO authenticated;

-- ── 4. get_filtered_feed ────────────────────────────────────────────────
-- Reproduces the live prod body verbatim (per 20260609140300's own dump
-- comment) with only the identity guard added. Business logic untouched.

CREATE OR REPLACE FUNCTION public.get_filtered_feed(
  p_user_id uuid,
  p_lat numeric DEFAULT NULL::numeric,
  p_lng numeric DEFAULT NULL::numeric,
  p_radius_km numeric DEFAULT NULL::numeric
)
 RETURNS TABLE(id uuid, title text, description text, location_text text, location_lat numeric, location_lng numeric, start_time timestamp with time zone, status text, member_count integer, max_invites integer, primary_vibe text, gender_rule text, target_age_min integer, target_age_max integer, host_id uuid, host_name text, host_photo text, host_age_group text, spots_remaining integer, city text, host_message text, image_url text, slug text, neighborhood text, is_featured boolean, cluster_root_id uuid, distance_km double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_gender gender_type; v_user_age INTEGER; v_user_vibes TEXT[]; v_user_city TEXT; v_blocked_users UUID[];
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT p.gender, calculate_age(p.birthday), p.vibe_tags, p.city, p.blocked_users
  INTO v_user_gender, v_user_age, v_user_vibes, v_user_city, v_blocked_users
  FROM profiles p WHERE p.id = p_user_id;
  RETURN QUERY
  WITH mutual_blocks AS (
    SELECT bp.id AS blocked_id FROM profiles bp WHERE p_user_id = ANY(bp.blocked_users)
    UNION SELECT unnest(COALESCE(v_blocked_users, ARRAY[]::UUID[])) AS blocked_id
  ),
  raw AS (
    SELECT e.id, e.title, e.description, e.location_text, e.location_lat, e.location_lng, e.start_time,
      e.status::text AS status, e.member_count, e.max_invites, e.primary_vibe, e.gender_rule::text AS gender_rule,
      e.target_age_min, e.target_age_max, pp.id AS host_id, pp.first_name_display AS host_name,
      pp.profile_photo_url AS host_photo, pp.age_group AS host_age_group,
      -- circle plans report remaining STRANGER spots; normal plans unchanged.
      CASE WHEN e.circle_id IS NOT NULL THEN
        GREATEST(0, COALESCE(e.stranger_cap, 0) - (
          SELECT count(*)::int FROM event_members em2
          WHERE em2.event_id = e.id AND em2.status = 'joined'
            AND NOT public.is_circle_member(e.circle_id, em2.user_id)
        ))::INTEGER
      ELSE (e.max_invites + 1 - e.member_count)::INTEGER END AS spots_remaining,
      e.city, e.host_message, e.image_url,
      e.slug, e.neighborhood, e.is_featured, get_event_root(e.id) AS raw_root_id,
      CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL AND e.location_lat IS NOT NULL AND e.location_lng IS NOT NULL
        THEN 2 * 6371 * asin(sqrt(power(sin(radians(e.location_lat - p_lat)/2),2) + cos(radians(p_lat))*cos(radians(e.location_lat))*power(sin(radians(e.location_lng - p_lng)/2),2)))
        ELSE NULL END AS distance_km
    FROM events e JOIN profiles_public pp ON e.creator_user_id = pp.id
    WHERE e.status IN ('forming','active','full')
      AND COALESCE(e.end_time, e.start_time + INTERVAL '3 hours') > NOW()
      AND (COALESCE(e.drop_in, true) = true OR e.start_time > NOW())
      AND e.creator_user_id NOT IN (SELECT blocked_id FROM mutual_blocks)
      AND NOT EXISTS (SELECT 1 FROM event_members em WHERE em.event_id = e.id AND em.status='joined' AND em.user_id IN (SELECT blocked_id FROM mutual_blocks))
      AND NOT EXISTS (SELECT 1 FROM event_waitlist ew WHERE ew.event_id = e.id AND ew.user_id IN (SELECT blocked_id FROM mutual_blocks))
      AND NOT EXISTS (SELECT 1 FROM event_members em WHERE em.event_id = e.id AND em.user_id = p_user_id AND em.role='guest' AND em.status='joined')
      AND (e.gender_rule='mixed' OR (e.gender_rule='women_only' AND v_user_gender='woman') OR (e.gender_rule='men_only' AND v_user_gender='man') OR (e.gender_rule='nonbinary_only' AND v_user_gender='non_binary'))
      AND (e.target_age_min IS NULL OR v_user_age >= e.target_age_min)
      AND (e.target_age_max IS NULL OR v_user_age <= e.target_age_max)
      -- include open circle plans, drop circle_only from the public feed.
      AND (e.circle_id IS NULL OR e.circle_visibility = 'open')
      -- a circle's own members never see its plan in the public feed.
      AND NOT (e.circle_id IS NOT NULL AND public.is_circle_member(e.circle_id, p_user_id))
  ),
  visible AS (
    SELECT * FROM raw r
    WHERE p_radius_km IS NULL OR p_lat IS NULL OR p_lng IS NULL
       OR (r.distance_km IS NOT NULL AND r.distance_km <= p_radius_km)
  )
  SELECT v.id, v.title, v.description, v.location_text, v.location_lat, v.location_lng, v.start_time,
    v.status, v.member_count, v.max_invites, v.primary_vibe, v.gender_rule, v.target_age_min, v.target_age_max,
    v.host_id, v.host_name, v.host_photo, v.host_age_group, v.spots_remaining, v.city, v.host_message, v.image_url,
    v.slug, v.neighborhood, v.is_featured,
    CASE WHEN COUNT(*) OVER (PARTITION BY v.raw_root_id) >= 2 THEN v.raw_root_id ELSE NULL END AS cluster_root_id,
    v.distance_km
  FROM visible v
  ORDER BY
    CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL AND v.distance_km IS NULL THEN 1 ELSE 0 END ASC,
    CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL AND p_radius_km IS NOT NULL AND v.is_featured THEN 0 ELSE 1 END ASC,
    CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL THEN v.distance_km END ASC NULLS LAST,
    v.start_time ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_filtered_feed(uuid, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_filtered_feed(uuid, numeric, numeric, numeric) TO authenticated;

-- Drop the un-hardened one-arg overload -- see the header comment above for
-- why this is behavior-safe (a one-arg-shaped call resolves to the four-arg
-- version with NULL geo defaults, same rows/order, response gains a null
-- distance_km).
DROP FUNCTION IF EXISTS public.get_filtered_feed(uuid);

-- ---------------------------------------------------------------------------
-- Self-test.
--   1. ACL: anon must not hold EXECUTE on any of the four functions. Hard
--      assertion (RAISE EXCEPTION) -- if this fails, the fix did not land.
--   2. RLS flag: event_members must have RLS enabled, RAISE WARNING (not
--      EXCEPTION) if not -- this ships loud on every apply/CI run instead of
--      depending on someone reading the header comment. Does not block the
--      fix above from landing, since event_members' RLS status is a
--      separate, larger follow-up (see header).
--   3. Positive: a real user calling each function AS THEMSELVES still
--      works (regression guard). Wrapped so an UNRELATED failure (a bad
--      profile row, bad data) only RAISE WARNINGs -- it should not roll
--      back the security fix above just because some other row is broken.
--   4. Negative: calling with a MISMATCHED p_user_id must raise the EXACT
--      guard message, not just "any error" (a coincidental unrelated
--      failure must not read as the guard working). Hard assertion.
--      join_event_atomic's guard runs before its first table touch (the
--      SELECT ... FOR UPDATE), so exercising the negative case here has no
--      write side effect; the all-zeros event_id is never read or locked.
--   5. Overload: the one-arg get_filtered_feed(uuid) must actually be gone,
--      not just absent from the ACL check above -- checking privileges on
--      only the four-arg signature is exactly how this migration's first
--      draft reported green while the un-hardened one-arg overload was
--      still live and still the one two real feed call sites resolve to.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_uid       uuid;
  v_other_uid uuid;
  v_n         integer;
  v_msg       text;
BEGIN
  IF has_function_privilege('anon', 'public.join_event_atomic(uuid,uuid,int,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_user_moments(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.search_users_by_handle(text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_filtered_feed(uuid,numeric,numeric,numeric)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'ACL check failed: anon still holds EXECUTE on one of the hardened functions';
  END IF;

  IF to_regprocedure('public.get_filtered_feed(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'get_filtered_feed(uuid) one-arg overload still exists -- the DROP above did not take, or something re-created it. This overload has no auth.uid() check and is what real feed calls actually resolve to.';
  END IF;

  IF NOT COALESCE(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.event_members'::regclass),
    false
  ) THEN
    RAISE WARNING 'event_members has RLS DISABLED: the join_event_atomic fix is bypassable via a direct PostgREST write to /rest/v1/event_members. See the four call sites named in this file''s header comment. Follow-up migration required.';
  END IF;

  -- Deterministic row pick (ORDER BY id, not an arbitrary LIMIT 1) so this
  -- self-test behaves the same on every apply.
  SELECT id INTO v_uid FROM public.profiles ORDER BY id LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE 'no profile available; skipping self-call smoke-tests (ACL + RLS checks above still ran)';
    RETURN;
  END IF;
  SELECT id INTO v_other_uid FROM public.profiles WHERE id <> v_uid ORDER BY id LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);

  BEGIN
    SELECT count(*) INTO v_n FROM public.get_user_moments(v_uid);
    RAISE NOTICE 'get_user_moments self-call returned % rows', v_n;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'get_user_moments self-call failed for an unrelated reason (not the guard): %', SQLERRM;
  END;

  BEGIN
    SELECT count(*) INTO v_n FROM public.search_users_by_handle('', v_uid);
    RAISE NOTICE 'search_users_by_handle self-call returned % rows', v_n;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'search_users_by_handle self-call failed for an unrelated reason (not the guard): %', SQLERRM;
  END;

  BEGIN
    SELECT count(*) INTO v_n FROM public.get_filtered_feed(v_uid, NULL, NULL, NULL);
    RAISE NOTICE 'get_filtered_feed self-call returned % rows', v_n;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'get_filtered_feed self-call failed for an unrelated reason (not the guard): %', SQLERRM;
  END;

  IF v_other_uid IS NULL THEN
    RAISE NOTICE 'only one profile exists; skipping negative (mismatched-uuid) tests';
  ELSE
    v_msg := NULL;
    BEGIN
      PERFORM public.get_user_moments(v_other_uid);
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
    IF v_msg IS DISTINCT FROM 'unauthorized' THEN
      RAISE EXCEPTION 'get_user_moments did not raise ''unauthorized'' for a mismatched p_user_id (got: %)', COALESCE(v_msg, 'no error');
    END IF;

    v_msg := NULL;
    BEGIN
      PERFORM public.search_users_by_handle('', v_other_uid);
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
    IF v_msg IS DISTINCT FROM 'unauthorized' THEN
      RAISE EXCEPTION 'search_users_by_handle did not raise ''unauthorized'' for a mismatched p_user_id (got: %)', COALESCE(v_msg, 'no error');
    END IF;

    v_msg := NULL;
    BEGIN
      PERFORM public.get_filtered_feed(v_other_uid, NULL, NULL, NULL);
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
    IF v_msg IS DISTINCT FROM 'unauthorized' THEN
      RAISE EXCEPTION 'get_filtered_feed did not raise ''unauthorized'' for a mismatched p_user_id (got: %)', COALESCE(v_msg, 'no error');
    END IF;

    -- join_event_atomic hits its SECOND guard clause here (auth.uid() IS
    -- NOT NULL, since v_uid is authenticated; p_user_id = v_other_uid IS
    -- DISTINCT FROM auth.uid()), which raises a different message than the
    -- other three.
    v_msg := NULL;
    BEGIN
      PERFORM public.join_event_atomic('00000000-0000-0000-0000-000000000000'::uuid, v_other_uid);
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
    IF v_msg IS DISTINCT FROM 'can only join as yourself' THEN
      RAISE EXCEPTION 'join_event_atomic did not raise ''can only join as yourself'' for a mismatched p_user_id (got: %)', COALESCE(v_msg, 'no error');
    END IF;

    RAISE NOTICE 'all negative (mismatched-uuid) assertions passed with exact-message matches';
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

COMMIT;
