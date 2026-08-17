\set ON_ERROR_STOP on

DO $$
DECLARE
  result text;
BEGIN
  result := public.claim_ticket_payout_batch(
    '62000000-0000-4000-8000-000000000001',
    'acct_A',
    '[{"event_id":"61000000-0000-4000-8000-000000000001","amount_cents":100},{"event_id":"61000000-0000-4000-8000-000000000002","amount_cents":200}]'
  );
  IF result <> 'claimed' OR (SELECT count(*) FROM public.ticket_payouts WHERE status = 'pending') <> 2 THEN
    RAISE EXCEPTION 'payout claim contract failed: fresh sibling claim was not complete';
  END IF;
END $$;

TRUNCATE public.ticket_payouts RESTART IDENTITY;
INSERT INTO public.ticket_payouts (
  event_id, organizer_user_id, stripe_account_id_snapshot, amount_cents, status
) VALUES (
  '61000000-0000-4000-8000-000000000011',
  '62000000-0000-4000-8000-000000000001',
  'acct_A',
  100,
  'pending'
);

DO $$
DECLARE
  result text;
BEGIN
  result := public.claim_ticket_payout_batch(
    '62000000-0000-4000-8000-000000000001',
    'acct_A',
    '[{"event_id":"61000000-0000-4000-8000-000000000011","amount_cents":100},{"event_id":"61000000-0000-4000-8000-000000000012","amount_cents":200}]'
  );
  IF result <> 'busy'
    OR EXISTS (SELECT 1 FROM public.ticket_payouts WHERE event_id = '61000000-0000-4000-8000-000000000012')
  THEN
    RAISE EXCEPTION 'payout claim contract failed: conflict left a partial sibling claim';
  END IF;
END $$;

TRUNCATE public.ticket_payouts RESTART IDENTITY;
INSERT INTO public.ticket_payouts (
  event_id, organizer_user_id, stripe_account_id_snapshot, amount_cents, status,
  failure_message, stripe_payout_id, released_at
) VALUES (
  '61000000-0000-4000-8000-000000000021',
  '62000000-0000-4000-8000-000000000001',
  'acct_A',
  50,
  'failed',
  'old failure',
  'po_old',
  now()
);

DO $$
DECLARE
  result text;
BEGIN
  result := public.claim_ticket_payout_batch(
    '62000000-0000-4000-8000-000000000001',
    'acct_A',
    '[{"event_id":"61000000-0000-4000-8000-000000000021","amount_cents":150},{"event_id":"61000000-0000-4000-8000-000000000022","amount_cents":250}]'
  );
  IF result <> 'claimed'
    OR (SELECT count(*) FROM public.ticket_payouts WHERE status = 'pending') <> 2
    OR EXISTS (
      SELECT 1 FROM public.ticket_payouts
      WHERE event_id = '61000000-0000-4000-8000-000000000021'
        AND (amount_cents <> 150 OR failure_message IS NOT NULL OR stripe_payout_id IS NOT NULL OR released_at IS NOT NULL)
    )
  THEN
    RAISE EXCEPTION 'payout claim contract failed: failed sibling reclaim was not complete';
  END IF;
END $$;

TRUNCATE public.ticket_payouts RESTART IDENTITY;
DO $$
DECLARE
  result text;
BEGIN
  result := public.claim_ticket_payout_batch(
    '62000000-0000-4000-8000-000000000001',
    'acct_A',
    '[{"event_id":"61000000-0000-4000-8000-000000000031","amount_cents":100},{"event_id":"61000000-0000-4000-8000-000000000031","amount_cents":100}]'
  );
  IF result <> 'invalid' OR EXISTS (SELECT 1 FROM public.ticket_payouts) THEN
    RAISE EXCEPTION 'payout claim contract failed: duplicate input mutated state';
  END IF;
END $$;

TRUNCATE public.ticket_payouts RESTART IDENTITY;
SELECT dblink_connect('payout_session_a', 'dbname=payout_contract');
SELECT dblink_connect('payout_session_b', 'dbname=payout_contract');
SELECT dblink_send_query(
  'payout_session_a',
  $$SELECT public.claim_ticket_payout_batch(
    '62000000-0000-4000-8000-000000000001',
    'acct_A',
    '[{"event_id":"61000000-0000-4000-8000-000000000041","amount_cents":100},{"event_id":"61000000-0000-4000-8000-000000000042","amount_cents":200}]'
  )$$
);
SELECT dblink_send_query(
  'payout_session_b',
  $$SELECT public.claim_ticket_payout_batch(
    '62000000-0000-4000-8000-000000000001',
    'acct_A',
    '[{"event_id":"61000000-0000-4000-8000-000000000041","amount_cents":100},{"event_id":"61000000-0000-4000-8000-000000000042","amount_cents":200}]'
  )$$
);

CREATE TEMP TABLE payout_session_results (result text NOT NULL);
INSERT INTO payout_session_results
SELECT result FROM dblink_get_result('payout_session_a') AS t(result text);
INSERT INTO payout_session_results
SELECT result FROM dblink_get_result('payout_session_b') AS t(result text);

DO $$
BEGIN
  IF (SELECT count(*) FROM payout_session_results WHERE result = 'claimed') <> 1
    OR (SELECT count(*) FROM payout_session_results WHERE result = 'busy') <> 1
    OR (SELECT count(*) FROM public.ticket_payouts WHERE status = 'pending') <> 2
  THEN
    RAISE EXCEPTION 'payout claim contract failed: concurrent claims split or duplicated the batch';
  END IF;
END $$;

SELECT dblink_disconnect('payout_session_a');
SELECT dblink_disconnect('payout_session_b');
SELECT 'PASS payout claim: complete fresh, rollback on conflict, reclaim, duplicate rejection, concurrent winner' AS result;
