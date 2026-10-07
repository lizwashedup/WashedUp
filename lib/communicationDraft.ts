import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CreatorPageScope } from './creatorPageReview';

export type CommunicationDraftKind = 'message' | 'reminders' | 'invitation';
const writes = new Map<string, Promise<void>>();
function key(eventId: string, kind: CommunicationDraftKind, scope: CreatorPageScope) {
  if (!eventId || !scope.userId || !scope.isCurrent()) throw Error('This event visit has ended.');
  return `creator-communication:v1:${scope.userId}:${kind}:${eventId}`;
}
/** Reuses local draft storage, with explicit ownership and ordered writes. Legacy unowned drafts stay untouched. */
export async function saveCommunicationDraft<T>(eventId: string, kind: CommunicationDraftKind, value: T, scope: CreatorPageScope) {
  const storageKey = key(eventId, kind, scope);
  const serialized = JSON.stringify({version: 1, eventId, userId: scope.userId, kind, value});
  const prior = writes.get(storageKey) ?? Promise.resolve();
  // Once accepted, a local write may finish after navigation under its original account key.
  const write = prior.catch(() => undefined).then(() => AsyncStorage.setItem(storageKey, serialized));
  writes.set(storageKey, write);
  try { await write; } finally { if (writes.get(storageKey) === write) writes.delete(storageKey); }
}
export async function loadCommunicationDraft<T>(eventId: string, kind: CommunicationDraftKind, scope: CreatorPageScope, valid: (value: unknown) => value is T): Promise<T | null> {
  const storageKey = key(eventId, kind, scope);
  await writes.get(storageKey);
  const raw = await AsyncStorage.getItem(storageKey);
  if (!scope.isCurrent()) throw Error('This event visit has ended.');
  if (raw === null) return null;
  try {
    const record = JSON.parse(raw);
    if (record?.version !== 1 || record.eventId !== eventId || record.userId !== scope.userId || record.kind !== kind || !valid(record.value)) throw Error();
    return record.value;
  } catch { throw Error('The saved draft could not be read.'); }
}
