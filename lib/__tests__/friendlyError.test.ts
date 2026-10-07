import { friendlyError } from '../friendlyError';

const FALLBACK = 'We could not delete your account automatically.';

// The exact text raised by public.block_account_deletion_with_pending_payout()
// / public.delete_own_account() in
// supabase/migrations/20260817120000_block_delete_account_with_pending_payout.sql.
// This is the real user-facing message for the pending-organizer-payout
// account-deletion block, so it must survive friendlyError() unmodified: if a
// future edit to RAW_DB_ERROR_PATTERNS ever broadened to match ordinary words
// like "account" or "paid", this specific message would silently collapse to
// the generic fallback and the app would stop telling the user why deletion
// was blocked.
const PENDING_PAYOUT_MESSAGE =
  "Your account has a pending payout that hasn't been paid out yet. It must be paid before your account can be deleted. Contact hello@washedup.app if you have questions.";

describe('friendlyError', () => {
  it('passes the pending-organizer-payout deletion-block message through unmodified', () => {
    expect(friendlyError({ message: PENDING_PAYOUT_MESSAGE }, FALLBACK)).toBe(PENDING_PAYOUT_MESSAGE);
  });

  it('passes the pending-payout message through when raised via a plain Error', () => {
    expect(friendlyError(new Error(PENDING_PAYOUT_MESSAGE), FALLBACK)).toBe(PENDING_PAYOUT_MESSAGE);
  });

  it('still suppresses a raw Postgres constraint error to the fallback', () => {
    const raw = 'update or delete on table "events" violates foreign key constraint "event_members_event_id_fkey" on table "event_members"';
    expect(friendlyError({ message: raw }, FALLBACK)).toBe(FALLBACK);
  });

  it('suppresses a raw relation/column-shaped error to the fallback', () => {
    expect(friendlyError({ message: 'column "amount_cents" of relation "organizer_receivables" does not exist' }, FALLBACK))
      .toBe(FALLBACK);
  });

  it('falls back on null, undefined, or a non-string message', () => {
    expect(friendlyError(null, FALLBACK)).toBe(FALLBACK);
    expect(friendlyError(undefined, FALLBACK)).toBe(FALLBACK);
    expect(friendlyError({}, FALLBACK)).toBe(FALLBACK);
    expect(friendlyError({ message: 42 }, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back on an empty message', () => {
    expect(friendlyError({ message: '' }, FALLBACK)).toBe(FALLBACK);
  });

  it('passes through actionable plain-language errors', () => {
    expect(friendlyError('This plan is full.', FALLBACK)).toBe('This plan is full.');
  });

  it.each(['Edge Function returned a non-2xx status code', 'Failed to send a request to the Edge Function', 'Relay Error invoking the Edge Function'])('keeps caller recovery instructions instead of SDK details: %s', message => {
    expect(friendlyError(new Error(message), 'Check the saved upload before retrying.')).toBe('Check the saved upload before retrying.');
  });

  it.each(['Network request failed', 'TypeError: Network request failed', 'Failed to fetch', 'TypeError: Failed to fetch', 'NetworkError when attempting to fetch resource.', 'AbortError: The operation was aborted.'])('uses the caller recovery instructions for %s', message => {
    expect(friendlyError(message, FALLBACK)).toBe(FALLBACK);
    expect(friendlyError({ message }, 'Delivery is not confirmed. Check the original first.')).toBe('Delivery is not confirmed. Check the original first.');
  });
});
