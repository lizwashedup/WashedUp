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
 * All operations are best-effort: already_connected / cannot_re_request /
 * blocked from send_people_request are swallowed (the scan is a soft action).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';

const PENDING_KEY = 'pendingReferralCode';

/** Extract the <code> from a washedup.app/r/<code> or washedupapp://r/<code> URL. */
export function parseReferralCode(url: string): string | null {
  if (!url || !/(^|[/.])washedup(app)?(\.app)?/i.test(url)) return null;
  const m = url.match(/\/r\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/**
 * Claim a referral code. The server resolves the inviter, records conversion,
 * and creates the inviter -> current-user pending request in one transaction.
 * Returns the inviter's user id so the route can land on their profile.
 */
export async function resolveAndConnect(code: string): Promise<string | null> {
  const { data: inviterId, error } = await supabase.rpc(
    'claim_referral_invite',
    { p_code: code },
  );
  if (error || !inviterId) return null;
  return inviterId as string;
}

async function resolveAndSend(code: string): Promise<boolean> {
  return (await resolveAndConnect(code)) !== null;
}

/** Stash a referral code for consumePendingReferral() to run after sign-in. */
export async function stashPendingReferral(code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_KEY, code);
  } catch {
    /* best-effort */
  }
}

/**
 * Handle a freshly received referral URL. Returns true if it was a
 * referral link (so the caller can skip other URL handlers).
 */
export async function handleReferralUrl(url: string): Promise<boolean> {
  const code = parseReferralCode(url);
  if (!code) return false;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      await resolveAndSend(code);
    } else {
      await stashPendingReferral(code);
    }
  } catch {
    /* best-effort */
  }
  return true;
}

/**
 * Consume a referral code captured while signed out. Safe to call on every
 * sign-in; it no-ops when there is nothing pending.
 */
export async function consumePendingReferral(): Promise<void> {
  try {
    const code = await AsyncStorage.getItem(PENDING_KEY);
    if (!code) return;
    await AsyncStorage.removeItem(PENDING_KEY);
    await resolveAndSend(code);
  } catch {
    /* best-effort */
  }
}
