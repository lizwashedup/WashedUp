import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@18';
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
 *   - pre-payout bookkeeping error → any pending rows already written for
 *     this organizer are flipped to 'failed' so the next run retries; no
 *     Stripe call is made.
 *   - Stripe payout error (e.g. the first-payout availability hold) → all
 *     this organizer's rows marked 'failed' with the reason; retried next run.
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
const UNIQUE_VIOLATION = '23505';
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
    // THE CLAIM, atomic and all-or-nothing per organizer. This replaces an
    // upsert with onConflict 'event_id', which UPDATEd on conflict and so
    // provided zero mutual exclusion: the 6-hourly cron and a manual
    // x-run-token run could both read the same due list and both pay.
    // Now a plain INSERT wins the fresh case (the ticket_payouts_one_per_event
    // unique index arbitrates; the loser gets 23505), and an existing row is
    // taken only by a conditional update off 'failed', the house pattern from
    // ticket-inbox-drain. Under READ COMMITTED the loser of that update
    // re-evaluates the WHERE against the winner's committed row, sees
    // status='pending' and matches nothing.
    // ALL-OR-NOTHING is the money-critical half: row.total_due_cents is the
    // WHOLE organizer's sum, so paying it while another run owns even one
    // sibling event would pay that sibling twice. Losing any event releases
    // every event already claimed and skips the organizer entirely.
    const writtenEventIds = [];
    let claimFailure = null;
    for (const ev of events){
      const { error: insErr } = await service.from('ticket_payouts').insert({
        event_id: ev.event_id,
        organizer_user_id: row.organizer_user_id,
        stripe_account_id_snapshot: row.stripe_account_id,
        amount_cents: ev.amount_cents,
        status: 'pending',
        failure_message: null
      });
      if (!insErr) {
        writtenEventIds.push(ev.event_id);
        continue;
      }
      if (insErr.code !== UNIQUE_VIOLATION) {
        console.error('ticket-payout-release: pending insert failed', ev.event_id, insErr.message);
        claimFailure = 'pre-payout bookkeeping failed';
        break;
      }
      // a row already exists. Only a 'failed' one is ours to take: a
      // payout.failed webhook or a prior errored run left it retryable, and
      // list_ticket_payouts_due re-selects exactly those. pending/released/
      // paid belong to another run in flight. Clearing stripe_payout_id and
      // released_at is required, not cosmetic: a stale po_ id left on a
      // reclaimed row would let a late payout.paid for the OLD payout stamp
      // this new in-flight claim as paid.
      const { data: reclaimed, error: reErr } = await service.from('ticket_payouts').update({
        organizer_user_id: row.organizer_user_id,
        stripe_account_id_snapshot: row.stripe_account_id,
        amount_cents: ev.amount_cents,
        status: 'pending',
        failure_message: null,
        stripe_payout_id: null,
        released_at: null
      }).eq('event_id', ev.event_id).eq('status', 'failed').select('event_id');
      if (reErr) {
        console.error('ticket-payout-release: claim update failed', ev.event_id, reErr.message);
        claimFailure = 'pre-payout bookkeeping failed';
        break;
      }
      if (!reclaimed || reclaimed.length === 0) {
        console.error('ticket-payout-release: claim lost to a concurrent run', ev.event_id);
        claimFailure = 'claim lost to a concurrent run';
        break;
      }
      writtenEventIds.push(ev.event_id);
    }
    if (claimFailure) {
      // no money moved; release the whole claim back to 'failed' so the next
      // run retries this organizer as one batch
      if (writtenEventIds.length > 0) {
        await service.from('ticket_payouts').update({
          status: 'failed',
          failure_message: claimFailure
        }).in('event_id', writtenEventIds);
      }
      organizersFailed++;
      continue;
    }
    // Deterministic across retries of the SAME batch: organizer + the sorted
    // event ids being paid. Without it, a create that timed out AFTER Stripe
    // made the payout was marked 'failed', re-selected by
    // list_ticket_payouts_due (which excludes only pending/released/paid) and
    // paid AGAIN on the next 6-hourly run. The amount is deliberately NOT in
    // the key: if a refund moved the total, Stripe must refuse the retry
    // rather than mint a second payout under a fresh key.
    // ONE sorted list feeds BOTH the key and the metadata below. Stripe
    // compares every request param against the key, so a metadata string that
    // reordered between attempts would raise idempotency_error on a retry that
    // moved no money, and the handler below would then wrongly strand the
    // organizer as money-moved.
    const paidEventIds = [
      ...writtenEventIds
    ].sort();
    const idempotencyKey = `wu-payout-v1-${await sha256Hex(`${row.organizer_user_id}|${paidEventIds.join(',')}`)}`;
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
