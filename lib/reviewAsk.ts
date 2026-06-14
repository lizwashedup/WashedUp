import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { supabase } from './supabase';
import { logError } from './logger';

// expo-store-review is a NATIVE module. It is imported lazily (only when we are
// actually about to ask) so a JS bundle that lands on a binary WITHOUT the
// native module (e.g. an OTA before the next EAS build) still boots and the
// import simply throws here, caught below, instead of crashing at app load.

// Native App Store / Play review ask.
//
// The ask is no longer a custom modal. The soft-ask is the user tapping the TOP
// rating ("Really good" / thumbs_up) in the post-plan survey; only then, and
// only AFTER the survey Modal has fully dismissed, do we present the OS review
// sheet. Presenting it while the survey Modal is still on screen / dismissing
// re-arms the iOS "present during presentation" crash class, so the caller must
// fire this from inside the root-modal handoff window (post-unmount).
//
// Re-ask cadence: there is no "Not Now" callback from the native API, so we
// simply allow another ask after a 90-day cooldown OR an app-version bump. iOS
// caps actual displays at 3 / 365 days regardless, which is the real backstop.

// New cooldown keys (the old counter/modal keys are retired).
const LAST_AT_KEY = 'reviewAsk.lastAtV2';
const LAST_VERSION_KEY = 'reviewAsk.lastVersionV2';
// Legacy permanent hard-stops from the previous modal flow are still honored so
// users who already wrote a review (or dismissed it for good) are never re-asked.
const LEGACY_COMPLETED_KEY = 'reviewAskCompleted';
const LEGACY_ASKED_KEY = 'hasRequestedReview';

const COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function appVersion(): string {
  return Constants.expoConfig?.version ?? 'unknown';
}

/**
 * Fire the native review request if eligible. Best-effort: every failure is
 * swallowed so it can never trap the user. MUST be called only after the survey
 * Modal has fully dismissed (inside the modal handoff window).
 */
export async function maybeRequestReviewAfterTopRating(): Promise<void> {
  try {
    if (Platform.OS === 'web') return;

    // Permanent hard stops carried over from the old flow.
    if ((await AsyncStorage.getItem(LEGACY_COMPLETED_KEY)) === 'true') return;
    if ((await AsyncStorage.getItem(LEGACY_ASKED_KEY)) === 'true') return;

    // Cooldown: re-ask only after 90 days OR an app-version bump.
    const lastAtRaw = await AsyncStorage.getItem(LAST_AT_KEY);
    if (lastAtRaw) {
      const lastAt = Number(lastAtRaw) || 0;
      const lastVersion = await AsyncStorage.getItem(LAST_VERSION_KEY);
      const versionBumped = lastVersion != null && lastVersion !== appVersion();
      if (!versionBumped && Date.now() - lastAt < COOLDOWN_MS) return;
    }

    // Server-side eligibility (a real thumbs_up, OR no real feedback yet;
    // sentinel rows excluded). The positive survey tap is the soft-ask; this is
    // the final gate before the OS sheet.
    const { data: eligible, error } = await supabase.rpc('get_review_ask_eligibility');
    if (error) {
      console.warn('[WashedUp] review eligibility RPC failed:', error.message);
      return;
    }
    if (eligible !== true) return;

    // Lazy native import (see note at top): throws on a binary without the
    // module, which the surrounding try/catch swallows.
    const StoreReview = await import('expo-store-review');
    if (!(await StoreReview.isAvailableAsync())) return;

    // Record BEFORE presenting so a crash mid-present can't re-arm next launch.
    await AsyncStorage.setItem(LAST_AT_KEY, String(Date.now())).catch(() => {});
    await AsyncStorage.setItem(LAST_VERSION_KEY, appVersion()).catch(() => {});

    await StoreReview.requestReview();
  } catch (e) {
    logError(e, 'reviewAsk.maybeRequest');
  }
}
