import { claimPayoutBatch } from '../_shared/payoutBatchClaim.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)}`);
  }
}

const row = { organizer_user_id: 'organizer-1', stripe_account_id: 'acct_one' };
const events = [
  { event_id: 'event-1', amount_cents: 100 },
  { event_id: 'event-2', amount_cents: 200 },
];

Deno.test('payout orchestration makes one RPC with the complete event array', async () => {
  const calls: unknown[] = [];
  const result = await claimPayoutBatch(async (name, args) => {
    calls.push([name, args]);
    return { data: 'claimed', error: null };
  }, row, events);

  assertEqual(calls, [[
    'claim_ticket_payout_batch',
    {
      p_organizer_user_id: 'organizer-1',
      p_stripe_account_id: 'acct_one',
      p_events: events,
    },
  ]], 'batch RPC calls');
  assert(result.claimed, 'expected claimed result');
  assertEqual(result.eventIds, ['event-1', 'event-2'], 'claimed event ids');
});

Deno.test('busy or database errors never report a successful claim', async () => {
  let calls = 0;
  const busy = await claimPayoutBatch(async () => {
    calls++;
    return { data: 'busy', error: null };
  }, row, events);
  const failed = await claimPayoutBatch(async () => {
    calls++;
    return { data: null, error: { message: 'database unavailable' } };
  }, row, events);
  assertEqual(calls, 2, 'one RPC per orchestration');
  assert(!busy.claimed && !failed.claimed, 'busy and error must fail closed');
  assertEqual(failed.errorMessage, 'database unavailable', 'error message');
});
