import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@18';
/**
 * ticket-refund v5 — the refund door, REWRITTEN 2026-07-27 against applied
 * proposal 89 v3 (Cowork ruling: v4 was a loaded misfire — it computed
 * amounts in TypeScript against the retired v1 policy, used the proportional
 * booleans even for voluntary partials (the doc-99 F1 commission leak), and
 * called record_ticket_refund with a retired five-arg signature AFTER Stripe
 * moved the money, so every call refunded real money and then failed to
 * record the void).
 *
 * v5 FLOW (the 89 v3 contract, money math lives in probed SQL only):
 *   compute_ticket_refund  → the exact Stripe amounts for the target set
 *   Stripe                 → buyer_request: THREE EXPLICIT legs (refund of
 *                            face to the buyer; transfer reversal of
 *                            face − commission-share; application-fee refund
 *                            of commission-share) — proportional booleans are
 *                            NEVER used on the voluntary path (they prorate
 *                            against T while the law prorates commission
 *                            against F).
 *                            organizer_cancel: ONE refund of the T-share with
 *                            reverse_transfer + refund_application_fee true
 *                            (proportional IS correct there); the platform's
 *                            −P lands on the organizer as SQL-93's
 *                            processing_shortfall receivable.
 *   record_ticket_refund   → AFTER Stripe confirms: ledger row (unique
 *                            stripe_refund_id = idempotent), voids the
 *                            positions, flips the order when the last live
 *                            ticket is voided. Amounts re-derived in SQL and
 *                            probed equal to compute's.
 *
 * ═══ THE CONTRACT (published for the client lanes, 2026-07-27) ═══
 * POST, verify_jwt on. Body:
 *   {
 *     order_id: string,                       // required
 *     action?: 'preview' | 'refund',          // default 'refund'
 *     kind?: 'buyer_request' | 'organizer_cancel',  // organizer callers only
 *     position_indexes?: number[] | null,     // null/omitted = all remaining
 *   }
 * CALLERS — one slug, role resolved from the JWT then checked against the
 * order (v4's organizer-only 403 is retired):
 *   * BUYER: identity = order.buyer_user_id === caller id. kind is FORCED to
 *     'buyer_request' (a buyer-sent kind is ignored), position_indexes is
 *     FORCED to null (self-refund is whole-remaining-order), and the refund
 *     only proceeds when can_buyer_self_refund(order) is true (the §5 preset
 *     gate, checked server-side under the service role).
 *   * ORGANIZER: identity = explore_events.host_user_id, or when that is
 *     null and the event fronts a community, communities.created_by (the
 *     same payee resolution begin_ticket_checkout uses). May pass kind
 *     'buyer_request' (voluntary, face-only) or 'organizer_cancel' (buyer
 *     made whole to T) and may target position subsets.
 *   * ADMIN/support refunds do NOT ride this slug (unchanged from v4): they
 *     go through a direct service call to record_ticket_refund kind 'admin'.
 * PREVIEW (action 'preview') — how the wallet gets its answer, since the
 * RPCs are service-role-only and the client cannot ask them directly: no
 * Stripe call, no record; returns
 *   { ok, allowed, can_self_refund, kind, refund_amount_cents,
 *     position_count } — the wallet renders its refund button from this.
 * REFUND success returns
 *   { ok, order_id, kind, positions_voided, refund_amount_cents,
 *     transfer_reversal_cents, app_fee_refund_cents,
 *     processing_shortfall_cents, stripe_refund_id, warnings? }.
 * FAILURE SHAPE: if a post-refund explicit leg fails (reversal or fee
 * refund), the buyer HAS been refunded, so the void IS recorded — but the
 * order is ALSO flagged via flag_order_for_refund_review (queryable trail +
 * durable owner alert) and the response is 207 with needs_review true,
 * review_reason, and warnings[] naming the failed leg. ok stays true because
 * the buyer's money really did come back; needs_review is the signal that a
 * human still has to settle the organizer side. If recording itself fails
 * after Stripe, 500 with the stripe_refund_id — the drain's
 * charge.refund.updated courier and the SQL-92 backstop reconcile, and both
 * record and the Stripe call are idempotent so the call is safely retried.
 *
 * LIVE OR TEST: STRIPE_TICKET_SECRET_KEY decides the mode by its own value.
 * Since Liz's live word (2026-07-31, PBC + EIN seller of record) a live key
 * is accepted alongside a test key; only a missing or malformed key is
 * refused with 503.
 */ const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
// ═══ RULED (Cowork 2026-07-28, from battery evidence on order 8F8RCDJH):
// a standalone application fee refund credits the CONNECTED account
// (observed: connected 'adjustment' +80 / platform 'application_fee_refund'
// −80), so the three-leg combo hands the organizer a C-share windfall per
// voluntary refund. Reversal-only is law: refund face to the buyer +
// explicit reversal (face-share − C-share); the platform's returned
// commission is implicit in its net (observed lawful end state: buyer +u,
// organizer −(F−C)/qty exactly, platform −C-share). HOLD lifted. ═══
const VOLUNTARY_FEE_REFUND_LEG = false;
// ONE deterministic value per logical refund, used for BOTH jobs: the Stripe
// idempotency key (a genuine retry of the same refund replays Stripe's answer
// instead of moving money twice) and the ticket_orders row-claim key (a
// concurrent DIFFERENT refund on the same order is refused before any Stripe
// call). Targeting a different seat set, or a different kind, yields a
// different key, so those are never mistaken for duplicates. Bounded length:
// 3 + 36 uuid + 1 + 16 kind + 1 + at most 149 (50 seats, index <= 50 by the
// ticket_positions_index_range check) = 206, inside Stripe's 255-char limit.
function refundClaimKey(orderId, kind, positions) {
  const target = positions ? [
    ...positions
  ].sort((a, b)=>a - b).join('-') : 'all';
  return `tr:${orderId}:${kind}:${target}`;
}
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json'
    }
  });
}
function stripeKeyIsTest(key) {
  return key.startsWith('sk_test_') || key.startsWith('rk_test_');
}
// LIVE FLIP (Liz's live word 2026-07-31, PBC + EIN seller of record): the
// secret's VALUE decides the mode — a live key is now accepted alongside test.
function stripeKeyIsLive(key) {
  return key.startsWith('sk_live_') || key.startsWith('rk_live_');
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: CORS
  });
  if (req.method !== 'POST') return json(405, {
    error: 'method not allowed'
  });
  const stripeKey = Deno.env.get('STRIPE_TICKET_SECRET_KEY') ?? '';
  if (!stripeKey || !stripeKeyIsTest(stripeKey) && !stripeKeyIsLive(stripeKey)) {
    return json(503, {
      error: 'ticketing payments are not configured yet.'
    });
  }
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json(401, {
    error: 'unauthenticated'
  });
  let body;
  try {
    body = await req.json();
  } catch  {
    return json(400, {
      error: 'invalid body'
    });
  }
  const orderId = body.order_id ?? '';
  const action = body.action === 'preview' ? 'preview' : 'refund';
  if (!orderId) return json(400, {
    error: 'order_id is required'
  });
  if (body.position_indexes != null) {
    if (!Array.isArray(body.position_indexes) || body.position_indexes.length === 0 || body.position_indexes.some((i)=>!Number.isInteger(i) || i < 1)) {
      return json(400, {
        error: 'position_indexes must be positive integers'
      });
    }
  }
  // caller identity from the verified JWT
  const asCaller = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: {
      headers: {
        Authorization: authHeader
      }
    },
    auth: {
      persistSession: false
    }
  });
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  const callerId = userData?.user?.id;
  if (userErr || !callerId) return json(401, {
    error: 'unauthenticated'
  });
  const service = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: {
      persistSession: false
    }
  });
  // load the order + its event's organizer identity + the payment intent
  const { data: order, error: ordErr } = await service.from('ticket_orders').select('id, status, buyer_user_id, stripe_payment_intent_id, event_id, explore_events!inner(host_user_id, community_id)').eq('id', orderId).single();
  if (ordErr || !order) return json(404, {
    error: 'order not found'
  });
  // deno-lint-ignore no-explicit-any
  const ev = order.explore_events;
  let organizerId = ev?.host_user_id ?? null;
  if (!organizerId && ev?.community_id) {
    const { data: comm } = await service.from('communities').select('created_by').eq('id', ev.community_id).maybeSingle();
    organizerId = comm?.created_by ?? null;
  }
  const isOrganizer = !!organizerId && organizerId === callerId;
  const isBuyer = order.buyer_user_id === callerId;
  if (!isOrganizer && !isBuyer) return json(403, {
    error: 'not your order'
  });
  // resolve kind + targets by role
  let kind;
  let positionsArg;
  let canSelfRefund = false;
  if (isOrganizer) {
    kind = body.kind === 'organizer_cancel' ? 'organizer_cancel' : 'buyer_request';
    positionsArg = body.position_indexes ?? null;
  } else {
    // buyer: kind forced, whole-remaining-order only, §5 preset gate applies
    kind = 'buyer_request';
    positionsArg = null;
  }
  // dual identity (an organizer buying their own ticket): the §5 gate must
  // still be answered for the BUYER half, or the wallet never shows the
  // affordance even when the gate says yes (seat-confirmed fix, 2026-08-01)
  if (isBuyer) {
    const { data: gate, error: gateErr } = await service.rpc('can_buyer_self_refund', {
      p_order_id: orderId
    });
    if (gateErr) return json(500, {
      error: 'could not check the refund window'
    });
    canSelfRefund = gate === true;
  }
  if (order.status !== 'paid') {
    if (action === 'preview') {
      return json(200, {
        ok: true,
        allowed: false,
        can_self_refund: false,
        kind,
        refund_amount_cents: 0,
        position_count: 0,
        reason: `order is ${order.status}`
      });
    }
    return json(409, {
      error: `order is ${order.status}, not refundable`
    });
  }
  const allowed = isOrganizer || canSelfRefund;
  // ═══ CONCURRENCY (fix 2): the claim is taken BEFORE compute and BEFORE any
  // Stripe call, so a second refund racing this one is refused while nothing
  // has moved. record_ticket_refund's own `for update` runs only AFTER Stripe,
  // so on its own it can detect a double-spend but never prevent one. Taking
  // the claim first also stops compute's numbers from going stale underneath
  // us: nothing else can void a position while we hold it. Every exit from
  // here on goes through respond(), which releases the claim exactly once.
  let releaseClaim: (() => PromiseLike<unknown>) | null = null;
  const respond = async (status, body)=>{
    if (releaseClaim) {
      const release = releaseClaim;
      releaseClaim = null;
      try {
        await release();
      } catch (err) {
        // a leaked claim self-heals on the staleness window; never mask the
        // real answer we are about to return
        console.error('ticket-refund: claim release failed', orderId, err?.message);
      }
    }
    return json(status, body);
  };
  // left undefined (not null) on the preview path: Stripe's RequestOptions
  // types idempotencyKey as string | undefined, and preview never reaches it
  let idempotencyKey: string | undefined;
  if (action === 'refund') {
    // these two gates move ahead of the claim so a refused caller never takes
    // (and never has to release) a claim
    if (!allowed) return json(403, {
      error: 'this order is outside its refund window'
    });
    if (!order.stripe_payment_intent_id) return json(409, {
      error: 'order has no captured payment'
    });
    idempotencyKey = refundClaimKey(orderId, kind, positionsArg);
    const { data: claimed, error: claimErr } = await service.rpc('claim_ticket_refund', {
      p_order_id: orderId,
      p_claim_key: idempotencyKey
    });
    if (claimErr) {
      console.error('ticket-refund: claim failed', orderId, claimErr.code, claimErr.message);
      return json(500, {
        error: 'could not start the refund.'
      });
    }
    if (claimed !== 'claimed') {
      return json(409, {
        // wording chosen so lib/ticketing.ts humanRefundError maps each to the
        // right shipped line without any client change: 'busy' falls to the
        // retry line, the other to the already-refunded line
        error: claimed === 'busy' ? 'another refund on this order is still in progress' : 'this order is already refunded or no longer refundable'
      });
    }
    releaseClaim = ()=>service.rpc('release_ticket_refund_claim', {
      p_order_id: orderId,
      p_claim_key: idempotencyKey
    });
  }
  // the probed money math — the ONLY source of refund amounts
  const { data: computed, error: cmpErr } = await service.rpc('compute_ticket_refund', {
    p_order_id: orderId,
    p_position_indexes: positionsArg,
    p_kind: kind
  });
  if (cmpErr) {
    if ((cmpErr.code ?? '').startsWith('PGRST')) {
      console.error('ticket-refund: rpc plumbing error', cmpErr.code, cmpErr.message);
      return await respond(500, {
        error: 'could not compute the refund.'
      });
    }
    return await respond(409, {
      error: cmpErr.message ?? 'could not compute the refund.'
    });
  }
  const c = Array.isArray(computed) ? computed[0] : computed;
  if (!c) return await respond(500, {
    error: 'could not compute the refund.'
  });
  if (c.position_count === 0) return await respond(409, {
    error: 'nothing left to refund'
  });
  if (positionsArg && c.position_count !== positionsArg.length) {
    return await respond(409, {
      error: 'some requested positions are not refundable'
    });
  }
  if (c.refund_amount_cents <= 0) return await respond(409, {
    error: 'refund amount is zero'
  });
  if (action === 'preview') {
    return await respond(200, {
      ok: true,
      allowed,
      can_self_refund: canSelfRefund,
      kind,
      refund_amount_cents: c.refund_amount_cents,
      position_count: c.position_count
    });
  }
  const stripe = new Stripe(stripeKey, {
    apiVersion: '2025-08-27.basil',
    httpClient: Stripe.createFetchHttpClient()
  });
  const warnings = [];
  // set when a post-refund leg failed: the buyer is whole but the organizer
  // or platform side is not, so the order must not read as a clean success
  let reviewReason = null;
  // the same door the drain uses for a failed/canceled refund state. Writes
  // ticket_orders.needs_refund_review + reason + timestamp (idempotent, keeps
  // the first reason) and raises the durable admin_alert to the owner.
  const flagForReview = async (reason)=>{
    const { error: flagErr } = await service.rpc('flag_order_for_refund_review', {
      p_payment_intent_id: order.stripe_payment_intent_id,
      p_reason: reason
    });
    if (flagErr) {
      // the trail itself failed to write: this is the one thing that must
      // never be quiet, so it rides the response too
      console.error('ticket-refund: refund-review flag failed', orderId, flagErr.code, flagErr.message);
      warnings.push('refund_review_flag_failed');
    }
  };
  let refundId;
  if (c.reverse_transfer_proportional && c.refund_application_fee_full) {
    // organizer_cancel / admin: buyer made whole to the T-share; the
    // proportional booleans are CORRECT here (doc 99 / 89 v3 law)
    try {
      const refund = await stripe.refunds.create({
        payment_intent: order.stripe_payment_intent_id,
        amount: c.refund_amount_cents,
        reverse_transfer: true,
        refund_application_fee: true,
        metadata: {
          order_id: orderId,
          kind
        }
      }, {
        idempotencyKey
      });
      refundId = refund.id;
    } catch (err) {
      // seat-required fix (2026-07-27): raw Stripe messages stay in the logs
      console.error('ticket-refund: cancel refund failed', err?.message);
      return await respond(502, {
        error: 'stripe refund failed',
        detail: null
      });
    }
  } else {
    // buyer_request: the EXPLICIT three-leg split. Need the charge for the
    // transfer id + application fee id (destination charge created both).
    let transferId = null;
    let appFeeId = null;
    try {
      const pi = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id, {
        expand: [
          'latest_charge'
        ]
      });
      const charge = pi.latest_charge && typeof pi.latest_charge !== 'string' ? pi.latest_charge : null;
      if (!charge) return await respond(409, {
        error: 'the payment has no charge to refund'
      });
      transferId = typeof charge.transfer === 'string' ? charge.transfer : charge.transfer?.id ?? null;
      appFeeId = typeof charge.application_fee === 'string' ? charge.application_fee : charge.application_fee?.id ?? null;
    } catch (err) {
      console.error('ticket-refund: payment load failed', err?.message);
      return await respond(502, {
        error: 'could not load the payment',
        detail: null
      });
    }
    if (!transferId || !appFeeId) {
      return await respond(409, {
        error: 'the payment is missing its transfer or fee; escalate to support'
      });
    }
    // leg 1: refund FACE to the buyer (this id keys the ledger)
    try {
      const refund = await stripe.refunds.create({
        payment_intent: order.stripe_payment_intent_id,
        amount: c.refund_amount_cents,
        metadata: {
          order_id: orderId,
          kind
        }
      }, {
        idempotencyKey
      });
      refundId = refund.id;
    } catch (err) {
      console.error('ticket-refund: voluntary refund failed', err?.message);
      return await respond(502, {
        error: 'stripe refund failed',
        detail: null
      });
    }
    // leg 2: explicit transfer reversal (face-share − commission-share);
    // leg 3: explicit application-fee refund (commission-share). The buyer is
    // already refunded, so the void IS still recorded — but a failed leg means
    // the organizer kept money the platform just handed back, so it gets a
    // real, queryable record and a real alert, never a log line and a 200.
    if (c.transfer_reversal_cents > 0) {
      try {
        await stripe.transfers.createReversal(transferId, {
          amount: c.transfer_reversal_cents,
          metadata: {
            order_id: orderId,
            stripe_refund_id: refundId
          }
        });
      } catch (err) {
        console.error('ticket-refund: transfer reversal failed', refundId, err?.message);
        warnings.push('transfer_reversal_failed');
        reviewReason = `transfer_reversal_failed:${refundId}:${c.transfer_reversal_cents}`;
        await flagForReview(reviewReason);
      }
    }
    if (VOLUNTARY_FEE_REFUND_LEG && c.app_fee_refund_cents > 0) {
      try {
        await stripe.applicationFees.createRefund(appFeeId, {
          amount: c.app_fee_refund_cents
        });
      } catch (err) {
        console.error('ticket-refund: application fee refund failed', refundId, err?.message);
        warnings.push('application_fee_refund_failed');
        reviewReason = `application_fee_refund_failed:${refundId}:${c.app_fee_refund_cents}`;
        await flagForReview(reviewReason);
      }
    }
  }
  // record ONLY after Stripe confirmed; 89 v3's four-arg signature derives
  // the amounts itself (probed equal to compute's) and is idempotent on the
  // refund id, so a retry of this call cannot double-record
  const { data: voided, error: recErr } = await service.rpc('record_ticket_refund', {
    p_order_id: orderId,
    p_position_indexes: positionsArg,
    p_kind: kind,
    p_stripe_refund_id: refundId
  });
  if (recErr) {
    // the money moved but the record failed — surface loudly for
    // reconciliation (charge.refund.updated -> drain + SQL-92 backstop);
    // record is idempotent so this call is safely retried with the same key
    console.error('ticket-refund: recording failed after stripe', refundId, recErr.code, recErr.message);
    return await respond(500, {
      error: 'refund succeeded at stripe but recording failed',
      stripe_refund_id: refundId
    });
  }
  const payload = {
    ok: true,
    order_id: orderId,
    kind,
    positions_voided: voided,
    refund_amount_cents: c.refund_amount_cents,
    transfer_reversal_cents: c.transfer_reversal_cents,
    app_fee_refund_cents: c.app_fee_refund_cents,
    processing_shortfall_cents: c.processing_shortfall_cents,
    stripe_refund_id: refundId,
    ...warnings.length ? {
      warnings
    } : {}
  };
  if (!reviewReason) return await respond(200, payload);
  // 207, not 200: the buyer's refund really did land (so ok stays true and the
  // shipped clients still show success rather than telling a refunded buyer to
  // try again), but a leg is unsettled and a human has to close it. The status
  // code is what separates this from a clean refund in logs and monitoring;
  // ticket_orders.needs_refund_review is the queryable trail.
  return await respond(207, {
    ...payload,
    needs_review: true,
    review_reason: reviewReason
  });
});
