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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

// --- stripeKeyIsTest / stripeKeyIsLive ---

Deno.test('stripeKeyIsTest: recognizes sk_test_ and rk_test_ keys', () => {
  assert(stripeKeyIsTest('sk_test_abc') === true, 'sk_test_ should be test');
  assert(stripeKeyIsTest('rk_test_abc') === true, 'rk_test_ should be test');
});

Deno.test('stripeKeyIsTest: a live key is not a test key', () => {
  assert(stripeKeyIsTest('sk_live_abc') === false, 'sk_live_ should not be test');
});

Deno.test('stripeKeyIsLive: recognizes sk_live_ and rk_live_ keys', () => {
  assert(stripeKeyIsLive('sk_live_abc') === true, 'sk_live_ should be live');
  assert(stripeKeyIsLive('rk_live_abc') === true, 'rk_live_ should be live');
});

Deno.test('stripeKeyIsLive: a test key is not a live key', () => {
  assert(stripeKeyIsLive('sk_test_abc') === false, 'sk_test_ should not be live');
});

Deno.test('stripeKeyIsTest/Live: an empty or garbage key is neither', () => {
  assert(stripeKeyIsTest('') === false && stripeKeyIsLive('') === false, 'empty key is neither');
  assert(stripeKeyIsTest('nonsense') === false && stripeKeyIsLive('nonsense') === false, 'garbage key is neither');
});

// --- resolveClientCheckoutKey ---

Deno.test('resolveClientCheckoutKey: accepts a well-formed key and trims it', () => {
  assert(resolveClientCheckoutKey('  abcd1234  ') === 'abcd1234', 'should trim and accept');
});

Deno.test('resolveClientCheckoutKey: rejects a key shorter than 8 chars', () => {
  assert(resolveClientCheckoutKey('short') === null, 'too short should be rejected');
});

Deno.test('resolveClientCheckoutKey: rejects a key with disallowed characters', () => {
  assert(resolveClientCheckoutKey('has spaces!!') === null, 'illegal characters should be rejected');
});

Deno.test('resolveClientCheckoutKey: rejects non-string input (absent key)', () => {
  assert(resolveClientCheckoutKey(undefined) === null, 'undefined should be rejected');
  assert(resolveClientCheckoutKey(12345678) === null, 'a number should be rejected');
});

Deno.test('resolveClientCheckoutKey: accepts a real crypto.randomUUID()-shaped key', () => {
  const uuid = crypto.randomUUID();
  assert(resolveClientCheckoutKey(uuid) === uuid, 'a real UUID should round-trip');
});

// --- namespaceIdempotencyKey ---

Deno.test('namespaceIdempotencyKey: namespaces to ctc:{buyer}:{key}', () => {
  assert(namespaceIdempotencyKey('user-1', 'key-1') === 'ctc:user-1:key-1', 'should build the exact namespace');
});

Deno.test('namespaceIdempotencyKey: two different buyers with the same key never collide', () => {
  const a = namespaceIdempotencyKey('buyer-a', 'same-key');
  const b = namespaceIdempotencyKey('buyer-b', 'same-key');
  assert(a !== b, 'different buyers must produce different idempotency keys');
});

// --- isHoldTooStaleForSession ---

const FLOOR = 30 * 60;
const BUFFER = 60;

Deno.test('isHoldTooStaleForSession: a hold with plenty of time left is not stale', () => {
  const now = Date.now();
  const holdExpiresAt = new Date(now + 35 * 60 * 1000).toISOString();
  assert(isHoldTooStaleForSession(holdExpiresAt, now, FLOOR, BUFFER) === false, 'fresh 35-min hold should not be stale');
});

Deno.test('isHoldTooStaleForSession: a hold under the floor+buffer is stale', () => {
  const now = Date.now();
  const holdExpiresAt = new Date(now + 20 * 60 * 1000).toISOString();
  assert(isHoldTooStaleForSession(holdExpiresAt, now, FLOOR, BUFFER) === true, '20 minutes left should be stale');
});

Deno.test('isHoldTooStaleForSession: an unparseable date is treated as stale', () => {
  assert(isHoldTooStaleForSession('not-a-date', Date.now(), FLOOR, BUFFER) === true, 'garbage date must fail closed to stale');
});

Deno.test('isHoldTooStaleForSession: exactly at floor+buffer is the last safe instant, not stale (strict <)', () => {
  const now = Date.now();
  const holdExpiresAt = new Date(now + (FLOOR + BUFFER) * 1000).toISOString();
  assert(isHoldTooStaleForSession(holdExpiresAt, now, FLOOR, BUFFER) === false, 'exactly floor+buffer should not yet be stale');
});

Deno.test('isHoldTooStaleForSession: one second inside floor+buffer is stale', () => {
  const now = Date.now();
  const holdExpiresAt = new Date(now + (FLOOR + BUFFER - 1) * 1000).toISOString();
  assert(isHoldTooStaleForSession(holdExpiresAt, now, FLOOR, BUFFER) === true, 'one second short of the floor+buffer should be stale');
});

// --- applicationFeeCents ---

Deno.test('applicationFeeCents: commission plus processing, matching the documented example', () => {
  // from the file's own doc comment: $41.51 total − (160+151) = $38.40 = $40 face − $1.60
  assert(applicationFeeCents(160, 151) === 311, 'should equal commission + processing exactly');
});

Deno.test('applicationFeeCents: never silently drops processing (the documented past bug)', () => {
  const commission = 200;
  const processing = 137;
  assert(applicationFeeCents(commission, processing) !== commission, 'must not equal commission alone');
  assert(applicationFeeCents(commission, processing) === commission + processing, 'must include processing');
});

// --- planAddonLineItems ---

Deno.test('planAddonLineItems: no add-ons produces no lines and no fallback', () => {
  const planned = planAddonLineItems(0, []);
  assertEqual(planned, { lines: [], usedFallback: false }, 'zero addon total should be empty, not a fallback line');
});

Deno.test('planAddonLineItems: itemized rows that sum correctly produce a nice per-item receipt', () => {
  const rows = [
    { qty: 2, unit_price_cents: 500, name_snapshot: 'drink ticket' },
    { qty: 1, unit_price_cents: 300, name_snapshot: 'coat check' },
  ];
  const planned = planAddonLineItems(1300, rows);
  assert(planned.usedFallback === false, 'a correctly-summing breakdown should not fall back');
  assert(planned.lines.length === 2, 'should itemize one line per row');
  assert(planned.lines[0].price_data.product_data.name === 'drink ticket', 'names should carry through');
});

Deno.test('planAddonLineItems: a breakdown that does not sum to the folded total falls back to one exact-remainder line, never an undercharge', () => {
  const rows = [{ qty: 1, unit_price_cents: 500, name_snapshot: 'mismatched row' }];
  const planned = planAddonLineItems(1300, rows); // rows sum to 500, not 1300
  assert(planned.usedFallback === true, 'mismatched sum must trigger the fallback');
  assert(planned.lines.length === 1, 'fallback is exactly one line');
  assert(planned.lines[0].price_data.unit_amount === 1300, 'fallback line must charge the FULL folded remainder, not the mismatched row sum');
});

Deno.test('planAddonLineItems: an unreadable (empty) breakdown with a positive total falls back safely', () => {
  const planned = planAddonLineItems(500, []);
  assert(planned.usedFallback === true, 'empty rows with a positive total must fall back');
  assert(planned.lines[0].price_data.unit_amount === 500, 'fallback must still charge the real remainder');
});

// --- planPriorSessionReuse ---

Deno.test('planPriorSessionReuse: a completed session is already_paid', () => {
  assert(planPriorSessionReuse({ status: 'complete' }, 1000) === 'already_paid', 'status complete');
  assert(planPriorSessionReuse({ status: 'open', payment_status: 'paid' }, 1000) === 'already_paid', 'payment_status paid overrides open');
});

Deno.test('planPriorSessionReuse: an expired session is expired', () => {
  assert(planPriorSessionReuse({ status: 'expired' }, 1000) === 'expired', 'status expired');
});

Deno.test('planPriorSessionReuse: an open session pricing this exact order is reusable', () => {
  const action = planPriorSessionReuse({ status: 'open', url: 'https://checkout.stripe.com/x', amount_total: 1000 }, 1000);
  assert(action === 'reusable', 'matching open session should be reused, not replaced');
});

Deno.test('planPriorSessionReuse: an open session with no url is not reusable (replace)', () => {
  const action = planPriorSessionReuse({ status: 'open', url: null, amount_total: 1000 }, 1000);
  assert(action === 'replace', 'no url means it cannot be reused');
});

Deno.test('planPriorSessionReuse: an open session pricing a DIFFERENT total is not reusable (replace) — the undercharge/overcharge guard', () => {
  const action = planPriorSessionReuse({ status: 'open', url: 'https://checkout.stripe.com/x', amount_total: 999 }, 1000);
  assert(action === 'replace', 'a price mismatch must never be silently reused');
});

Deno.test('planPriorSessionReuse: an unrecognized status falls through to replace', () => {
  assert(planPriorSessionReuse({ status: 'some_future_stripe_status' }, 1000) === 'replace', 'unknown status defaults to replace, not reuse');
});
