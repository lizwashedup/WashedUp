import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  applyPayoutReconciliationFilters,
  planPayoutReconciliation,
} from '../_shared/payoutReconciliation.ts';
import { fetchWithTimeout } from '../_shared/fetchWithTimeout.ts';
import {
  CONFIRMATION_SEND_ATTEMPTS,
  confirmationBackoffMs,
  isImmediatelyRetryableStatus,
} from '../_shared/confirmationRetry.ts';
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
 *      TRUE → done + the doc-112 BUYER CONFIRMATION EMAIL (Resend, bounded
 *      in-call retry then a durable retry row on failure — see doc 112 +
 *      the 2026-08-17 retry/observability fix below): the address is read
 *      from session.customer_details.email in THIS payload and never
 *      persisted onto ticket_orders; the confirmation_email_sent_at claim
 *      makes redeliveries send nothing; a retryable send failure hands the
 *      SAME captured payload to a new ticket_webhook_events row so the
 *      drain's own claim/attempts/poison-cap machinery retries it on later
 *      runs; a terminal failure (payload never had an email/order id) or an
 *      exhausted retry alerts via alert_state='open', same as every other
 *      real failure in this table; sending NEVER blocks the settle — the
 *      money always wins;
 *      FALSE → 'refund owed' stamped VISIBLE for the §6
 *      executor; business raise → TERMINAL per (a).
 *  - confirmation_email_retry (added 2026-08-17, synthetic — never a real
 *      Stripe event type) → a durable retry of sendBuyerConfirmation against
 *      the SAME buyer email/order id captured at settle time. Same
 *      claim/attempts/MAX_ATTEMPTS poison-cap as every other row; success
 *      stamps processed, an exhausted or terminal failure stamps
 *      alert_state='open' so run_ticket_inbox_watchdog already alerts on it
 *      with zero changes on its side.
 *  - checkout.session.expired → pending order canceled; the hold released
 *      if still active, unconditionally attempted.
 *  - payout.paid / payout.failed → ticket_payouts by payout id plus the
 *    connected-account snapshot from the stored Stripe event.
 *  - charge.refund.updated → THE reconcile key (Cowork ruling 2026-07-27:
 *      the keyless drain cannot API-fetch, and this is the only refund event
 *      carrying the Refund id + amount; full-vs-partial is decided by the
 *      SQL-92 v3 RPC against the amount the refund SHOULD be for its kind,
 *      recomputed from compute_ticket_refund over the still-live seats, never
 *      Stripe's cumulative totals and no longer order.total_cents (which is
 *      only the right yardstick for a gross refund of a whole untouched
 *      order, so it mis-flagged every face-only buyer_request refund)).
 *      status succeeded → reconcile_dashboard_refund(pi, refund id,
 *      refund.amount, refund.metadata.kind): FULL voids every position with
 *      the refund's OWN kind (metadata when our executor made it, 'admin'
 *      only for a genuinely unattributed dashboard refund) + refunds the
 *      order + clears a review flag ONLY if this RPC opened it; PARTIAL flags
 *      for manual review and touches nothing (cumulative partials that total
 *      the charge stay FLAGGED, accepted). failed/canceled/requires_action →
 *      the flag door.
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
// attempts are paid one per drain run and the drain runs ONCE A MINUTE, so
// this number is wall-clock minutes of transient-outage tolerance, not an
// abstract count. At 5 it was 5 minutes: shorter than a routine Postgres
// failover or a Supabase incident, which defeated the whole point of the
// 7-21 rewrite that made transient errors retryable. 60 covers a real
// outage. It is safe to be this generous ONLY because the age watchdog
// still fires at minute 10 on a row that is still retrying, so a long
// budget means "keep trying while a human is already alerted", never "stay
// silent for an hour". A row that finally exhausts it is stamped
// alert_state 'open' and alerted on (see stampFailed below). Reused as-is
// (2026-08-17) as the durable poison cap for confirmation_email_retry rows
// too — same reasoning applies unchanged, so there is no reason for a
// second tunable.
const MAX_ATTEMPTS = 60;
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
function sleep(ms) {
  return new Promise((resolve)=>setTimeout(resolve, ms));
}
// doc 112: one branded confirmation to the buyer's checkout email, sent by
// the platform after a successful settle. Never throws; never blocks
// settle. RETURNS a result instead of silently swallowing every outcome —
// the original bug (confirmed against real production data, 2026-08-17): a
// caught failure was only console.error'd, confirmation_email_sent_at
// stayed null forever, nothing else in the system ever revisited it, and
// there was no queryable record a human could find. The caller decides what
// to do with a failure: `retryable: true` hands the SAME captured
// email/order id to a durable retry row (see enqueueConfirmationRetry
// below); `retryable: false` is the one truly terminal case — the session
// payload never had a buyer email or order id, so no retry, in-call or
// durable, can ever recover it — and alerts immediately instead.
async function sendBuyerConfirmation(// deno-lint-ignore no-explicit-any
service, obj) {
  // held ACROSS the try/catch on purpose: the claim below stamps the order
  // "sent" BEFORE anything is sent, so every failure path, including one
  // that throws, has to be able to give the claim back.
  let claimedOrderId = null;
  try {
    const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';
    if (!resendKey) {
      console.error('confirmation email: RESEND_API_KEY missing');
      // retryable, not terminal: a later run may see a fixed env var. This
      // is systemic (every send fails, not just this order) so it is worth
      // a durable retry rather than a dead end, same as any other outage.
      return { sent: false, retryable: true, reason: 'RESEND_API_KEY missing' };
    }
    const details = obj.customer_details;
    const email = typeof details?.email === 'string' ? details.email : null;
    const meta = obj.metadata ?? {};
    const orderId = meta.order_id;
    if (!email || !orderId) {
      console.error('confirmation email: session missing buyer email or order id');
      // TERMINAL: this exact payload is everything any future attempt will
      // ever have to work with (the buyer email is deliberately never
      // persisted onto ticket_orders — doc 112). If it is not here now, no
      // in-call retry and no durable retry row built from this same `obj`
      // can ever recover it, so this alerts immediately rather than
      // spending a retry budget on a guaranteed-forever failure.
      return {
        sent: false,
        retryable: false,
        reason: `session missing buyer ${!email ? 'email' : 'order id'}`,
      };
    }
    // the claim wins exactly once; a webhook redelivery matches nothing and
    // sends nothing (the doc-112 idempotency law, probed in the SQL half)
    const { data: claimed, error: claimErr } = await service.from('ticket_orders').update({
      confirmation_email_sent_at: new Date().toISOString()
    }).eq('id', orderId).is('confirmation_email_sent_at', null).select('id, reference_code, qty, total_cents, event_id');
    if (claimErr) {
      console.error('confirmation email: claim failed', claimErr.message);
      return { sent: false, retryable: true, reason: `claim write failed: ${claimErr.message}` };
    }
    if (!claimed || claimed.length === 0) return { sent: true }; // already sent, nothing to do
    claimedOrderId = orderId;
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
    const releaseClaim = async ()=>{
      claimedOrderId = null;
      await service.from('ticket_orders').update({
        confirmation_email_sent_at: null,
        confirmation_email_id: null
      }).eq('id', orderId);
    };
    // IN-CALL bounded retry (2026-08-17): up to CONFIRMATION_SEND_ATTEMPTS
    // total tries against Resend within this SAME invocation, short backoff
    // between them (confirmationBackoffMs), only looping again while the
    // failure looks transient (isImmediatelyRetryableStatus — a thrown/
    // timed-out fetch, or 408/429/5xx). A deterministic 4xx stops this loop
    // immediately rather than retrying an identical rejection back-to-back
    // for nothing; every exit from this loop without a 2xx still gets a
    // durable retry from the caller (see below), because the underlying
    // cause might be fixed by the time that runs (e.g. a rotated key).
    //
    // fetchWithTimeout replaces the old bare fetch(): the original had NO
    // timeout at all, so a hung connection could stall this row (and this
    // whole batch) indefinitely instead of failing fast into the retry
    // path. The trade: fetchWithTimeout resolves to null on BOTH a thrown
    // fetch (DNS/TLS/connect) and a real timeout, so the specific
    // underlying error string is no longer available to log — an accepted,
    // disclosed trade for actually bounding the call, and it is the same
    // shared convention already used elsewhere in this codebase.
    let res = null;
    let lastStatus = null;
    let lastWasNetworkFailure = false;
    for(let attempt = 0; attempt < CONFIRMATION_SEND_ATTEMPTS; attempt++){
      if (attempt > 0) await sleep(confirmationBackoffMs(attempt - 1));
      const r = await fetchWithTimeout('https://api.resend.com/emails', {
        method: 'POST',
        timeoutMs: 10_000,
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
      if (r === null) {
        lastWasNetworkFailure = true;
        lastStatus = null;
        if (attempt < CONFIRMATION_SEND_ATTEMPTS - 1 && isImmediatelyRetryableStatus(null)) continue;
        break;
      }
      lastWasNetworkFailure = false;
      lastStatus = r.status;
      if (r.ok) {
        res = r;
        break;
      }
      if (attempt < CONFIRMATION_SEND_ATTEMPTS - 1 && isImmediatelyRetryableStatus(r.status)) continue;
      break;
    }
    if (!res) {
      // clear the claim so the miss stays findable; log loudly; settle stands
      const reason = lastWasNetworkFailure
        ? 'resend unreachable (network/timeout)'
        : `resend refused: ${lastStatus}`;
      console.error(`confirmation email: ${reason}`);
      await releaseClaim();
      // Every send-side failure reaching here is durably retryable: the
      // buyer's captured email/order id (this same `obj`) rides into a new
      // ticket_webhook_events row (enqueueConfirmationRetry, called by the
      // caller), which gets its own claim/attempts/poison-cap budget on top
      // of the in-call attempts already spent here.
      return { sent: false, retryable: true, reason };
    }
    // sent for real: the claim is now TRUE and must stand, so nothing below
    // (including the outer catch) may release it
    claimedOrderId = null;
    const body = await res.json().catch(()=>({}));
    const emailId = typeof body?.id === 'string' ? body.id : null;
    if (emailId) {
      await service.from('ticket_orders').update({
        confirmation_email_id: emailId
      }).eq('id', orderId);
    }
    return { sent: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.error('confirmation email: failed', msg);
    // Anything that threw AFTER the claim but BEFORE a confirmed send (the
    // event/seat lookups, the body build) left the order permanently stamped
    // "sent" with nothing sent. Nothing in this system ever retries a
    // confirmation on its own, so that claim was a silent, permanent loss.
    // Give it back.
    if (claimedOrderId) {
      try {
        await service.from('ticket_orders').update({
          confirmation_email_sent_at: null,
          confirmation_email_id: null
        }).eq('id', claimedOrderId);
      } catch (releaseErr) {
        console.error('confirmation email: could not release claim', releaseErr instanceof Error ? releaseErr.message : 'unknown');
      }
    }
    return { sent: false, retryable: true, reason: `unexpected error: ${msg}` };
  }
}
// A confirmation send still failing after its in-call retries is handed to
// the SAME drain as a new row — never a second bespoke retry system.
// claim-before-work, the MAX_ATTEMPTS poison cap, and stampFailed's
// alert_state='open' all apply to it exactly as they do to every other row
// in ticket_webhook_events, and run_ticket_inbox_watchdog already alerts on
// alert_state with ZERO change on its side. stripe_event_id only has to be
// UNIQUE — it is a dedupe key for real Stripe redeliveries, never looked up
// by value here, and a real Stripe id is always 'evt_...' so this can never
// collide with one. The payload mirrors the minimal shape
// sendBuyerConfirmation reads (customer_details.email, metadata.order_id) —
// the exact same shape a real checkout.session.completed event carries at
// that path, so no new parsing branch is needed for it.
async function enqueueConfirmationRetry(// deno-lint-ignore no-explicit-any
service, obj, reason) {
  const email = obj?.customer_details?.email ?? null;
  const orderId = obj?.metadata?.order_id ?? null;
  const { error } = await service.from('ticket_webhook_events').insert({
    stripe_event_id: `confirmation_retry_${orderId}_${crypto.randomUUID()}`,
    type: 'confirmation_email_retry',
    payload: {
      data: {
        object: {
          customer_details: {
            email
          },
          metadata: {
            order_id: orderId
          }
        }
      }
    }
  });
  if (error) {
    // The backstop itself failing has nothing left to hand off to. Loud,
    // not silent: this is the one path in the confirmation flow where
    // console.error really is the last line of defense.
    console.error('confirmation email: could not enqueue durable retry', error.message, '— original failure:', reason);
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
    // A FAILURE stamp (2026-08-14). Same processed_at as stampProcessed (the
    // row is given up on and will not retry) but it also raises alert_state
    // so a human is actually told. This exists because the age watchdog can
    // ONLY see rows with processed_at null, so every path that stamps and
    // walks away was structurally invisible to it, not merely unlikely to
    // alert. Use this, never stampProcessed, for any outcome a paying
    // customer would notice: money captured with nothing delivered, or a
    // refund owed. stampProcessed stays for inert dispositions (ignored
    // event types, "nothing to do" states) that nobody needs to act on.
    const stampFailed = async (errNote)=>{
      await service.from('ticket_webhook_events').update({
        processed_at: new Date().toISOString(),
        error: errNote,
        alert_state: 'open'
      }).eq('id', row.id);
    };
    // the poison guard, un-bypassable now that the claim always pays first.
    // It stamps at about minute 61 now; the age watchdog already alerted at
    // minute 10, and this raises a second, louder alert saying the event was
    // abandoned for good.
    if (claimedAttempts > MAX_ATTEMPTS) {
      await stampFailed(`poison: exceeded ${MAX_ATTEMPTS} attempts, abandoned; see prior error`);
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
          // Stripe does NOT guarantee event ORDER. Two account.updated events
          // in flight can arrive newest-first, and an unconditional write then
          // replays a STALE snapshot over current truth, flipping
          // charges_enabled/payouts_enabled back to a value Stripe has already
          // moved on from. The guard is Stripe's own event timestamp compared
          // against the last one applied, enforced in the WHERE clause so two
          // overlapping drain runs cannot race it. Fallback to "now" when
          // created is absent keeps today's unguarded behaviour rather than
          // dropping the write (no live event has ever lacked it: verified
          // across all 93 rows in ticket_webhook_events).
          const evCreated = typeof row.payload?.created === 'number' ? new Date(row.payload.created * 1000).toISOString() : new Date().toISOString();
          const { data: updated, error: updErr } = await service.from('organizer_stripe_accounts').update({
            charges_enabled: obj.charges_enabled === true,
            payouts_enabled: obj.payouts_enabled === true,
            details_submitted: obj.details_submitted === true,
            requirements_due: obj.requirements ?? {},
            last_event_at: evCreated,
            last_event_id: row.stripe_event_id
          }).eq('stripe_account_id', acctId).lte('last_event_at', evCreated).select('user_id');
          if (updErr) {
            await recordRetryable(`account.updated write failed: ${updErr.message}`);
            continue;
          }
          if (updated && updated.length > 0) {
            await stampProcessed(null);
          } else {
            // zero rows is now ambiguous: no organizer row at all, or a stale
            // event correctly refused. Ask, so the two never get conflated.
            const { data: existing, error: exErr } = await service.from('organizer_stripe_accounts').select('user_id').eq('stripe_account_id', acctId).maybeSingle();
            if (exErr) {
              await recordRetryable(`account.updated ordering check failed: ${exErr.message}`);
              continue;
            }
            await stampProcessed(existing ? `account.updated out of order (older than applied state), ignored` : `no organizer row for ${acctId}`);
          }
        }
      } else if (row.type === 'checkout.session.completed') {
        const meta = obj.metadata ?? {};
        const holdId = meta.hold_id;
        const paymentIntent = typeof obj.payment_intent === 'string' ? obj.payment_intent : null;
        if (!holdId) {
          // The buyer's card was CHARGED and there is nothing here to settle
          // onto: no hold, so no tickets are issued and no refund is queued.
          // This already happened for real (2026-07-27) and was stamped
          // processed with nobody told. It is a failure, never a disposition.
          await stampFailed('completed session without hold_id metadata: buyer was charged, no tickets issued, no refund queued');
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
            // doc 112: the money is settled; the email rides after. Never
            // blocks settle. A retryable miss (after its own in-call
            // retries) is handed to the SAME drain as a new row so it gets
            // the SAME claim/attempts/poison-cap/alert machinery already
            // proven above — never a second bespoke retry system. A
            // terminal miss (no email/order id in the payload — data that
            // will never appear later) alerts on THIS row immediately
            // instead of manufacturing a retry that can only ever fail the
            // same way.
            const emailResult = await sendBuyerConfirmation(service, obj);
            if (!emailResult.sent) {
              if (emailResult.retryable) {
                await enqueueConfirmationRetry(service, obj, emailResult.reason ?? 'unknown');
              } else {
                await stampFailed(`confirmation email: ${emailResult.reason ?? 'unknown'} — tickets issued, buyer never notified`);
              }
            }
          } else {
            // money captured, quota gone, nothing delivered: a human owes this
            // buyer a refund and nothing else in the system will say so
            await stampFailed('settle refused (late webhook, no quota): refund owed');
          }
        }
      } else if (row.type === 'confirmation_email_retry') {
        // 2026-08-17: the durable half of the confirmation-email fix. This
        // row's payload carries exactly the buyer email + order id captured
        // at settle time (enqueueConfirmationRetry), so sendBuyerConfirmation
        // runs the identical send path — same idempotent DB claim, same
        // in-call bounded retry against Resend.
        const result = await sendBuyerConfirmation(service, obj);
        if (result.sent) {
          await stampProcessed(null);
        } else if (result.retryable) {
          await recordRetryable(`confirmation email retry: ${result.reason}`);
          continue;
        } else {
          // defensive: sendBuyerConfirmation's only non-retryable outcome is
          // a missing email/order id, which THIS row's own payload was built
          // from (see enqueueConfirmationRetry) and should not newly go
          // missing. If it somehow does, looping for MAX_ATTEMPTS drain
          // cycles on a guaranteed-forever failure is worse than alerting
          // now.
          await stampFailed(`confirmation email retry exhausted (terminal): ${result.reason}`);
        }
      } else if (row.type === 'checkout.session.expired') {
        const sessionId = obj.id;
        if (!sessionId?.startsWith('cs_')) {
          await stampProcessed('expired session without an id');
        } else {
          const { data: order, error: orderErr } = await service.from('ticket_orders').select('id, hold_id, status').eq('stripe_checkout_session_id', sessionId).maybeSingle();
          if (orderErr) {
            // the account.updated pattern above, applied here: a transient
            // read failure must RETRY. Without this it fell into the "no
            // order" branch and abandoned the cleanup, stranding an active
            // hold on inventory nobody paid for.
            await recordRetryable(`expired session order read failed: ${orderErr.message}`);
            continue;
          }
          if (!order) {
            await stampProcessed('expired session with no order (abandoned pre-order)');
          } else {
            if (order.status === 'pending') {
              const { error: cancelErr } = await service.from('ticket_orders').update({
                status: 'canceled'
              }).eq('id', order.id).eq('status', 'pending');
              if (cancelErr) {
                await recordRetryable(`expired session order cancel failed: ${cancelErr.message}`);
                continue;
              }
            }
            // the partial-failure gap, closed: the hold release is
            // attempted whatever the order's status — a prior run that
            // canceled and crashed no longer strands an active hold
            if (order.status === 'pending' || order.status === 'canceled') {
              const { error: relErr } = await service.from('ticket_holds').update({
                status: 'released'
              }).eq('id', order.hold_id).eq('status', 'active');
              if (relErr) {
                // this write is the whole point of the handler; swallowing its
                // error left the hold ACTIVE forever while the row was stamped
                // clean, the exact gap this branch was rewritten to close
                await recordRetryable(`expired session hold release failed: ${relErr.message}`);
                continue;
              }
              await stampProcessed(order.status === 'pending' ? null : 'order already canceled; hold release ensured');
            } else {
              await stampProcessed(`expired session: order already ${order.status}, untouched`);
            }
          }
        }
      } else if (row.type === 'payout.paid' || row.type === 'payout.failed') {
        const payoutPlan = planPayoutReconciliation(
          row.type,
          row.payload,
          new Date().toISOString()
        );
        if (payoutPlan.kind === 'invalid') {
          await stampFailed(payoutPlan.reason);
          failed++;
          continue;
        }
        const payoutUpdate = applyPayoutReconciliationFilters(
          service.from('ticket_payouts').update(payoutPlan.patch),
          payoutPlan.filters
        );
        const { data: updated, error: poErr } = await payoutUpdate.select('id');
        if (poErr) {
          await recordRetryable(`payout write failed: ${poErr.message}`);
          continue;
        }
        const payoutId = payoutPlan.filters[0][1];
        await stampProcessed(updated && updated.length > 0 ? null : `no ledger row for ${payoutId}`);
      } else if (row.type === 'charge.refunded') {
        // superseded as reconcile trigger (Cowork 2026-07-27):
        // charge.refund.updated carries the refund id + amount and is the key
        await stampProcessed('ignored: charge.refunded (charge.refund.updated is the reconcile key)');
      } else if (row.type === 'charge.refund.updated') {
        // object = Refund — THE reconcile key. The RPC decides full/partial
        // against the real amount the refund was SUPPOSED to be for its kind
        // (a buyer_request refund is face-only, so it never equals
        // order.total_cents); a null pi answers 'no_order' inside.
        const pi = typeof obj.payment_intent === 'string' ? obj.payment_intent : null;
        const status = typeof obj.status === 'string' ? obj.status : null;
        const refundId = typeof obj.id === 'string' ? obj.id : null;
        const refundAmount = typeof obj.amount === 'number' ? obj.amount : null;
        // ticket-refund stamps metadata.kind on every refund it creates. It is
        // the only honest source of the kind: the amount alone cannot tell an
        // organizer_cancel from a human dashboard refund, and guessing wrote
        // 'admin' onto real organizer cancels. Absent = a dashboard refund.
        const refundKind = typeof obj.metadata?.kind === 'string' ? obj.metadata.kind : null;
        if (status === 'succeeded') {
          if (!refundId || refundAmount === null) {
            await stampProcessed('charge.refund.updated missing refund id/amount — cannot reconcile');
          } else {
            const { data: res, error: rpcErr } = await service.rpc('reconcile_dashboard_refund', {
              p_payment_intent_id: pi,
              p_stripe_refund_id: refundId,
              p_refund_amount_cents: refundAmount,
              p_refund_kind: refundKind
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
