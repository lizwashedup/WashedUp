import { createHmac } from 'node:crypto';
import {
  timingSafeEqual,
  hmacSha256Hex,
  parseStripeSignatureHeader,
  isTimestampWithinTolerance,
  isValidStripeEventShape,
  hasValidLivemode,
  livemodeMatchesSecret,
} from '../_shared/webhookVerification.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// --- timingSafeEqual ---

Deno.test('timingSafeEqual: identical strings match', () => {
  assert(timingSafeEqual('abc123', 'abc123') === true, 'equal strings should match');
});

Deno.test('timingSafeEqual: different content, same length does not match', () => {
  assert(timingSafeEqual('abc123', 'abc124') === false, 'differing last char should not match');
});

Deno.test('timingSafeEqual: different lengths never match', () => {
  assert(timingSafeEqual('abc', 'abcd') === false, 'different lengths should not match');
});

Deno.test('timingSafeEqual: two empty strings match', () => {
  assert(timingSafeEqual('', '') === true, 'two empty strings should match');
});

// --- hmacSha256Hex ---

Deno.test('hmacSha256Hex: matches Node\'s independent crypto implementation', async () => {
  // Cross-check against a completely separate HMAC-SHA256 implementation
  // (Node's built-in crypto, not WebCrypto) rather than a hand-typed digest
  // constant, which is too easy to transcribe wrong and have it go unnoticed.
  const key = 'cross-check-secret';
  const msg = 'The quick brown fox jumps over the lazy dog';
  const ours = await hmacSha256Hex(key, new TextEncoder().encode(msg));
  const reference = createHmac('sha256', key).update(msg).digest('hex');
  assert(ours === reference, `ours=${ours} reference=${reference}`);
});

Deno.test('hmacSha256Hex: deterministic for the same secret and message', async () => {
  const msg = new TextEncoder().encode('same input twice');
  const a = await hmacSha256Hex('shared-secret', msg);
  const b = await hmacSha256Hex('shared-secret', msg);
  assert(a === b, 'same input should always produce the same digest');
});

Deno.test('hmacSha256Hex: a different secret produces a different digest', async () => {
  const msg = new TextEncoder().encode('same message');
  const a = await hmacSha256Hex('secret-one', msg);
  const b = await hmacSha256Hex('secret-two', msg);
  assert(a !== b, 'different secrets must not collide');
});

// --- parseStripeSignatureHeader ---

Deno.test('parseStripeSignatureHeader: parses a normal single-v1 header', () => {
  const parsed = parseStripeSignatureHeader('t=1700000000,v1=abc123');
  assert(parsed !== null, 'should parse');
  assert(parsed!.rawTs === '1700000000', 'raw ts preserved verbatim');
  assert(parsed!.ts === 1700000000, 'numeric ts parsed');
  assert(parsed!.v1s.length === 1 && parsed!.v1s[0] === 'abc123', 'single v1 captured');
});

Deno.test('parseStripeSignatureHeader: captures multiple v1s during secret rotation', () => {
  const parsed = parseStripeSignatureHeader('t=1700000000,v1=old111,v1=new222');
  assert(parsed !== null, 'should parse');
  assert(parsed!.v1s.length === 2, 'both v1 signatures captured');
  assert(parsed!.v1s.includes('old111') && parsed!.v1s.includes('new222'), 'both values present');
});

Deno.test('parseStripeSignatureHeader: missing t returns null', () => {
  assert(parseStripeSignatureHeader('v1=abc123') === null, 'no timestamp should fail to parse');
});

Deno.test('parseStripeSignatureHeader: missing v1 returns null', () => {
  assert(parseStripeSignatureHeader('t=1700000000') === null, 'no v1 should fail to parse');
});

Deno.test('parseStripeSignatureHeader: empty header returns null', () => {
  assert(parseStripeSignatureHeader('') === null, 'empty header should fail to parse');
});

Deno.test('parseStripeSignatureHeader: malformed pieces are ignored, not fatal', () => {
  const parsed = parseStripeSignatureHeader('t=1700000000,garbage,v1=abc123');
  assert(parsed !== null, 'should still parse around a malformed piece');
  assert(parsed!.v1s[0] === 'abc123', 'valid v1 still captured');
});

// --- isTimestampWithinTolerance ---

Deno.test('isTimestampWithinTolerance: exactly at the boundary passes', () => {
  assert(isTimestampWithinTolerance(1000, 1300, 300) === true, 'exactly 300s skew should pass (inclusive)');
});

Deno.test('isTimestampWithinTolerance: one second past the boundary fails', () => {
  assert(isTimestampWithinTolerance(1000, 1301, 300) === false, '301s skew should fail');
});

Deno.test('isTimestampWithinTolerance: a timestamp from the future is also bounded', () => {
  assert(isTimestampWithinTolerance(1301, 1000, 300) === false, 'future timestamps are bounded too (abs)');
});

Deno.test('isTimestampWithinTolerance: zero skew always passes', () => {
  assert(isTimestampWithinTolerance(1000, 1000, 300) === true, 'no skew should pass');
});

// --- isValidStripeEventShape ---

Deno.test('isValidStripeEventShape: accepts a real-looking event', () => {
  assert(isValidStripeEventShape({ id: 'evt_123', type: 'checkout.session.completed' }) === true, 'valid shape');
});

Deno.test('isValidStripeEventShape: rejects an id not prefixed evt_', () => {
  assert(isValidStripeEventShape({ id: 'cs_123', type: 'checkout.session.completed' }) === false, 'wrong prefix');
});

Deno.test('isValidStripeEventShape: rejects a missing type', () => {
  assert(isValidStripeEventShape({ id: 'evt_123' }) === false, 'missing type');
});

Deno.test('isValidStripeEventShape: rejects null', () => {
  assert(isValidStripeEventShape(null) === false, 'null is not a valid event');
});

// --- hasValidLivemode / livemodeMatchesSecret: the documented mode-binding fix ---

Deno.test('hasValidLivemode: true and false are both valid booleans', () => {
  assert(hasValidLivemode({ livemode: true }) === true, 'true is valid');
  assert(hasValidLivemode({ livemode: false }) === true, 'false is valid');
});

Deno.test('hasValidLivemode: a missing livemode fails closed', () => {
  assert(hasValidLivemode({}) === false, 'missing livemode must fail closed');
});

Deno.test('hasValidLivemode: a string "true" is not a boolean and fails closed', () => {
  assert(hasValidLivemode({ livemode: 'true' }) === false, 'stringly-typed livemode must fail closed');
});

// the four real combinations the 2026-08-14 fix exists to enforce.
Deno.test('livemodeMatchesSecret: a live event signed by the live secret is accepted', () => {
  assert(livemodeMatchesSecret(true, true) === true, 'live/live should match');
});

Deno.test('livemodeMatchesSecret: a test event signed by the test secret is accepted', () => {
  assert(livemodeMatchesSecret(false, false) === true, 'test/test should match');
});

Deno.test('livemodeMatchesSecret: a live-claiming event signed by a test secret is rejected', () => {
  assert(livemodeMatchesSecret(true, false) === false, 'a leaked test whsec must not be able to forge livemode:true');
});

Deno.test('livemodeMatchesSecret: a test-claiming event signed by a live secret is rejected', () => {
  assert(livemodeMatchesSecret(false, true) === false, 'the mismatch is rejected in both directions');
});
