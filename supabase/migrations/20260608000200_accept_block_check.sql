-- ===========================================================================
-- APPLIED to prod 2026-06-08 via Supabase MCP (verbatim, BEGIN/COMMIT self-test
-- passed). Idempotent CREATE OR REPLACE; not registered in schema_migrations.
--
-- Finding #4 (M2). Hardens accept_people_request with a block check so you can
-- never accept a request from someone you've blocked (or who blocked you).
-- Today the read RPC get_incoming_people_requests already hides blocked
-- requesters, so their card never appears - but the accept RPC itself has no
-- guard, so a direct call / future non-filtered path could accept a blocked
-- person. This is defense-in-depth at the mutation layer.
--
-- Caller surface: only hooks/usePeopleConnectionMutations.ts (components/yours/**,
-- gated by YOURS_PAGE_ENABLED). No shipped / non-gated path calls this.
-- ===========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.accept_people_request(p_requester uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_rows int;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  -- Defense-in-depth: refuse if a block exists in either direction.
  IF public.yours_is_blocked_between(v_me, p_requester) THEN
    RAISE EXCEPTION 'blocked';
  END IF;

  UPDATE public.people_connections
    SET status = 'accepted', responded_at = now()
  WHERE requester_user_id = p_requester
    AND recipient_user_id = v_me
    AND status = 'pending';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RAISE EXCEPTION 'no_pending_request'; END IF;
END;
$$;

-- --- in-transaction self-test (rolls back; leaves no trace) -----------------
DO $$
DECLARE
  v_me   uuid := 'ae8006dc-5bca-42b8-975a-e11ad14b796f';   -- Liz
  v_them uuid := 'cafe0001-0000-0000-0000-000000000001';   -- Sage (test)
  v_status text;
  v_raised boolean := false;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_me, 'role', 'authenticated')::text, true);

    -- fixture: a fresh pending request them -> me
    DELETE FROM public.user_blocks WHERE blocker_id = v_me AND blocked_id = v_them;
    DELETE FROM public.people_connections
      WHERE requester_user_id = v_them AND recipient_user_id = v_me;
    INSERT INTO public.people_connections
      (requester_user_id, recipient_user_id, status, context, can_re_request)
    VALUES (v_them, v_me, 'pending', 'handle_lookup', true);

    -- with a block in place, accept must RAISE 'blocked'
    INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (v_me, v_them);
    BEGIN
      PERFORM public.accept_people_request(v_them);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'blocked' THEN v_raised := true; ELSE RAISE; END IF;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test: accept should have raised "blocked" when a block exists';
    END IF;

    -- remove the block, accept should now succeed
    DELETE FROM public.user_blocks WHERE blocker_id = v_me AND blocked_id = v_them;
    PERFORM public.accept_people_request(v_them);
    SELECT status INTO v_status FROM public.people_connections
      WHERE requester_user_id = v_them AND recipient_user_id = v_me;
    IF v_status <> 'accepted' THEN
      RAISE EXCEPTION 'self-test: accept should have set status=accepted (got %)', v_status;
    END IF;

    RAISE EXCEPTION 'SELFTEST_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'accept_people_request self-test passed';
END $$;

COMMIT;
