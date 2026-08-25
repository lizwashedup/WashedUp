-- REVIEW ONLY. DO NOT APPLY TO PRODUCTION.
--
-- Local proposal for mechanically decidable database hardening found in the
-- 2026-08-24 live-function audit. This file is intentionally outside
-- supabase/migrations. It does not choose moderation presentation, evidence
-- retention, recipient routing, or any other product policy.
--
-- Production prerequisites before promotion:
--   1. Re-capture exact live definitions, owners, triggers, ACLs, and schema.
--   2. Reconcile the repository migration history and create a forward-only
--      migration from this reviewed proposal.
--   3. Run the full private contract suite against a production-faithful copy.
--   4. Obtain fresh approval for the migration and deployment.

BEGIN;

DO $preflight$
DECLARE
  missing text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.organizer_receivables') IS NULL THEN
    missing := array_append(missing, 'public.organizer_receivables');
  END IF;
  IF to_regclass('public.ticket_orders') IS NULL THEN
    missing := array_append(missing, 'public.ticket_orders');
  END IF;
  IF to_regclass('public.ticket_questions') IS NULL THEN
    missing := array_append(missing, 'public.ticket_questions');
  END IF;
  IF to_regclass('public.ticket_answers') IS NULL THEN
    missing := array_append(missing, 'public.ticket_answers');
  END IF;
  IF to_regclass('public.banned_identifiers') IS NULL THEN
    missing := array_append(missing, 'public.banned_identifiers');
  END IF;
  IF to_regprocedure('public.normalize_email(text)') IS NULL THEN
    missing := array_append(missing, 'public.normalize_email(text)');
  END IF;
  IF to_regprocedure('public.phash_distance_256(text,text)') IS NULL THEN
    missing := array_append(missing, 'public.phash_distance_256(text,text)');
  END IF;
  IF to_regprocedure('public.list_ticket_payouts_blocked()') IS NULL THEN
    missing := array_append(missing, 'public.list_ticket_payouts_blocked()');
  END IF;

  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'technical hardening preflight failed: missing %',
      array_to_string(missing, ', ');
  END IF;
END;
$preflight$;

-- -------------------------------------------------------------------------
-- Money: immutable per-payout receivable allocations and whole-call replay.
-- -------------------------------------------------------------------------

CREATE TABLE public.organizer_receivable_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receivable_id uuid NOT NULL
    REFERENCES public.organizer_receivables(id) ON DELETE RESTRICT,
  organizer_user_id uuid NOT NULL,
  stripe_payout_id text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizer_receivable_allocations_identity
    UNIQUE (receivable_id, stripe_payout_id),
  CONSTRAINT organizer_receivable_allocations_payout_format
    CHECK (btrim(stripe_payout_id) <> '')
);

CREATE INDEX organizer_receivable_allocations_organizer_created_idx
  ON public.organizer_receivable_allocations (organizer_user_id, created_at, id);

CREATE TABLE public.organizer_receivable_consumptions (
  stripe_payout_id text PRIMARY KEY,
  organizer_user_id uuid NOT NULL,
  requested_cents integer NOT NULL CHECK (requested_cents > 0),
  consumed_cents integer NOT NULL CHECK (consumed_cents > 0),
  completed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizer_receivable_consumptions_exact
    CHECK (consumed_cents = requested_cents),
  CONSTRAINT organizer_receivable_consumptions_payout_format
    CHECK (btrim(stripe_payout_id) <> '')
);

ALTER TABLE public.organizer_receivable_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizer_receivable_consumptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organizer_receivable_allocations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.organizer_receivable_consumptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.organizer_receivable_allocations TO service_role;
GRANT ALL ON public.organizer_receivable_consumptions TO service_role;

CREATE OR REPLACE FUNCTION public.consume_organizer_receivables(
  p_organizer_user_id uuid,
  p_amount_cents integer,
  p_stripe_payout_id text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_row record;
  v_existing record;
  v_left integer;
  v_take integer;
  v_outstanding integer;
BEGIN
  IF p_organizer_user_id IS NULL THEN
    RAISE EXCEPTION 'consume: organizer is required';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'consume: amount must be positive';
  END IF;
  IF coalesce(btrim(p_stripe_payout_id), '') = '' THEN
    RAISE EXCEPTION 'consume: a stripe payout id is required';
  END IF;

  -- One organizer's receivable stream is consumed in FIFO order. The lock
  -- also makes an exact Stripe payout replay deterministic.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organizer_user_id::text, 7321)
  );

  SELECT organizer_user_id, requested_cents, consumed_cents
    INTO v_existing
  FROM public.organizer_receivable_consumptions
  WHERE stripe_payout_id = p_stripe_payout_id;

  IF FOUND THEN
    IF v_existing.organizer_user_id IS DISTINCT FROM p_organizer_user_id
       OR v_existing.requested_cents IS DISTINCT FROM p_amount_cents THEN
      RAISE EXCEPTION 'consume: payout id was already used with different inputs';
    END IF;
    RETURN v_existing.consumed_cents;
  END IF;

  PERFORM 1
  FROM public.organizer_receivables r
  WHERE r.organizer_user_id = p_organizer_user_id
    AND r.settled_at IS NULL
  FOR UPDATE;

  SELECT coalesce(sum(r.amount_cents - r.consumed_cents), 0)::integer
    INTO v_outstanding
  FROM public.organizer_receivables r
  WHERE r.organizer_user_id = p_organizer_user_id
    AND r.settled_at IS NULL;

  IF p_amount_cents > v_outstanding THEN
    RAISE EXCEPTION 'consume: % exceeds the outstanding receivable % for organizer %',
      p_amount_cents, v_outstanding, p_organizer_user_id;
  END IF;

  v_left := p_amount_cents;
  FOR v_row IN
    SELECT r.id, r.amount_cents, r.consumed_cents
    FROM public.organizer_receivables r
    WHERE r.organizer_user_id = p_organizer_user_id
      AND r.settled_at IS NULL
    ORDER BY r.created_at, r.id
    FOR UPDATE
  LOOP
    EXIT WHEN v_left = 0;
    v_take := least(v_left, v_row.amount_cents - v_row.consumed_cents);
    IF v_take <= 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.organizer_receivable_allocations (
      receivable_id, organizer_user_id, stripe_payout_id, amount_cents
    ) VALUES (
      v_row.id, p_organizer_user_id, p_stripe_payout_id, v_take
    );

    UPDATE public.organizer_receivables
       SET consumed_cents = consumed_cents + v_take,
           last_stripe_payout_id = p_stripe_payout_id,
           settled_at = CASE
             WHEN consumed_cents + v_take = amount_cents THEN now()
             ELSE NULL
           END
     WHERE id = v_row.id;

    v_left := v_left - v_take;
  END LOOP;

  IF v_left <> 0 THEN
    RAISE EXCEPTION 'consume: internal allocation shortfall of % cents', v_left;
  END IF;

  INSERT INTO public.organizer_receivable_consumptions (
    stripe_payout_id, organizer_user_id, requested_cents, consumed_cents
  ) VALUES (
    p_stripe_payout_id, p_organizer_user_id, p_amount_cents, p_amount_cents
  );

  RETURN p_amount_cents;
END;
$function$;

ALTER FUNCTION public.consume_organizer_receivables(uuid, integer, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.consume_organizer_receivables(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_organizer_receivables(uuid, integer, text) TO service_role;

-- Durable, deduplicated operational evidence for the existing blocked-payout
-- query. No notification or automatic resolution behavior is chosen here.
CREATE TABLE public.ticket_payout_blocked_cases (
  organizer_user_id uuid PRIMARY KEY,
  gross_due_cents integer NOT NULL CHECK (gross_due_cents > 0),
  receivable_outstanding_cents integer NOT NULL
    CHECK (receivable_outstanding_cents >= gross_due_cents),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  resolved_at timestamptz,
  resolution_note text,
  CONSTRAINT ticket_payout_blocked_cases_resolution_pair CHECK (
    (status = 'open' AND resolved_at IS NULL)
    OR (status = 'resolved' AND resolved_at IS NOT NULL)
  )
);

ALTER TABLE public.ticket_payout_blocked_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticket_payout_blocked_cases FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ticket_payout_blocked_cases TO service_role;

CREATE OR REPLACE FUNCTION public.record_ticket_payouts_blocked()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_case record;
  v_count integer := 0;
BEGIN
  FOR v_case IN SELECT * FROM public.list_ticket_payouts_blocked()
  LOOP
    INSERT INTO public.ticket_payout_blocked_cases (
      organizer_user_id, gross_due_cents, receivable_outstanding_cents
    ) VALUES (
      v_case.organizer_user_id,
      v_case.gross_due_cents,
      v_case.receivable_outstanding_cents
    )
    ON CONFLICT (organizer_user_id) DO UPDATE
      SET gross_due_cents = EXCLUDED.gross_due_cents,
          receivable_outstanding_cents = EXCLUDED.receivable_outstanding_cents,
          status = 'open',
          last_seen_at = now(),
          occurrence_count = public.ticket_payout_blocked_cases.occurrence_count + 1,
          resolved_at = NULL,
          resolution_note = NULL;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

ALTER FUNCTION public.record_ticket_payouts_blocked() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_ticket_payouts_blocked() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ticket_payouts_blocked() TO service_role;

-- -------------------------------------------------------------------------
-- Refund review: preserve the reason and timestamp before clearing the queue.
-- -------------------------------------------------------------------------

CREATE TABLE public.ticket_refund_review_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.ticket_orders(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('resolved')),
  original_reason text NOT NULL,
  originally_flagged_at timestamptz NOT NULL,
  resolution_reason text NOT NULL CHECK (btrim(resolution_reason) <> ''),
  resolution_source text NOT NULL CHECK (btrim(resolution_source) <> ''),
  resolver_user_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ticket_refund_review_actions_order_occurred_idx
  ON public.ticket_refund_review_actions (order_id, occurred_at, id);

ALTER TABLE public.ticket_refund_review_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticket_refund_review_actions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ticket_refund_review_actions TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_order_refund_review(
  p_order_id uuid,
  p_resolution_reason text,
  p_resolution_source text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_order record;
BEGIN
  IF coalesce(btrim(p_resolution_reason), '') = '' THEN
    RAISE EXCEPTION 'refund review: resolution reason is required';
  END IF;
  IF coalesce(btrim(p_resolution_source), '') = '' THEN
    RAISE EXCEPTION 'refund review: resolution source is required';
  END IF;

  SELECT id, needs_refund_review, refund_review_reason, refund_review_flagged_at
    INTO v_order
  FROM public.ticket_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN 'no_order';
  END IF;
  IF NOT v_order.needs_refund_review THEN
    RETURN 'not_flagged';
  END IF;

  INSERT INTO public.ticket_refund_review_actions (
    order_id,
    action,
    original_reason,
    originally_flagged_at,
    resolution_reason,
    resolution_source,
    resolver_user_id
  ) VALUES (
    v_order.id,
    'resolved',
    v_order.refund_review_reason,
    v_order.refund_review_flagged_at,
    btrim(p_resolution_reason),
    btrim(p_resolution_source),
    auth.uid()
  );

  UPDATE public.ticket_orders
     SET needs_refund_review = false,
         refund_review_reason = NULL,
         refund_review_flagged_at = NULL
   WHERE id = p_order_id;

  RETURN 'resolved';
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_order_refund_review(p_order_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT public.resolve_order_refund_review(
    p_order_id,
    'resolved by existing caller',
    'existing_one_argument_rpc'
  );
$function$;

ALTER FUNCTION public.resolve_order_refund_review(uuid, text, text) OWNER TO postgres;
ALTER FUNCTION public.resolve_order_refund_review(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_order_refund_review(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_order_refund_review(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_order_refund_review(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_order_refund_review(uuid) TO service_role;

-- -------------------------------------------------------------------------
-- Ticket questions and answers: dynamic bounds plus serialized cap checks.
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_ticket_answers_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_order record;
  v_question record;
BEGIN
  SELECT event_id, qty, status INTO v_order
  FROM public.ticket_orders WHERE id = new.order_id;
  SELECT event_id, scope, is_active INTO v_question
  FROM public.ticket_questions WHERE id = new.question_id;

  IF v_order.event_id IS DISTINCT FROM v_question.event_id THEN
    RAISE EXCEPTION 'answer links a question and an order from different events';
  END IF;
  IF v_order.status NOT IN ('pending', 'paid') THEN
    RAISE EXCEPTION 'answers attach to pending or paid orders only';
  END IF;
  IF NOT v_question.is_active THEN
    RAISE EXCEPTION 'this question is no longer active';
  END IF;
  IF v_question.scope = 'per_order' AND new.attendee_index IS NOT NULL THEN
    RAISE EXCEPTION 'a per-order question takes no attendee_index';
  END IF;
  IF v_question.scope = 'per_attendee'
     AND (
       new.attendee_index IS NULL
       OR new.attendee_index < 1
       OR new.attendee_index > v_order.qty
     ) THEN
    RAISE EXCEPTION 'a per-attendee answer needs attendee_index between 1 and the order qty';
  END IF;
  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_ticket_questions_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF new.is_active THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.event_id::text, 110011)
    );
    IF (
      SELECT count(*)
      FROM public.ticket_questions q
      WHERE q.event_id = new.event_id
        AND q.is_active
        AND q.id <> new.id
    ) >= 11 THEN
      RAISE EXCEPTION 'an event carries at most 11 active buyer questions';
    END IF;
  END IF;
  RETURN new;
END;
$function$;

ALTER FUNCTION public.tg_ticket_answers_validate() OWNER TO postgres;
ALTER FUNCTION public.tg_ticket_questions_cap() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tg_ticket_answers_validate() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_ticket_questions_cap() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_ticket_answers_validate() TO service_role;
GRANT EXECUTE ON FUNCTION public.tg_ticket_questions_cap() TO service_role;

-- -------------------------------------------------------------------------
-- Ban helpers: one canonical comparison rule and bounded photo-hash inputs.
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_identifier_banned(
  check_email text DEFAULT NULL,
  check_phone text DEFAULT NULL
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.banned_identifiers bi
    WHERE (
      check_email IS NOT NULL
      AND bi.normalized_email = public.normalize_email(check_email)
    ) OR (
      nullif(pg_catalog.regexp_replace(check_phone, '\D', '', 'g'), '') IS NOT NULL
      AND pg_catalog.regexp_replace(bi.phone_number, '\D', '', 'g')
          = pg_catalog.regexp_replace(check_phone, '\D', '', 'g')
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_photo_banned(hash text, threshold integer DEFAULT 8)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF hash IS NULL OR hash !~ '^[0-9A-Fa-f]{64}$' THEN
    RAISE EXCEPTION 'photo hash must be exactly 64 hexadecimal characters'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF threshold IS NULL OR threshold < 0 OR threshold > 256 THEN
    RAISE EXCEPTION 'photo threshold must be between 0 and 256'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.banned_identifiers bi
    WHERE bi.photo_hash IS NOT NULL
      AND public.phash_distance_256(bi.photo_hash, hash) <= threshold
  );
END;
$function$;

ALTER FUNCTION public.is_identifier_banned(text, text) OWNER TO postgres;
ALTER FUNCTION public.is_photo_banned(text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_identifier_banned(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_photo_banned(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_identifier_banned(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_photo_banned(text, integer) TO service_role;

COMMIT;
