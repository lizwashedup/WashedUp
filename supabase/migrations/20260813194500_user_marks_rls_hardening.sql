-- Security hardening: public.user_marks (user_id + earned badge/mark rows)
-- has a leftover permissive SELECT policy that lets anon enumerate every
-- real user_id in the system plus their earned badges. Confirmed live, not
-- inferred:
--
--   washedup-schema-dump.sql:17809 (pg_dump of the live project, captured
--   earlier this session):
--     CREATE POLICY "user_marks_read_all" ON "public"."user_marks"
--       FOR SELECT USING (true);
--   -- sitting four lines above the policy that was clearly meant to be the
--   -- only one:
--   washedup-schema-dump.sql:17813:
--     CREATE POLICY "user_marks_read_own" ON "public"."user_marks"
--       FOR SELECT USING (("auth"."uid"() = "user_id"));
--
-- Postgres OR's multiple permissive policies for the same command together,
-- so read_all's unconditional `true` silently wins over read_own no matter
-- how correct read_own is. Live anon-key probe confirms the real-world
-- effect (wu_anon_probe.txt:144, captured earlier this session): a plain
-- anon-key GET against /rest/v1/user_marks returns 200 with real rows,
-- e.g. `{"id":"b5ba4bc1-...","user_id":"50d57fb7-...","mark_id":"98071f65-...`.
-- Matches WASHEDUP-CANONICAL-MAP-20260813.md's flagged finding (section 3 +
-- 6): "user_marks anon-readable -- enumerates active user_ids + earned
-- badges." Same bug shape (a `USING (true)` policy sitting on a table whose
-- name implies it should be scoped) as event_members's live
-- "Authenticated users can view event members" policy -- FOR SELECT USING
-- (true), no TO clause, so despite the name it is not actually restricted
-- to authenticated (washedup-schema-dump.sql:16471) -- not touched here,
-- separate finding/migration, noted only because it confirms this is a
-- systemic pattern in this project, not a one-off.
--
-- Real client-side access pattern (grepped, not guessed -- exhaustive
-- search across all four repos, incl. edge functions, for every
-- `.from('user_marks')` / `user_marks` reference):
--   WashedUp/components/marks/MarkEarnedModal.tsx and
--   washedup-web/src/components/app/marks/MarkEarnedModal.tsx are the ONLY
--   two direct table call sites anywhere. Both:
--     - SELECT id, mark_id, seen, marks!inner(...) WHERE user_id = userId
--       AND seen = false -- `userId` is the `<MarkEarnedModal userId={...}>`
--       prop, populated on both platforms exclusively from the caller's own
--       authenticated session (native: `authedUserId`, set only from
--       `session.user.id` in every auth-state-change handler,
--       app/_layout.tsx; web: `user.id` from a server-side
--       `supabase.auth.getUser()` call, src/app/app/layout.tsx). Neither
--       ever passes another user's id.
--     - UPDATE user_marks SET seen = true WHERE id = current.id (marking
--       your own just-shown mark as seen).
--   Real legitimate DIRECT-table access is 100% self-only, and the two
--   pre-existing policies already enforce exactly that (user_marks_read_own,
--   user_marks_update_own, both `USING (auth.uid() = user_id)`) -- this
--   migration does not touch either one, they were already correct.
--
-- Cross-user badge display (profile cards, plan-creator badges) is real and
-- intentional -- WashedUp/components/MiniProfileCard.tsx,
-- WashedUp/lib/creatorMarks.ts, and washedup-web's
-- MiniProfileCard.tsx/PlanCard.tsx/MyPlansView.tsx all call
-- get_user_profile_marks(p_user_id) / get_creator_milestone_marks(p_user_ids)
-- to show OTHER users' earned marks on their own cards. 20260813025124
-- (lines 10-18) already found this and deliberately did not add a
-- self-guard, calling that a false positive that "would break real
-- features, not fix a bug." This migration does not touch either RPC.
-- Confirmed safe against RLS, not assumed: both are
-- `LANGUAGE plpgsql SECURITY DEFINER`, owned by `postgres` (same role that
-- owns user_marks itself), in the live dump --
--   washedup-schema-dump.sql:3816 (get_creator_milestone_marks) and
--   washedup-schema-dump.sql:5427 (get_user_profile_marks).
-- Table owners bypass RLS by default in Postgres, and user_marks has no
-- FORCE ROW LEVEL SECURITY (checked: absent from the dump), so a
-- SECURITY DEFINER function owned by the table's own owner reads every row
-- regardless of any policy on the table -- exactly how this schema's other
-- cross-user RPCs already read RLS-protected tables today (e.g.
-- get_people_with_plan_history / get_pending_invites / get_featured_eligible_ids
-- all read `profiles`, which has real enforced RLS, the same way). The
-- self-test below still hard-asserts prosecdef live rather than trusting
-- this comment, in case of drift between the dump's capture time and
-- whenever this migration actually applies.
--
-- Fix, minimal diff against real live state:
--   1. Drop the one bad policy (user_marks_read_all). The two correct
--      policies (read_own, update_own) and the insert-blocking policy
--      (user_marks_insert_service, WITH CHECK false -- inserts only ever
--      happen via the SECURITY DEFINER milestone/identity-mark functions,
--      which bypass RLS as owner the same way the two read RPCs do) are
--      untouched.
--   2. Tighten the table-level grants as defense in depth. Live grants
--      before this migration (washedup-schema-dump.sql:20366-20367) are the
--      same systemic ALTER DEFAULT PRIVILEGES leak already diagnosed and
--      fixed for other tables tonight (stripe_customers_revoke_hardening,
--      audit_security_hardening): anon and authenticated both hold
--      SELECT, INSERT, REFERENCES, DELETE, TRIGGER, MAINTAIN, UPDATE on the
--      raw table, none of which anon has any legitimate use for (zero call
--      sites), and authenticated only legitimately needs SELECT + UPDATE
--      (matching its two real policies -- INSERT is already permanently
--      blocked by insert_service's WITH CHECK(false) and there is no DELETE
--      policy at all, so both are already RLS-denied for every role
--      regardless of the grant, but the grant itself is tightened too so a
--      future accidental permissive policy is not the only thing standing
--      between anon/authenticated and the rest of this table's privileges).

BEGIN;

DROP POLICY IF EXISTS "user_marks_read_all" ON public.user_marks;

REVOKE ALL ON TABLE public.user_marks FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.user_marks TO authenticated;

-- ---------------------------------------------------------------------------
-- Self-test.
--   1. Load-bearing assumption (hard EXCEPTION, checked first): both
--      profile-marks RPCs must still be SECURITY DEFINER, or this fix's
--      core premise (they bypass RLS as the table owner, so tightening
--      user_marks RLS cannot break the cross-user badge-display feature)
--      is false and applying this migration would ship a silent regression.
--   2. Structural: the bad policy is gone; the two good policies are still
--      present with the right command; anon holds no grant at all;
--      authenticated holds exactly SELECT + UPDATE, nothing more. Hard
--      assertions.
--   3. Behavioral (real `SET LOCAL ROLE` + real JWT claim, not just catalog
--      introspection -- same technique as 20260713224144's probes): a real
--      authenticated user can still SELECT their own row(s); a real
--      authenticated user can no longer SELECT a different real user's
--      row(s) -- this is the actual bug, verified closed, not just assumed
--      closed. Skipped with a NOTICE (not a failure) if user_marks does not
--      currently hold rows for at least two distinct users to probe with.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad_fn     text;
  v_n_ups      int;
  v_n_gcmm     int;
  v_bad_grant  int;
  v_policy_n   int;
  v_uid        uuid;
  v_other_uid  uuid;
  v_n          int;
BEGIN
  -- 1a. Both RPCs must exist live (real shipped client code calls both).
  SELECT count(*) INTO v_n_ups FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_user_profile_marks';
  SELECT count(*) INTO v_n_gcmm FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_creator_milestone_marks';
  IF v_n_ups = 0 THEN
    RAISE WARNING 'get_user_profile_marks not found live -- cannot verify its SECURITY DEFINER status. Real client code calls this RPC (MiniProfileCard.tsx in both repos), so a missing function is unexpected independent of this migration.';
  END IF;
  IF v_n_gcmm = 0 THEN
    RAISE WARNING 'get_creator_milestone_marks not found live -- cannot verify its SECURITY DEFINER status. Real client code calls this RPC (lib/creatorMarks.ts, PlanCard.tsx, MyPlansView.tsx), so a missing function is unexpected independent of this migration.';
  END IF;

  -- 1b. If either exists, it MUST be SECURITY DEFINER or this fix breaks a
  --     live feature. Fail closed (whole migration rolls back).
  SELECT p.proname INTO v_bad_fn
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('get_user_profile_marks', 'get_creator_milestone_marks')
    AND p.prosecdef = false
  LIMIT 1;
  IF v_bad_fn IS NOT NULL THEN
    RAISE EXCEPTION 'user_marks RLS fix assumption violated: % is NOT SECURITY DEFINER. The tightened RLS on user_marks will block this function''s cross-user badge reads. Do not apply this migration as-is -- rewrite % as SECURITY DEFINER first (matching every other cross-user-read RPC in this schema), or add an explicit RLS exception for it.', v_bad_fn, v_bad_fn;
  END IF;

  -- 2. Structural checks
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_marks'
      AND policyname = 'user_marks_read_all'
  ) THEN
    RAISE EXCEPTION 'self-test: user_marks_read_all still exists -- the DROP above did not take';
  END IF;

  SELECT count(*) INTO v_policy_n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'user_marks'
    AND policyname = 'user_marks_read_own' AND cmd = 'SELECT';
  IF v_policy_n <> 1 THEN
    RAISE EXCEPTION 'self-test: user_marks_read_own is missing or has the wrong cmd -- it should have been left untouched';
  END IF;

  SELECT count(*) INTO v_policy_n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'user_marks'
    AND policyname = 'user_marks_update_own' AND cmd = 'UPDATE';
  IF v_policy_n <> 1 THEN
    RAISE EXCEPTION 'self-test: user_marks_update_own is missing or has the wrong cmd -- it should have been left untouched';
  END IF;

  SELECT count(*) INTO v_bad_grant FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'user_marks' AND grantee = 'anon';
  IF v_bad_grant <> 0 THEN
    RAISE EXCEPTION 'self-test: anon still holds % grant(s) on user_marks', v_bad_grant;
  END IF;

  SELECT count(*) INTO v_bad_grant FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'user_marks' AND grantee = 'authenticated'
    AND privilege_type NOT IN ('SELECT', 'UPDATE');
  IF v_bad_grant <> 0 THEN
    RAISE EXCEPTION 'self-test: authenticated holds % unexpected grant(s) (beyond SELECT/UPDATE) on user_marks', v_bad_grant;
  END IF;

  -- 3. Behavioral probe: real role switch + real JWT claim. Deterministic
  --    picks; skip (don't fail) if there is not enough real data to probe.
  SELECT user_id INTO v_uid FROM public.user_marks ORDER BY user_id LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE 'user_marks has zero rows; skipping behavioral probe (structural + SECURITY DEFINER checks above already ran and passed)';
  ELSE
    SELECT user_id INTO v_other_uid FROM public.user_marks WHERE user_id <> v_uid ORDER BY user_id LIMIT 1;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    BEGIN
      EXECUTE 'SET LOCAL ROLE authenticated';

      SELECT count(*) INTO v_n FROM public.user_marks WHERE user_id = v_uid;
      IF v_n = 0 THEN
        RAISE EXCEPTION 'probe: authenticated self-select returned 0 rows for a user_id known to own at least one user_marks row -- read-own policy is not matching real rows';
      END IF;

      IF v_other_uid IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM public.user_marks WHERE user_id = v_other_uid;
        IF v_n <> 0 THEN
          RAISE EXCEPTION 'probe: authenticated user could still SELECT % row(s) belonging to a different user_id directly from user_marks -- this is the exact enumeration bug this migration exists to close, and it is not closed', v_n;
        END IF;
      ELSE
        RAISE NOTICE 'only one distinct user_id in user_marks; skipping the cross-user negative probe';
      END IF;

      EXECUTE 'RESET ROLE';
    EXCEPTION WHEN OTHERS THEN
      EXECUTE 'RESET ROLE';
      RAISE;
    END;

    PERFORM set_config('request.jwt.claims', NULL, true);
    RAISE NOTICE 'user_marks behavioral probe passed: self-select works, cross-user select returns zero rows';
  END IF;
END $$;

COMMIT;
