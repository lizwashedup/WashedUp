import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The Scene stage marker. The coming-soon page ships in stages ahead of the
 * communities launch (stage 1 = the founding-host card; later stages = the
 * events feed, then July 22). Each stage lands via OTA with a bumped
 * SCENE_STAGE; the tab dot shows whenever the locally-seen stage is behind
 * it and clears on the first Scene open (same anatomy as the requests-seen
 * marker in lib/yours/requestsSeen.ts). Purely local: no server state.
 */
export const SCENE_STAGE = 1;

const KEY = 'scene.stageSeenV1';

/** React Query key for the Scene tab stage dot. */
export const SCENE_BADGE_KEY = ['scene', 'stage-badge'] as const;

export async function getSeenSceneStage(): Promise<number> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    const n = v ? Number(v) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    // Unreadable marker reads as "never seen": the dot shows once more
    // rather than a landed stage passing silently.
    return 0;
  }
}

/** Stamp the current stage as seen so the tab dot clears. */
export async function markSceneStageSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, String(SCENE_STAGE));
  } catch {
    /* best-effort; the dot simply stays until the next successful stamp */
  }
}
