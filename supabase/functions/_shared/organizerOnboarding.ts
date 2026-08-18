// Pure decision logic for ticket-connect-onboarding, extracted for testing
// (2026-08-18). No Stripe/Supabase I/O here — the caller owns the grant
// query, the actual /accounts and /account_links calls, and the DB writes.

// every approved grant today is a founding partner; a non-founding rate is
// a reviewed change — and the per-organizer lock in organizer_stripe_accounts
// table is what actually governs at checkout (this constant only seeds new rows).
export const FOUNDING_PARTNER_BPS = 400;

export const UNIQUE_VIOLATION = '23505';

export interface OperatorGrant {
  track: string;
  status: string;
}

export function hasApprovedOrganizerGrant(grants: OperatorGrant[] | null | undefined): boolean {
  return !!grants && grants.length > 0;
}

// doc 61 §2 target config: platform pays fees and carries losses, Stripe
// collects requirements, express dashboard, MANUAL payout schedule (lean 3
// — no code path can pay out before the release cron says so).
export function buildExpressAccountParams(userId: string): Record<string, string> {
  return {
    country: 'US',
    'controller[fees][payer]': 'application',
    'controller[losses][payments]': 'application',
    'controller[requirement_collection]': 'stripe',
    'controller[stripe_dashboard][type]': 'express',
    'capabilities[card_payments][requested]': 'true',
    'capabilities[transfers][requested]': 'true',
    'settings[payouts][schedule][interval]': 'manual',
    'metadata[washedup_user_id]': userId,
  };
}

export type AccountRowInsertOutcome = 'created' | 'race_recovered' | 'needs_human';

// the 7-21 concurrent-create race: a unique-violation on the lock-row insert
// means another request won the row while we were at Stripe — adopt the
// winner's account and carry on (our just-created Stripe account becomes an
// inert orphan: no row, nothing ever routes to it). Any OTHER insert error
// means the account exists at Stripe but got recorded nowhere — a retry
// would double-create, so that's the one path needing a human.
export function planAccountRowInsert(insertError: { code?: string } | null | undefined): AccountRowInsertOutcome {
  if (!insertError) return 'created';
  if (insertError.code === UNIQUE_VIOLATION) return 'race_recovered';
  return 'needs_human';
}
