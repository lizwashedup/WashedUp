/**
 * QR / referral-link receive path (same-app scan).
 *
 * A washedup.app/r/<code> link (the value encoded in the QR and the text
 * invite) is handled here:
 *   - authenticated scanner  -> claim the inviter's server-side request so
 *     the recipient sees "Liz already wants to add you," not a reversed
 *     request from the recipient back to Liz
 *   - unauthenticated scanner -> stash the code; consumePendingReferral()
 *     runs it once the user signs in (best-effort capture)
 *
 * Out of scope (documented follow-up): true post-App-Store deferred deep
 * linking that survives an install without the link being re-opened. That
 * needs Branch/clipboard infra the app does not have.
 *
 * Foreground handling is best-effort. The visible referral route owns retry
 * feedback; both paths use the existing inviter-to-recipient claim operation.
 */
import { supabase } from '../supabase';
import { stashPendingReferral } from './pendingReferral';
import { requestWithDeadline } from '../requestWithDeadline';
import { claimReferralForRecipient } from './referralClaim';
export { stashPendingReferral, consumePendingReferral } from './pendingReferral';

/** Extract the <code> from a washedup.app/r/<code> or washedupapp://r/<code> URL. */
export function parseReferralCode(url: string): string | null {
  if (typeof url !== 'string' || /\s/.test(url)) return null;
  // Keep the web forms supported by lib/url.ts and the configured native
  // scheme. The complete authority must match before a mutating claim runs.
  const own = url.match(/^(?:https?:\/\/(?:www\.)?washedup\.app\/|washedupapp:\/\/)(.*)$/i);
  if (!own) return null;
  // Match the entire path, not a valid-looking prefix. Query/fragment data
  // is not part of the code; the server and web landing share this limit.
  const path = own[1].match(/^r\/([A-Za-z0-9_-]{1,64})\/?(?:[?#]\S*)?$/);
  return path ? path[1] : null;
}

let latestDelivery = 0;
/**
 * Handle a freshly received referral URL. Returns true if it was a
 * referral link (so the caller can skip other URL handlers).
 */
export async function handleReferralUrl(url: string, scope?: { isCurrent(): boolean }): Promise<boolean> {
  const code = parseReferralCode(url);
  if (!code) return false;
  const delivery = ++latestDelivery;
  const current = () => delivery === latestDelivery && (!scope || scope.isCurrent());
  if (!current()) return true;
  try {
    const { data, error } = await requestWithDeadline(supabase.auth.getSession(), 12_000);
    if (!current() || error) return true;
    if (data.session?.user) {
      await claimReferralForRecipient(code, { userId: data.session.user.id, isCurrent: current });
    } else {
      await stashPendingReferral(code);
    }
  } catch {
    /* best-effort */
  }
  return true;
}
