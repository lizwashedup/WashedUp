import {
  CONFIRMATION_SEND_ATTEMPTS,
  confirmationBackoffMs,
  isImmediatelyRetryableStatus,
} from '../_shared/confirmationRetry.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('backoff schedule is short and matches the documented values', () => {
  assert(confirmationBackoffMs(0) === 300, `first retry delay: ${confirmationBackoffMs(0)}`);
  assert(confirmationBackoffMs(1) === 900, `second retry delay: ${confirmationBackoffMs(1)}`);
});

Deno.test('backoff clamps past the schedule instead of growing unbounded', () => {
  assert(confirmationBackoffMs(2) === 900, 'index 2 should clamp to the last scheduled value');
  assert(confirmationBackoffMs(50) === 900, 'a far-out index should still clamp to the last scheduled value');
});

Deno.test('a negative attempt index never produces a negative delay', () => {
  assert(confirmationBackoffMs(-1) === 0, 'negative index should floor at 0');
});

Deno.test('network/timeout (null status, fetchWithTimeout\'s unreachable signal) is always immediately retryable', () => {
  assert(isImmediatelyRetryableStatus(null) === true, 'null status should retry immediately');
});

Deno.test('transient Resend statuses are immediately retryable', () => {
  for (const s of [408, 429, 500, 502, 503, 504]) {
    assert(isImmediatelyRetryableStatus(s) === true, `status ${s} should be immediately retryable`);
  }
});

Deno.test('deterministic client-error statuses are not immediately retryable in-call', () => {
  for (const s of [400, 401, 403, 404, 422]) {
    assert(isImmediatelyRetryableStatus(s) === false, `status ${s} should not be immediately retryable`);
  }
});

Deno.test('success/redirect statuses never read as retryable (boundary should not misfire)', () => {
  assert(isImmediatelyRetryableStatus(200) === false, '200 should not be retryable');
  assert(isImmediatelyRetryableStatus(201) === false, '201 should not be retryable');
  assert(isImmediatelyRetryableStatus(302) === false, '302 should not be retryable');
});

Deno.test('CONFIRMATION_SEND_ATTEMPTS stays small and bounded', () => {
  assert(
    CONFIRMATION_SEND_ATTEMPTS >= 2 && CONFIRMATION_SEND_ATTEMPTS <= 5,
    `attempts should be a small bounded number, got ${CONFIRMATION_SEND_ATTEMPTS}`,
  );
});
