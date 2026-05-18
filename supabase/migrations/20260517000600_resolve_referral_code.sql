-- Yours page rebuild — resolve a referral code to a user id.
--
-- REVIEW ONLY. Not applied by the agent. Supabase preview branches are
-- broken for this repo; apply directly + rely on the trailing self-test
-- to roll back. Additive only; safe to ship ahead of the flag.
--
-- Powers the QR same-app-scan path: an authenticated user who scans a
-- washedup.app/r/<code> link resolves the code to the owner's user id and
-- then calls send_people_request (migration 300). profiles.referral_code
-- is created lazily by ensure_referral_code (migration 300).
--
-- Idempotent (CREATE OR REPLACE). SECURITY DEFINER, pinned search_path,
-- auth.uid() required, never resolves to the caller themselves.

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_referral_code(p_code text)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT pr.id
  FROM public.profiles pr
  WHERE auth.uid() IS NOT NULL
    AND p_code IS NOT NULL
    AND pr.referral_code = p_code
    AND pr.id <> auth.uid()
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_referral_code(text)
  FROM anon, public;
GRANT EXECUTE ON FUNCTION public.resolve_referral_code(text)
  TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'resolve_referral_code'
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'self-test: resolve_referral_code missing or not SECURITY DEFINER';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE routine_schema = 'public'
      AND routine_name = 'resolve_referral_code'
      AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'self-test: resolve_referral_code exposed to anon';
  END IF;
END $$;

COMMIT;
