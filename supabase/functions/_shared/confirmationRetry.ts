// Pure retry/backoff decisions for the buyer-confirmation email send (doc
// 112). No I/O: sendBuyerConfirmation in ticket-inbox-drain does the real
// fetch/DB work and asks this module what to do with the outcome. Split out
// the same way planPayoutReconciliation.ts is: the decision is unit-testable
// without a live Resend key or a Supabase client.
//
// Root cause this exists to fix (confirmed against real production data,
// 2026-08-17): a failed confirmation send was caught and only console.error
// logged. confirmation_email_sent_at stayed null forever, nothing retried,
// nothing alerted. Two retry tiers close that gap:
//   1. IN-CALL: a short bounded retry against Resend itself, within the same
//      drain invocation, for the common transient blip.
//   2. DURABLE: anything still failing is hand off to a new
//      ticket_webhook_events row (type 'confirmation_email_retry'), so it
//      inherits the SAME claim-before-work / MAX_ATTEMPTS poison-cap /
//      stampFailed+alert_state machinery every other row in that table
//      already uses (proven in the 2026-07-21 rewrite and the 2026-08-14
//      money audit) rather than a second bespoke retry system.

/** One provider call per durable queue attempt. Retrying inside the serial
 * settlement drain let a small set of failing emails monopolize the queue.
 * The inbox row already supplies bounded durable retries, so each invocation
 * should fail fast and yield. */
export const CONFIRMATION_SEND_ATTEMPTS = 1;

/** Bound one provider attempt tightly enough that confirmation failures cannot
 * starve fresh paid checkout events in the same drain. */
export const CONFIRMATION_SEND_TIMEOUT_MS = 5_000;

/** Resend deduplicates this request for 24 hours. The queue's poison window is
 * about one hour, so every retry of one order uses the same provider key. */
export function confirmationIdempotencyKey(orderId: string): string {
  return `ticket-confirmation/${orderId}`;
}

/** A replay after a crash can see settle_ticket_hold return false even though
 * the first attempt already committed the paid order. Never cancel that
 * order's valid confirmation outbox or claim a refund is owed. */
export function settlementFalseDisposition(orderStatus: string | null): 'already_paid' | 'refund_owed' {
  return orderStatus === 'paid' ? 'already_paid' : 'refund_owed';
}
