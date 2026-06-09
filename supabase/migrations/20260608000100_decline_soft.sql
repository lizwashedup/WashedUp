-- ===========================================================================
-- REVIEW ONLY - NOT YET APPLIED (await Liz's go-ahead).
--
-- Decline-trap fix (M1). Makes "Not now" a SOFT decline:
--   p_block = false  -> status='declined', can_re_request = TRUE  (re-requestable)
--   p_block = true   -> status='declined', can_re_request = FALSE + user_blocks row
--
-- Today the fn ALWAYS sets can_re_request=false, so a plain "Not now" was as
-- permanent as a block (the trap). It also required status='pending', which
-- breaks the new client flow where "Not now" soft-declines first and the
-- BlockPrompt's "Block" then escalates the already-declined row. So we now
-- match status IN ('pending','declined') (never 'accepted', so an existing
-- connection can't be silently severed) and are idempotent for re-calls.
--
-- Caller surface: only hooks/usePeopleConnectionMutations.ts, used solely by
-- components/yours/** (mounted only when YOURS_PAGE_ENABLED). No shipped /
-- non-gated path calls this. Ships together with the RequestStack client change.
-- ===========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.decline_people_request(
  p_requester uuid,
  p_block boolean DEFAULT false
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_rows int;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  UPDATE public.people_connections
    SET status = 'declined',
        responded_at = now(),
        can_re_request = NOT p_block   -- soft decline stays re-requestable
  WHERE requester_user_id = p_requester
    AND recipient_user_id = v_me
    AND status IN ('pending', 'declined');  -- never touch an 'accepted' tie
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RAISE EXCEPTION 'no_pending_request'; END IF;

  IF p_block THEN
    INSERT INTO public.user_blocks (blocker_id, blocked_id)
    VALUES (v_me, p_requester)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

-- --- in-transaction self-test (rolls back; leaves no trace) -----------------
DO $$
DECLARE
  v_me   uuid := 'ae8006dc-5bca-42b8-975a-e11ad14b796f';        -- Liz
  v_them uuid := 'cafe0001-0000-0000-0000-000000000001';        -- Sage (test)
  v_can  boolean;
  v_blocked boolean;
BEGIN
  -- fixture: a fresh pending request them -> me (rolled back via the savepoint
  -- the EXCEPTION clause establishes, so the real rows are restored).
  DELETE FROM public.user_blocks WHERE blocker_id = v_me AND blocked_id = v_them;
  DELETE FROM public.people_connections
    WHERE requester_user_id = v_them AND recipient_user_id = v_me;
  INSERT INTO public.people_connections
    (requester_user_id, recipient_user_id, status, context, can_re_request)
  VALUES (v_them, v_me, 'pending', 'handle_lookup', true);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_me, 'role', 'authenticated')::text, true);

  -- soft decline -> re-requestable, no block
  PERFORM public.decline_people_request(v_them, false);
  SELECT can_re_request INTO v_can FROM public.people_connections
    WHERE requester_user_id=v_them AND recipient_user_id=v_me;
  IF v_can IS NOT TRUE THEN
    RAISE EXCEPTION 'self-test: soft decline should leave can_re_request TRUE (got %)', v_can;
  END IF;

  -- escalate the already-declined row to a block -> permanent + block row
  PERFORM public.decline_people_request(v_them, true);
  SELECT can_re_request INTO v_can FROM public.people_connections
    WHERE requester_user_id=v_them AND recipient_user_id=v_me;
  SELECT EXISTS(SELECT 1 FROM public.user_blocks WHERE blocker_id=v_me AND blocked_id=v_them)
    INTO v_blocked;
  IF v_can IS NOT FALSE OR v_blocked IS NOT TRUE THEN
    RAISE EXCEPTION 'self-test: Block escalation should set can_re_request FALSE (%) + block row (%)', v_can, v_blocked;
  END IF;

  RAISE EXCEPTION 'SELFTEST_OK_ROLLBACK';  -- force rollback of all fixture data
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'SELFTEST_OK_ROLLBACK' THEN RAISE; END IF;
  RAISE NOTICE 'decline_people_request self-test passed';
END $$;

COMMIT;
