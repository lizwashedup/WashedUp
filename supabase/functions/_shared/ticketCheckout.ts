// Pure decision logic for create-ticket-checkout, extracted for testing
// (2026-08-18). No Stripe/Supabase I/O here — the caller owns the RPC call,
// the actual Stripe session create/retrieve/expire, and the DB writes.

export function stripeKeyIsTest(key: string): boolean {
  return key.startsWith('sk_test_') || key.startsWith('rk_test_');
}

export function stripeKeyIsLive(key: string): boolean {
  return key.startsWith('sk_live_') || key.startsWith('rk_live_');
}

// client-supplied checkout_key shape: what crypto.randomUUID()-style client
// keys look like; anything else is ignored (caller falls back to a random
// per-invocation key) rather than rejected.
const CHECKOUT_KEY_SHAPE = /^[A-Za-z0-9_-]{8,64}$/;

export function resolveClientCheckoutKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return CHECKOUT_KEY_SHAPE.test(trimmed) ? trimmed : null;
}

// namespaced so one user can never squat another user's key (the RPC's
// idempotency_key column is globally unique).
export function namespaceIdempotencyKey(buyerId: string, key: string): string {
  return `ctc:${buyerId}:${key}`;
}

// Stripe requires a Checkout session's expires_at to be 30 min to 24 h after
// creation. A stale reused key can point at a hold with under 30 minutes
// left; Stripe would reject that expires_at, so this checks the floor
// (plus a clock-skew buffer) before ever calling Stripe.
export function isHoldTooStaleForSession(
  holdExpiresAtIso: string,
  nowMs: number,
  floorSec: number,
  bufferSec: number,
): boolean {
  const holdExpiresSec = Math.floor(new Date(holdExpiresAtIso).getTime() / 1000);
  const nowSec = Math.floor(nowMs / 1000);
  if (!Number.isFinite(holdExpiresSec)) return true;
  return holdExpiresSec - nowSec < floorSec + bufferSec;
}

// With a DESTINATION charge the connected account receives (charge total −
// application_fee). To land the organizer at exactly face − commission, the
// application_fee must be commission + processing: the platform keeps that,
// pays Stripe's processing fee, and nets the commission. Charging only the
// commission would hand the buyer's processing cost to the organizer.
export function applicationFeeCents(commissionCents: number, processingCents: number): number {
  return commissionCents + processingCents;
}

export interface AddonRow {
  qty: number;
  unit_price_cents: number;
  name_snapshot: string;
}

export interface PlannedAddonLines {
  lines: Array<{ quantity: number; price_data: { currency: string; unit_amount: number; product_data: { name: string } } }>;
  usedFallback: boolean;
}

// Add-on money is folded into face_cents by the RPC, so the remainder above
// the base ticket price MUST appear as its own Stripe line or the buyer is
// undercharged by exactly that amount. If the itemized rows can't be read
// back or don't sum to the expected remainder, charge the exact remainder as
// one line rather than let a read failure become an undercharge.
export function planAddonLineItems(addonTotalCents: number, rows: AddonRow[]): PlannedAddonLines {
  if (addonTotalCents <= 0) return { lines: [], usedFallback: false };
  const itemized = rows.map((r) => ({
    quantity: r.qty,
    price_data: { currency: 'usd', unit_amount: r.unit_price_cents, product_data: { name: r.name_snapshot } },
  }));
  const itemizedSum = rows.reduce((s, r) => s + r.qty * r.unit_price_cents, 0);
  if (itemized.length > 0 && itemizedSum === addonTotalCents) {
    return { lines: itemized, usedFallback: false };
  }
  return {
    lines: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: addonTotalCents, product_data: { name: 'extras' } } }],
    usedFallback: true,
  };
}

export type PriorSessionAction = 'already_paid' | 'expired' | 'reusable' | 'replace';

export interface PriorSessionSnapshot {
  status: string;
  payment_status?: string | null;
  url?: string | null;
  amount_total?: number | null;
}

// One order gets ONE payable session, ever. A second session for the same
// order can also be paid with no reconciliation, so a reused checkout_key
// must hand back the SAME session rather than mint a new payable one.
export function planPriorSessionReuse(prior: PriorSessionSnapshot, expectedTotalCents: number): PriorSessionAction {
  if (prior.status === 'complete' || prior.payment_status === 'paid') return 'already_paid';
  if (prior.status === 'expired') return 'expired';
  if (prior.status === 'open' && typeof prior.url === 'string' && prior.amount_total === expectedTotalCents) {
    return 'reusable';
  }
  return 'replace';
}
