import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@18';
import {
  stripeKeyIsTest,
  stripeKeyIsLive,
  resolveClientCheckoutKey,
  namespaceIdempotencyKey,
  isHoldTooStaleForSession,
  applicationFeeCents,
  planAddonLineItems,
  planPriorSessionReuse,
  providerCheckoutKey,
} from '../_shared/ticketCheckout.ts';
/**
 * create-ticket-checkout — the buyer's pay door (money loop step 1,
 * ticketing lane 2026-07-25; v8 rework 2026-07-27 against 87 v3's returns).
 * A thin Stripe courier over begin_ticket_checkout (proposal 87 v3): the RPC
 * runs the §3 math, applies every business rule, claims the 66 hold and
 * extends it to the 35-min checkout TTL (F13), writes the PENDING order with
 * its C3 reference; THIS function only creates the hosted Checkout session
 * and hands back the URL.
 *
 * v8 PAIRED CHANGES (Cowork-approved on 87 v3 clear, 2026-07-27):
 *  (a) IDEMPOTENCY (F1/F14): the client sends checkout_key, ONE stable value
 *      per user checkout action, reused across that action's own retries
 *      only. We namespace it as ctc:{buyer_id}:{key} so one user can never
 *      squat another user's key (idempotency_key is globally unique), and
 *      pass it to begin_ticket_checkout, which returns the FIRST order for a
 *      repeated key without claiming a second hold and raises if a key is
 *      reused for a different tier/qty/buyer. A client that omits the key
 *      gets a per-invocation random key: same behavior as before, never
 *      unsafe, protection simply inert for that call.
 *  (b) EXPIRES_AT PINNED (F2/F13): the Checkout session's expires_at is the
 *      RPC's returned hold_expires_at (now + 35 min, above Stripe's 30-min
 *      session floor) — hold and session expire together, never Stripe's 24h
 *      default, no charged-after-hold window.
 *  (c) SESSION RECOVERY: inspect a saved provider session before applying
 *      the creation-only floor. Unknown create/expire responses preserve the
 *      pending order. A confirmed expired session may release the old hold;
 *      new creation uses one provider idempotency key per saved order.
 *  (+) RPC errors are no longer passed through raw when they are plumbing
 *      (PGRST* schema-cache dumps confused clients); business refusals keep
 *      their curated messages.
 *
 * THE FEE SPLIT (corrected 2026-07-25): with a DESTINATION charge the
 * connected account receives (charge total − application_fee). To land the
 * organizer at exactly face − our-commission (§3), the application_fee must be
 * commission + processing — the platform keeps that, pays Stripe's ~processing
 * fee (fees.payer=application, set at onboarding), and nets the 4%. e.g.
 * $41.51 total − (160+151) = $38.40 = $40 face − $1.60. Charging only the
 * commission would hand the buyer's processing to the organizer — wrong.
 *
 * v13 PAIRED CHANGES (doc 113 + doc 114 apply, 2026-08-01) — this deploy MUST
 * land with those proposals or the session undercharges:
 *  (d) PROMO CODES: body.promo_code rides through to the RPC, which validates
 *      it and returns an already-discounted unit_face_cents, so the ticket
 *      line prices itself correctly with no arithmetic here.
 *  (e) ADD-ONS: body.add_ons ([{add_on_id, qty}]) rides through; the RPC folds
 *      the add-on money into face_cents. unit_face_cents * qty therefore no
 *      longer covers the face, and the remainder gets its own line item(s).
 *      Without that line the buyer is charged the ticket only while the
 *      order, the commission, and the payout all count the extras.
 *
 * v17 PAIRED CHANGE (SQL-99 apply, 2026-08-04) — deploys ONLY in the SQL-99
 * window, strictly AFTER the SQL (p_answers on a 7-arg begin fails PostgREST
 * resolution):
 *  (f) ANSWERS: body.answers ([{question_id, value, attendee_index?}]) rides
 *      through to the RPC, which enforces shape, scope, dupes, and REQUIRED
 *      COVERAGE server-side before any claim, and inserts the rows in the
 *      same transaction as the pending order. Free path needs nothing: the
 *      answers exist before the inline settle below.
 */ const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const ALLOWED_ORIGINS = [
  'https://washedup.app',
  'https://www.washedup.app',
  'http://localhost:3000'
];
// Stripe requires a Checkout session's expires_at to be 30 min to 24 h after
// creation (F13). The buffer absorbs edge-vs-Stripe clock skew: anything
// closer than floor + buffer cannot start a NEW session. Existing sessions
// are reconciled first; a missing saved ID does not prove creation failed.
const STRIPE_SESSION_FLOOR_SEC = 30 * 60;
const FLOOR_SKEW_BUFFER_SEC = 60;
// LIZ COPY (approved 2026-07-27): shown when a stale reused checkout
// can no longer make Stripe's session window.
const EXPIRED_CHECKOUT_LINE = 'this checkout took too long and expired. head back and pick your tickets again.';
function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json'
    }
  });
}
// LIVE FLIP (Liz's live word 2026-07-31, PBC + EIN seller of record): the
// secret's VALUE decides the mode — a live key is now accepted alongside test.
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: CORS
  });
  if (req.method !== 'POST') return json(405, {
    error: 'method not allowed'
  });
  const stripeKey = Deno.env.get('STRIPE_TICKET_SECRET_KEY') ?? '';
  const paymentsConfigured = stripeKeyIsTest(stripeKey) || stripeKeyIsLive(stripeKey);
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const service = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: {
      persistSession: false
    }
  });
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: {
      headers: {
        Authorization: authHeader
      }
    }
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json(401, {
    error: 'not signed in'
  });
  const buyer = userData.user;
  const body = await req.json().catch(()=>({}));
  const origin = ALLOWED_ORIGINS.includes(body?.origin) ? body.origin : ALLOWED_ORIGINS[0];
  const nativeReturn = body?.return_mode === 'native';
  const resumeOnly = body?.order_id !== undefined;
  let b: {
    order_id: string; hold_id: string; hold_expires_at: string; reference_code: string;
    is_free: boolean; organizer_stripe_account_id: string | null;
    unit_face_cents: number; face_cents: number; processing_cents: number;
    commission_cents: number; total_cents: number; commission_bps_applied: number;
    stripe_checkout_session_id: string | null;
  };
  let qty: number;
  if (resumeOnly) {
    const orderId = body.order_id;
    if (typeof orderId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
      return json(400, { error: 'choose the purchase you want to continue.' });
    }
    // Resume an owned purchase, not a new quote. No question/answer/promo
    // writes, extra stock claims or creator payout re-resolution occur here.
    try {
      const { data: saved, error: orderError } = await service.from('ticket_orders')
        .select('id,event_id,tier_id,hold_id,buyer_user_id,qty,status,reference_code,unit_face_cents,face_cents,processing_cents,commission_cents,total_cents,commission_bps_applied,stripe_checkout_session_id')
        .eq('id', orderId).eq('buyer_user_id', buyer.id).maybeSingle();
      if (orderError) return json(503, { code: 'checkout_recovery_pending', error: 'this purchase could not be checked. try again.' });
      if (!saved || saved.id !== orderId || saved.buyer_user_id !== buyer.id) return json(404, { error: 'this purchase is not available for this account.' });
      if (saved.status !== 'pending') {
        if (!['paid', 'canceled', 'refunded'].includes(saved.status)) return json(409, { code: 'checkout_recovery_pending' });
        return json(200, { order_id: saved.id, status: saved.status });
      }
      // Public event visibility is checked as the caller. Existing orders
      // remain readable, but withdrawn/ended events cannot resume payment.
      const { data: event, error: eventError } = await userClient.from('explore_events')
        .select('id,status,end_time').eq('id', saved.event_id).maybeSingle();
      if (eventError) return json(503, { code: 'checkout_recovery_pending' });
      if (!event || event.id !== saved.event_id || event.status !== 'Live' || (event.end_time && Date.parse(event.end_time) <= Date.now())) {
        return json(409, { code: 'checkout_event_unavailable', order_id: saved.id, error: 'this event is not accepting payments. your saved purchase is still available.' });
      }
      const { data: hold, error: holdError } = await service.from('ticket_holds')
        .select('id,event_id,tier_id,buyer_user_id,qty,status,expires_at')
        .eq('id', saved.hold_id).eq('buyer_user_id', buyer.id).maybeSingle();
      if (holdError || !hold || hold.id !== saved.hold_id || hold.event_id !== saved.event_id || hold.tier_id !== saved.tier_id || hold.buyer_user_id !== buyer.id || hold.qty !== saved.qty || hold.status !== 'active') {
        return json(409, { code: 'checkout_recovery_pending', order_id: saved.id });
      }
      qty = saved.qty;
      b = { ...saved, order_id: saved.id, hold_expires_at: hold.expires_at, is_free: saved.face_cents === 0, organizer_stripe_account_id: null };
    } catch {
      return json(503, { code: 'checkout_recovery_pending' });
    }
  } else {
  const tierId = body?.tier_id ?? '';
  qty = Number.isInteger(body?.qty) ? body.qty : Number(body?.qty);
  if (!tierId || !Number.isFinite(qty) || qty < 1) {
    return json(400, {
      error: 'pick a ticket and a quantity.'
    });
  }
  // (a) the stable per-checkout-action key, namespaced to the buyer so keys
  // can never collide or be squatted across users. No client key → random
  // per-invocation key (inert but safe).
  const clientKey = resolveClientCheckoutKey(body?.checkout_key) ?? crypto.randomUUID();
  const idempotencyKey = namespaceIdempotencyKey(buyer.id, clientKey);
  // doc 113 / doc 114: the promo code and the add-on list are forwarded as-is.
  // Every rule (existence, window, cap, stock, per-order max, duplicates) is
  // the RPC's to enforce inside the transaction, so nothing here re-decides
  // money; shape screening only, to keep junk out of the round trip.
  const promoCode = typeof body?.promo_code === 'string' && body.promo_code.trim() !== '' ? body.promo_code.trim().slice(0, 64) : null;
  let addOns = null;
  if (Array.isArray(body?.add_ons) && body.add_ons.length > 0) {
    if (body.add_ons.length > 20) return json(400, {
      error: 'that is too many extras.'
    });
    // Preserve the creator's option ID; the transactional RPC validates its
    // event/add-on binding and snapshots its label. Options never set prices.
    if (body.add_ons.some((a: { variation_id?: unknown } | null) => a?.variation_id !== undefined &&
        (typeof a.variation_id !== 'string' || !a.variation_id.trim() || a.variation_id.length > 128))) {
      return json(400, { error: 'choose an available option for each extra.' });
    }
    const cleaned: Array<{ add_on_id: string; qty: number; variation_id?: string }> = body.add_ons.map((a: { add_on_id?: unknown; qty?: unknown; variation_id?: string } | null)=>({
        add_on_id: String(a?.add_on_id ?? ''),
        qty: Number(a?.qty),
        ...(a?.variation_id === undefined ? {} : { variation_id: a.variation_id })
      }));
    if (cleaned.some((a)=>!a.add_on_id || !Number.isInteger(a.qty) || a.qty < 1)) {
      return json(400, {
        error: 'pick a quantity for each extra.'
      });
    }
    addOns = cleaned;
  }
  // SQL-99 (v17 pairing): the buyer's question answers ride through to the
  // RPC, which owns every rule — shape per qtype, scope, dupes, and the
  // required-coverage refusal BEFORE any money or claim. Shape screening only
  // here; value stays whatever JSON the client sent (string, bool, array).
  let answers = null;
  if (Array.isArray(body?.answers) && body.answers.length > 0) {
    if (body.answers.length > 600) return json(400, {
      error: 'that is too many answers.'
    });
    const cleaned: Array<{ question_id: string; value: unknown; attendee_index?: number }> = body.answers.map((a: { question_id?: unknown; value?: unknown; attendee_index?: unknown } | null)=>{
      const entry: { question_id: string; value: unknown; attendee_index?: number } = {
        question_id: String(a?.question_id ?? ''),
        value: a?.value
      };
      if (a?.attendee_index !== undefined && a?.attendee_index !== null) {
        entry.attendee_index = Number(a.attendee_index);
      }
      return entry;
    });
    if (cleaned.some((a)=>!a.question_id || a.value === undefined || a.value === null || a.attendee_index !== undefined && !Number.isInteger(a.attendee_index))) {
      return json(400, {
        error: 'every answer needs its question.'
      });
    }
    answers = cleaned;
  }
  const { data: prof } = await service.from('profiles').select('first_name_display').eq('id', buyer.id).maybeSingle();
  const buyerName = prof?.first_name_display?.trim() || (buyer.email ? buyer.email.split('@')[0] : 'guest');
  // The free-only wrapper uses the same transaction and pricing/admission rules.
  // A paid result raises inside that transaction, so no paid hold/order can
  // commit while this courier lacks provider configuration. No quote race.
  const { data: begun, error: rpcErr } = await service.rpc(paymentsConfigured ? 'begin_ticket_checkout' : 'begin_free_ticket_checkout', {
    p_tier_id: tierId,
    p_qty: qty,
    p_buyer_user_id: buyer.id,
    p_buyer_name: buyerName,
    p_idempotency_key: idempotencyKey,
    p_promo_code: promoCode,
    p_add_ons: addOns,
    p_answers: answers
  });
  if (rpcErr) {
    if (!paymentsConfigured && (rpcErr.message === 'ticketing payments are not configured yet.' || (rpcErr.code ?? '').startsWith('PGRST'))) {
      return json(503, { error: 'ticketing payments are not configured yet.' });
    }
    // plumbing errors (schema cache, signature mismatch) are OURS, not the
    // buyer's; keep the raw dump out of clients and in the logs
    if ((rpcErr.code ?? '').startsWith('PGRST')) {
      console.error('create-ticket-checkout: rpc plumbing error', rpcErr.code, rpcErr.message);
      return json(500, {
        error: 'could not start checkout.'
      });
    }
    // business refusals carry curated messages from the RPC (not on sale,
    // already ended, cannot accept payments, key reused, ...)
    return json(409, {
      error: rpcErr.message ?? 'could not start checkout.'
    });
  }
  b = Array.isArray(begun) ? begun[0] : begun;
  }
  if (!b?.order_id) return json(500, {
    error: 'checkout did not start.'
  });
  if (b.is_free) {
    const { data: settled, error: setErr } = await service.rpc('settle_ticket_hold', {
      p_hold_id: b.hold_id,
      p_payment_intent_id: null
    });
    if (setErr || settled !== true) return json(409, {
      error: 'this free ticket could not be confirmed.'
    });
    return json(200, {
      free: true,
      order_id: b.order_id,
      reference_code: b.reference_code
    });
  }
  // Owned terminal receipts and genuinely free settlement need no provider.
  // Paid resume preserves its existing order until configuration is restored.
  if (!paymentsConfigured) return json(503, { order_id: b.order_id, error: 'ticketing payments are not configured yet.' });
  const stripe = new Stripe(stripeKey, {
    apiVersion: '2025-08-27.basil',
    httpClient: Stripe.createFetchHttpClient()
  });
  // (g) THE REPLAY'S OWN SESSION (2026-08-14, paired with the SQL that adds
  // stripe_checkout_session_id to begin_ticket_checkout's returns): one order
  // gets ONE payable session, ever. A second session for the same order can
  // also be paid, and settle_ticket_hold returns early on the already-consumed
  // hold, so that second charge is captured by Stripe and never reconciled or
  // refunded. Null on every first pass; set only on a replayed order.
  const priorSessionId = typeof b.stripe_checkout_session_id === 'string' && b.stripe_checkout_session_id.startsWith('cs_') ? b.stripe_checkout_session_id : null;
  const recoveryPending = () => json(409, {
    code: 'checkout_recovery_pending',
    order_id: b.order_id,
    error: 'this checkout is still being checked. keep this order and check its status again.'
  });
  // Only call after a same-ID provider receipt confirms expiry. A failed
  // expiry request is not permission to cancel a potentially payable order.
  async function finishConfirmedExpiry() {
    try {
      const { error: holdError } = await service.from('ticket_holds').update({
        status: 'released'
      }).eq('id', b.hold_id).eq('status', 'active');
      if (holdError) return recoveryPending();
      const { data: canceled, error: orderError } = await service.from('ticket_orders').update({
        status: 'canceled'
      }).eq('id', b.order_id).eq('status', 'pending').eq('stripe_checkout_session_id', priorSessionId)
        .select('id,status').maybeSingle();
      if (orderError || canceled?.id !== b.order_id || canceled?.status !== 'canceled') return recoveryPending();
      return json(409, { code: 'checkout_expired', order_id: b.order_id, error: EXPIRED_CHECKOUT_LINE });
    } catch {
      console.error('create-ticket-checkout: expired-order cleanup uncertain');
      return recoveryPending();
    }
  }
  const holdExpiresSec = Math.floor(new Date(b.hold_expires_at).getTime() / 1000);
  if (priorSessionId) {
    let prior: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>>;
    try {
      prior = await stripe.checkout.sessions.retrieve(priorSessionId);
    } catch {
      console.error('create-ticket-checkout: prior session unreadable');
      return recoveryPending();
    }
    if (prior.id !== priorSessionId) return recoveryPending();
    const priorAction = planPriorSessionReuse(prior, b.total_cents);
    if (priorAction === 'already_paid') {
      return json(409, {
        order_id: b.order_id,
        error: 'this checkout already went through. give it a moment to confirm.'
      });
    }
    if (priorAction === 'expired') return await finishConfirmedExpiry();
    if (priorAction === 'unknown' || !Number.isFinite(holdExpiresSec)) return recoveryPending();
    if (priorAction === 'reusable' && holdExpiresSec > Math.floor(Date.now() / 1000)) {
      return json(200, { url: prior.url, order_id: b.order_id, reference_code: b.reference_code });
    }
    // An open mismatched or overdue session must become unpayable first.
    // Do not create a replacement for this saved order.
    try {
      const expired = await stripe.checkout.sessions.expire(priorSessionId);
      if (expired.id !== priorSessionId || planPriorSessionReuse(expired, b.total_cents) !== 'expired') {
        return recoveryPending();
      }
    } catch {
      console.error('create-ticket-checkout: provider expiry uncertain');
      return recoveryPending();
    }
    return await finishConfirmedExpiry();
  }
  if (resumeOnly || !b.organizer_stripe_account_id) return recoveryPending();
  if (isHoldTooStaleForSession(b.hold_expires_at, Date.now(), STRIPE_SESSION_FLOOR_SEC, FLOOR_SKEW_BUFFER_SEC)) {
    // A prior response or DB acknowledgement could have been lost. Never
    // infer that no payable session exists from the absent saved ID.
    return recoveryPending();
  }
  // doc 114: add-on money is FOLDED INTO face_cents by the RPC, so
  // unit_face_cents * qty no longer covers the face. The remainder is the
  // add-on total and MUST appear as its own line or Stripe undercharges by
  // exactly that amount. It is derived from the RPC's own numbers, never from
  // what the client asked for.
  const addonTotal = b.face_cents - b.unit_face_cents * qty;
  let addonLines: ReturnType<typeof planAddonLineItems>['lines'] = [];
  if (addonTotal > 0) {
    const { data: lines } = await service.from('order_add_ons').select('qty, unit_price_cents, name_snapshot').eq('order_id', b.order_id);
    const planned = planAddonLineItems(addonTotal, lines ?? []);
    if (planned.usedFallback) {
      // the breakdown could not be read back or did not sum to the folded
      // remainder; charge the exact remainder as one line rather than let a
      // read failure become an undercharge
      console.error('create-ticket-checkout: add-on breakdown unusable', b.order_id, addonTotal);
    }
    addonLines = planned.lines;
  }
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: qty,
          price_data: {
            currency: 'usd',
            unit_amount: b.unit_face_cents,
            product_data: {
              name: 'ticket'
            }
          }
        },
        ...addonLines,
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: b.processing_cents,
            product_data: {
              name: 'card processing'
            }
          }
        }
      ],
      payment_intent_data: {
        // commission + processing: the platform keeps this, pays Stripe's
        // ~processing fee, nets the 4%; the organizer receives face − 4%
        application_fee_amount: applicationFeeCents(b.commission_cents, b.processing_cents),
        on_behalf_of: b.organizer_stripe_account_id,
        transfer_data: {
          destination: b.organizer_stripe_account_id
        }
      },
      metadata: {
        hold_id: b.hold_id,
        order_id: b.order_id,
        reference_code: b.reference_code
      },
      expires_at: holdExpiresSec,
      success_url: nativeReturn
        ? `${origin}/e/?checkout=success&session_id={CHECKOUT_SESSION_ID}&order=${b.order_id}&native=1`
        : `${origin}/e?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: nativeReturn
        ? `${origin}/e/?checkout=cancelled&order=${b.order_id}&native=1`
        : `${origin}/e?checkout=cancelled`
    }, { idempotencyKey: providerCheckoutKey(b.order_id) });
  } catch {
    // Provider errors can arrive after creation. Preserve the original
    // order/hold and retry only with its same provider key; never unwind.
    console.error('create-ticket-checkout: provider creation uncertain');
    return recoveryPending();
  }
  if (typeof session.id !== 'string' || !session.id.startsWith('cs_')) return recoveryPending();
  // Bind before returning a payable URL. Concurrent retries use the same
  // provider key; only an empty binding may be filled by this invocation.
  try {
    const { error: bindError } = await service.from('ticket_orders').update({
      stripe_checkout_session_id: session.id
    }).eq('id', b.order_id).eq('buyer_user_id', buyer.id).eq('status', 'pending').is('stripe_checkout_session_id', null);
    if (bindError) return recoveryPending();
    const { data: saved, error: readError } = await service.from('ticket_orders')
      .select('id,status,stripe_checkout_session_id').eq('id', b.order_id).eq('buyer_user_id', buyer.id).maybeSingle();
    if (readError || saved?.id !== b.order_id || saved?.status !== 'pending' || saved?.stripe_checkout_session_id !== session.id) {
      return recoveryPending();
    }
  } catch {
    return recoveryPending();
  }
  if (planPriorSessionReuse(session, b.total_cents) !== 'reusable') return recoveryPending();
  return json(200, { url: session.url, order_id: b.order_id, reference_code: b.reference_code });
});
