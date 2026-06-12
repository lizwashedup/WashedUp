-- ===========================================================================
-- NOT YET APPLIED. Auth fail-closed pass (auth-audit.md, fix #1). Drafted for CW
-- review; applied to prod only on explicit go-ahead.
--
-- needs_phone_migration() -> boolean: the DEFINITE, server-truthed answer to
-- "should this caller be sent to the phone-migration gate?" The client gates ONLY
-- on a hard TRUE from this RPC, and treats any failure/timeout/absence as FALSE
-- (not gated). This replaces the old fail-OPEN client check
-- (`authedDest` gating on `!session.user.phone`), which routed phone-VERIFIED
-- users to the gate whenever the JWT phone field read null on a stale/slow
-- session (the 2026-06-11 incident: the gate fired at a phone-verified user).
--
-- Rule: a user "needs migration" iff they are authenticated and have NO confirmed
-- phone on auth.users. Supabase only sets phone_confirmed_at after a successful
-- verifyOtp, so its presence is the single source of truth for "has a verified
-- phone." A user with no confirmed phone is by definition not phone-origin (a
-- phone signup confirms at signup), i.e. exactly the legacy email/Apple/invited
-- population the gate targets — so this one condition captures "legacy origin AND
-- no verified phone" without a separate provider check.
--
-- Unauthenticated caller -> false (auth.uid() IS NULL): can't determine, so never
-- gate. STABLE + SECURITY DEFINER so it can read auth.users; granted to
-- authenticated only.
-- ===========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.needs_phone_migration()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM auth.users u
       WHERE u.id = auth.uid()
         AND u.phone_confirmed_at IS NOT NULL
     );
$$;

REVOKE ALL    ON FUNCTION public.needs_phone_migration() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.needs_phone_migration() TO authenticated;

-- --- self-test (read-only; no writes, nothing to roll back) ------------------
-- Asserts against live auth state: Sage (cafe0001) is an email test user with NO
-- phone -> true; Liz (ae8006dc) is phone-verified -> false; no JWT -> false.
DO $$
DECLARE
  v_sage uuid := 'cafe0001-0000-0000-0000-000000000001';
  v_liz  uuid := 'ae8006dc-5bca-42b8-975a-e11ad14b796f';
  v_res  boolean;
BEGIN
  -- no JWT -> auth.uid() null -> false
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF public.needs_phone_migration() IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'self-test: unauthenticated should be false';
  END IF;

  -- Sage: no confirmed phone -> true
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_sage, 'role', 'authenticated')::text, true);
  v_res := public.needs_phone_migration();
  IF v_res IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'self-test: a no-phone account (Sage) should need migration, got %', v_res;
  END IF;

  -- Liz: phone-verified -> false
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_liz, 'role', 'authenticated')::text, true);
  v_res := public.needs_phone_migration();
  IF v_res IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'self-test: a phone-verified account (Liz) must NOT need migration, got %', v_res;
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'needs_phone_migration self-test passed';
END $$;

COMMIT;
