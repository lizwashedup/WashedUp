-- ═══════════════════════════════════════════════════════════════════════════
-- refund hardening: pre-Stripe concurrency claim (fix 2) + reconcile v3
-- (fix 3). NOT YET APPLIED. Apply with the other pending ticketing SQL, and
-- deploy the paired edge functions (ticket-refund, ticket-inbox-drain) in the
-- SAME window: the drain calls reconcile_dashboard_refund with a 4th argument
-- that does not exist until this runs, and ticket-refund calls two RPCs that
-- do not exist until this runs.
--
-- ORDER: this SQL FIRST, then the two functions. Between the two steps the
-- old drain keeps working (PostgREST resolves the 4-arg function by named
-- args, and the 3-arg name is gone, so the drain MUST be redeployed promptly
-- — see the rollback note at the bottom).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── fix 2, part 1: the claim columns ──────────────────────────────────────
-- A refund's row lock used to be taken by record_ticket_refund, which runs
-- AFTER Stripe has already moved money. That can only detect a double-spend,
-- never prevent one. These two columns hold a short-lived claim that
-- ticket-refund takes BEFORE its first Stripe call.
alter table public.ticket_orders
  add column if not exists refund_claim_key text,
  add column if not exists refund_claim_at  timestamptz;

comment on column public.ticket_orders.refund_claim_key is
  'short-lived pre-Stripe refund claim; also the Stripe idempotency key for that refund. null when no refund is in flight.';
comment on column public.ticket_orders.refund_claim_at is
  'when refund_claim_key was taken; a claim older than the staleness window in claim_ticket_refund is treated as abandoned.';


-- ── fix 2, part 2: take the claim ─────────────────────────────────────────
create or replace function public.claim_ticket_refund(p_order_id uuid, p_claim_key text)
 returns text
 language plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  -- an invocation that dies mid-refund must not wedge the order forever.
  -- ticket-refund's own Stripe work is seconds; the edge runtime kills a
  -- request long before this window, so a claim older than this is abandoned.
  v_stale constant interval := interval '3 minutes';
begin
  if p_claim_key is null or char_length(p_claim_key) = 0 or char_length(p_claim_key) > 255 then
    raise exception 'claim: a claim key is required';
  end if;

  -- the serialisation point: a concurrent claimer blocks here, then re-reads
  -- the committed row, so exactly one caller can win.
  select id, status, refund_claim_key, refund_claim_at into v_order
  from public.ticket_orders where id = p_order_id for update;

  if v_order.id is null then return 'no_order'; end if;
  -- re-checked UNDER the lock: the order may have flipped to refunded between
  -- the caller's read and this claim.
  if v_order.status <> 'paid' then return 'noop_status'; end if;

  if v_order.refund_claim_key is not null
     and v_order.refund_claim_key is distinct from p_claim_key
     and v_order.refund_claim_at > now() - v_stale then
    return 'busy';
  end if;

  -- SAME key = the caller's own retry of the identical refund. Let it through:
  -- the key is also the Stripe idempotency key, so Stripe replays the first
  -- answer instead of moving money a second time.
  update public.ticket_orders
     set refund_claim_key = p_claim_key, refund_claim_at = now()
   where id = p_order_id;
  return 'claimed';
end;
$function$;

revoke all on function public.claim_ticket_refund(uuid, text) from public;
revoke all on function public.claim_ticket_refund(uuid, text) from anon, authenticated;
grant execute on function public.claim_ticket_refund(uuid, text) to service_role;


-- ── fix 2, part 3: release the claim ──────────────────────────────────────
create or replace function public.release_ticket_refund_claim(p_order_id uuid, p_claim_key text)
 returns text
 language plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- keyed, so a stale invocation can never release the claim of the request
  -- that superseded it.
  update public.ticket_orders
     set refund_claim_key = null, refund_claim_at = null
   where id = p_order_id and refund_claim_key = p_claim_key;
  if found then return 'released'; end if;
  return 'not_held';
end;
$function$;

revoke all on function public.release_ticket_refund_claim(uuid, text) from public;
revoke all on function public.release_ticket_refund_claim(uuid, text) from anon, authenticated;
grant execute on function public.release_ticket_refund_claim(uuid, text) to service_role;


-- ── fix 3: reconcile v3 ───────────────────────────────────────────────────
-- v2 compared a single refund's amount against order.total_cents. That is the
-- right yardstick for exactly one case (a gross refund of a whole untouched
-- order) and wrong for the common one: a buyer_request refund is FACE ONLY,
-- so it is always short of total_cents by the processing share and was being
-- flagged for manual review whenever the drain beat record_ticket_refund's
-- commit. v2 also hardcoded kind 'admin', mislabelling real organizer
-- cancels; worse, applying only the amount fix would have started routing
-- face-only buyer refunds into record with kind 'admin', which adds the
-- processing share to total_refunded_cents and births a phantom
-- processing_shortfall receivable against the organizer.
--
-- v3: the two candidate totals come from compute_ticket_refund over the seats
-- still live (so it stays correct on a partly-refunded order and can never
-- drift from the money math), and the kind comes from the refund's own Stripe
-- metadata, carried by the drain. Amount and kind must corroborate each other
-- or it falls through to the human.
drop function if exists public.reconcile_dashboard_refund(text, text, integer);

create or replace function public.reconcile_dashboard_refund(
  p_payment_intent_id text,
  p_stripe_refund_id text,
  p_refund_amount_cents integer,
  p_refund_kind text default null
)
 returns text
 language plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_voided int;
  v_kind text;
  v_full_face int;
  v_full_gross int;
  v_live int;
  v_reason text;
begin
  if p_payment_intent_id is null then
    return 'no_order';                       -- F3: dashboard charges can carry pi = null
  end if;
  if p_payment_intent_id !~ '^pi_' then
    raise exception 'reconcile: bad payment_intent';
  end if;
  if p_stripe_refund_id is null or p_stripe_refund_id !~ '^re_' then
    raise exception 'reconcile: bad refund id';
  end if;
  if p_refund_amount_cents is null or p_refund_amount_cents <= 0 then
    raise exception 'reconcile: refund amount out of range (%)', p_refund_amount_cents;
  end if;

  -- F1: a refund id already in the 89 ledger was recorded by OUR executor
  -- (or a prior reconcile) — a webhook redelivery must not double-act
  if exists (select 1 from public.ticket_refunds r
             where r.stripe_refund_id = p_stripe_refund_id) then
    return 'already_recorded';
  end if;

  -- only a settled order (paid, or already-refunded on replay) is
  -- reconcilable; a pending/canceled order never carried a captured charge
  select id, status into v_order
  from public.ticket_orders
  where stripe_payment_intent_id = p_payment_intent_id
  order by paid_at nulls last
  limit 1;
  if v_order.id is null then
    return 'no_order';        -- a dashboard refund on a charge we don't own
  end if;
  if v_order.status not in ('paid', 'refunded') then
    return 'noop_status';
  end if;

  -- the kind ticket-refund stamped on the Stripe refund's metadata. Absent (or
  -- unrecognised) = an unattributed dashboard refund. Never trusted on its
  -- own: the amount has to agree with it below.
  v_kind := case when p_refund_kind in ('buyer_request', 'organizer_cancel', 'admin')
                 then p_refund_kind else null end;

  -- what a FULL refund of the still-live seats is worth under each law, from
  -- the one source of refund amounts. buyer_request = face only;
  -- organizer_cancel = face + the processing share (the gross).
  select refund_amount_cents, position_count into v_full_face, v_live
    from public.compute_ticket_refund(v_order.id, null, 'buyer_request');
  select refund_amount_cents into v_full_gross
    from public.compute_ticket_refund(v_order.id, null, 'organizer_cancel');

  -- an extra refund against an order with nothing left to void: record would
  -- raise, the drain would burn its retries and poison the row. Flag instead.
  if v_live = 0 then
    perform public.flag_order_for_refund_review(
      p_payment_intent_id,
      'refund_with_no_live_positions:' || p_stripe_refund_id
    );
    return 'flagged_review';
  end if;

  if v_kind = 'buyer_request' and p_refund_amount_cents = v_full_face then
    -- our own face-only voluntary refund, arriving before record committed
    v_voided := public.record_ticket_refund(v_order.id, null, 'buyer_request', p_stripe_refund_id);
  elsif v_kind in ('organizer_cancel', 'admin') and p_refund_amount_cents = v_full_gross then
    -- our own gross refund: keep its real kind, never relabel it 'admin'
    v_voided := public.record_ticket_refund(v_order.id, null, v_kind, p_stripe_refund_id);
  elsif v_kind is null and p_refund_amount_cents >= v_full_gross then
    -- unattributed and covers the whole remaining charge: a human dashboard
    -- refund, which is what 'admin' actually means
    v_voided := public.record_ticket_refund(v_order.id, null, 'admin', p_stripe_refund_id);
  else
    -- amount and kind do not corroborate, or it is a true partial → never
    -- guess which tickets. Cumulative partials that eventually total the
    -- charge STAY flagged, unchanged from v2.
    perform public.flag_order_for_refund_review(
      p_payment_intent_id,
      'partial_dashboard_refund:' || p_stripe_refund_id
    );
    return 'flagged_review';
  end if;

  -- F2: a full reconcile answers the review question THIS function opens, and
  -- only that one. A review opened by ticket-refund (a failed transfer
  -- reversal: the buyer is whole but the organizer's share was never clawed
  -- back) is not answered by anything here and must stay open for a human.
  select refund_review_reason into v_reason
  from public.ticket_orders where id = v_order.id;
  if v_reason is null or starts_with(v_reason, 'partial_dashboard_refund:')
     or starts_with(v_reason, 'refund_with_no_live_positions:') then
    perform public.resolve_order_refund_review(v_order.id);
  end if;
  return 'voided_all:' || v_voided;
end;
$function$;

revoke all on function public.reconcile_dashboard_refund(text, text, integer, text) from public;
revoke all on function public.reconcile_dashboard_refund(text, text, integer, text) from anon, authenticated;
grant execute on function public.reconcile_dashboard_refund(text, text, integer, text) to service_role;

-- ROLLBACK NOTE: reverting means restoring the 3-arg reconcile_dashboard_refund
-- (drop the 4-arg one first) and redeploying the previous drain. The claim
-- columns and the two claim functions are additive and safe to leave in place;
-- an old ticket-refund simply never calls them.
