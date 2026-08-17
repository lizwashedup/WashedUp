import {
  applyPayoutReconciliationFilters,
  planPayoutReconciliation,
} from '../_shared/payoutReconciliation.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)}`);
  }
}

const paidPayload = (account: unknown = 'acct_one') => ({
  account,
  data: { object: { id: 'po_shared' } },
});

Deno.test('payout plans bind a shared payout id to the connected account snapshot', () => {
  const first = planPayoutReconciliation('payout.paid', paidPayload('acct_one'), 'now');
  const second = planPayoutReconciliation('payout.paid', paidPayload('acct_two'), 'now');
  assert(first.kind === 'update' && second.kind === 'update', 'expected update plans');
  assertEqual(first.filters, [
    ['stripe_payout_id', 'po_shared'],
    ['stripe_account_id_snapshot', 'acct_one'],
  ], 'first identity filters');
  assertEqual(second.filters, [
    ['stripe_payout_id', 'po_shared'],
    ['stripe_account_id_snapshot', 'acct_two'],
  ], 'second identity filters');
});

Deno.test('paid and failed patches stay exact', () => {
  const paid = planPayoutReconciliation('payout.paid', paidPayload(), '2026-08-16T00:00:00Z');
  const failed = planPayoutReconciliation('payout.failed', {
    account: 'acct_one',
    data: { object: { id: 'po_shared', failure_code: 'declined' } },
  }, 'unused');
  assert(paid.kind === 'update' && failed.kind === 'update', 'expected update plans');
  assertEqual(paid.patch, { status: 'paid', paid_at: '2026-08-16T00:00:00Z' }, 'paid patch');
  assertEqual(failed.patch, { status: 'failed', failure_message: 'declined' }, 'failed patch');
});

for (const [name, type, payload] of [
  ['missing account', 'payout.paid', paidPayload(null)],
  ['malformed account', 'payout.paid', paidPayload('platform')],
  ['missing payout', 'payout.paid', { account: 'acct_one', data: { object: {} } }],
  ['wrong event type', 'charge.refunded', paidPayload()],
] as const) {
  Deno.test(`invalid payout input: ${name}`, () => {
    const plan = planPayoutReconciliation(type, payload, 'now');
    assert(plan.kind === 'invalid', 'expected an invalid plan');
  });
}

Deno.test('recording query receives both identity filters', () => {
  const plan = planPayoutReconciliation('payout.paid', paidPayload(), 'now');
  assert(plan.kind === 'update', 'expected an update plan');
  const calls: unknown[] = [];
  const query = {
    eq(column: string, value: string) {
      calls.push([column, value]);
      return this;
    },
  };
  applyPayoutReconciliationFilters(query, plan.filters);
  assertEqual(calls, plan.filters, 'applied filters');
});
