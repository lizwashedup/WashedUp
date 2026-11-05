import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Local "requests loop seen" marker. The pending-requests tab badge clears once
 * the user opens the Requests surface (independent of accept/decline, so it
 * never nags after a look) and re-shows only for a request that arrives AFTER
 * this stamp (requested_at > seen). Source of truth for the requests list stays
 * the server; this only governs the badge's seen-state.
 */
// The old device-wide marker has no trustworthy account owner. Do not copy it.
const keyFor = (userId: string) => `yours.requestsSeenAtV2:${userId}`;

/** React Query key for the tab-bar pending-requests count. */
export const REQUESTS_BADGE_KEY = ['yours', 'requests-badge'] as const;

export async function getRequestsSeenAt(userId: string): Promise<number> {
  if (!userId) return 0;
  try {
    const v = await AsyncStorage.getItem(keyFor(userId));
    const n = v ? Number(v) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Stamp "seen now" so all currently-pending requests stop counting. */
export async function markRequestsSeen(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(keyFor(userId), String(Date.now()));
  } catch {
    /* best-effort; the badge simply stays until the next successful stamp */
  }
}
