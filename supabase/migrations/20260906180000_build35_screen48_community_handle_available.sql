-- ============================================================================
-- Build 35 Screen 48 (app/creator/setup-community.tsx): a live handle-
-- availability check BEFORE submit, not only the 23505 unique-violation
-- discovered after the leader has already tapped "start your community".
--
-- Why a new RPC instead of a plain client select: communities_select RLS
-- (20260702184012_communities_skeleton.sql) only surfaces
-- status = 'active' OR is_community_member() OR admin rows. A brand-new
-- community is born DRAFT (create_community, same skeleton migration), so a
-- plain `select id from communities where handle = X` run from a DIFFERENT
-- leader's session would read a just-taken handle as falsely available
-- right up until the real create attempt hits the unique constraint. This
-- function runs SECURITY DEFINER specifically to see past that RLS boundary
-- for the one narrow fact "does this handle exist at all" -- it returns a
-- boolean only, the same fact the 23505 error already reveals today at
-- submit time, nothing new exposed by moving the check earlier.
--
-- Deliberately NOT touched: create_community() itself. That function
-- already carries two independent DRAFT signature forks pending on top of
-- it (20260901080000_gender_restricted_communities.sql,
-- 20260902200000_community_join_policy_at_creation.sql), each gated
-- "DO NOT APPLY WITHOUT JOSH WORD" and each already coordinating a merge
-- with the other. A client-side idempotency-key parameter on that same
-- function would have been a third fork of the identical contested surface;
-- this migration adds a wholly separate, new, independently-named function
-- instead, so it has no merge-order dependency on either pending fork and
-- can apply on its own regardless of when (or whether) they do.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.community_handle_available(p_handle text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.communities WHERE handle = lower(p_handle)
  );
$$;

REVOKE ALL ON FUNCTION public.community_handle_available(text) FROM public;
REVOKE ALL ON FUNCTION public.community_handle_available(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.community_handle_available(text) TO authenticated;

COMMENT ON FUNCTION public.community_handle_available(text) IS
  'Screen 48: live pre-submit handle-availability check for setup-community.tsx. SECURITY DEFINER so a draft community''s handle (invisible to a non-member under communities_select RLS) still correctly reads as taken. Returns a boolean only -- the same fact the 23505 unique-violation on create_community already reveals today, just surfaced earlier.';

-- ---------------------------------------------------------------------------
-- Self-test. Real INSERT/DELETE against a real row, cleaned up before
-- commit, simulated auth via transaction-local jwt claims -- same style as
-- the skeleton and other community migrations.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_leader uuid;
  v_probe_handle text := 'selftest-handle-avail-' || substr(md5(random()::text), 1, 8);
  v_cid uuid;
  v_available boolean;
BEGIN
  SELECT user_id INTO v_leader FROM public.operator_grants
    WHERE track = 'community_leader' AND status = 'approved' LIMIT 1;
  IF v_leader IS NULL THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: needs an existing approved community_leader grant to test with';
  END IF;

  -- an unused handle reads available
  v_available := public.community_handle_available(v_probe_handle);
  IF v_available IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: an unused handle did not read as available';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_cid := public.create_community(v_probe_handle, 'selftest handle availability');

  -- the same handle now reads taken -- including for a call made by the
  -- creator's own session, since this is a plain existence check, not a
  -- "someone else's draft" special case
  v_available := public.community_handle_available(v_probe_handle);
  IF v_available IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: an existing handle did not read as taken';
  END IF;

  -- case-insensitive: communities.handle is already stored lowercase
  -- (HANDLE_SHAPE client-side, the column's own CHECK constraint
  -- server-side), but the availability check itself still lowers its input
  -- so a careless caller cannot false-negative past a real collision
  v_available := public.community_handle_available(upper(v_probe_handle));
  IF v_available IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: the availability check is not case-insensitive';
  END IF;

  -- cleanup at full privilege (impersonated-role deletes silently no-op
  -- against community_members RLS -- same caught-live precedent as the
  -- join-policy-at-creation migration's own cleanup comment)
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  DELETE FROM public.community_members WHERE community_id = v_cid;
  DELETE FROM public.community_blocks WHERE community_id = v_cid;
  DELETE FROM public.communities WHERE id = v_cid;

  -- and now that it is cleaned up, the handle reads available again
  v_available := public.community_handle_available(v_probe_handle);
  IF v_available IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: handle did not read available again after cleanup';
  END IF;

  RAISE NOTICE 'community_handle_available self-test passed';
END;
$$;

COMMIT;
