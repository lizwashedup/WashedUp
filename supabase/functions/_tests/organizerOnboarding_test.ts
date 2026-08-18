import {
  FOUNDING_PARTNER_BPS,
  hasApprovedOrganizerGrant,
  buildExpressAccountParams,
  planAccountRowInsert,
} from '../_shared/organizerOnboarding.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// --- FOUNDING_PARTNER_BPS ---
// A fat-fingered commission constant is a real money bug (e.g. 4000 instead
// of 400 would be 40% instead of 4%). Lock it to a small, sane bps range.

Deno.test('FOUNDING_PARTNER_BPS: stays a small single-digit percentage, not a fat-fingered order of magnitude', () => {
  assert(FOUNDING_PARTNER_BPS === 400, `expected the documented 4% (400 bps), got ${FOUNDING_PARTNER_BPS}`);
  assert(FOUNDING_PARTNER_BPS > 0 && FOUNDING_PARTNER_BPS < 1000, 'bps should read as a small single-digit percentage');
});

// --- hasApprovedOrganizerGrant ---

Deno.test('hasApprovedOrganizerGrant: at least one grant row is approved', () => {
  assert(hasApprovedOrganizerGrant([{ track: 'event_host', status: 'approved' }]) === true, 'one grant should approve');
});

Deno.test('hasApprovedOrganizerGrant: an empty array is not approved', () => {
  assert(hasApprovedOrganizerGrant([]) === false, 'empty array should not approve');
});

Deno.test('hasApprovedOrganizerGrant: null or undefined is not approved', () => {
  assert(hasApprovedOrganizerGrant(null) === false, 'null should not approve');
  assert(hasApprovedOrganizerGrant(undefined) === false, 'undefined should not approve');
});

// --- buildExpressAccountParams ---
// This is the doc 61 §2 safety config. The manual payout schedule in
// particular is load-bearing: it's the only thing stopping money moving
// before the release cron approves it. Lock the exact params sent to Stripe.

Deno.test('buildExpressAccountParams: payouts are manual, never automatic', () => {
  const params = buildExpressAccountParams('user-1');
  assert(params['settings[payouts][schedule][interval]'] === 'manual', 'payout schedule must stay manual (lean 3 safety property)');
});

Deno.test('buildExpressAccountParams: platform carries fees and losses, not the connected account', () => {
  const params = buildExpressAccountParams('user-1');
  assert(params['controller[fees][payer]'] === 'application', 'platform must pay fees');
  assert(params['controller[losses][payments]'] === 'application', 'platform must carry losses');
});

Deno.test('buildExpressAccountParams: uses the express dashboard, not a custom or none-controller dashboard', () => {
  const params = buildExpressAccountParams('user-1');
  assert(params['controller[stripe_dashboard][type]'] === 'express', 'must be the express dashboard type');
});

Deno.test('buildExpressAccountParams: stamps the requesting user id in metadata for support/audit lookups', () => {
  const params = buildExpressAccountParams('user-42');
  assert(params['metadata[washedup_user_id]'] === 'user-42', 'the actual caller id should be stamped, not a placeholder');
});

Deno.test('buildExpressAccountParams: requests both card_payments and transfers capabilities', () => {
  const params = buildExpressAccountParams('user-1');
  assert(params['capabilities[card_payments][requested]'] === 'true', 'card_payments must be requested');
  assert(params['capabilities[transfers][requested]'] === 'true', 'transfers must be requested (needed for destination charges)');
});

// --- planAccountRowInsert ---

Deno.test('planAccountRowInsert: no error means the row was created cleanly', () => {
  assert(planAccountRowInsert(null) === 'created', 'no error should read as created');
  assert(planAccountRowInsert(undefined) === 'created', 'undefined error should read as created');
});

Deno.test('planAccountRowInsert: a unique-violation is the concurrent-create race, recoverable', () => {
  assert(planAccountRowInsert({ code: '23505' }) === 'race_recovered', 'unique violation should be race_recovered');
});

Deno.test('planAccountRowInsert: any other error means the account is orphaned at Stripe and needs a human', () => {
  assert(planAccountRowInsert({ code: '42501' }) === 'needs_human', 'a non-unique-violation error must escalate to a human, not silently retry');
  assert(planAccountRowInsert({}) === 'needs_human', 'an error object with no code must still escalate, not be assumed benign');
});
