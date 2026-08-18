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

/** In-call attempts against Resend within ONE drain invocation (the fast
 * path for a blip that clears in under ~1.2s). Anything still failing after
 * this is handed to a durable retry row, which gets the SAME
 * claim/attempts/poison-cap machinery (up to MAX_ATTEMPTS drain cycles) as
 * every other row in ticket_webhook_events, so there is no reason to burn a
 * large in-call time budget here — a batch can hold up to BATCH_SIZE rows
 * and every one of them shares the same invocation's wall-clock budget. */
export const CONFIRMATION_SEND_ATTEMPTS = 3;

const BACKOFF_SCHEDULE_MS = [300, 900] as const;

/** Delay before in-call retry attempt `attemptIndex` (0-based: 0 = the
 * delay before the SECOND overall attempt, i.e. the first retry). Clamped
 * to the schedule's last value past its length instead of growing
 * unbounded, and never negative. */
export function confirmationBackoffMs(attemptIndex: number): number {
  if (attemptIndex < 0) return 0;
  return BACKOFF_SCHEDULE_MS[Math.min(attemptIndex, BACKOFF_SCHEDULE_MS.length - 1)];
}

/**
 * Should a Resend response be retried WITHIN this same invocation? `status`
 * is null for a thrown/timed-out fetch (fetchWithTimeout's own "unreachable"
 * signal, which never distinguishes a DNS/TLS/connect failure from a real
 * timeout) — always worth an immediate retry, same as a 5xx/429/408. A clean
 * 4xx otherwise (bad request, invalid/rotated API key, unprocessable
 * recipient) will not succeed on the SAME key and payload a moment later, so
 * in-call retry is skipped for it; it still gets a durable retry (decided by
 * the caller in ticket-inbox-drain, not here) because the underlying cause
 * might be fixed within the drain's retry window (e.g. an operator rotates a
 * key back, or Resend's own validation was a transient false rejection).
 */
export function isImmediatelyRetryableStatus(status: number | null): boolean {
  if (status === null) return true;
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}
