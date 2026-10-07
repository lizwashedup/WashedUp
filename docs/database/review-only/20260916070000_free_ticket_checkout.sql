-- Pair with create-ticket-checkout's provider-independent free path.
-- Reuse every existing admission, stock, promo, answer and attempt-stop rule.
-- The exception rolls back any allocation inside begin_ticket_checkout when
-- its authoritative saved price is not free. A client quote is never trusted.
CREATE OR REPLACE FUNCTION public.begin_free_ticket_checkout(
  p_tier_id uuid, p_qty integer, p_buyer_user_id uuid, p_buyer_name text,
  p_idempotency_key text DEFAULT NULL, p_promo_code text DEFAULT NULL,
  p_add_ons jsonb DEFAULT NULL, p_answers jsonb DEFAULT NULL
) RETURNS TABLE(
  order_id uuid, hold_id uuid, hold_expires_at timestamptz, reference_code text,
  organizer_stripe_account_id text, is_free boolean, unit_face_cents integer,
  face_cents integer, processing_cents integer, commission_cents integer,
  total_cents integer, commission_bps_applied integer, stripe_checkout_session_id text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result record;
BEGIN
  SELECT * INTO STRICT result FROM public.begin_ticket_checkout(
    p_tier_id, p_qty, p_buyer_user_id, p_buyer_name,
    p_idempotency_key, p_promo_code, p_add_ons, p_answers
  );
  IF result.is_free IS DISTINCT FROM TRUE OR result.face_cents IS DISTINCT FROM 0
     OR result.total_cents IS DISTINCT FROM 0 OR result.processing_cents IS DISTINCT FROM 0
     OR result.commission_cents IS DISTINCT FROM 0 OR result.stripe_checkout_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'ticketing payments are not configured yet.';
  END IF;
  RETURN QUERY SELECT result.order_id, result.hold_id, result.hold_expires_at,
    result.reference_code, result.organizer_stripe_account_id, result.is_free,
    result.unit_face_cents, result.face_cents, result.processing_cents,
    result.commission_cents, result.total_cents, result.commission_bps_applied,
    result.stripe_checkout_session_id;
END;
$$;
REVOKE ALL ON FUNCTION public.begin_free_ticket_checkout(uuid,integer,uuid,text,text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_free_ticket_checkout(uuid,integer,uuid,text,text,text,jsonb,jsonb) TO service_role;
COMMENT ON FUNCTION public.begin_free_ticket_checkout(uuid,integer,uuid,text,text,text,jsonb,jsonb) IS 'Service-only zero-total checkout, using existing begin rules and rolling back non-free allocations.';
