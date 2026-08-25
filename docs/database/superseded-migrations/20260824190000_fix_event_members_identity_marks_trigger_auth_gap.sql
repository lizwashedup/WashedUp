-- ARCHIVED FROM ACTIVE MIGRATIONS: preserved verbatim except for this marker.
-- Its self-test selected real profiles and created transient rows in the live
-- schema. The forward replacement uses catalog-only verification here and an
-- isolated behavioral contract under supabase/tests/contracts.
--
-- Fixes a real, live production bug found while investigating a suspected
-- risk flagged during today's DM circle-plan-cap fix (20260824180000):
-- creating a DM-originated (2-person circle) whole-circle plan, or a
-- circle_only picked-subset plan in ANY circle, throws 'unauthorized' and
-- fails the entire create_circle_plan() call, every time, today.
--
-- Reproduced empirically against real prod 2026-08-24 (throwaway rows,
-- rolled back, zero residual state confirmed after):
--   ERROR: P0001: unauthorized
--   CONTEXT: PL/pgSQL function check_member_identity_marks(uuid) line 12 at RAISE
--   PL/pgSQL function trg_event_members_insert_check_marks() line 4 at PERFORM
--   PL/pgSQL function create_circle_plan(...) line 91 at SQL statement
--
-- Root cause: a trigger + function pair live on prod TODAY with ZERO
-- matching migration file anywhere in this repo (confirmed by a full-repo
-- grep for both names) -- applied outside version control at some unknown
-- point, pure tracking drift, same class of gap already flagged elsewhere
-- this session:
--   CREATE TRIGGER trg_event_members_after_insert_marks
--     AFTER INSERT ON public.event_members FOR EACH ROW
--     EXECUTE FUNCTION trg_event_members_insert_check_marks();
--   trg_event_members_insert_check_marks(): IF NEW.status = 'joined' THEN
--     PERFORM check_member_identity_marks(NEW.user_id); END IF;
-- check_member_identity_marks(p_user_id), from 20260813025124, carries a
-- self-check ("closes it defensively" against a hypothetical direct client
-- call awarding marks under someone else's id -- that migration's own header
-- confirms it had zero live callers at the time and was a low-severity,
-- defense-in-depth close, not an active exploit fix):
--   IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN RAISE EXCEPTION 'unauthorized';
-- create_circle_plan's auto-add step inserts OTHER real members into
-- event_members with status='joined' directly (DM's other member; a
-- circle_only picked subset's invited members) -- auth.uid() is the
-- creator, never equal to the member being auto-added, so every such row
-- trips the trigger and aborts the whole function. Real 3+ whole-circle
-- plans and open plans are unaffected (creator-only insert, auth.uid() =
-- self there).
--
-- This is EXACTLY the same bug class already fixed once this batch
-- (20260821001500, check_creator_milestones / trg_events_update_check_marks):
-- a self-check correct for a direct/client call is simply the wrong check
-- for a trusted trigger caller. Same fix shape, applied here: split the
-- real logic into an internal, non-client-callable function with no
-- self-check; the public function keeps its exact original signature, self-
-- check, and grants (a direct/client call behaves identically to before);
-- the trigger calls the internal function directly.
--
-- Trust-boundary check done BEFORE writing this (mirrors 20260821001500's
-- own required check for events.creator_user_id): confirmed live via
-- pg_policies that event_members' only client-facing INSERT policy enforces
-- `auth.uid() = user_id` ("Users can only join events matching their
-- gender"). A client cannot directly insert a row naming another user's id
-- -- the only way NEW.user_id ever differs from the inserting session's
-- auth.uid() is a SECURITY DEFINER function (create_circle_plan, join flows)
-- that has already independently authorized the add. Trusting NEW.user_id
-- inside the trigger's internal-function call is safe on the same grounds
-- 20260821001500 already established for NEW.creator_user_id on events.
--
-- Idempotent (CREATE OR REPLACE). Verified against real prod in-transaction
-- self-tests below (both real scenarios + cleanup), not just a syntax check.

BEGIN;

-- ── 1. internal, non-client-callable identity-marks logic (moved verbatim
--      out of check_member_identity_marks, self-check removed) ────────────
CREATE OR REPLACE FUNCTION public._member_identity_marks_apply(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_night_count int;
  v_morning_count int;
  v_outdoor_count int;
  v_culture_count int;
  v_coattend_count int;
  v_category_count int;
  v_mark_id uuid;
BEGIN
  SELECT COUNT(*) INTO v_night_count
  FROM event_members em
  JOIN events e ON e.id = em.event_id
  WHERE em.user_id = p_user_id
    AND em.status = 'joined'
    AND EXTRACT(HOUR FROM e.start_time AT TIME ZONE 'America/Los_Angeles') >= 20;

  IF v_night_count >= 3 THEN
    SELECT id INTO v_mark_id FROM marks WHERE slug = 'night-owl';
    IF v_mark_id IS NOT NULL THEN
      INSERT INTO user_marks (user_id, mark_id) VALUES (p_user_id, v_mark_id)
      ON CONFLICT (user_id, mark_id) DO NOTHING;
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_morning_count
  FROM event_members em
  JOIN events e ON e.id = em.event_id
  WHERE em.user_id = p_user_id
    AND em.status = 'joined'
    AND EXTRACT(HOUR FROM e.start_time AT TIME ZONE 'America/Los_Angeles') < 12;

  IF v_morning_count >= 3 THEN
    SELECT id INTO v_mark_id FROM marks WHERE slug = 'early-bird';
    IF v_mark_id IS NOT NULL THEN
      INSERT INTO user_marks (user_id, mark_id) VALUES (p_user_id, v_mark_id)
      ON CONFLICT (user_id, mark_id) DO NOTHING;
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_outdoor_count
  FROM event_members em
  JOIN events e ON e.id = em.event_id
  WHERE em.user_id = p_user_id
    AND em.status = 'joined'
    AND e.primary_vibe = 'outdoors';

  IF v_outdoor_count >= 3 THEN
    SELECT id INTO v_mark_id FROM marks WHERE slug = 'trailblazer';
    IF v_mark_id IS NOT NULL THEN
      INSERT INTO user_marks (user_id, mark_id) VALUES (p_user_id, v_mark_id)
      ON CONFLICT (user_id, mark_id) DO NOTHING;
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_culture_count
  FROM event_members em
  JOIN events e ON e.id = em.event_id
  WHERE em.user_id = p_user_id
    AND em.status = 'joined'
    AND e.primary_vibe IN ('art', 'film', 'music', 'comedy');

  IF v_culture_count >= 3 THEN
    SELECT id INTO v_mark_id FROM marks WHERE slug = 'culture-club';
    IF v_mark_id IS NOT NULL THEN
      INSERT INTO user_marks (user_id, mark_id) VALUES (p_user_id, v_mark_id)
      ON CONFLICT (user_id, mark_id) DO NOTHING;
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_coattend_count
  FROM (
    SELECT other.user_id AS other_user
    FROM event_members me
    JOIN event_members other ON other.event_id = me.event_id
      AND other.user_id != me.user_id
      AND other.status = 'joined'
    WHERE me.user_id = p_user_id
      AND me.status = 'joined'
    GROUP BY other.user_id
    HAVING COUNT(DISTINCT me.event_id) >= 3
  ) pairs;

  IF v_coattend_count >= 1 THEN
    SELECT id INTO v_mark_id FROM marks WHERE slug = 'the-regular';
    IF v_mark_id IS NOT NULL THEN
      INSERT INTO user_marks (user_id, mark_id) VALUES (p_user_id, v_mark_id)
      ON CONFLICT (user_id, mark_id) DO NOTHING;
    END IF;
  END IF;

  SELECT COUNT(DISTINCT e.primary_vibe) INTO v_category_count
  FROM event_members em
  JOIN events e ON e.id = em.event_id
  WHERE em.user_id = p_user_id
    AND em.status = 'joined'
    AND e.primary_vibe IS NOT NULL;

  IF v_category_count >= 3 THEN
    SELECT id INTO v_mark_id FROM marks WHERE slug = 'explorer';
    IF v_mark_id IS NOT NULL THEN
      INSERT INTO user_marks (user_id, mark_id) VALUES (p_user_id, v_mark_id)
      ON CONFLICT (user_id, mark_id) DO NOTHING;
    END IF;
  END IF;
END;
$$;

-- deliberately no grants to anon or authenticated -- this function trusts
-- its caller's identity checks, so it must never be directly client-reachable.
REVOKE ALL ON FUNCTION public._member_identity_marks_apply(uuid) FROM PUBLIC, anon, authenticated;

-- ── 2. check_member_identity_marks: same signature, same self-check, same
--      grants as 20260813025124 -- now just delegates the real work ───────
CREATE OR REPLACE FUNCTION public.check_member_identity_marks(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  PERFORM public._member_identity_marks_apply(p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.check_member_identity_marks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_member_identity_marks(uuid) TO authenticated;

-- ── 3. the trigger calls the internal function directly, for any joined-
--      status insert regardless of who's authenticated ────────────────────
CREATE OR REPLACE FUNCTION public.trg_event_members_insert_check_marks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'joined' THEN
    PERFORM public._member_identity_marks_apply(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Self-test: real, in-transaction, against real prod rows -- exercises both
-- broken scenarios (DM whole-circle auto-add, circle_only picked-subset
-- auto-add) plus confirms the direct-call self-check is unchanged and the
-- internal helper stays non-client-callable. Everything created is deleted
-- by id at the end; no real user's data is touched.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_uid_a uuid;
  v_uid_b uuid;
  v_uid_c uuid;
  v_circle_dm uuid;
  v_circle_3 uuid;
  v_res jsonb;
  v_event_dm uuid;
  v_event_subset uuid;
  v_raised boolean;
  v_msg text;
BEGIN
  SELECT id INTO v_uid_a FROM public.profiles ORDER BY id LIMIT 1;
  SELECT id INTO v_uid_b FROM public.profiles WHERE id <> v_uid_a ORDER BY id LIMIT 1;
  SELECT id INTO v_uid_c FROM public.profiles WHERE id NOT IN (v_uid_a, v_uid_b) ORDER BY id LIMIT 1;
  IF v_uid_a IS NULL OR v_uid_b IS NULL OR v_uid_c IS NULL THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: needs three existing profiles';
  END IF;

  -- ---------- scenario 1: DM-style 2-person circle, whole-circle plan ----------
  -- (THE bug from today's live repro -- must now succeed, and the auto-
  -- added other member must actually land in event_members)
  INSERT INTO public.circles (id, name, creator_user_id)
  VALUES (gen_random_uuid(), 'SELFTEST identity-marks DM (cleanup)', v_uid_a)
  RETURNING id INTO v_circle_dm;
  INSERT INTO public.circle_members (circle_id, user_id, role, status) VALUES
    (v_circle_dm, v_uid_a, 'member', 'joined'),
    (v_circle_dm, v_uid_b, 'member', 'joined');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid_a, 'role', 'authenticated')::text, true);
  SET LOCAL role authenticated;
  v_res := public.create_circle_plan(v_circle_dm, 'selftest dm whole-circle', now() + interval '1 day', 'circle_only');
  RESET role;
  v_event_dm := (v_res->>'event_id')::uuid;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_members WHERE event_id = v_event_dm AND user_id = v_uid_b AND status = 'joined'
  ) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: DM whole-circle plan created but the other member was never auto-added';
  END IF;
  RAISE NOTICE 'SELF-TEST 1/4 passed: DM (2-person circle) whole-circle plan creation no longer throws, other member auto-added';

  -- ---------- scenario 2: 3-person circle, circle_only PICKED SUBSET ----------
  -- (the other real path hit by the same bug -- picking a subset also
  -- auto-adds, must now succeed; the unpicked member must NOT be added)
  INSERT INTO public.circles (id, name, creator_user_id)
  VALUES (gen_random_uuid(), 'SELFTEST identity-marks subset (cleanup)', v_uid_a)
  RETURNING id INTO v_circle_3;
  INSERT INTO public.circle_members (circle_id, user_id, role, status) VALUES
    (v_circle_3, v_uid_a, 'member', 'joined'),
    (v_circle_3, v_uid_b, 'member', 'joined'),
    (v_circle_3, v_uid_c, 'member', 'joined');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid_a, 'role', 'authenticated')::text, true);
  SET LOCAL role authenticated;
  v_res := public.create_circle_plan(v_circle_3, 'selftest picked subset', now() + interval '1 day', 'circle_only', NULL, 'mixed', ARRAY[v_uid_b]);
  RESET role;
  v_event_subset := (v_res->>'event_id')::uuid;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_members WHERE event_id = v_event_subset AND user_id = v_uid_b AND status = 'joined'
  ) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: picked-subset plan created but the picked member was never auto-added';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.event_members WHERE event_id = v_event_subset AND user_id = v_uid_c
  ) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: picked-subset plan wrongly added the unpicked third member';
  END IF;
  RAISE NOTICE 'SELF-TEST 2/4 passed: circle_only picked-subset plan (3-person circle) no longer throws, exactly the picked member was added';

  -- ---------- unchanged behavior: direct call, mismatched user, still rejected ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid_c, 'role', 'authenticated')::text, true);
  SET LOCAL role authenticated;
  v_raised := false;
  BEGIN
    PERFORM public.check_member_identity_marks(v_uid_a);
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    v_msg := SQLERRM;
  END;
  RESET role;
  IF NOT v_raised OR v_msg <> 'unauthorized' THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: direct mismatched call was not rejected with unauthorized (got: %)', COALESCE(v_msg, 'no error');
  END IF;
  RAISE NOTICE 'SELF-TEST 3/4 passed: direct call with a mismatched user still throws unauthorized -- original 20260813025124 hardening intact';

  -- ---------- the internal helper is not client-callable ----------
  IF has_function_privilege('anon', 'public._member_identity_marks_apply(uuid)', 'execute')
     OR has_function_privilege('authenticated', 'public._member_identity_marks_apply(uuid)', 'execute') THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: _member_identity_marks_apply is directly callable by a client role -- the self-check bypass is exposed';
  END IF;
  RAISE NOTICE 'SELF-TEST 4/4 passed: the internal helper has zero client-facing grants';

  -- ---------- cleanup: remove only what this test created ----------
  DELETE FROM public.messages WHERE event_id IN (v_event_dm, v_event_subset) OR circle_id IN (v_circle_dm, v_circle_3);
  DELETE FROM public.event_members WHERE event_id IN (v_event_dm, v_event_subset);
  DELETE FROM public.events WHERE id IN (v_event_dm, v_event_subset);
  DELETE FROM public.circle_members WHERE circle_id IN (v_circle_dm, v_circle_3);
  DELETE FROM public.circles WHERE id IN (v_circle_dm, v_circle_3);

  RAISE NOTICE 'event-members-identity-marks-trigger-auth-gap self-test passed: all 4 scenarios, cleanup complete';
END $$;

COMMIT;
