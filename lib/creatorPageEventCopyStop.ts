import {pageEventReuseNetwork} from './creatorPageEventReuseOperation';
/** Resolve an original copy before keeping its destination. Callers retain their
 * whole-copy/media journals until this result and their terminal cleanup finish. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {CreatorPageScopeExpired, type CreatorPageScope} from './creatorPageReview';
import {getPageEventSaveAttempt, getPageEventSaveState, savePageEvent, pageEventSaveMatches,
  validPageEventSaveInput, type PageEventSaveInput, type PageEventSaveReceipt, type PageEventSaveState} from './creatorPageEventSave';
import {mediaUUID} from './creatorPageEventMedia';
import {sameEventSaveVersion} from './eventSaveVersion';
import type {SavedPageEventReuse} from './creatorPageEventReuse';

export interface PageEventCopyStopAttempt {
  version: 1; userId: string; pageId: string; eventId: string; copyRequestId: string;
  originalUpdatedAt: string; copyInput?: PageEventSaveInput;
  requestId: string; input: PageEventSaveInput;
}
export type PageEventCopyStopResult = {state: 'pending'} | {state: 'saved'; saved: PageEventSaveReceipt}
  | {state: 'kept'; event: PageEventSaveState};
const queues = new Map<string, Promise<unknown>>();
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const key = (pageId: string, eventId: string, scope: CreatorPageScope) => `creator-page-event-copy-stop:v1:${scope.userId}:${pageId}:${eventId}`;
function current(pageId: string, eventId: string, scope: CreatorPageScope) {
  if (!scope.isCurrent() || ![pageId, eventId, scope.userId].every(mediaUUID)) throw new CreatorPageScopeExpired();
}
async function serial<T>(k: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(k) ?? Promise.resolve()).catch(() => undefined).then(work); queues.set(k, next);
  try { return await next; } finally { if (queues.get(k) === next) queues.delete(k); }
}
function valid(a: PageEventCopyStopAttempt, pageId: string, eventId: string, scope: CreatorPageScope) {
  return a && a.version === 1 && a.pageId === pageId && a.eventId === eventId && a.userId === scope.userId
    && mediaUUID(a.copyRequestId) && mediaUUID(a.requestId) && a.requestId !== a.copyRequestId
    && validPageEventSaveInput(a.input) && sameEventSaveVersion(a.originalUpdatedAt, a.originalUpdatedAt)
    && (!a.copyInput || validPageEventSaveInput(a.copyInput) && sameEventSaveVersion(a.copyInput.expectedUpdatedAt, a.originalUpdatedAt));
}
async function read(pageId: string, eventId: string, scope: CreatorPageScope) {
  current(pageId, eventId, scope); const raw = await AsyncStorage.getItem(key(pageId, eventId, scope)); current(pageId, eventId, scope);
  if (raw === null) return null;
  const a = JSON.parse(raw) as PageEventCopyStopAttempt;
  if (!valid(a, pageId, eventId, scope)) throw Error('The original copy recovery needs to be checked.');
  return a;
}
export function readPageEventCopyStop(pageId: string, eventId: string, scope: CreatorPageScope) {
  return serial(key(pageId, eventId, scope), () => read(pageId, eventId, scope));
}
/** The parent must stop/await its copy operation before preparing this intent.
 * Persist the content-preserving save before any backend write, using a separate
 * request ID. An earlier recovery always wins a new caller's preparation. */
export function preparePageEventCopyStop(copy: SavedPageEventReuse, scope: CreatorPageScope) {
  const c = clone(copy); current(c.pageId, c.eventId, scope);
  if (c.version !== 1 || c.userId !== scope.userId || !mediaUUID(c.requestId) || !validPageEventSaveInput(c.destination)
    || c.input && (!validPageEventSaveInput(c.input) || !sameEventSaveVersion(c.input.expectedUpdatedAt, c.destination.expectedUpdatedAt))) throw Error('Keep the original complete copy attempt.');
  return serial(key(c.pageId, c.eventId, scope), async () => {
    const prior = await read(c.pageId, c.eventId, scope);
    if (prior) {
      if (prior.copyRequestId !== c.requestId || !sameEventSaveVersion(prior.originalUpdatedAt, c.destination.expectedUpdatedAt)
        || JSON.stringify(prior.copyInput) !== JSON.stringify(c.input)) throw Error('A different copy recovery is pending.');
      return {attempt: prior, created: false};
    }
    const event = await pageEventReuseNetwork(scope, networkScope => getPageEventSaveState(c.pageId, c.eventId, networkScope)); current(c.pageId, c.eventId, scope);
    const attempt: PageEventCopyStopAttempt = {version: 1, userId: scope.userId, pageId: c.pageId, eventId: c.eventId,
      copyRequestId: c.requestId, originalUpdatedAt: c.destination.expectedUpdatedAt, ...(c.input ? {copyInput: c.input} : {}),
      // Snapshot reads normalize an unset rich body to []. The existing writer
      // explicitly treats null as preserve, so keep its stored representation.
      requestId: Crypto.randomUUID(), input: {fields: {...event.fields, description_blocks: null}, expectedUpdatedAt: event.updatedAt,
        offerType: event.offerType, ticketCapacity: event.ticketCapacity, latitude: event.latitude, longitude: event.longitude}};
    if (!valid(attempt, c.pageId, c.eventId, scope)) throw Error('Check the saved destination before keeping it.');
    await AsyncStorage.setItem(key(c.pageId, c.eventId, scope), JSON.stringify(attempt)); current(c.pageId, c.eventId, scope);
    return {attempt, created: true};
  });
}
async function resolve(a: PageEventCopyStopAttempt, scope: CreatorPageScope, action: 'check' | 'retry'): Promise<PageEventCopyStopResult> {
  const original = async () => {
    const saved = await pageEventReuseNetwork(scope, networkScope => getPageEventSaveAttempt(a.pageId, a.eventId, a.copyRequestId, networkScope)); current(a.pageId, a.eventId, scope);
    if (saved && (!a.copyInput || !pageEventSaveMatches(saved, a.copyInput))) throw Error('The original copy receipt could not be confirmed.');
    return saved;
  };
  let saved = await original();
  if (saved) return {state: 'saved', saved};
  const barrier = await pageEventReuseNetwork(scope, networkScope => getPageEventSaveAttempt(a.pageId, a.eventId, a.requestId, networkScope)); current(a.pageId, a.eventId, scope);
  if (barrier && (!pageEventSaveMatches(barrier, a.input) || sameEventSaveVersion(barrier.updatedAt, a.originalUpdatedAt))) throw Error('The saved copy recovery could not be confirmed.');
  let event = await pageEventReuseNetwork(scope, networkScope => getPageEventSaveState(a.pageId, a.eventId, networkScope)); current(a.pageId, a.eventId, scope);
  if (barrier || !sameEventSaveVersion(event.updatedAt, a.originalUpdatedAt)) {
    // Read after the new row version: a prior successful original save wins.
    saved = await original();
    return saved ? {state: 'saved', saved} : {state: 'kept', event};
  }
  if (action === 'check') return {state: 'pending'};
  if (!['Draft', 'Live'].includes(event.status) || !sameEventSaveVersion(a.input.expectedUpdatedAt, a.originalUpdatedAt)) throw Error('Check the latest destination before continuing.');
  try {
    const confirmed = await pageEventReuseNetwork(scope, networkScope => savePageEvent(a.pageId, a.eventId, a.requestId, a.input, networkScope), 25_000); current(a.pageId, a.eventId, scope);
    if (sameEventSaveVersion(confirmed.updatedAt, a.originalUpdatedAt)) throw Error('The copy recovery did not advance the saved version.');
  } catch (error) {
    current(a.pageId, a.eventId, scope);
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'PT409') throw error;
    // A competing original or another edit won the existing row lock/CAS.
  }
  saved = await original();
  if (saved) return {state: 'saved', saved};
  event = await pageEventReuseNetwork(scope, networkScope => getPageEventSaveState(a.pageId, a.eventId, networkScope)); current(a.pageId, a.eventId, scope);
  if (sameEventSaveVersion(event.updatedAt, a.originalUpdatedAt)) throw Error('The original copy is still unconfirmed.');
  return {state: 'kept', event};
}
export function resolvePageEventCopyStop(attempt: PageEventCopyStopAttempt, scope: CreatorPageScope, action: 'check' | 'retry') {
  const a = clone(attempt); current(a.pageId, a.eventId, scope);
  if (!valid(a, a.pageId, a.eventId, scope) || !['check', 'retry'].includes(action)) throw Error('Check the original copy recovery.');
  return serial(key(a.pageId, a.eventId, scope), async () => {
    const prior = await read(a.pageId, a.eventId, scope);
    if (!prior || JSON.stringify(prior) !== JSON.stringify(a)) throw Error('Use the current saved copy recovery.');
    return resolve(a, scope, action);
  });
}
/** Clear only after the parent has finished whole-copy/media handling. A cleanup
 * failure retains this receipt pointer and never changes a confirmed outcome. */
export function clearPageEventCopyStop(attempt: PageEventCopyStopAttempt, scope: CreatorPageScope) {
  const a = clone(attempt); current(a.pageId, a.eventId, scope);
  return serial(key(a.pageId, a.eventId, scope), async () => {
    const prior = await read(a.pageId, a.eventId, scope);
    if (!prior) return true;
    if (JSON.stringify(prior) !== JSON.stringify(a)) throw Error('A different copy recovery is pending.');
    const result = await resolve(a, scope, 'check');
    if (result.state === 'pending') throw Error('Check the original copy before clearing recovery.');
    try { await AsyncStorage.removeItem(key(a.pageId, a.eventId, scope)); } catch { return false; }
    current(a.pageId, a.eventId, scope); return true;
  });
}
