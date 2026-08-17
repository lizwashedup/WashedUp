\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.test_claim_and_hold(
  p_order_id uuid,
  p_claim_key text,
  p_hold_seconds double precision
) RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  claim_result text;
BEGIN
  claim_result := public.claim_ticket_refund(p_order_id, p_claim_key);
  PERFORM pg_advisory_lock(8675309);
  PERFORM pg_sleep(p_hold_seconds);
  PERFORM pg_advisory_unlock(8675309);
  RETURN claim_result;
END;
$$;

SELECT dblink_connect('refund_session_a', 'dbname=refund_contract');
SELECT dblink_connect('refund_session_b', 'dbname=refund_contract');

SELECT dblink_send_query(
  'refund_session_a',
  $$SELECT public.test_claim_and_hold(
      '30000000-0000-0000-0000-000000000001'::uuid,
      'claim-a',
      1.5
    )$$
);

DO $$
DECLARE
  deadline timestamptz := clock_timestamp() + interval '3 seconds';
BEGIN
  LOOP
    EXIT WHEN EXISTS (
      SELECT 1
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND objid = 8675309
        AND granted
    );
    IF clock_timestamp() >= deadline THEN
      RAISE EXCEPTION 'refund lock contract failed: session A never reached the post-claim barrier';
    END IF;
    PERFORM pg_sleep(0.01);
  END LOOP;
END $$;

SELECT dblink_send_query(
  'refund_session_b',
  $$SELECT public.claim_ticket_refund(
      '30000000-0000-0000-0000-000000000001'::uuid,
      'claim-b'
    )$$
);

CREATE TEMP TABLE refund_session_results (
  session_name text PRIMARY KEY,
  claim_result text NOT NULL
);

INSERT INTO refund_session_results
SELECT 'a', test_claim_and_hold
FROM dblink_get_result('refund_session_a') AS t(test_claim_and_hold text);

INSERT INTO refund_session_results
SELECT 'b', claim_ticket_refund
FROM dblink_get_result('refund_session_b') AS t(claim_ticket_refund text);

DO $$
DECLARE
  session_a text;
  session_b text;
  held_key text;
BEGIN
  SELECT claim_result INTO session_a FROM refund_session_results WHERE session_name = 'a';
  SELECT claim_result INTO session_b FROM refund_session_results WHERE session_name = 'b';
  SELECT refund_claim_key INTO held_key
  FROM public.ticket_orders
  WHERE id = '30000000-0000-0000-0000-000000000001';

  IF session_a <> 'claimed' THEN
    RAISE EXCEPTION 'refund lock contract failed: session A returned %', session_a;
  END IF;
  IF session_b <> 'busy' THEN
    RAISE EXCEPTION 'refund lock contract failed: session B returned %, expected busy', session_b;
  END IF;
  IF held_key <> 'claim-a' THEN
    RAISE EXCEPTION 'refund lock contract failed: held key is %, expected claim-a', held_key;
  END IF;
END $$;

DO $$
BEGIN
  IF public.release_ticket_refund_claim(
    '30000000-0000-0000-0000-000000000001',
    'claim-b'
  ) <> 'not_held' THEN
    RAISE EXCEPTION 'refund release contract failed: stale key released another session claim';
  END IF;

  IF public.release_ticket_refund_claim(
    '30000000-0000-0000-0000-000000000001',
    'claim-a'
  ) <> 'released' THEN
    RAISE EXCEPTION 'refund release contract failed: owner could not release claim';
  END IF;
END $$;

SELECT dblink_disconnect('refund_session_a');
SELECT dblink_disconnect('refund_session_b');

SELECT 'PASS refund locking: two database sessions, one claim winner, keyed release' AS result;
