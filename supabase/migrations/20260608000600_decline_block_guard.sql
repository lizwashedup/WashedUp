-- ===========================================================================
-- APPLIED to prod 2026-06-08 via Supabase MCP (verbatim, self-test passed).
--
-- D2: harden M1 (decline_people_request). Previously can_re_request = NOT p_block
-- unconditionally, so a soft decline (block=false) on an ALREADY-blocked row -
-- or the soft/block escalation completing out of order - could leave
-- can_re_request=true while a user_blocks row still exists (inconsistent;
-- unexploitable today since send_people_request gates on the block first, but a
-- latent footgun). Now: can_re_request flips TRUE only when not blocking AND no
-- block exists; otherwise FALSE. Converges to the correct end-state regardless
-- of the two declines' completion order. Gated-Yours-only.
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
        can_re_request = CASE
          WHEN p_block THEN false
          WHEN public.yours_is_blocked_between(v_me, p_requester) THEN false
          ELSE true
        END
  WHERE requester_user_id = p_requester
    AND recipient_user_id = v_me
    AND status IN ('pending', 'declined');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RAISE EXCEPTION 'no_pending_request'; END IF;

  IF p_block THEN
    INSERT INTO public.user_blocks (blocker_id, blocked_id)
    VALUES (v_me, p_requester)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

DO $$
DECLARE
  v_me   uuid := 'ae8006dc-5bca-42b8-975a-e11ad14b796f';
  v_them uuid := 'cafe0001-0000-0000-0000-000000000001';
  v_can  boolean;
BEGIN
  BEGIN
    DELETE FROM public.user_blocks WHERE blocker_id = v_me AND blocked_id = v_them;
    DELETE FROM public.people_connections
      WHERE requester_user_id = v_them AND recipient_user_id = v_me;
    INSERT INTO public.people_connections
      (requester_user_id, recipient_user_id, status, context, can_re_request)
    VALUES (v_them, v_me, 'pending', 'handle_lookup', true);

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_me, 'role', 'authenticated')::text, true);

    -- soft decline, no block -> can_re_request TRUE
    PERFORM public.decline_people_request(v_them, false);
    SELECT can_re_request INTO v_can FROM public.people_connections
      WHERE requester_user_id=v_them AND recipient_user_id=v_me;
    IF v_can IS NOT TRUE THEN
      RAISE EXCEPTION 'self-test: unblocked soft decline should be re-requestable (got %)', v_can;
    END IF;

    -- block -> FALSE + block row
    PERFORM public.decline_people_request(v_them, true);
    SELECT can_re_request INTO v_can FROM public.people_connections
      WHERE requester_user_id=v_them AND recipient_user_id=v_me;
    IF v_can IS NOT FALSE THEN
      RAISE EXCEPTION 'self-test: block should set can_re_request FALSE (got %)', v_can;
    END IF;

    -- THE HARDENING: a soft decline on the now-blocked row must STAY false
    PERFORM public.decline_people_request(v_them, false);
    SELECT can_re_request INTO v_can FROM public.people_connections
      WHERE requester_user_id=v_them AND recipient_user_id=v_me;
    IF v_can IS NOT FALSE THEN
      RAISE EXCEPTION 'self-test: soft decline on a BLOCKED row must keep can_re_request FALSE (got %)', v_can;
    END IF;

    RAISE EXCEPTION 'SELFTEST_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'decline_people_request block-guard self-test passed';
END $$;

COMMIT;
