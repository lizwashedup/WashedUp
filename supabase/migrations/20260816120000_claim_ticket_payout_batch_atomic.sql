-- REVIEW ONLY. Do not apply without the normal live migration approval.
-- Claims every event in one organizer payout inside one database statement.

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_ticket_payout_batch(
  p_organizer_user_id uuid,
  p_stripe_account_id text,
  p_events jsonb
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  requested_count integer;
  claimed_count integer;
BEGIN
  IF p_organizer_user_id IS NULL
    OR coalesce(p_stripe_account_id, '') !~ '^acct_[A-Za-z0-9]+$'
    OR p_events IS NULL
    OR jsonb_typeof(p_events) <> 'array'
    OR jsonb_array_length(p_events) = 0
  THEN
    RETURN 'invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_events) AS item(value)
    WHERE jsonb_typeof(value) <> 'object'
      OR coalesce(value->>'event_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR CASE
        WHEN coalesce(value->>'amount_cents', '') ~ '^[1-9][0-9]*$'
          THEN (value->>'amount_cents')::numeric > 2147483647
        ELSE true
      END
  ) THEN
    RETURN 'invalid';
  END IF;

  SELECT count(*), count(DISTINCT value->>'event_id')
  INTO requested_count, claimed_count
  FROM jsonb_array_elements(p_events) AS item(value);
  IF requested_count <> claimed_count THEN RETURN 'invalid'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_organizer_user_id::text, 0));

  BEGIN
    WITH requested AS (
      SELECT
        (value->>'event_id')::uuid AS event_id,
        (value->>'amount_cents')::integer AS amount_cents
      FROM jsonb_array_elements(p_events) AS item(value)
    ), claimed AS (
      INSERT INTO public.ticket_payouts (
        event_id,
        organizer_user_id,
        stripe_account_id_snapshot,
        amount_cents,
        status,
        failure_message
      )
      SELECT
        event_id,
        p_organizer_user_id,
        p_stripe_account_id,
        amount_cents,
        'pending',
        NULL
      FROM requested
      ON CONFLICT ON CONSTRAINT ticket_payouts_one_per_event
      DO UPDATE SET
        organizer_user_id = EXCLUDED.organizer_user_id,
        stripe_account_id_snapshot = EXCLUDED.stripe_account_id_snapshot,
        amount_cents = EXCLUDED.amount_cents,
        status = 'pending',
        failure_message = NULL,
        stripe_payout_id = NULL,
        released_at = NULL
      WHERE ticket_payouts.status = 'failed'
        AND ticket_payouts.organizer_user_id = EXCLUDED.organizer_user_id
      RETURNING event_id
    )
    SELECT count(*) INTO claimed_count FROM claimed;

    IF claimed_count <> requested_count THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'claim_busy';
    END IF;
  EXCEPTION
    WHEN unique_violation THEN RETURN 'busy';
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM = 'claim_busy' THEN RETURN 'busy'; END IF;
      RAISE;
  END;

  RETURN 'claimed';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_ticket_payout_batch(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ticket_payout_batch(uuid, text, jsonb)
  TO service_role;

COMMIT;
