-- DRAFT. NOT APPLIED to any database (local, staging, or production).
-- Written 2026-09-04 against Liz's approved ticket-transfer model
-- (LIZ-OPEN-QUESTIONS.md, item 15, confirmed verbatim 2026-09-03):
--   "Agree with the proposed transfer model. Only the current ticket holder
--   may initiate a transfer, and each ticket may have only one pending
--   transfer at a time. The recipient claims the ticket through the existing
--   referral-style flow. If the event includes an age gate, waiver, or
--   attendee-specific required questions, the recipient must complete those
--   questions for themselves before the transfer is accepted; answers from
--   the original attendee must never carry over. Final waiver handling
--   should be confirmed through the appropriate legal review before release."
--
-- LEGAL REVIEW REQUIRED BEFORE RELEASE (Liz's own words above): this
-- migration builds the mechanism to re-collect required per-attendee
-- answers fresh from the transfer recipient (see claim_ticket_transfer
-- below). It does not certify that mechanism as legally sufficient for a
-- waiver or age-gate question. Do not ship this without that sign-off.
--
-- Design, matching this repo's own existing shape rather than inventing a
-- new one:
--   - Transfer is seat-level, not order-level. ticket_orders.status is
--     never touched (checked everywhere else in this codebase); the target
--     is ticket_order_positions, the same per-seat table attendees.tsx,
--     the door check-in RPC, and ticket-inbox-drain already key off.
--   - current_holder_user_id is nullable: null means the seat is still with
--     the order's own buyer_user_id (zero backfill needed for the 100% of
--     seats that have never transferred).
--   - The recipient claims via the same /r/<code>-shaped flow already
--     shipped and locked for referrals (claim_referral_invite,
--     app/r/[code].tsx, lib/yours/referralLink.ts): a short random code,
--     an authenticated-only SECURITY DEFINER RPC, GRANT to authenticated /
--     REVOKE from anon, a DO $$ self-test block. This migration reuses that
--     exact idiom for the transfer's own /t/<code>.
--   - Per-attendee answers (ticket_answers.attendee_index = the seat's
--     position_index) for that one seat are replaced at claim time with the
--     recipient's fresh answers. Per-order answers (attendee_index IS NULL)
--     belong to the whole order, not this seat, and are never touched.

BEGIN;

-- ── current holder ────────────────────────────────────────────────────────

ALTER TABLE public.ticket_order_positions
  ADD COLUMN IF NOT EXISTS current_holder_user_id uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.ticket_order_positions.current_holder_user_id IS
  'Null = still with the order''s own buyer_user_id. Set only by claim_ticket_transfer.';

-- ── audit table ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ticket_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id uuid NOT NULL REFERENCES public.ticket_order_positions(id),
  order_id uuid NOT NULL REFERENCES public.ticket_orders(id),
  event_id uuid NOT NULL REFERENCES public.explore_events(id),
  from_user_id uuid NOT NULL REFERENCES auth.users(id),
  transfer_code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'canceled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  canceled_at timestamptz,
  claimed_at timestamptz,
  claimed_by_user_id uuid REFERENCES auth.users(id),
  CONSTRAINT ticket_transfers_claimed_fields_match CHECK (
    (status = 'claimed') = (claimed_at IS NOT NULL AND claimed_by_user_id IS NOT NULL)
  )
);

-- "each ticket may have only one pending transfer at a time" -- enforced at
-- the database, not just checked in the RPC, so a race can't create two.
CREATE UNIQUE INDEX IF NOT EXISTS ticket_transfers_one_pending_per_position
  ON public.ticket_transfers (position_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS ticket_transfers_from_user_idx ON public.ticket_transfers (from_user_id);
CREATE INDEX IF NOT EXISTS ticket_transfers_claimed_by_idx ON public.ticket_transfers (claimed_by_user_id);

ALTER TABLE public.ticket_transfers ENABLE ROW LEVEL SECURITY;

-- Both parties to a transfer can see it; no client ever writes this table
-- directly -- every write goes through a SECURITY DEFINER RPC below.
CREATE POLICY ticket_transfers_select_own ON public.ticket_transfers
  FOR SELECT
  USING (auth.uid() = from_user_id OR auth.uid() = claimed_by_user_id);

-- ── who currently holds a seat (original buyer, unless transferred) ───────

CREATE OR REPLACE FUNCTION public.current_ticket_holder(p_position_id uuid)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(p.current_holder_user_id, o.buyer_user_id)
  FROM public.ticket_order_positions p
  JOIN public.ticket_orders o ON o.id = p.order_id
  WHERE p.id = p_position_id;
$$;

REVOKE ALL ON FUNCTION public.current_ticket_holder(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_ticket_holder(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.current_ticket_holder(uuid) TO authenticated;

-- ── preview a pending transfer by code (recipient, before they claim) ─────
-- ticket_transfers' own SELECT policy only covers from_user_id /
-- claimed_by_user_id, so a not-yet-claimed recipient cannot read the row
-- directly -- they are neither party yet. The claim screen still needs the
-- event to show what it is and to fetch that event's required per-attendee
-- questions before submitting an answer set. This returns the minimum
-- needed for that, nothing about the seat, order, or the sending holder.

CREATE OR REPLACE FUNCTION public.preview_ticket_transfer(p_code text)
  RETURNS TABLE (event_id uuid, event_title text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_code IS NULL OR p_code !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'invalid_transfer_code';
  END IF;
  RETURN QUERY
    SELECT e.id, e.title
    FROM public.ticket_transfers t
    JOIN public.explore_events e ON e.id = t.event_id
    WHERE t.transfer_code = p_code AND t.status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.preview_ticket_transfer(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.preview_ticket_transfer(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.preview_ticket_transfer(text) TO authenticated;

-- ── start a transfer (current holder only) ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.start_ticket_transfer(p_position_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_holder uuid := auth.uid();
  v_pos record;
  v_code text;
  v_attempt int := 0;
BEGIN
  IF v_holder IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT p.id, p.order_id, p.voided_at, o.event_id, o.status AS order_status,
         public.current_ticket_holder(p.id) AS holder
    INTO v_pos
  FROM public.ticket_order_positions p
  JOIN public.ticket_orders o ON o.id = p.order_id
  WHERE p.id = p_position_id
  FOR UPDATE OF p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_ticket';
  END IF;
  IF v_pos.holder IS DISTINCT FROM v_holder THEN
    RAISE EXCEPTION 'not_current_holder';
  END IF;
  IF v_pos.voided_at IS NOT NULL OR v_pos.order_status <> 'paid' THEN
    RAISE EXCEPTION 'ticket_not_transferable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ticket_transfers
    WHERE position_id = p_position_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'transfer_already_pending';
  END IF;

  -- Same shape as a referral code (^[A-Za-z0-9_-]{1,64}$); a handful of
  -- retries against the UNIQUE constraint is simpler and safer than reasoning
  -- about collision probability up front.
  LOOP
    v_attempt := v_attempt + 1;
    v_code := upper(substr(encode(extensions.gen_random_bytes(6), 'base64'), 1, 8));
    v_code := regexp_replace(v_code, '[^A-Z0-9]', '', 'g');
    EXIT WHEN length(v_code) >= 6;
    IF v_attempt > 20 THEN
      RAISE EXCEPTION 'code_generation_failed';
    END IF;
  END LOOP;

  INSERT INTO public.ticket_transfers (position_id, order_id, event_id, from_user_id, transfer_code)
  VALUES (p_position_id, v_pos.order_id, v_pos.event_id, v_holder, v_code);

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.start_ticket_transfer(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.start_ticket_transfer(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.start_ticket_transfer(uuid) TO authenticated;

-- ── cancel a pending transfer (the initiating holder only) ─────────────────
-- "Reversible only while pending" (Liz) needs an actual way to reverse it.

CREATE OR REPLACE FUNCTION public.cancel_ticket_transfer(p_transfer_code text)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_updated int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  UPDATE public.ticket_transfers
     SET status = 'canceled', canceled_at = now()
   WHERE transfer_code = p_transfer_code
     AND from_user_id = v_uid
     AND status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_ticket_transfer(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_ticket_transfer(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_ticket_transfer(text) TO authenticated;

-- ── claim a transfer (recipient) ───────────────────────────────────────────
-- p_answers shape: [{"question_id": "<uuid>", "value": <AnswerValue jsonb>}]
-- for every ACTIVE, REQUIRED, per_attendee ticket_questions row on the
-- transfer's event. Anything else in p_answers is ignored. Per-order
-- answers are never read or written here -- they belong to the order, not
-- this one seat.

CREATE OR REPLACE FUNCTION public.claim_ticket_transfer(p_code text, p_answers jsonb)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_recipient uuid := auth.uid();
  v_xfer record;
  v_pos record;
  v_q record;
  v_answer jsonb;
  v_found boolean;
BEGIN
  IF v_recipient IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_code IS NULL OR p_code !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'invalid_transfer_code';
  END IF;

  SELECT * INTO v_xfer
  FROM public.ticket_transfers
  WHERE transfer_code = p_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_transfer_code';
  END IF;
  IF v_xfer.status <> 'pending' THEN
    RAISE EXCEPTION 'transfer_not_pending';
  END IF;
  IF v_xfer.from_user_id = v_recipient THEN
    RAISE EXCEPTION 'invalid_recipient';
  END IF;

  SELECT p.id, p.voided_at, o.status AS order_status
    INTO v_pos
  FROM public.ticket_order_positions p
  JOIN public.ticket_orders o ON o.id = p.order_id
  WHERE p.id = v_xfer.position_id
  FOR UPDATE OF p;

  IF v_pos.voided_at IS NOT NULL OR v_pos.order_status <> 'paid' THEN
    RAISE EXCEPTION 'ticket_not_transferable';
  END IF;

  -- Re-collect every required per-attendee question fresh from the
  -- recipient. NEVER copy the original attendee's answers forward.
  -- *** LEGAL REVIEW REQUIRED (Liz, 2026-09-03) before this path ships: an
  -- age-gate or waiver authored as a ticket_questions row lands here too,
  -- and re-asking a stranger is a legal question, not just an engineering
  -- one. This code re-asks correctly; it does not certify that as
  -- sufficient. ***
  FOR v_q IN
    SELECT id, prompt FROM public.ticket_questions
    WHERE event_id = v_xfer.event_id
      AND scope = 'per_attendee'
      AND required = true
      AND is_active = true
  LOOP
    v_found := false;
    FOR v_answer IN SELECT * FROM jsonb_array_elements(COALESCE(p_answers, '[]'::jsonb))
    LOOP
      IF (v_answer->>'question_id')::uuid = v_q.id THEN
        v_found := true;
        DELETE FROM public.ticket_answers
         WHERE order_id = v_xfer.order_id
           AND question_id = v_q.id
           AND attendee_index = (
             SELECT position_index FROM public.ticket_order_positions WHERE id = v_xfer.position_id
           );
        INSERT INTO public.ticket_answers (order_id, question_id, attendee_index, value)
        SELECT v_xfer.order_id, v_q.id,
               (SELECT position_index FROM public.ticket_order_positions WHERE id = v_xfer.position_id),
               v_answer->'value';
        EXIT;
      END IF;
    END LOOP;
    IF NOT v_found THEN
      RAISE EXCEPTION 'missing_required_answer: %', v_q.prompt;
    END IF;
  END LOOP;

  UPDATE public.ticket_order_positions
     SET current_holder_user_id = v_recipient
   WHERE id = v_xfer.position_id;

  UPDATE public.ticket_transfers
     SET status = 'claimed', claimed_at = now(), claimed_by_user_id = v_recipient
   WHERE id = v_xfer.id;

  RETURN v_xfer.event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_ticket_transfer(text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_ticket_transfer(text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_ticket_transfer(text, jsonb) TO authenticated;

-- ── self-test ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'claim_ticket_transfer' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'self-test: claim_ticket_transfer missing or not SECURITY DEFINER';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE routine_schema = 'public'
      AND routine_name IN ('start_ticket_transfer', 'cancel_ticket_transfer', 'claim_ticket_transfer', 'current_ticket_holder', 'preview_ticket_transfer')
      AND grantee IN ('anon', 'PUBLIC')
  ) THEN
    RAISE EXCEPTION 'self-test: a transfer function is exposed outside authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'ticket_transfers_one_pending_per_position'
  ) THEN
    RAISE EXCEPTION 'self-test: one-pending-transfer-per-seat index missing';
  END IF;
END $$;

COMMIT;
