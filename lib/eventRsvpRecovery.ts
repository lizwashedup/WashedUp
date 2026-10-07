import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { setRsvp, type RsvpStatus } from './eventRsvp';

export interface RsvpOwner { userId: string; isCurrent(): boolean }
export interface RsvpAttempt { version: 1; userId: string; eventId: string; going: boolean; updatedAt: string }
export type RsvpRecovery = { kind: 'ready' } | { kind: 'confirmed'; status: Exclude<RsvpStatus, null> }
  | { kind: 'settled'; status: RsvpStatus }
  | { kind: 'unknown'; attempt: RsvpAttempt };
const queues = new Map<string, Promise<unknown>>();
const key = (eventId: string, owner: RsvpOwner) => `event-rsvp-recovery:v1:${owner.userId}:${eventId}`;
function current(owner: RsvpOwner) {
  if (!owner.userId || !owner.isCurrent()) throw new Error('This attendance action is no longer active.');
}
async function account(owner: RsvpOwner) {
  current(owner);
  const result = await supabase.auth.getUser();
  current(owner);
  if (result.error || result.data.user?.id !== owner.userId) throw new Error('Your account could not be checked.');
}
async function serial<T>(k: string, action: () => Promise<T>): Promise<T> {
  const next = (queues.get(k) ?? Promise.resolve()).catch(() => undefined).then(action);
  queues.set(k, next);
  try { return await next; } finally { if (queues.get(k) === next) queues.delete(k); }
}
async function read(eventId: string, owner: RsvpOwner): Promise<RsvpAttempt | null> {
  current(owner);
  const raw = await AsyncStorage.getItem(key(eventId, owner));
  current(owner);
  if (raw === null) return null;
  const value = JSON.parse(raw) as RsvpAttempt;
  if (!value || value.version !== 1 || value.eventId !== eventId || value.userId !== owner.userId
    || typeof value.going !== 'boolean' || typeof value.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('Your saved attendance change could not be checked.');
  return value;
}
async function clear(attempt: RsvpAttempt, owner: RsvpOwner) {
  // Also completes the original account's cleanup after its view retires.
  const k = key(attempt.eventId, owner);
  if (await AsyncStorage.getItem(k) === JSON.stringify(attempt)) await AsyncStorage.removeItem(k);
}
async function reconcile(attempt: RsvpAttempt, owner: RsvpOwner): Promise<RsvpRecovery> {
  await account(owner);
  const result = await supabase.from('explore_event_rsvps').select('status,updated_at')
    .eq('explore_event_id', attempt.eventId).eq('user_id', owner.userId).maybeSingle();
  await account(owner);
  if (result.error) return { kind: 'unknown', attempt };
  const status = attempt.going ? 'going' : 'cancelled';
  // A missing/older row does not prove a timed-out request stopped executing.
  if (!result.data || result.data.status !== status
    || Date.parse(result.data.updated_at) !== Date.parse(attempt.updatedAt)) {
    // This closes the exact old timestamp under the same database lock used
    // by its write. It never applies the intended attendance change again.
    const settled = await supabase.rpc('settle_event_rsvp', {
      p_event_id: attempt.eventId, p_updated_at: attempt.updatedAt, p_going: attempt.going,
    });
    await account(owner);
    const receipt = settled.data;
    if (settled.error || !receipt || !['confirmed', 'settled'].includes(receipt.kind)
      || receipt.user_id !== owner.userId || receipt.event_id !== attempt.eventId
      || Date.parse(receipt.attempt_updated_at) !== Date.parse(attempt.updatedAt)
      || ![null, 'going', 'cancelled'].includes(receipt.status)
      || receipt.kind === 'confirmed' && receipt.status !== status) return { kind: 'unknown', attempt };
    await clear(attempt, owner);
    current(owner);
    return receipt.kind === 'confirmed' ? { kind: 'confirmed', status } : { kind: 'settled', status: receipt.status };
  }
  await clear(attempt, owner);
  current(owner);
  return { kind: 'confirmed', status };
}
export async function checkRsvpRecovery(eventId: string, owner: RsvpOwner): Promise<RsvpRecovery> {
  return serial(key(eventId, owner), async () => {
    const attempt = await read(eventId, owner);
    return attempt ? reconcile(attempt, owner) : { kind: 'ready' };
  });
}
/** One dispatch per saved intent. Return/retry only checks the original row. */
export async function changeRsvpWithRecovery(eventId: string, going: boolean, owner: RsvpOwner): Promise<RsvpRecovery> {
  return serial(key(eventId, owner), async () => {
    await account(owner);
    const existing = await read(eventId, owner);
    if (existing) return reconcile(existing, owner);
    const attempt: RsvpAttempt = { version: 1, userId: owner.userId, eventId, going, updatedAt: new Date().toISOString() };
    await AsyncStorage.setItem(key(eventId, owner), JSON.stringify(attempt));
    // If retired before dispatch, no server action needs recovering.
    if (!owner.isCurrent()) { await clear(attempt, owner); current(owner); }
    let dispatched = false;
    try {
      await setRsvp(eventId, going, owner.userId, { updatedAt: attempt.updatedAt, isCurrent: owner.isCurrent, onDispatch: () => { dispatched = true; } });
    } catch (failure) {
      if (!dispatched) { await clear(attempt, owner); throw failure; }
      // Only explicit database rejection proves rollback. Transport/unknown
      // failures keep the original intent, including across screen returns.
      const code = (failure as { code?: string })?.code;
      if (code && /^(42501|235\d\d|22\w\w\w|P0001|40001|40P01)$/.test(code)) {
        await clear(attempt, owner);
        throw new Error('Your attendance change was not accepted. Try again.');
      }
      current(owner);
      return reconcile(attempt, owner);
    }
    await clear(attempt, owner);
    current(owner);
    return { kind: 'confirmed', status: going ? 'going' : 'cancelled' };
  });
}
