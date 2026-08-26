/**
 * QR / referral-link receive path (same-app scan).
 *
 * A washedup.app/r/<code> link (the value encoded in the QR and the text
 * invite) is handled here:
 *   - authenticated scanner  -> resolve the code to the owner and send a
 *     people request immediately
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
 * Resolve a referral code to its owner and send the people request.
 * Returns the owner's user id (so a caller with a screen can land on their
 * profile), or null when the code resolves to nothing. The request send is
 * best-effort and idempotent server-side: already_connected /
 * cannot_re_request / blocked are swallowed (the scan is a soft action).
 */
export async function resolveAndConnect(code: string): Promise<string | null> {
  const { data: recipientId, error } = await supabase.rpc(
    'resolve_referral_code',
    { p_code: code },
  );
  if (error || !recipientId) return null;
  try {
    await supabase.rpc('send_people_request', {
      p_recipient: recipientId,
      p_context: 'referral_invite',
      p_context_event_id: null,
    });
  } catch {
    /* soft action */
  }
  return recipientId as string;
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
