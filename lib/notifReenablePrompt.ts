import AsyncStorage from '@react-native-async-storage/async-storage';
import { NOTIF_REENABLE_PROMPT_ENABLED } from '../constants/FeatureFlags';
import { getPushPermissionStatus } from '../hooks/usePushNotifications';

// Gate + persistence for the post-join "re-enable notifications" soft-ask.
// Mirrors the cooldown idiom in components/chat/ChatThread.tsx (the existing
// re-enable banner) and the review-ask gate in lib/reviewAsk.ts: a single
// maybe...() decides whether to show, the parent owns the UI + the actual
// permission call.
//
// Frequency policy (respects "don't nag people who declined"):
//   - never when OS permission is already granted (they're reachable)
//   - at most once per JS session (module flag, resets on cold start)
//   - 14-day cooldown after any show (post-join fires far more often than a
//     chat open, so 7d would over-ask)
//   - hard lifetime cap of 3 shows, then never again

const COOLDOWN_KEY = 'notif_reenable_prompted_at';
const COUNT_KEY = 'notif_reenable_show_count';
const COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
const LIFETIME_CAP = 3;

let shownThisSession = false;

export async function maybeShowNotifReenable(): Promise<boolean> {
  if (!NOTIF_REENABLE_PROMPT_ENABLED) return false;
  if (shownThisSession) return false;
  try {
    const status = await getPushPermissionStatus();
    if (status === 'granted') return false;

    const countRaw = await AsyncStorage.getItem(COUNT_KEY);
    const count = countRaw ? parseInt(countRaw, 10) || 0 : 0;
    if (count >= LIFETIME_CAP) return false;

    const lastRaw = await AsyncStorage.getItem(COOLDOWN_KEY);
    if (lastRaw) {
      const elapsed = Date.now() - (parseInt(lastRaw, 10) || 0);
      if (elapsed < COOLDOWN_MS) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Called when the modal is actually shown. Sets the cooldown + bumps the
// lifetime count immediately, so tapping "Open Settings" then leaving (or
// dismissing) both honor the 14-day gap without a separate dismiss path.
export async function recordNotifReenableShown(): Promise<void> {
  shownThisSession = true;
  try {
    await AsyncStorage.setItem(COOLDOWN_KEY, String(Date.now()));
    const countRaw = await AsyncStorage.getItem(COUNT_KEY);
    const count = countRaw ? parseInt(countRaw, 10) || 0 : 0;
    await AsyncStorage.setItem(COUNT_KEY, String(count + 1));
  } catch {}
}
