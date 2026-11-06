import AsyncStorage from '@react-native-async-storage/async-storage';

// Old versions stored plan IDs without a viewer. Keep honoring those entries:
// guessing their owner could re-prompt a member who already dismissed offline.
const legacyKey = 'postPlanSurvey.handledV1';
const accountKey = (userId: string) => 'postPlanSurvey.handledV2:' + userId;

function readIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const ids: unknown = JSON.parse(raw);
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

export async function isPostPlanSurveyHandled(eventId: string, userId: string): Promise<boolean> {
  try {
    const records = await AsyncStorage.multiGet([accountKey(userId), legacyKey]);
    return records.some(([, raw]) => readIds(raw).includes(eventId));
  } catch { return false; }
}

export async function markPostPlanSurveyHandled(eventId: string, userId: string): Promise<void> {
  try {
    const key = accountKey(userId);
    const ids = readIds(await AsyncStorage.getItem(key));
    if (ids.includes(eventId)) return;
    await AsyncStorage.setItem(key, JSON.stringify([...ids, eventId].slice(-100)));
  } catch { /* The server feedback row independently prevents re-prompting. */ }
}
