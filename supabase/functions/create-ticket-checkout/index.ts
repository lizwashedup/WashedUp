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
 *  (c) STALE-REUSE FLOOR: a reused key can return a prior order whose hold
 *      has under 30 minutes left; Stripe would reject that expires_at. We
 *      check the floor BEFORE Stripe (plus catch Stripe's own expires_at
 *      rejection as backstop), release the stale hold, cancel the stale
 *      pending order, and return the friendly expired-checkout line so a
 *      fresh tap (new key) starts clean.
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
// closer than floor + buffer is treated as an expired checkout up front.
const STRIPE_SESSION_FLOOR_SEC = 30 * 60;
const FLOOR_SKEW_BUFFER_SEC = 60;
// LIZ COPY (approved 2026-07-27): shown when a stale reused checkout
// can no longer make Stripe's session window.
const EXPIRED_CHECKOUT_LINE = 'this checkout took too long and expired. head back and pick your tickets again.';
function json(status, body) {
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
  if (!stripeKey || !stripeKeyIsTest(stripeKey) && !stripeKeyIsLive(stripeKey)) {
    return json(503, {
      error: 'ticketing payments are not configured yet.'
    });
  }
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
  const tierId = body?.tier_id ?? '';
  const qty = Number.isInteger(body?.qty) ? body.qty : Number(body?.qty);
  const origin = ALLOWED_ORIGINS.includes(body?.origin) ? body.origin : ALLOWED_ORIGINS[0];
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
    const cleaned = body.add_ons.map((a)=>({
        add_on_id: String(a?.add_on_id ?? ''),
        qty: Number(a?.qty)
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
    const cleaned = body.answers.map((a)=>{
      const entry = {
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
  const { data: begun, error: rpcErr } = await service.rpc('begin_ticket_checkout', {
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
  const b = Array.isArray(begun) ? begun[0] : begun;
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
  // releases the hold and cancels the pending order so a fresh tap (with a
  // fresh key) starts clean; used by (c) and by session-create failure. A
  // prior session is expired at Stripe first: an open session outliving its
  // canceled order is payable money with nothing left to settle onto.
  async function unwindPending() {
    if (priorSessionId) {
      try {
        await stripe.checkout.sessions.expire(priorSessionId);
      } catch (err) {
        console.error('create-ticket-checkout: could not expire stale session', priorSessionId, err instanceof Error ? err.message : '');
      }
    }
    await service.from('ticket_holds').update({
      status: 'released'
    }).eq('id', b.hold_id).eq('status', 'active');
    await service.from('ticket_orders').update({
      status: 'canceled'
    }).eq('id', b.order_id).eq('status', 'pending');
  }
  // (b) pin the session to the hold's real expiry (35-min TTL from 87 v3)
  const holdExpiresSec = Math.floor(new Date(b.hold_expires_at).getTime() / 1000);
  // (c) a stale reused checkout whose hold can no longer make Stripe's
  // 30-min session floor is expired NOW, before Stripe sees it
  if (isHoldTooStaleForSession(b.hold_expires_at, Date.now(), STRIPE_SESSION_FLOOR_SEC, FLOOR_SKEW_BUFFER_SEC)) {
    await unwindPending();
    return json(409, {
      code: 'checkout_expired',
      error: EXPIRED_CHECKOUT_LINE
    });
  }
  // (g) REUSE, NEVER RE-CREATE: this order already carries a Stripe session,
  // so hand that same one back instead of minting a second payable session.
  if (priorSessionId) {
    let prior: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>>;
    try {
      prior = await stripe.checkout.sessions.retrieve(priorSessionId);
    } catch (err) {
      console.error('create-ticket-checkout: prior session unreadable', priorSessionId, err instanceof Error ? err.message : '');
      return json(409, {
        error: 'this checkout is still being set up. give it a moment and try again.'
      });
    }
    const priorAction = planPriorSessionReuse(prior, b.total_cents);
    if (priorAction === 'already_paid') {
      // already paid: the drain settles it from the webhook. Creating a new
      // session here IS the double charge, so refuse and let it confirm.
      return json(409, {
        error: 'this checkout already went through. give it a moment to confirm.'
      });
    }
    if (priorAction === 'expired') {
      await unwindPending();
      return json(409, {
        code: 'checkout_expired',
        error: EXPIRED_CHECKOUT_LINE
      });
    }
    if (priorAction === 'reusable') {
      return json(200, {
        url: prior.url,
        order_id: b.order_id,
        reference_code: b.reference_code
      });
    }
    // 'replace': open but unusable (no url, or it does not price THIS
    // order) — expire it before its replacement exists, never leave two
    // payable sessions alive.
    try {
      await stripe.checkout.sessions.expire(priorSessionId);
    } catch (err) {
      console.error('create-ticket-checkout: could not expire mismatched session', priorSessionId, err instanceof Error ? err.message : '');
      return json(409, {
        error: 'this checkout is still being set up. give it a moment and try again.'
      });
    }
  }
  // doc 114: add-on money is FOLDED INTO face_cents by the RPC, so
  // unit_face_cents * qty no longer covers the face. The remainder is the
  // add-on total and MUST appear as its own line or Stripe undercharges by
  // exactly that amount. It is derived from the RPC's own numbers, never from
  // what the client asked for.
  const addonTotal = b.face_cents - b.unit_face_cents * qty;
  let addonLines = [];
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
      success_url: `${origin}/e?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/e?checkout=cancelled`
    });
  } catch (err) {
    await unwindPending();
    // (c) backstop: Stripe rejected the pinned expires_at (clock skew got
    // past the proactive check) — same friendly expiry, not a scary 502
    const msg = err?.message ?? '';
    if (msg.includes('expires_at')) {
      return json(409, {
        code: 'checkout_expired',
        error: EXPIRED_CHECKOUT_LINE
      });
    }
    // seat-required fix (2026-07-27): Stripe's raw message stays in the logs,
    // never in the response body
    console.error('create-ticket-checkout: session create failed', msg);
    return json(502, {
      error: 'the payment could not be set up. try again.',
      detail: null
    });
  }
  await service.from('ticket_orders').update({
    stripe_checkout_session_id: session.id
  }).eq('id', b.order_id);
  return json(200, {
    url: session.url,
    order_id: b.order_id,
    reference_code: b.reference_code
  });
});
