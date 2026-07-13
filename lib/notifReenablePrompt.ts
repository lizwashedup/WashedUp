import AsyncStorage from '@react-native-async-storage/async-storage';
import { NOTIF_REENABLE_PROMPT_ENABLED } from '../constants/FeatureFlags';
import { getPushPermissionStatus } from '../hooks/usePushNotifications';
import { getRemoteFlag } from './remoteFlags';

// Gate for the post-join "re-enable notifications" soft-ask.
//
// Control lives in the server-driven `remote_flags` row 'notif_reenable_prompt'
// ({ enabled, rollout_pct, holdout_pct }): kill switch + gradual ramp +
// holdout, edited without an app build. The build-time env flag
// (NOTIF_REENABLE_PROMPT_ENABLED) is only the OFFLINE fallback for `enabled`.
//
// Decision (in order):
//   - shown already this session → skip
//   - OS permission already granted → skip (reachable)
//   - remote flag disabled → skip
//   - not in the rollout bucket (hash%100 >= rollout_pct) → skip
//   - in rollout but in the holdout bucket → 'held' (control; caller logs a
//     control-exposure event so a future shown-vs-held comparison has a
//     denominator, and does NOT show the modal). holdout_pct is 0 for v1, so
//     no one is held yet; the bucketing is built so turning it on later is a
//     config edit, not a code change.
//   - treatment, but in cooldown or over the lifetime cap → skip
//   - otherwise → 'show'
//
// Frequency policy for the shown path: never when granted, once per JS session,
// 14-day cooldown, lifetime cap of 3.

const FLAG_KEY = 'notif_reenable_prompt';
const COOLDOWN_KEY = 'notif_reenable_prompted_at';
const COUNT_KEY = 'notif_reenable_show_count';
const COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
const LIFETIME_CAP = 3;

export type NotifReenableDecision = 'show' | 'held' | 'skip';

let shownThisSession = false;

// Deterministic 0-99 bucket from a stable hash of the user id (djb2). Two
// independent buckets (rollout, holdout) via distinct salts so the holdout
// slice isn't correlated with the rollout edge.
function bucket(userId: string, salt: string): number {
  const s = `${userId}:${salt}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h % 100;
}

async function inCooldownOrCapped(): Promise<boolean> {
  const countRaw = await AsyncStorage.getItem(COUNT_KEY);
  const count = countRaw ? parseInt(countRaw, 10) || 0 : 0;
  if (count >= LIFETIME_CAP) return true;
  const lastRaw = await AsyncStorage.getItem(COOLDOWN_KEY);
  if (lastRaw) {
    const elapsed = Date.now() - (parseInt(lastRaw, 10) || 0);
    if (elapsed < COOLDOWN_MS) return true;
  }
  return false;
}

export async function decideNotifReenable(userId: string | null | undefined): Promise<NotifReenableDecision> {
  if (!userId) return 'skip';
  if (shownThisSession) return 'skip';
  try {
    const status = await getPushPermissionStatus();
    if (status === 'granted') return 'skip';

    const flag = await getRemoteFlag(FLAG_KEY, NOTIF_REENABLE_PROMPT_ENABLED);
    if (!flag.enabled) return 'skip';
    if (bucket(userId, 'rollout') >= flag.rollout_pct) return 'skip';
    if (bucket(userId, 'holdout') < flag.holdout_pct) return 'held';

    if (await inCooldownOrCapped()) return 'skip';
    return 'show';
  } catch {
    return 'skip';
  }
}

// Called when the modal is actually shown. Sets the cooldown + bumps the
// lifetime count immediately, so "Open Settings" then leaving (or dismissing)
// both honor the 14-day gap without a separate dismiss path.
export async function recordNotifReenableShown(): Promise<void> {
  shownThisSession = true;
  try {
    await AsyncStorage.setItem(COOLDOWN_KEY, String(Date.now()));
    const countRaw = await AsyncStorage.getItem(COUNT_KEY);
    const count = countRaw ? parseInt(countRaw, 10) || 0 : 0;
    await AsyncStorage.setItem(COUNT_KEY, String(count + 1));
  } catch {}
}
