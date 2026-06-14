import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Local "requests loop seen" marker. The pending-requests tab badge clears once
 * the user opens the Requests surface (independent of accept/decline, so it
 * never nags after a look) and re-shows only for a request that arrives AFTER
 * this stamp (requested_at > seen). Source of truth for the requests list stays
 * the server; this only governs the badge's seen-state.
 */
const KEY = 'yours.requestsSeenAtV1';

/** React Query key for the tab-bar pending-requests count. */
export const REQUESTS_BADGE_KEY = ['yours', 'requests-badge'] as const;

export async function getRequestsSeenAt(): Promise<number> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    const n = v ? Number(v) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Stamp "seen now" so all currently-pending requests stop counting. */
export async function markRequestsSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* best-effort; the badge simply stays until the next successful stamp */
  }
}
