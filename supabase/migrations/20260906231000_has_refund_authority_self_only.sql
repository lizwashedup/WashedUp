-- DRAFT: DO NOT APPLY WITHOUT JOSH'S WORD.
--
-- Fix: has_refund_authority(p_user_id, p_event_id) (20260904010000_refund_authority_grants.sql)
-- is GRANTed to `authenticated`, and lets ANY signed-in caller ask whether an ARBITRARY
-- other user holds refund authority on an arbitrary event -- a low-severity information
-- leak (who has been granted delegate access to whose event), not an access bypass: the
-- function only ever answers a yes/no question, it never lets the caller act as that
-- other user or move money.
--
-- Smallest safe fix: restrict a caller to asking only about themselves (p_user_id must
-- equal auth.uid()), with the existing service_role bypass every SECURITY DEFINER RPC in
-- this codebase already uses for its one legitimate non-self caller. Chose this over
-- additionally allowing a leader/co-leader to ask about someone else because nothing in
-- this codebase actually needs that broader case: the Team roster's own view of who holds
-- a grant (lib/refundAuthority.ts listCommunityRefundAuthorityGrants) already reads
-- refund_authority_grants directly under its own RLS policy, never through this RPC, and
-- ticket-refund/index.ts's two calls (initial check + the TOCTOU re-check) always pass the
-- request's own authenticated caller id. Self-or-service_role covers every real caller
-- with no new carve-out.
--
-- NOT applied anywhere, NOT run against a live or disposable Postgres this session (no
-- working harness -- same caveat as recent same-night migrations in this repo). Needs a
-- real apply-and-test pass and Josh's explicit go before this can ever be called done, per
-- this repo's own Release Discipline (clients/washed-up/CLAUDE.md).

BEGIN;

CREATE OR REPLACE FUNCTION public.has_refund_authority(p_user_id uuid, p_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_community_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_event_id IS NULL THEN
    RETURN false;
  END IF;

  -- Info-leak fix (2026-09-06): self-or-service_role only. service_role covers
  -- ticket-refund/index.ts, which always passes the request's own verified
  -- caller id under the service client (no per-request auth.uid() there); an
  -- ordinary `authenticated` caller may only ask about themselves.
  --
  -- NULL-safe (2026-09-06, security-review catch): a plain <> comparison goes
  -- to NULL (not true) when either side is NULL, which would fail OPEN here --
  -- exactly the leak this migration exists to close. auth.uid() IS NULL is
  -- checked explicitly first; IS DISTINCT FROM (NULL-safe <>) covers the role
  -- check, matching the existing precedent in
  -- 20260829210000_ticket_receipt_resend_rate_limit.sql.
  IF auth.uid() IS NULL
     OR (auth.role() IS DISTINCT FROM 'service_role' AND p_user_id <> auth.uid())
  THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.refund_authority_grants
    WHERE scope = 'event' AND event_id = p_event_id
      AND grantee_user_id = p_user_id AND active
  ) THEN
    RETURN true;
  END IF;

  SELECT community_id INTO v_community_id FROM public.explore_events WHERE id = p_event_id;
  IF v_community_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.refund_authority_grants
    WHERE scope = 'creator_account' AND community_id = v_community_id
      AND grantee_user_id = p_user_id AND active
  );
END;
$$;

REVOKE ALL ON FUNCTION public.has_refund_authority(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_refund_authority(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- self-test: the invariant this migration exists to establish (never strip on apply)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
  FROM pg_proc
  WHERE proname = 'has_refund_authority' AND pronamespace = 'public'::regnamespace;

  IF v_src IS NULL OR v_src NOT ILIKE '%service_role%' OR v_src NOT ILIKE '%auth.uid()%' THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: has_refund_authority no longer contains the self-or-service_role guard';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.has_refund_authority(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: has_refund_authority lost service_role EXECUTE -- this would break ticket-refund/index.ts';
  END IF;
END;
$$;

COMMIT;
