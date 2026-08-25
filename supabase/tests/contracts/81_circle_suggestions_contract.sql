\set ON_ERROR_STOP on

DO $$
DECLARE
  v_inserted integer;
  v_count integer;
  v_a_id uuid;
  v_b_id uuid;
  v_result text;
  v_payload jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  v_inserted := public.detect_circle_suggestions();
  RESET ROLE;

  IF v_inserted <> 3 THEN
    RAISE EXCEPTION 'circle contract failed: expected 3 A/B/C suggestions, inserted %', v_inserted;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.circle_suggestions
    WHERE user_id IN (
      '00000000-0000-0000-0000-000000000004',
      '00000000-0000-0000-0000-000000000005',
      '00000000-0000-0000-0000-000000000006'
    )
  ) THEN
    RAISE EXCEPTION 'circle contract failed: existing exact Circle was suggested';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.circle_suggestions
  WHERE score = 3
    AND COALESCE(array_length(shared_event_ids, 1), 0) = 3;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'circle contract failed: exact 3-plan threshold was not preserved';
  END IF;

  SET LOCAL ROLE service_role;
  v_inserted := public.detect_circle_suggestions();
  RESET ROLE;
  IF v_inserted <> 0 THEN
    RAISE EXCEPTION 'circle contract failed: repeat detection inserted % duplicates', v_inserted;
  END IF;

  -- A newly completed fourth exact-roster Plan refreshes, rather than duplicates,
  -- each still-pending suggestion.
  INSERT INTO public.event_members (event_id, user_id, status)
  SELECT '10000000-0000-0000-0000-000000000005', user_id, 'joined'
  FROM unnest(ARRAY[
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000003'::uuid
  ]) AS person(user_id);

  SET LOCAL ROLE service_role;
  v_inserted := public.detect_circle_suggestions();
  RESET ROLE;
  IF v_inserted <> 3 THEN
    RAISE EXCEPTION 'circle contract failed: expected 3 refreshed suggestions, changed %', v_inserted;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.circle_suggestions
  WHERE score = 4
    AND COALESCE(array_length(shared_event_ids, 1), 0) = 4;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'circle contract failed: fourth Plan evidence was not refreshed';
  END IF;

  -- The database boundary rejects a noncanonical active key rather than letting
  -- array order create a second logical suggestion.
  BEGIN
    INSERT INTO public.circle_suggestions
      (user_id, suggested_user_ids, shared_event_ids, basis, score, status)
    VALUES (
      '00000000-0000-0000-0000-000000000001',
      ARRAY[
        '00000000-0000-0000-0000-000000000003'::uuid,
        '00000000-0000-0000-0000-000000000002'::uuid
      ],
      ARRAY['10000000-0000-0000-0000-000000000001'::uuid],
      'co_attendance', 1, 'pending'
    );
    RAISE EXCEPTION 'circle contract failed: noncanonical people array was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.circle_suggestions
      (user_id, suggested_user_ids, shared_event_ids, basis, score, status)
    VALUES (
      '00000000-0000-0000-0000-000000000001',
      ARRAY['00000000-0000-0000-0000-000000000002'::uuid, NULL::uuid],
      ARRAY['10000000-0000-0000-0000-000000000001'::uuid],
      'co_attendance', 1, 'pending'
    );
    RAISE EXCEPTION 'circle contract failed: NULL people array element was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- A block anywhere inside the proposed set hides the whole suggestion from
  -- every member, not only from the blocker and blocked person.
  INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003'
  );
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  SET LOCAL ROLE authenticated;
  v_payload := public.get_circle_suggestions();
  RESET ROLE;
  IF jsonb_array_length(v_payload) <> 0 THEN
    RAISE EXCEPTION 'circle contract failed: third-party block left suggestion visible';
  END IF;
  DELETE FROM public.user_blocks
  WHERE blocker_id = '00000000-0000-0000-0000-000000000002'
    AND blocked_id = '00000000-0000-0000-0000-000000000003';

  -- Correcting two historical memberships drops the exact roster below three
  -- qualifying Plans, so the pending row is hidden until the evidence is valid.
  UPDATE public.event_members
  SET status = 'left'
  WHERE user_id = '00000000-0000-0000-0000-000000000003'
    AND event_id IN (
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002'
    );
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  SET LOCAL ROLE authenticated;
  v_payload := public.get_circle_suggestions();
  RESET ROLE;
  IF jsonb_array_length(v_payload) <> 0 THEN
    RAISE EXCEPTION 'circle contract failed: stale sub-threshold evidence remained visible';
  END IF;
  UPDATE public.event_members
  SET status = 'joined'
  WHERE user_id = '00000000-0000-0000-0000-000000000003'
    AND event_id IN (
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002'
    );

  SELECT id INTO v_a_id FROM public.circle_suggestions
  WHERE user_id = '00000000-0000-0000-0000-000000000001';
  SELECT id INTO v_b_id FROM public.circle_suggestions
  WHERE user_id = '00000000-0000-0000-0000-000000000002';

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  SET LOCAL ROLE authenticated;
  v_result := public.set_circle_suggestion_status(v_b_id, 'dismissed');
  IF v_result <> 'not_found' THEN
    RAISE EXCEPTION 'circle contract failed: caller changed another user''s status';
  END IF;

  BEGIN
    PERFORM public.set_circle_suggestion_status(v_a_id, 'pending');
    RAISE EXCEPTION 'circle contract failed: pending was accepted as a target status';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  v_result := public.set_circle_suggestion_status(v_a_id, 'converted');
  IF v_result <> 'converted' THEN
    RAISE EXCEPTION 'circle contract failed: owner status transition returned %', v_result;
  END IF;
  v_result := public.set_circle_suggestion_status(v_a_id, 'dismissed');
  IF v_result <> 'not_found' THEN
    RAISE EXCEPTION 'circle contract failed: terminal status transitioned twice';
  END IF;

  v_payload := public.get_circle_suggestions();
  IF jsonb_array_length(v_payload) <> 0 THEN
    RAISE EXCEPTION 'circle contract failed: converted suggestion remained visible';
  END IF;
  RESET ROLE;

  -- Preserve and expose the original unresolved dismissal behavior: dismissal
  -- removes the active dedup key, so the next job run may resurface it.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  SET LOCAL ROLE authenticated;
  v_result := public.set_circle_suggestion_status(v_b_id, 'dismissed');
  RESET ROLE;
  IF v_result <> 'dismissed' THEN
    RAISE EXCEPTION 'circle contract failed: owner could not dismiss suggestion';
  END IF;

  SET LOCAL ROLE service_role;
  v_inserted := public.detect_circle_suggestions();
  RESET ROLE;
  IF v_inserted <> 1 THEN
    RAISE EXCEPTION 'circle contract failed: dismissed suggestion resurfaced % rows, expected 1', v_inserted;
  END IF;

  -- A block created after detection immediately hides the historical suggestion,
  -- including current handle and photo fields returned by the definer RPC.
  INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000002'
  );
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
  SET LOCAL ROLE authenticated;
  v_payload := public.get_circle_suggestions();
  RESET ROLE;
  IF jsonb_array_length(v_payload) <> 0 THEN
    RAISE EXCEPTION 'circle contract failed: blocked historical suggestion remained visible';
  END IF;

  SET LOCAL ROLE service_role;
  v_inserted := public.detect_circle_suggestions();
  RESET ROLE;
  IF v_inserted <> 0 THEN
    RAISE EXCEPTION 'circle contract failed: blocked member set changed % suggestions', v_inserted;
  END IF;

  -- Exercise denial under actual role semantics, not metadata alone.
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.detect_circle_suggestions();
    RAISE EXCEPTION 'circle contract failed: authenticated role ran detection';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;

  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.get_circle_suggestions();
    RAISE EXCEPTION 'circle contract failed: anon role read suggestions';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;

  IF has_function_privilege('anon', 'public.get_circle_suggestions()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.set_circle_suggestion_status(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.detect_circle_suggestions()', 'EXECUTE') THEN
    RAISE EXCEPTION 'circle contract failed: RPC execute ACL is too broad';
  END IF;
END $$;

-- RLS probe under the real authenticated role. A cannot read B or C's rows.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
SET ROLE authenticated;
DO $$
DECLARE
  v_visible integer;
BEGIN
  SELECT count(*) INTO v_visible FROM public.circle_suggestions;
  IF v_visible <> 1 THEN
    RAISE EXCEPTION 'circle contract failed: RLS exposed % rows to A', v_visible;
  END IF;
END $$;
RESET ROLE;

SELECT 'PASS: exact Circle suggestions refresh evidence, honor blocks, deduplicate, and stay owner-only' AS result;
