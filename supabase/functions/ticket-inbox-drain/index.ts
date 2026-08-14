import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
/**
 * ticket-inbox-drain — the inbox DRAIN (ticketing lane, 2026-07-21,
 * Cowork's sprint order; RE-CUT same day per Cowork's rejection verdict).
 *
 * THE TWO 7-21 FIXES, exactly as ordered:
 *  (a) TERMINAL IS A TEXT MATCH, NOT A CLASS: only settle's own business
 *      raises — "cannot settle" (canceled order) and "does not match its
 *      hold" (the mismatch guard) — are terminal-stamped. Every OTHER RPC
 *      error (transient DB blip on a PAID session included) goes through
 *      the retryable path: attempts already counted by the claim, error
 *      recorded, row stays unprocessed, poison guard caps it. A customer
 *      who paid can no longer be permanently stamped away by a blip.
 *  (b) CLAIM BEFORE WORK: every row is claimed with the house optimistic
 *      conditional update (attempts = seen+1 WHERE processed_at IS NULL
 *      AND attempts = seen, RETURNING) BEFORE any work. Overlapping runs
 *      can never double-execute a row (the loser's claim matches nothing),
 *      and a mid-row crash has already paid its attempt — the poison guard
 *      cannot be bypassed by crashing.
 * Folded in per the same verdict: the session-expired path releases the
 * hold even when the order is already canceled (the partial-failure gap —
 * a first run that canceled the order and died before the release no
 * longer strands an active hold), and the run-token compare reuses the
 * webhook's timing-safe equality.
 *
 * Invoked by pg_cron with an x-run-token header (TICKET_DRAIN_RUN_TOKEN;
 * the vault + schedule ride the cron proposal, the 50→56 pattern) — until
 * that lands it can be invoked manually with the same token. verify_jwt
 * off: the token is the guard.
 *
 * TRANSITIONS (the standing Cowork bindings, honored):
 *  - account.updated       → flags + requirements onto
 *                            organizer_stripe_accounts by stripe_account_id.
 *  - checkout.session.completed → settle_ticket_hold(metadata.hold_id, pi):
 *      TRUE → done + the doc-112 BUYER CONFIRMATION EMAIL (Resend, fire-and-
 *      log: the address is read from session.customer_details.email in THIS
 *      payload and never persisted; the confirmation_email_sent_at claim on
 *      ticket_orders makes redeliveries send nothing; any failure clears the
 *      claim, logs, and NEVER blocks the settle — the money always wins);
 *      FALSE → 'refund owed' stamped VISIBLE for the §6
 *      executor; business raise → TERMINAL per (a).
 *  - checkout.session.expired → pending order canceled; the hold released
 *      if still active, unconditionally attempted.
 *  - payout.paid / payout.failed → ticket_payouts by stripe_payout_id.
 *  - charge.refund.updated → THE reconcile key (Cowork ruling 2026-07-27:
 *      the keyless drain cannot API-fetch, and this is the only refund event
 *      carrying the Refund id + amount; full-vs-partial is decided by the
 *      SQL-92 v2 RPC against OUR order.total_cents, never Stripe's cumulative
 *      totals). status succeeded → reconcile_dashboard_refund(pi, refund id,
 *      refund.amount): FULL voids every position (void_kind admin) + refunds
 *      the order + clears any review flag; PARTIAL flags for manual review
 *      and touches nothing (cumulative partials that total the charge stay
 *      FLAGGED, accepted). failed/canceled/requires_action → the flag door.
 *      pending → no-op. A null payment_intent rides through to the RPC,
 *      which answers 'no_order' (dashboard charges can carry pi = null).
 *  - charge.refunded → ignored (superseded as reconcile trigger by the
 *      2026-07-27 ruling; charge.refund.updated carries everything needed).
 *  - anything else → processed with 'ignored: <type>'.
 *
 * This function MOVES NO MONEY and DECIDES no money policy — it holds no
 * Stripe key at all and passes the charge/refund facts to the SQL-92 RPCs,
 * which are the single brain for full-vs-partial and voiding.
 */ const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 5;
const TERMINAL_RAISE_MARKERS = [
  'cannot settle',
  'does not match its hold'
];
// doc 112: buyer confirmation email. Transactional only, platform is the
// sender. FROM local-part + every copy string = LIZ COPY at her taste gate
// (domain washedup.app is the verified Resend domain the scene@ sender uses).
const CONFIRMATION_FROM = 'washedup <tickets@washedup.app>';
// ships with the web lane's held branch — until that deploys this lands on
// the /app shell, not the tickets page (flagged in the doc-112 proposal)
const WALLET_URL = 'https://washedup.app/app/tickets';
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for(let i = 0; i < a.length; i++)out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
// doc 112: one branded confirmation to the buyer's checkout email, sent by
// the platform after a successful settle. Never throws; never blocks settle.
async function sendBuyerConfirmation(// deno-lint-ignore no-explicit-any
service, obj) {
  try {
    const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';
    if (!resendKey) {
      console.error('confirmation email: RESEND_API_KEY missing');
      return;
    }
    const details = obj.customer_details;
    const email = typeof details?.email === 'string' ? details.email : null;
    const meta = obj.metadata ?? {};
    const orderId = meta.order_id;
    if (!email || !orderId) {
      console.error('confirmation email: session missing buyer email or order id');
      return;
    }
    // the claim wins exactly once; a webhook redelivery matches nothing and
    // sends nothing (the doc-112 idempotency law, probed in the SQL half)
    const { data: claimed, error: claimErr } = await service.from('ticket_orders').update({
      confirmation_email_sent_at: new Date().toISOString()
    }).eq('id', orderId).is('confirmation_email_sent_at', null).select('id, reference_code, qty, total_cents, event_id');
    if (claimErr) {
      console.error('confirmation email: claim failed', claimErr.message);
      return;
    }
    if (!claimed || claimed.length === 0) return; // already sent
    const order = claimed[0];
    const { data: event } = await service.from('explore_events').select('title, event_date, venue, confirmation_message').eq('id', order.event_id).maybeSingle();
    const { data: seats } = await service.from('ticket_order_positions').select('position_index, reference_code').eq('order_id', orderId).order('position_index', {
      ascending: true
    });
    const title = event?.title ?? 'your event';
    const whenWhere = [
      event?.event_date,
      event?.venue
    ].filter(Boolean).join(' · ');
    const note = event?.confirmation_message ?? null;
    const total = `$${(order.total_cents / 100).toFixed(2)}`;
    const refs = (seats ?? []).map((p)=>p.reference_code);
    const refLines = refs.length > 0 ? refs : [
      order.reference_code
    ];
    /* LIZ COPY, all of it (subject + every line below) */ const subject = order.qty > 1 ? `your tickets to ${title}` : `your ticket to ${title}`;
    const text = [
      `you're in. ${title}${whenWhere ? ` (${whenWhere})` : ''}.`,
      '',
      `${order.qty > 1 ? 'tickets' : 'ticket'}: ${refLines.join(', ')}`,
      `total paid: ${total}`,
      ...note ? [
        '',
        'good to know:',
        note
      ] : [],
      '',
      `your tickets live at ${WALLET_URL}`
    ].join('\n');
    const noteHtml = note ? `<p style="margin:20px 0 6px;font-weight:700;color:#2C1810;">good to know</p>
         <p style="margin:0;color:#2C1810;white-space:pre-line;">${escapeHtml(note)}</p>` : '';
    const html = `
<div style="background:#FAF5EC;padding:32px 16px;font-family:-apple-system,'Segoe UI',sans-serif;color:#2C1810;">
  <div style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:16px;padding:28px;">
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#B5522E;font-weight:600;">washedup</p>
    <h1 style="margin:0 0 4px;font-size:22px;">you're in.</h1>
    <p style="margin:0 0 20px;color:#78695C;">${escapeHtml(title)}${whenWhere ? ` · ${escapeHtml(whenWhere)}` : ''}</p>
    <p style="margin:0 0 6px;font-weight:700;">${order.qty > 1 ? 'your tickets' : 'your ticket'}</p>
    ${refLines.map((r)=>`<p style="margin:0;font-family:monospace;font-size:16px;font-weight:700;">${escapeHtml(r)}</p>`).join('')}
    <p style="margin:16px 0 0;color:#78695C;">total paid: <span style="color:#2C1810;font-weight:700;">${total}</span></p>
    ${noteHtml}
    <a href="${WALLET_URL}" style="display:inline-block;margin-top:24px;background:#B5522E;color:#FFFFFF;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:700;">see your tickets</a>
  </div>
</div>`;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: CONFIRMATION_FROM,
        to: [
          email
        ],
        subject,
        html,
        text
      })
    });
    if (!res.ok) {
      // clear the claim so the miss stays findable; log loudly; settle stands
      console.error('confirmation email: resend refused', res.status);
      await service.from('ticket_orders').update({
        confirmation_email_sent_at: null,
        confirmation_email_id: null
      }).eq('id', orderId);
      return;
    }
    const body = await res.json().catch(()=>({}));
    const emailId = typeof body?.id === 'string' ? body.id : null;
    if (emailId) {
      await service.from('ticket_orders').update({
        confirmation_email_id: emailId
      }).eq('id', orderId);
    }
  } catch (e) {
    console.error('confirmation email: failed', e instanceof Error ? e.message : 'unknown');
  }
}
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
Deno.serve(async (req)=>{
  if (req.method !== 'POST') return json(405, {
    error: 'method not allowed'
  });
  const runToken = Deno.env.get('TICKET_DRAIN_RUN_TOKEN') ?? '';
  const givenToken = req.headers.get('x-run-token') ?? '';
  if (!runToken || !timingSafeEqual(givenToken, runToken)) {
    return json(403, {
      error: 'forbidden'
    });
  }
  const service = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { data: rows, error: readErr } = await service.from('ticket_webhook_events').select('id, stripe_event_id, type, payload, attempts').is('processed_at', null).order('id', {
    ascending: true
  }).limit(BATCH_SIZE);
  if (readErr) return json(500, {
    error: 'inbox read failed'
  });
  let drained = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of rows ?? []){
    // (b) THE CLAIM: optimistic conditional update, the send-application-
    // emails pattern. No claim, no work — ever.
    const claimedAttempts = row.attempts + 1;
    const { data: claimed, error: claimErr } = await service.from('ticket_webhook_events').update({
      attempts: claimedAttempts
    }).eq('id', row.id).is('processed_at', null).eq('attempts', row.attempts).select('id');
    if (claimErr || !claimed || claimed.length === 0) {
      skipped++; // another run owns it, or it just got processed
      continue;
    }
    const stampProcessed = async (errNote)=>{
      await service.from('ticket_webhook_events').update({
        processed_at: new Date().toISOString(),
        error: errNote
      }).eq('id', row.id);
    };
    const recordRetryable = async (errNote)=>{
      // attempts already paid by the claim; the row stays unprocessed
      await service.from('ticket_webhook_events').update({
        error: errNote
      }).eq('id', row.id);
      failed++;
    };
    // the poison guard, un-bypassable now that the claim always pays first
    if (claimedAttempts > MAX_ATTEMPTS) {
      await stampProcessed(`poison: exceeded ${MAX_ATTEMPTS} attempts; see prior error`);
      failed++;
      continue;
    }
    try {
      const obj = row.payload?.data?.object ?? {};
      if (row.type === 'account.updated') {
        const acctId = obj.id;
        if (!acctId?.startsWith('acct_')) {
          await stampProcessed('account.updated without an acct id');
        } else {
          const { data: updated, error: updErr } = await service.from('organizer_stripe_accounts').update({
            charges_enabled: obj.charges_enabled === true,
            payouts_enabled: obj.payouts_enabled === true,
            details_submitted: obj.details_submitted === true,
            requirements_due: obj.requirements ?? {}
          }).eq('stripe_account_id', acctId).select('user_id');
          if (updErr) {
            await recordRetryable(`account.updated write failed: ${updErr.message}`);
            continue;
          }
          await stampProcessed(updated && updated.length > 0 ? null : `no organizer row for ${acctId}`);
        }
      } else if (row.type === 'checkout.session.completed') {
        const meta = obj.metadata ?? {};
        const holdId = meta.hold_id;
        const paymentIntent = typeof obj.payment_intent === 'string' ? obj.payment_intent : null;
        if (!holdId) {
          await stampProcessed('completed session without hold_id metadata');
        } else {
          const { data: settled, error: rpcErr } = await service.rpc('settle_ticket_hold', {
            p_hold_id: holdId,
            p_payment_intent_id: paymentIntent
          });
          if (rpcErr) {
            // (a) terminal ONLY on settle's own business raises; every
            // other error (transient DB, network, pool) retries under the
            // poison cap — a paid customer is never stamped away by a blip
            const isBusinessRaise = TERMINAL_RAISE_MARKERS.some((m)=>(rpcErr.message ?? '').includes(m));
            if (isBusinessRaise) {
              await stampProcessed(`settle raised (terminal): ${rpcErr.message}`);
            } else {
              await recordRetryable(`settle errored (retryable): ${rpcErr.message}`);
              continue;
            }
          } else if (settled === true) {
            await stampProcessed(null);
            // doc 112: the money is settled; the email rides after, fire-and-log
            await sendBuyerConfirmation(service, obj);
          } else {
            await stampProcessed('settle refused (late webhook, no quota) — refund owed');
          }
        }
      } else if (row.type === 'checkout.session.expired') {
        const sessionId = obj.id;
        if (!sessionId?.startsWith('cs_')) {
          await stampProcessed('expired session without an id');
        } else {
          const { data: order } = await service.from('ticket_orders').select('id, hold_id, status').eq('stripe_checkout_session_id', sessionId).maybeSingle();
          if (!order) {
            await stampProcessed('expired session with no order (abandoned pre-order)');
          } else {
            if (order.status === 'pending') {
              await service.from('ticket_orders').update({
                status: 'canceled'
              }).eq('id', order.id).eq('status', 'pending');
            }
            // the partial-failure gap, closed: the hold release is
            // attempted whatever the order's status — a prior run that
            // canceled and crashed no longer strands an active hold
            if (order.status === 'pending' || order.status === 'canceled') {
              await service.from('ticket_holds').update({
                status: 'released'
              }).eq('id', order.hold_id).eq('status', 'active');
              await stampProcessed(order.status === 'pending' ? null : 'order already canceled; hold release ensured');
            } else {
              await stampProcessed(`expired session: order already ${order.status}, untouched`);
            }
          }
        }
      } else if (row.type === 'payout.paid' || row.type === 'payout.failed') {
        const payoutId = obj.id;
        if (!payoutId?.startsWith('po_')) {
          await stampProcessed('payout event without a po_ id');
        } else {
          const isPaid = row.type === 'payout.paid';
          const { data: updated, error: poErr } = await service.from('ticket_payouts').update(isPaid ? {
            status: 'paid',
            paid_at: new Date().toISOString()
          } : {
            status: 'failed',
            failure_message: obj.failure_message ?? obj.failure_code ?? 'payout failed'
          }).eq('stripe_payout_id', payoutId).select('id');
          if (poErr) {
            await recordRetryable(`payout write failed: ${poErr.message}`);
            continue;
          }
          await stampProcessed(updated && updated.length > 0 ? null : `no ledger row for ${payoutId}`);
        }
      } else if (row.type === 'charge.refunded') {
        // superseded as reconcile trigger (Cowork 2026-07-27):
        // charge.refund.updated carries the refund id + amount and is the key
        await stampProcessed('ignored: charge.refunded (charge.refund.updated is the reconcile key)');
      } else if (row.type === 'charge.refund.updated') {
        // object = Refund — THE reconcile key. The RPC decides full/partial
        // against OUR order.total_cents; a null pi answers 'no_order' inside.
        const pi = typeof obj.payment_intent === 'string' ? obj.payment_intent : null;
        const status = typeof obj.status === 'string' ? obj.status : null;
        const refundId = typeof obj.id === 'string' ? obj.id : null;
        const refundAmount = typeof obj.amount === 'number' ? obj.amount : null;
        if (status === 'succeeded') {
          if (!refundId || refundAmount === null) {
            await stampProcessed('charge.refund.updated missing refund id/amount — cannot reconcile');
          } else {
            const { data: res, error: rpcErr } = await service.rpc('reconcile_dashboard_refund', {
              p_payment_intent_id: pi,
              p_stripe_refund_id: refundId,
              p_refund_amount_cents: refundAmount
            });
            if (rpcErr) {
              await recordRetryable(`reconcile errored (retryable): ${rpcErr.message}`);
              continue;
            }
            await stampProcessed(`dashboard refund reconciled: ${res}`);
          }
        } else if (status === 'failed' || status === 'canceled' || status === 'requires_action') {
          if (!pi) {
            await stampProcessed(`charge.refund.updated ${status} without a payment_intent`);
          } else {
            const { data: res, error: rpcErr } = await service.rpc('flag_order_for_refund_review', {
              p_payment_intent_id: pi,
              p_reason: `refund_${status}:${refundId ?? 'unknown'}`
            });
            if (rpcErr) {
              await recordRetryable(`refund-review flag errored (retryable): ${rpcErr.message}`);
              continue;
            }
            await stampProcessed(`refund state ${status} flagged for review: ${res}`);
          }
        } else {
          await stampProcessed(`charge.refund.updated status ${status ?? 'unknown'}: no action`);
        }
      } else {
        await stampProcessed(`ignored: ${row.type}`);
      }
      drained++;
    } catch (e) {
      await recordRetryable(e instanceof Error ? e.message : 'unknown drain error');
    }
  }
  return json(200, {
    drained,
    failed,
    skipped,
    batch: (rows ?? []).length
  });
});
