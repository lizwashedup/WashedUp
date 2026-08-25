\set ON_ERROR_STOP on

-- Money allocation provenance and exact replay.
INSERT INTO public.organizer_receivables (
  id, organizer_user_id, amount_cents, created_at
) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 100, now() - interval '2 minutes'),
  ('a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 200, now() - interval '1 minute');

DO $$
BEGIN
  IF public.consume_organizer_receivables(
    'a2000000-0000-4000-8000-000000000001', 150, 'po_first'
  ) <> 150 THEN
    RAISE EXCEPTION 'receivable contract: first consume returned the wrong amount';
  END IF;

  IF (SELECT count(*) FROM public.organizer_receivable_allocations) <> 2
     OR (SELECT sum(amount_cents) FROM public.organizer_receivable_allocations) <> 150
     OR (SELECT count(*) FROM public.organizer_receivable_consumptions) <> 1 THEN
    RAISE EXCEPTION 'receivable contract: first consume did not write exact allocation provenance';
  END IF;

  IF public.consume_organizer_receivables(
    'a2000000-0000-4000-8000-000000000001', 150, 'po_first'
  ) <> 150
     OR (SELECT count(*) FROM public.organizer_receivable_allocations) <> 2 THEN
    RAISE EXCEPTION 'receivable contract: exact payout replay was not idempotent';
  END IF;

  BEGIN
    PERFORM public.consume_organizer_receivables(
      'a2000000-0000-4000-8000-000000000001', 149, 'po_first'
    );
    RAISE EXCEPTION 'receivable contract: mismatched payout replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'receivable contract: mismatched payout replay was accepted' THEN RAISE; END IF;
  END;

  PERFORM public.consume_organizer_receivables(
    'a2000000-0000-4000-8000-000000000001', 150, 'po_second'
  );

  IF (SELECT sum(amount_cents) FROM public.organizer_receivable_allocations WHERE stripe_payout_id = 'po_first') <> 150
     OR (SELECT sum(amount_cents) FROM public.organizer_receivable_allocations WHERE stripe_payout_id = 'po_second') <> 150
     OR EXISTS (SELECT 1 FROM public.organizer_receivables WHERE settled_at IS NULL)
  THEN
    RAISE EXCEPTION 'receivable contract: later payout erased provenance or failed to settle';
  END IF;
END $$;

-- Two sessions replay one payout. Both return the same result and one ledger
-- identity survives.
INSERT INTO public.organizer_receivables (
  id, organizer_user_id, amount_cents, created_at
) VALUES (
  'a1000000-0000-4000-8000-000000000003',
  'a2000000-0000-4000-8000-000000000002',
  75,
  now()
);

SELECT dblink_connect('receivable_session_a', 'dbname=technical_database_hardening_contract');
SELECT dblink_connect('receivable_session_b', 'dbname=technical_database_hardening_contract');
SELECT dblink_send_query(
  'receivable_session_a',
  $$SELECT public.consume_organizer_receivables(
    'a2000000-0000-4000-8000-000000000002', 75, 'po_concurrent'
  )$$
);
SELECT dblink_send_query(
  'receivable_session_b',
  $$SELECT public.consume_organizer_receivables(
    'a2000000-0000-4000-8000-000000000002', 75, 'po_concurrent'
  )$$
);

CREATE TEMP TABLE receivable_session_results (result integer NOT NULL);
INSERT INTO receivable_session_results
SELECT result FROM dblink_get_result('receivable_session_a') AS t(result integer);
INSERT INTO receivable_session_results
SELECT result FROM dblink_get_result('receivable_session_b') AS t(result integer);

DO $$
BEGIN
  IF (SELECT count(*) FROM receivable_session_results WHERE result = 75) <> 2
     OR (SELECT count(*) FROM public.organizer_receivable_consumptions WHERE stripe_payout_id = 'po_concurrent') <> 1
     OR (SELECT count(*) FROM public.organizer_receivable_allocations WHERE stripe_payout_id = 'po_concurrent') <> 1
  THEN
    RAISE EXCEPTION 'receivable contract: concurrent replay duplicated or split the ledger';
  END IF;
END $$;

SELECT dblink_disconnect('receivable_session_a');
SELECT dblink_disconnect('receivable_session_b');

-- Blocked payouts become durable and deduplicated.
INSERT INTO public.blocked_payout_source VALUES (
  'a2000000-0000-4000-8000-000000000003', 500, 700
);

DO $$
DECLARE
  first_result integer;
  second_result integer;
  case_count integer;
  seen_count integer;
BEGIN
  first_result := public.record_ticket_payouts_blocked();
  second_result := public.record_ticket_payouts_blocked();
  SELECT count(*), max(occurrence_count)
    INTO case_count, seen_count
  FROM public.ticket_payout_blocked_cases;

  IF first_result <> 1
     OR second_result <> 1
     OR case_count <> 1
     OR seen_count <> 2
  THEN
    RAISE EXCEPTION 'blocked payout contract: results %, %, cases %, seen %',
      first_result, second_result, case_count, seen_count;
  END IF;
END $$;

-- Refund review resolution preserves the operational trail.
INSERT INTO public.explore_events VALUES ('b1000000-0000-4000-8000-000000000001');
INSERT INTO public.ticket_orders (
  id, event_id, qty, status, needs_refund_review,
  refund_review_reason, refund_review_flagged_at
) VALUES (
  'b2000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  2,
  'paid',
  true,
  'partial_dashboard_refund:re_fixture',
  '2026-08-24 12:00:00+00'
);

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'b3000000-0000-4000-8000-000000000001', true);
  IF public.resolve_order_refund_review(
    'b2000000-0000-4000-8000-000000000001',
    'Stripe evidence reconciled',
    'admin_review'
  ) <> 'resolved' THEN
    RAISE EXCEPTION 'refund history contract: flagged order did not resolve';
  END IF;

  IF (SELECT needs_refund_review FROM public.ticket_orders WHERE id = 'b2000000-0000-4000-8000-000000000001')
     OR NOT EXISTS (
       SELECT 1 FROM public.ticket_refund_review_actions
       WHERE order_id = 'b2000000-0000-4000-8000-000000000001'
         AND original_reason = 'partial_dashboard_refund:re_fixture'
         AND originally_flagged_at = '2026-08-24 12:00:00+00'
         AND resolution_reason = 'Stripe evidence reconciled'
         AND resolution_source = 'admin_review'
         AND resolver_user_id = 'b3000000-0000-4000-8000-000000000001'
     )
  THEN
    RAISE EXCEPTION 'refund history contract: resolution erased its evidence';
  END IF;
END $$;

-- Attendee answers respect real ticket positions.
INSERT INTO public.ticket_questions (id, event_id, scope) VALUES
  ('b4000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'per_attendee'),
  ('b4000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'per_order');

INSERT INTO public.ticket_answers (order_id, question_id, attendee_index)
VALUES (
  'b2000000-0000-4000-8000-000000000001',
  'b4000000-0000-4000-8000-000000000001',
  1
);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.ticket_answers (order_id, question_id, attendee_index)
    VALUES ('b2000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', 0);
    RAISE EXCEPTION 'answer contract: attendee index zero was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'answer contract: attendee index zero was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO public.ticket_answers (order_id, question_id, attendee_index)
    VALUES ('b2000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', 3);
    RAISE EXCEPTION 'answer contract: attendee index above qty was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'answer contract: attendee index above qty was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO public.ticket_answers (order_id, question_id, attendee_index)
    VALUES ('b2000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000002', 1);
    RAISE EXCEPTION 'answer contract: per-order attendee index was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'answer contract: per-order attendee index was accepted' THEN RAISE; END IF;
  END;
END $$;

-- Concurrent question writes cannot cross the existing cap of eleven.
INSERT INTO public.explore_events VALUES ('b1000000-0000-4000-8000-000000000002');
INSERT INTO public.ticket_questions (event_id)
SELECT 'b1000000-0000-4000-8000-000000000002'
FROM generate_series(1, 10);

CREATE FUNCTION public.test_try_insert_question(p_event_id uuid) RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.ticket_questions(event_id) VALUES (p_event_id);
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

SELECT dblink_connect('question_session_a', 'dbname=technical_database_hardening_contract');
SELECT dblink_connect('question_session_b', 'dbname=technical_database_hardening_contract');
SELECT dblink_send_query(
  'question_session_a',
  $$SELECT public.test_try_insert_question('b1000000-0000-4000-8000-000000000002')$$
);
SELECT dblink_send_query(
  'question_session_b',
  $$SELECT public.test_try_insert_question('b1000000-0000-4000-8000-000000000002')$$
);

CREATE TEMP TABLE question_session_results (result boolean NOT NULL);
INSERT INTO question_session_results
SELECT result FROM dblink_get_result('question_session_a') AS t(result boolean);
INSERT INTO question_session_results
SELECT result FROM dblink_get_result('question_session_b') AS t(result boolean);

DO $$
BEGIN
  IF (SELECT count(*) FROM question_session_results WHERE result) <> 1
     OR (SELECT count(*) FROM question_session_results WHERE NOT result) <> 1
     OR (SELECT count(*) FROM public.ticket_questions WHERE event_id = 'b1000000-0000-4000-8000-000000000002') <> 11
  THEN
    RAISE EXCEPTION 'question cap contract: concurrent writes crossed the eleven-question cap';
  END IF;
END $$;

SELECT dblink_disconnect('question_session_a');
SELECT dblink_disconnect('question_session_b');

-- Identifier helpers agree with signup normalization and reject malformed
-- photo inputs before decode.
INSERT INTO public.banned_identifiers (
  email, normalized_email, phone_number, photo_hash
) VALUES (
  'first.last+tag@gmail.com',
  public.normalize_email('first.last+tag@gmail.com'),
  '+1 (415) 555-0123',
  repeat('a', 64)
);

DO $$
BEGIN
  IF NOT public.is_identifier_banned('f.i.r.s.t.l.a.s.t+other@googlemail.com', NULL)
     OR NOT public.is_identifier_banned(NULL, '1-415-555-0123')
     OR public.is_identifier_banned('different@example.com', NULL)
  THEN
    RAISE EXCEPTION 'identifier contract: service lookup disagrees with canonical normalization';
  END IF;

  IF NOT public.is_photo_banned(repeat('A', 64), 8) THEN
    RAISE EXCEPTION 'photo contract: canonical hash did not match';
  END IF;

  BEGIN
    PERFORM public.is_photo_banned(repeat('z', 64), 8);
    RAISE EXCEPTION 'photo contract: malformed hexadecimal hash was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM public.is_photo_banned(repeat('a', 64), 257);
    RAISE EXCEPTION 'photo contract: impossible threshold was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $$;

-- Security posture: privileged entry points remain service-only and new
-- operational tables have RLS enabled.
DO $$
DECLARE
  sig regprocedure;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.consume_organizer_receivables(uuid,integer,text)'::regprocedure,
    'public.record_ticket_payouts_blocked()'::regprocedure,
    'public.resolve_order_refund_review(uuid)'::regprocedure,
    'public.resolve_order_refund_review(uuid,text,text)'::regprocedure,
    'public.is_identifier_banned(text,text)'::regprocedure,
    'public.is_photo_banned(text,integer)'::regprocedure
  ]
  LOOP
    IF has_function_privilege('anon', sig, 'EXECUTE')
       OR has_function_privilege('authenticated', sig, 'EXECUTE')
       OR NOT has_function_privilege('service_role', sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'ACL contract failed for %', sig;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'organizer_receivable_allocations',
        'organizer_receivable_consumptions',
        'ticket_payout_blocked_cases',
        'ticket_refund_review_actions'
      )
      AND NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS contract failed for a hardening table';
  END IF;
END $$;

SELECT 'PASS technical database hardening: money provenance and replay, durable blocked/refund records, ticket bounds and concurrency, canonical identifier checks, and ACLs' AS result;
