import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CreatorPageScope } from './creatorPageReview';
import { messageUuid, readMessageContent, readMessageReview, type AttendeeMessageContent, type AttendeeMessageReview } from './attendeeMessageContract';

export interface AttendeeMessageAttempt {
  accountId: string; eventId: string; requestId: string; message: AttendeeMessageContent; review: AttendeeMessageReview;
}
const writes = new Map<string, Promise<unknown>>();
function key(eventId: string, scope: CreatorPageScope) {
  if (!scope.isCurrent() || !messageUuid.test(eventId) || !messageUuid.test(scope.userId)) throw Error('This event visit has ended.');
  return `attendee-message-attempt:v1:${scope.userId}:${eventId}`;
}
export function parseAttendeeMessageAttempt(raw: string, eventId: string, accountId: string): AttendeeMessageAttempt {
  try {
    const a = JSON.parse(raw), message = readMessageContent(a.message), review = readMessageReview(a.review, eventId);
    if (a.accountId !== accountId || a.eventId !== eventId || typeof a.requestId !== 'string' || !messageUuid.test(a.requestId) || !message || !review) throw Error();
    return { accountId, eventId, requestId: a.requestId, message, review };
  } catch { throw Error('The saved message request could not be read. It has been kept.'); }
}
export async function loadAttendeeMessageAttempt(eventId: string, scope: CreatorPageScope) {
  const k = key(eventId, scope); await writes.get(k);
  const raw = await AsyncStorage.getItem(k);
  if (!scope.isCurrent()) throw Error('This event visit has ended.');
  return raw === null ? null : parseAttendeeMessageAttempt(raw, eventId, scope.userId);
}
async function ordered(k: string, work: () => Promise<void>) {
  const next = (writes.get(k) ?? Promise.resolve()).catch(() => undefined).then(work);
  writes.set(k, next);
  try { await next; } finally { if (writes.get(k) === next) writes.delete(k); }
}
/** An acknowledged local write must precede every dispatch, including retry. */
export async function saveAttendeeMessageAttempt(attempt: AttendeeMessageAttempt, scope: CreatorPageScope) {
  const k = key(attempt.eventId, scope), serialized = JSON.stringify(attempt);
  parseAttendeeMessageAttempt(serialized, attempt.eventId, scope.userId);
  await ordered(k, async () => {
    const raw = await AsyncStorage.getItem(k);
    if (raw !== null) {
      const prior = parseAttendeeMessageAttempt(raw, attempt.eventId, scope.userId);
      if (JSON.stringify(prior) !== serialized) throw Error('Another saved message needs checking first.');
    }
    await AsyncStorage.setItem(k, serialized);
  });
  if (!scope.isCurrent()) throw Error('This event visit has ended.');
}
/** Clear only the checked request; late cleanup cannot remove a newer one. */
export async function clearAttendeeMessageAttempt(attempt: AttendeeMessageAttempt, scope: CreatorPageScope) {
  const k = key(attempt.eventId, scope);
  await ordered(k, async () => {
    const raw = await AsyncStorage.getItem(k);
    if (raw === null) return;
    if (parseAttendeeMessageAttempt(raw, attempt.eventId, scope.userId).requestId !== attempt.requestId) throw Error('Another saved message needs checking first.');
    await AsyncStorage.removeItem(k);
  });
}
