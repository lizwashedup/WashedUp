import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import { isCircleId } from './creationAttempt';

export type PlanPostAttempt = { requestId: string; payload: Record<string, unknown> };
const prefix = 'wu.circlePlanPost.v1.';
const queues = new Map<string, Promise<void>>();
const running = new Map<string, object>();
export const planPostKey = (user: string, circle: string) => prefix + user + '.' + circle;
async function serial<T>(key: string, run: () => Promise<T>) {
  const result = (queues.get(key) ?? Promise.resolve()).then(run);
  const done = result.then(() => {}, () => {}); queues.set(key, done);
  try { return await result; } finally { if (queues.get(key) === done) queues.delete(key); }
}
async function read(key: string): Promise<PlanPostAttempt | null> {
  const raw = await AsyncStorage.getItem(key); if (raw === null) return null;
  const value = JSON.parse(raw);
  if (!isCircleId(value?.requestId) || typeof value.payload?.p_circle_id !== 'string' ||
    typeof value.payload?.p_title !== 'string' || typeof value.payload?.p_start_time !== 'string' ||
    typeof value.payload?.p_host_message !== 'string' || !['circle_only', 'open'].includes(value.payload?.p_visibility))
    throw new Error('Couldn’t read the previous plan post.');
  return value;
}
export function readPlanPost(key: string) { return serial(key, () => read(key)); }
export function beginPlanPost(key: string, payload: Record<string, unknown>, requireCurrent: () => void) {
  return serial(key, async () => {
    const previous = await read(key); requireCurrent();
    if (previous) return null;
    const attempt = { requestId: Crypto.randomUUID(), payload: JSON.parse(JSON.stringify(payload)) };
    await AsyncStorage.setItem(key, JSON.stringify(attempt)); return attempt;
  });
}
export function clearPlanPost(key: string, requestId: string) {
  return serial(key, async () => {
    if ((await read(key))?.requestId !== requestId) return false;
    await AsyncStorage.removeItem(key); return true;
  });
}
export function claimPlanPost(key: string) { if (running.has(key)) return null; const token = {}; running.set(key, token); return token; }
export function releasePlanPost(key: string, token?: object) { if (!token || running.get(key) === token) running.delete(key); }
export function planPostRunning(key: string) { return running.has(key); }
