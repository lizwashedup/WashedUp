import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import type { UpdateCircleIdentity } from '../../hooks/useUpdateCircle';
import { isCircleId } from './creationAttempt';

export type IdentitySaveAttempt = { requestId: string; revision: string | null; identity: UpdateCircleIdentity };
const prefix = 'wu.circleIdentity.v1.';
const queues = new Map<string, Promise<void>>();
const running = new Map<string, object>();
export const identitySaveKey = (user: string, circle: string) => prefix + user + '.' + circle;
async function serial<T>(key: string, run: () => Promise<T>) {
  const result = (queues.get(key) ?? Promise.resolve()).then(run);
  const done = result.then(() => {}, () => {}); queues.set(key, done);
  try { return await result; } finally { if (queues.get(key) === done) queues.delete(key); }
}
async function read(key: string): Promise<IdentitySaveAttempt | null> {
  const raw = await AsyncStorage.getItem(key); if (raw === null) return null;
  const value = JSON.parse(raw);
  if (!isCircleId(value?.requestId) || !(value.revision === null || typeof value.revision === 'string') ||
    typeof value.identity?.name !== 'string' || !(value.identity.description === null || typeof value.identity.description === 'string') ||
    !(value.identity.coverUploadId == null || typeof value.identity.coverUploadId === 'string') ||
    !(value.identity.clearCover === undefined || typeof value.identity.clearCover === 'boolean')) throw new Error('Couldn’t read the previous circle save.');
  return value;
}
export function readIdentitySave(key: string) { return serial(key, () => read(key)); }
export function beginIdentitySave(key: string, revision: string | null, identity: UpdateCircleIdentity, requireCurrent: () => void) {
  return serial(key, async () => {
    const previous = await read(key); requireCurrent();
    if (previous) return null;
    const attempt = { requestId: Crypto.randomUUID(), revision, identity: { ...identity } };
    await AsyncStorage.setItem(key, JSON.stringify(attempt)); return attempt;
  });
}
export function clearIdentitySave(key: string, requestId: string) {
  return serial(key, async () => {
    if ((await read(key))?.requestId !== requestId) return false;
    await AsyncStorage.removeItem(key); return true;
  });
}
export function claimIdentitySave(key: string) { if (running.has(key)) return null; const token = {}; running.set(key, token); return token; }
export function releaseIdentitySave(key: string, token?: object) { if (!token || running.get(key) === token) running.delete(key); }
export function identitySaveRunning(key: string) { return running.has(key); }
