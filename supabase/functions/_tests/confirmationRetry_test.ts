import {
  confirmationIdempotencyKey,
  CONFIRMATION_SEND_ATTEMPTS,
  CONFIRMATION_SEND_TIMEOUT_MS,
  settlementFalseDisposition,
} from '../_shared/confirmationRetry.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('one durable queue attempt makes only one provider call', () => {
  assert(CONFIRMATION_SEND_ATTEMPTS === 1, `expected one attempt, got ${CONFIRMATION_SEND_ATTEMPTS}`);
});

Deno.test('provider timeout is bounded to five seconds', () => {
  assert(CONFIRMATION_SEND_TIMEOUT_MS === 5_000, `unexpected timeout ${CONFIRMATION_SEND_TIMEOUT_MS}`);
});

Deno.test('confirmation idempotency key is stable per order', () => {
  assert(
    confirmationIdempotencyKey('order-123') === 'ticket-confirmation/order-123',
    'idempotency key should be deterministic',
  );
});

Deno.test('a settlement replay preserves delivery for an already-paid order', () => {
  assert(settlementFalseDisposition('paid') === 'already_paid', 'paid replay must preserve the outbox');
});

Deno.test('a genuinely unsettled order still enters refund-owed handling', () => {
  for (const status of [null, 'pending', 'canceled']) {
    assert(settlementFalseDisposition(status) === 'refund_owed', `${status} should require refund handling`);
  }
});
