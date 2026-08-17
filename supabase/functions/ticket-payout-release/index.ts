import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@18';
import { claimPayoutBatch } from '../_shared/payoutBatchClaim.ts';
/**
 * ticket-payout-release — courier v3 for SQL-93 (receivable netting +
 * consumption; ticketing lane 2026-07-31). NOT DEPLOYED; local canonical.
 * v2 (88 v2 organizer-grain) DEPLOYED 2026-07-31 in its pairing window.
 *
 * ═══ PAIRING RULE (same law, doc 00; cron is jobid 52 now) ═══
 * THIS version deploys in the SAME window SQL-93 applies, or jobid 52 is
 * unscheduled across the gap. Against pre-SQL-93 prod this file 500s on the
 * missing columns' RPC — never deploy early. Conversely SQL-93 without this
 * courier stays money-safe (v2 pays total_due_cents = the clamped net) but
 * records no consumption, so receivables would net AGAIN later and underpay
 * the organizer — the windows must land together.
 *
 * v3 ADDS: after a successful payout, consume_organizer_receivables settles
 * receivable_to_consume_cents against the organizer's open receivables with
 * the payout id (a consume failure is LOUD — the receivable would double-net
 * until manually settled — but the payout itself stands); each run also logs
 * every list_ticket_payouts_blocked organizer (gross swallowed by
 * receivables = refused from payment, the SQL-93 flag channel).
 *
 * SHAPE: list_ticket_payouts_due() now returns one row per ORGANIZER —
 * payouts_enabled account, summed ledger-exact due, and a jsonb per-event
 * breakdown. The courier records ONE ticket_payouts row PER EVENT (the
 * per-event ledger law is untouched) but makes ONE Stripe manual Payout per
 * organizer for the summed amount: per-event payouts can individually
 * exceed what refund reversals left in the shared connected balance even
 * when the organizer's total is payable. All of an organizer's event rows
 * share the payout id.
 *
 * FAILURE MODES (deliberate):
 *   - pre-payout bookkeeping error → the atomic claim returns without a
 *     partial organizer batch; no Stripe call is made.
 *   - Stripe payout error (e.g. the first-payout availability hold) → all
 *     this organizer's rows marked 'failed' with the reason; retried next run.
 *   - idempotency key reused with different params (e.g. a refund shrank the
 *     total between a proven stripeDecided rejection and its retry) → if
 *     every row in the batch was already 'failed' from that proven rejection
 *     and never reached Stripe under its old key, the retry folds the amount
 *     into a fresh key and stays 'failed' (retried next run); any other
 *     reuse stays 'pending', same as the case below.
 *   - post-payout bookkeeping error → rows stay 'pending' (money MOVED):
 *     pending suppresses re-selection, so the cron can never double-pay;
 *     the stuck rows are loud in the log and surface for manual settle.
 *
 * Invoked by pg_cron (jobid 48) with x-run-token = TICKET_PAYOUT_RUN_TOKEN.
 * verify_jwt off — the token is the guard. LIVE OR TEST:
 * STRIPE_TICKET_SECRET_KEY decides the mode by its own value. Since Liz's
 * live word (2026-07-31, PBC + EIN seller of record) a live key is accepted
 * alongside a test key; only a missing or malformed key is refused.
 */ const MAX_ORGANIZERS = 25;
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
async function sha256Hex(s: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest)).map((b)=>b.toString(16).padStart(2, '0')).join('');
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
  if (req.method !== 'POST') return json(405, {
    error: 'method not allowed'
  });
  const runToken = Deno.env.get('TICKET_PAYOUT_RUN_TOKEN') ?? '';
  const given = req.headers.get('x-run-token') ?? '';
  if (!runToken || !timingSafeEqual(given, runToken)) return json(403, {
    error: 'forbidden'
  });
  const stripeKey = Deno.env.get('STRIPE_TICKET_SECRET_KEY') ?? '';
  if (!stripeKey || !stripeKeyIsTest(stripeKey) && !stripeKeyIsLive(stripeKey)) return json(503, {
    error: 'ticketing payments are not configured yet.'
  });
  const service = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: {
      persistSession: false
    }
  });
  const stripe = new Stripe(stripeKey, {
    apiVersion: '2025-08-27.basil',
    httpClient: Stripe.createFetchHttpClient()
  });
  const { data: due, error: dueErr } = await service.rpc('list_ticket_payouts_due');
  if (dueErr) {
    console.error('ticket-payout-release: due read failed', dueErr.message);
    return json(500, {
      error: 'could not read due payouts'
    });
  }
  // SQL-93 flag channel: log every organizer refused because receivables
  // swallow their whole gross (they are absent from the due list by law)
  const { data: blocked, error: blockedErr } = await service.rpc('list_ticket_payouts_blocked');
  if (blockedErr) {
    console.error('ticket-payout-release: blocked read failed', blockedErr.message);
  } else {
    for (const b of blocked ?? []){
      console.error('ticket-payout-release: PAYOUT BLOCKED BY RECEIVABLE', b.organizer_user_id, 'gross', b.gross_due_cents, 'outstanding', b.receivable_outstanding_cents);
    }
  }
  let organizersReleased = 0, organizersFailed = 0, eventsReleased = 0;
  for (const row of (due ?? []).slice(0, MAX_ORGANIZERS)){
    const events = Array.isArray(row.events) ? row.events : [];
    if (events.length === 0 || row.total_due_cents <= 0) continue;
    // Snapshot BEFORE the claim: reclaiming a 'failed' row unconditionally
    // wipes status/failure_message/stripe_payout_id (see the migration's
    // ON CONFLICT DO UPDATE), so this is the only point that can still see
    // whether every event here was already 'failed' from THIS file's own
    // proven stripeDecided rejection below (Stripe gave a real decision,
    // e.g. balance_insufficient, and stripe_payout_id was never set because
    // no payout was ever created under the old key) rather than some other
    // route to 'failed', such as a webhook-driven post-payout failure
    // (stripe_payout_id WOULD be set there, from when it was briefly
    // 'released'). Only the former is a genuinely clean slate: a length
    // mismatch (a brand-new event with no row yet) or any non-clean row
    // leaves this false and the existing conservative path below unchanged.
    const eventIdsForClaim = events.map((ev: { event_id: string })=>ev.event_id);
    const { data: priorRows, error: priorErr } = await service.from('ticket_payouts').select('event_id, status, stripe_payout_id').in('event_id', eventIdsForClaim);
    if (priorErr) {
      console.error('ticket-payout-release: prior-state read failed', row.organizer_user_id, priorErr.message);
    }
    const provenCleanRetry = !priorErr && (priorRows ?? []).length === eventIdsForClaim.length && (priorRows ?? []).every((r)=>r.status === 'failed' && r.stripe_payout_id === null);
    // One database RPC claims the complete organizer batch transactionally.
    // A conflict on any sibling rolls back every row from this claim.
    const batchClaim = await claimPayoutBatch(
      (name, args)=>service.rpc(name, args),
      row,
      events
    );
    if (!batchClaim.claimed) {
      console.error('ticket-payout-release: atomic batch claim failed', row.organizer_user_id, batchClaim.errorMessage ?? batchClaim.status);
      organizersFailed++;
      continue;
    }
    const writtenEventIds = batchClaim.eventIds;
    // Deterministic across retries of the SAME batch: organizer + the sorted
    // event ids being paid. Without it, a create that timed out AFTER Stripe
    // made the payout was marked 'failed', re-selected by
    // list_ticket_payouts_due (which excludes only pending/released/paid) and
    // paid AGAIN on the next 6-hourly run. The amount is deliberately NOT in
    // this base key: if a refund moved the total, Stripe must refuse the
    // retry rather than mint a second payout under a fresh key. That
    // refusal is the intended backstop for any retry whose prior outcome
    // isn't provably clean (see the catch block below).
    // ONE sorted list feeds BOTH the key and the metadata below. Stripe
    // compares every request param against the key, so a metadata string that
    // reordered between attempts would raise idempotency_error on a retry that
    // moved no money, and the handler below would then wrongly strand the
    // organizer as money-moved.
    const paidEventIds = [
      ...writtenEventIds
    ].sort();
    // provenCleanRetry (above) already proves no payout was ever created
    // under the base key: excluding the amount there is exactly what
    // permanently strands a legitimate smaller payout after a refund.
    // Stripe correctly refuses the reused base key on the changed amount
    // (idempotency_error), and with nothing to prove the money didn't move
    // this time, that used to get stamped 'pending' forever. Folding
    // total_due_cents into the key ONLY in this proven-clean case gives a
    // key Stripe has never seen the instant the amount actually changed, so
    // it evaluates fresh instead of refusing a reused key.
    const idempotencyKey = provenCleanRetry
      ? `wu-payout-v1-amt-${await sha256Hex(`${row.organizer_user_id}|${paidEventIds.join(',')}|${row.total_due_cents}`)}`
      : `wu-payout-v1-${await sha256Hex(`${row.organizer_user_id}|${paidEventIds.join(',')}`)}`;
    try {
      // ONE manual payout of the organizer's summed due from their connected
      // balance (their account is payout_schedule=manual). Only reaches here
      // for past-end_time events, so the 67 gate permits the release flip.
      const payout = await stripe.payouts.create({
        amount: row.total_due_cents,
        currency: 'usd',
        metadata: {
          organizer_user_id: row.organizer_user_id,
          event_ids: paidEventIds.join(',')
        }
      }, {
        stripeAccount: row.stripe_account_id,
        idempotencyKey
      });
      const { error: relErr } = await service.from('ticket_payouts').update({
        status: 'released',
        stripe_payout_id: payout.id,
        released_at: new Date().toISOString()
      }).in('event_id', writtenEventIds);
      if (relErr) {
        // money MOVED; rows stay pending (never re-selected, never double-
        // paid) — loud log, manual settle owed
        console.error('ticket-payout-release: RELEASED AT STRIPE BUT NOT RECORDED', payout.id, relErr.message);
        organizersFailed++;
        continue;
      }
      organizersReleased++;
      eventsReleased += writtenEventIds.length;
      // SQL-93 settlement: consume what the netting withheld, keyed to this
      // payout. A failure here is LOUD (the receivable double-nets until
      // manually settled) but the payout itself stands.
      if ((row.receivable_to_consume_cents ?? 0) > 0) {
        const { error: consumeErr } = await service.rpc('consume_organizer_receivables', {
          p_organizer_user_id: row.organizer_user_id,
          p_amount_cents: row.receivable_to_consume_cents,
          p_stripe_payout_id: payout.id
        });
        if (consumeErr) {
          console.error('ticket-payout-release: RECEIVABLE CONSUME FAILED (will double-net until settled)', row.organizer_user_id, payout.id, consumeErr.message);
        }
      }
    } catch (err: any) {
      const reason = err?.message?.slice(0, 1000) ?? 'payout failed';
      // stripe-node puts the RAW api type on .rawType; .type carries the CLASS
      // name ('StripeIdempotencyError'). Checking .type === 'idempotency_error'
      // never fires, which would silently disable this whole branch. Both
      // spellings are checked so an SDK rename cannot re-break it.
      if (err?.rawType === 'idempotency_error' || err?.type === 'StripeIdempotencyError') {
        if (provenCleanRetry) {
          // The key above already folds in total_due_cents for exactly this
          // case, so reaching here means Stripe refused even the amount-
          // scoped key; a plain amount change cannot explain that. Still
          // not proof money moved: this row's ONLY prior state was a proven
          // stripeDecided rejection that never created a payout under its
          // key. Stay retryable instead of stranding it: 'failed', not
          // 'pending'. list_ticket_payouts_due re-selects it, and the next
          // run recomputes this same amount-scoped key fresh off whatever
          // total is due then.
          await service.from('ticket_payouts').update({
            status: 'failed',
            failure_message: `idempotency conflict after a proven-clean prior rejection, retrying: ${reason}`.slice(0, 1000)
          }).in('event_id', writtenEventIds);
          console.error('ticket-payout-release: IDEMPOTENCY CONFLICT AFTER PROVEN-CLEAN REJECTION, RETRYING NEXT RUN', row.organizer_user_id, idempotencyKey, reason);
          organizersFailed++;
          continue;
        }
        // this exact batch already reached Stripe under this key with
        // DIFFERENT params, so the money very likely moved. It must not stay
        // retryable: Stripe releases an idempotency key after 24h, and a
        // retry past that window would mint a SECOND payout. 'pending' is
        // this file's documented money-moved state, it suppresses
        // re-selection and surfaces loudly for a manual settle.
        await service.from('ticket_payouts').update({
          status: 'pending',
          failure_message: `idempotency conflict, manual settle owed: ${reason}`.slice(0, 1000)
        }).in('event_id', writtenEventIds);
        console.error('ticket-payout-release: IDEMPOTENCY CONFLICT, MONEY MAY HAVE MOVED', row.organizer_user_id, idempotencyKey, reason);
        organizersFailed++;
        continue;
      }
      // A retry is only safe when Stripe PROVED it rejected the request. An
      // error carrying rawType came back from Stripe's API with a decision
      // (balance_insufficient on the first-payout hold, etc), so no money
      // moved and 'failed' is right: list_ticket_payouts_due re-selects it.
      // A connection error, timeout, or api_error proves nothing: Stripe may
      // have created the payout and lost the response. Those must NOT be
      // retryable, because the idempotency key above does not cover them.
      // It is derived from this batch's event id set, so once one more event
      // comes due for this organizer the next run computes a DIFFERENT key
      // and Stripe mints a SECOND payout covering the already-paid event.
      // 'pending' is this file's documented money-moved state: never
      // re-selected, loud in the log, manual settle owed.
      const stripeDecided = typeof err?.rawType === 'string' && err.rawType !== 'api_error';
      await service.from('ticket_payouts').update({
        status: stripeDecided ? 'failed' : 'pending',
        failure_message: (stripeDecided
          ? reason
          : `no decision from stripe, money may have moved, manual settle owed: ${reason}`).slice(0, 1000)
      }).in('event_id', writtenEventIds);
      console.error(stripeDecided
        ? `ticket-payout-release: payout failed ${row.stripe_account_id} ${reason}`
        : `ticket-payout-release: NO STRIPE DECISION, MONEY MAY HAVE MOVED ${row.stripe_account_id} ${idempotencyKey} ${reason}`);
      organizersFailed++;
    }
  }
  return json(200, {
    considered: (due ?? []).length,
    organizers_released: organizersReleased,
    organizers_failed: organizersFailed,
    events_released: eventsReleased
  });
});
