import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

export type CircleCreationAttempt = { requestId: string; circleId: string | null };
const prefix = 'wu.circleCreation.v1.';
const queues = new Map<string, Promise<void>>();

export const isCircleId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

// Serialize local storage access, never the network call. A retired response
// can update only the marker written before its own request was dispatched.
async function serialized<T>(userId: string, run: (key: string) => Promise<T>): Promise<T> {
  const previous = queues.get(userId) ?? Promise.resolve();
  const result = previous.then(() => run(prefix + userId));
  const done = result.then(() => {}, () => {});
  queues.set(userId, done);
  try { return await result; }
  finally { if (queues.get(userId) === done) queues.delete(userId); }
}

async function read(key: string): Promise<CircleCreationAttempt | null> {
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return null;
  const value = JSON.parse(raw);
  if (!isCircleId(value?.requestId) || !(value.circleId === null || isCircleId(value.circleId))) {
    throw new Error('Couldn’t read the previous circle request.');
  }
  return { requestId: value.requestId, circleId: value.circleId };
}

export function readCircleCreationAttempt(userId: string) {
  return serialized(userId, read);
}

export function beginCircleCreation(userId: string, requireCurrent: () => void) {
  return serialized(userId, async key => {
    const previous = await read(key);
    requireCurrent();
    if (previous) return null;
    const attempt: CircleCreationAttempt = { requestId: Crypto.randomUUID(), circleId: null };
    await AsyncStorage.setItem(key, JSON.stringify(attempt));
    return attempt;
  });
}

export function finishCircleCreation(userId: string, requestId: string, circleId: string | null, requireCurrent?: () => void) {
  return serialized(userId, async key => {
    const previous = await read(key);
    requireCurrent?.();
    if (previous?.requestId !== requestId) return false;
    if (circleId) await AsyncStorage.setItem(key, JSON.stringify({ requestId, circleId }));
    else await AsyncStorage.removeItem(key);
    return true;
  });
}
