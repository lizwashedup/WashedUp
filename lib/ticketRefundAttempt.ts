import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import type { CreatorPageScope } from './creatorPageReview';
import { requestWithDeadline } from './requestWithDeadline';

/** The exact reviewed target, used only to reconcile a current receipt with refreshed tickets. */
export interface TicketRefundAttemptTarget {
  positionIndexes: number[] | null;
  reviewedPositionCount: number;
}
function validTarget(value: TicketRefundAttemptTarget) {
  return value && Number.isSafeInteger(value.reviewedPositionCount) && value.reviewedPositionCount > 0
    && (value.positionIndexes === null || (Array.isArray(value.positionIndexes)
      && value.positionIndexes.length === value.reviewedPositionCount
      && value.positionIndexes.every(index => Number.isSafeInteger(index) && index >= 1)
      && new Set(value.positionIndexes).size === value.positionIndexes.length));
}
/** A local dispatch barrier, never proof of a provider result or permission. */
export interface TicketRefundAttempt {
  version: 1;
  id: string;
  userId: string;
  orderId: string;
  createdAt: string;
  state: 'unknown' | 'confirmed' | 'complete' | 'not-started';
  refundAmountCents?: number;
  positionsVoided?: number;
  target?: TicketRefundAttemptTarget;
}
const queues = new Map<string, Promise<unknown>>();
const observed = new Map<string, string | null>();
const key = (orderId: string, userId: string) => `ticket-refund-attempt:v1:${userId}:${orderId}`;
export const isTicketRefundAttemptCurrent = (attempt: TicketRefundAttempt) => observed.get(key(attempt.orderId, attempt.userId)) === attempt.id;
function current(scope: CreatorPageScope) {
  if (!scope.userId || !scope.isCurrent()) throw new Error('This refund action is no longer active.');
}
async function serial<T>(name: string, action: () => Promise<T>): Promise<T> {
  const next = (queues.get(name) ?? Promise.resolve()).catch(() => undefined).then(action);
  queues.set(name, next);
  try { return await next; }
  finally { if (queues.get(name) === next) queues.delete(name); }
}
async function owned<T>(orderId: string, scope: CreatorPageScope, action: (visit: CreatorPageScope) => Promise<T>): Promise<T> {
  let active = true;
  const visit = { userId: scope.userId, isCurrent: () => active && scope.isCurrent() };
  try {
    return await requestWithDeadline(serial(key(orderId, scope.userId), async () => {
      current(visit);
      return action(visit);
    }), 12_000);
  } finally { active = false; }
}
async function read(orderId: string, scope: CreatorPageScope): Promise<TicketRefundAttempt | null> {
  const raw = await AsyncStorage.getItem(key(orderId, scope.userId));
  current(scope);
  if (raw === null) { observed.set(key(orderId, scope.userId), null); return null; }
  let value: TicketRefundAttempt;
  try { value = JSON.parse(raw); } catch { throw new Error('The saved refund attempt could not be checked.'); }
  if (!value || value.version !== 1 || typeof value.id !== 'string' || !value.id
    || value.orderId !== orderId || value.userId !== scope.userId
    || !['unknown', 'confirmed', 'complete', 'not-started'].includes(value.state)
    || (value.state === 'complete' && (!Number.isSafeInteger(value.refundAmountCents) || value.refundAmountCents! < 0
      || !Number.isSafeInteger(value.positionsVoided) || value.positionsVoided! < 0))
    || (value.target !== undefined && !validTarget(value.target))
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error('The saved refund attempt could not be checked.');
  }
  observed.set(key(orderId, scope.userId), value.id);
  return value;
}
export function readTicketRefundAttempt(orderId: string, scope: CreatorPageScope): Promise<TicketRefundAttempt | null> {
  return owned(orderId, scope, visit => read(orderId, visit));
}
export function beginTicketRefundAttempt(orderId: string, scope: CreatorPageScope, target?: TicketRefundAttemptTarget): Promise<{ attempt: TicketRefundAttempt; created: boolean }> {
  return owned(orderId, scope, async visit => {
    const existing = await read(orderId, visit);
    if (existing && (existing.state === 'unknown' || existing.state === 'confirmed')) return { attempt: existing, created: false };
    if (target !== undefined && !validTarget(target)) throw new Error('The reviewed refund target could not be saved.');
    const attempt: TicketRefundAttempt = {
      version: 1, id: Crypto.randomUUID(), userId: scope.userId, orderId,
      createdAt: new Date().toISOString(), state: 'unknown',
      ...(target ? { target: { positionIndexes: target.positionIndexes === null ? null : [...target.positionIndexes], reviewedPositionCount: target.reviewedPositionCount } } : {}),
    };
    const name = key(orderId, scope.userId), encoded = JSON.stringify(attempt);
    // Invalidate receipts held by mounted screens before the new write waits.
    observed.set(name, attempt.id);
    try { await AsyncStorage.setItem(name, encoded); }
    catch (error) {
      // A storage bridge can fail after writing. This request still has not
      // dispatched, so clean only its exact unsent record if storage recovers.
      try { if (await AsyncStorage.getItem(name) === encoded) await AsyncStorage.removeItem(name); }
      catch { /* A retained record continues to block dispatch until verified. */ }
      throw error;
    }
    // Storage cannot be aborted. If it finishes after retirement, this action
    // never dispatches; finish only this exact original record's cleanup.
    if (!visit.isCurrent()) {
      if (await AsyncStorage.getItem(name) === encoded) await AsyncStorage.removeItem(name);
      current(visit);
    }
    return { attempt, created: true };
  });
}
export type RefundAttemptReceipt = { state: 'confirmed' | 'not-started' }
  | { state: 'complete'; refundAmountCents: number; positionsVoided: number };
/** Keep exact receipts through failed refresh/restart. Never replace a newer attempt. */
export async function settleTicketRefundAttempt(attempt: TicketRefundAttempt, result: RefundAttemptReceipt): Promise<void> {
  if (result.state === 'complete' && (!Number.isSafeInteger(result.refundAmountCents) || result.refundAmountCents < 0
    || !Number.isSafeInteger(result.positionsVoided) || result.positionsVoided < 0)) throw new Error('Invalid refund receipt.');
  await requestWithDeadline(serial(key(attempt.orderId, attempt.userId), async () => {
    const name = key(attempt.orderId, attempt.userId), raw = await AsyncStorage.getItem(name);
    if (raw === null) return;
    let saved: TicketRefundAttempt;
    try { saved = JSON.parse(raw); } catch { return; }
    if (saved.version !== 1 || saved.id !== attempt.id || saved.userId !== attempt.userId || saved.orderId !== attempt.orderId) return;
    // An older response cannot downgrade already recorded provider evidence.
    if (saved.state === 'complete' || saved.state === 'not-started'
      || (saved.state === 'confirmed' && result.state === 'not-started')) return;
    await AsyncStorage.setItem(name, JSON.stringify({ ...saved, ...result }));
  }), 12_000);
}
