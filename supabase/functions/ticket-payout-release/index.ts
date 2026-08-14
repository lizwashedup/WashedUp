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
 * verify_jwt off — the token is the guard. TEST MODE ONLY:
 * STRIPE_TICKET_SECRET_KEY, stripeKeyIsTest-guarded; a live key is refused.
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
    // record intent first: one pending row PER EVENT (event_id unique; a
    // prior 'failed' row resets to pending; the 67 gate allows pending).
    const writtenEventIds = [];
    let bookkeepingBroke = false;
    for (const ev of events){
      const { error: upErr } = await service.from('ticket_payouts').upsert({
        event_id: ev.event_id,
        organizer_user_id: row.organizer_user_id,
        stripe_account_id_snapshot: row.stripe_account_id,
        amount_cents: ev.amount_cents,
        status: 'pending',
        failure_message: null
      }, {
        onConflict: 'event_id'
      });
      if (upErr) {
        console.error('ticket-payout-release: pending upsert failed', ev.event_id, upErr.message);
        bookkeepingBroke = true;
        break;
      }
      writtenEventIds.push(ev.event_id);
    }
    if (bookkeepingBroke) {
      // no money moved; flip what landed to failed so the next run retries
      if (writtenEventIds.length > 0) {
        await service.from('ticket_payouts').update({
          status: 'failed',
          failure_message: 'pre-payout bookkeeping failed'
        }).in('event_id', writtenEventIds);
      }
      organizersFailed++;
      continue;
    }
    try {
      // ONE manual payout of the organizer's summed due from their connected
      // balance (their account is payout_schedule=manual). Only reaches here
      // for past-end_time events, so the 67 gate permits the release flip.
      const payout = await stripe.payouts.create({
        amount: row.total_due_cents,
        currency: 'usd',
        metadata: {
          organizer_user_id: row.organizer_user_id,
          event_ids: events.map((e)=>e.event_id).join(',')
        }
      }, {
        stripeAccount: row.stripe_account_id
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
    } catch (err) {
      // e.g. balance not yet available (Stripe's first-payout hold) — mark
      // failed with the reason; list_ticket_payouts_due selects them again
      const reason = err?.message?.slice(0, 1000) ?? 'payout failed';
      await service.from('ticket_payouts').update({
        status: 'failed',
        failure_message: reason
      }).in('event_id', writtenEventIds);
      console.error('ticket-payout-release: payout failed', row.stripe_account_id, reason);
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
