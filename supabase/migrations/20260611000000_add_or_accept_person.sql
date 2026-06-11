-- ===========================================================================
-- NOT YET APPLIED. Batch 3 addendum (item 9), holding for the survey-audit
-- checkpoint with Liz. Per the standing rule, this migration is applied to prod
-- only on explicit go-ahead, alongside the rest of batch 3.
--
-- add_or_accept_person(target, context[, context_event_id]) - "THE HANDSHAKE"
-- (post-plan-survey-spec.md). One atomic, race-safe send-or-accept so that two
-- people adding each other the same day (the COMMON case when both fill out the
-- post-plan survey) can never strand two crossed pending rows that never connect.
--
-- Outcome (text):
--   'requested'          no relationship -> a pending request was sent
--   'now_connected'      an incoming pending request existed -> accepted (mutual)
--   'already_connected'  a race left us already mutual -> no-op
-- Raises 'blocked' when a block exists in either direction (the survey caller
-- swallows this as a silent skip). Also raises the usual unauthorized /
-- invalid_target / invalid_context, plus anything inherited from the reused
-- send/accept paths (e.g. cannot_re_request).
--
-- This is a thin router over the EXISTING, already-hardened paths - it never
-- reimplements them:
--   * send_people_request   (20260517000300) - insert/refresh my pending row + guards
--   * accept_people_request (20260608000200) - flip their pending row to accepted
--   * yours_is_connected / yours_is_blocked_between (20260517000100) - helpers
-- Reusing them means the people_request / people_request_accepted notifications
-- (trg_notify_people_connection) fire for free; no new notification code.
--
-- auth.uid() reads the JWT, not the definer, so inside the nested PERFORM calls
-- v_me still resolves to the CALLER - the composition is correct and inherits
-- every guard of the reused functions.
-- ===========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.add_or_accept_person(
  p_target           uuid,
  p_context          text,
  p_context_event_id uuid DEFAULT NULL
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_me               uuid := auth.uid();
  v_incoming_pending boolean;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_target IS NULL OR p_target = v_me THEN
    RAISE EXCEPTION 'invalid_target';
  END IF;
  IF p_context NOT IN ('plan_history','handle_lookup','referral_invite') THEN
    RAISE EXCEPTION 'invalid_context';
  END IF;

  -- Block (possibly a race) -> reject. The survey's Promise.allSettled swallows
  -- this, which is the spec's "silent skip"; consistent with how send/accept
  -- already signal a block.
  IF public.yours_is_blocked_between(v_me, p_target) THEN
    RAISE EXCEPTION 'blocked';
  END IF;

  -- Serialize the unordered pair (same canonical key as get_or_create_dm). This
  -- is the crux of race-safety: with A-adds-B and B-adds-A firing at once, the
  -- second caller blocks here until the first commits, then sees the first's
  -- fresh pending row and ACCEPTS it instead of inserting a crossed duplicate.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      least(v_me::text, p_target::text) || '|' || greatest(v_me::text, p_target::text),
      0
    )
  );

  -- Already mutual (their accept may have landed between survey-load and tap).
  IF public.yours_is_connected(v_me, p_target) THEN
    RETURN 'already_connected';
  END IF;

  -- Incoming pending from them -> me? Accept it; never a counter-request.
  SELECT EXISTS (
    SELECT 1 FROM public.people_connections pc
    WHERE pc.requester_user_id = p_target
      AND pc.recipient_user_id = v_me
      AND pc.status = 'pending'
  ) INTO v_incoming_pending;

  IF v_incoming_pending THEN
    PERFORM public.accept_people_request(p_target);
    RETURN 'now_connected';
  END IF;

  -- No relationship (or my own prior pending/declined): send/refresh my request.
  PERFORM public.send_people_request(p_target, p_context, p_context_event_id);
  RETURN 'requested';
END;
$$;

REVOKE ALL    ON FUNCTION public.add_or_accept_person(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_or_accept_person(uuid, text, uuid) TO authenticated;

-- --- in-transaction self-test (rolls back; leaves no trace) -----------------
DO $$
DECLARE
  v_me      uuid := 'ae8006dc-5bca-42b8-975a-e11ad14b796f';   -- Liz
  v_them    uuid := 'cafe0001-0000-0000-0000-000000000001';   -- Sage (test)
  v_outcome text;
  v_status  text;
  v_count   int;
  v_raised  boolean;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_me, 'role', 'authenticated')::text, true);

    -- Clean slate helper inline: clear both directions + any block.
    DELETE FROM public.user_blocks
      WHERE (blocker_id = v_me   AND blocked_id = v_them)
         OR (blocker_id = v_them AND blocked_id = v_me);
    DELETE FROM public.people_connections
      WHERE (requester_user_id = v_me   AND recipient_user_id = v_them)
         OR (requester_user_id = v_them AND recipient_user_id = v_me);

    -- Case 1: no relationship -> 'requested' + a pending me -> them row.
    v_outcome := public.add_or_accept_person(v_them, 'plan_history', NULL);
    IF v_outcome <> 'requested' THEN
      RAISE EXCEPTION 'self-test C1: expected requested, got %', v_outcome;
    END IF;
    SELECT status INTO v_status FROM public.people_connections
      WHERE requester_user_id = v_me AND recipient_user_id = v_them;
    IF v_status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'self-test C1: expected my pending row, got %', v_status;
    END IF;

    -- Case 2: incoming pending them -> me -> 'now_connected', their row accepted,
    -- and NO counter-request row me -> them is created.
    DELETE FROM public.people_connections
      WHERE (requester_user_id = v_me   AND recipient_user_id = v_them)
         OR (requester_user_id = v_them AND recipient_user_id = v_me);
    INSERT INTO public.people_connections
      (requester_user_id, recipient_user_id, status, context, can_re_request)
    VALUES (v_them, v_me, 'pending', 'handle_lookup', true);
    v_outcome := public.add_or_accept_person(v_them, 'plan_history', NULL);
    IF v_outcome <> 'now_connected' THEN
      RAISE EXCEPTION 'self-test C2: expected now_connected, got %', v_outcome;
    END IF;
    SELECT status INTO v_status FROM public.people_connections
      WHERE requester_user_id = v_them AND recipient_user_id = v_me;
    IF v_status IS DISTINCT FROM 'accepted' THEN
      RAISE EXCEPTION 'self-test C2: their row should be accepted, got %', v_status;
    END IF;
    SELECT count(*) INTO v_count FROM public.people_connections
      WHERE requester_user_id = v_me AND recipient_user_id = v_them;
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'self-test C2: a counter-request row was created (count %)', v_count;
    END IF;

    -- Case 3: already mutual -> 'already_connected', no extra row.
    DELETE FROM public.people_connections
      WHERE (requester_user_id = v_me   AND recipient_user_id = v_them)
         OR (requester_user_id = v_them AND recipient_user_id = v_me);
    INSERT INTO public.people_connections
      (requester_user_id, recipient_user_id, status, context, can_re_request)
    VALUES (v_me, v_them, 'accepted', 'plan_history', true);
    v_outcome := public.add_or_accept_person(v_them, 'plan_history', NULL);
    IF v_outcome <> 'already_connected' THEN
      RAISE EXCEPTION 'self-test C3: expected already_connected, got %', v_outcome;
    END IF;
    SELECT count(*) INTO v_count FROM public.people_connections
      WHERE (requester_user_id = v_me   AND recipient_user_id = v_them)
         OR (requester_user_id = v_them AND recipient_user_id = v_me);
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'self-test C3: expected exactly one row, got %', v_count;
    END IF;

    -- Case 4: a block in either direction -> raises 'blocked'.
    DELETE FROM public.people_connections
      WHERE (requester_user_id = v_me   AND recipient_user_id = v_them)
         OR (requester_user_id = v_them AND recipient_user_id = v_me);
    INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (v_me, v_them);
    v_raised := false;
    BEGIN
      PERFORM public.add_or_accept_person(v_them, 'plan_history', NULL);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'blocked' THEN v_raised := true; ELSE RAISE; END IF;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C4: expected blocked to be raised';
    END IF;

    RAISE EXCEPTION 'SELFTEST_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'add_or_accept_person self-test passed';
END $$;

COMMIT;
