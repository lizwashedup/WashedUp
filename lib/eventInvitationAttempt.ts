import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CreatorPageScope } from './creatorPageReview';
import { messageUuid } from './attendeeMessageContract';
import { readInvitationReview, type InvitationReview } from './eventInvitationSend';

export interface InvitationAttempt { accountId: string; eventId: string; requestId: string; review: InvitationReview }
const writes = new Map<string,Promise<unknown>>();
function key(eventId: string,scope: CreatorPageScope) {
  if (!scope.isCurrent() || !messageUuid.test(eventId) || !messageUuid.test(scope.userId)) throw Error('This invitation visit has ended.');
  return `event-invitation-attempt:v1:${scope.userId}:${eventId}`;
}
export function parseInvitationAttempt(raw: string,eventId: string,accountId: string): InvitationAttempt {
  try {
    const a = JSON.parse(raw), review = readInvitationReview(a.review,eventId,a.review?.message);
    if (a.accountId !== accountId || a.eventId !== eventId || typeof a.requestId !== 'string' || !messageUuid.test(a.requestId)
      || !review || !review.sendingEnabled || review.recipientCount < 1) throw Error();
    return {accountId,eventId,requestId:a.requestId,review};
  } catch { throw Error('The saved invitation request could not be read. It has been kept.'); }
}
async function ordered(k: string,work:()=>Promise<void>) {
  const next = (writes.get(k) ?? Promise.resolve()).catch(()=>undefined).then(work);writes.set(k,next);
  try { await next; } finally { if(writes.get(k) === next) writes.delete(k); }
}
export async function loadInvitationAttempt(eventId: string,scope: CreatorPageScope) {
  const k = key(eventId,scope);await writes.get(k);const raw = await AsyncStorage.getItem(k);
  if (!scope.isCurrent()) throw Error('This invitation visit has ended.');
  return raw === null ? null : parseInvitationAttempt(raw,eventId,scope.userId);
}
/** A confirmed write must precede dispatch. Never replace an unresolved request with new content. */
export async function saveInvitationAttempt(attempt: InvitationAttempt,scope: CreatorPageScope) {
  const k = key(attempt.eventId,scope), normalized = parseInvitationAttempt(JSON.stringify(attempt),attempt.eventId,scope.userId);
  const serialized = JSON.stringify(normalized);
  await ordered(k,async()=>{
    const raw = await AsyncStorage.getItem(k);
    if (raw !== null && JSON.stringify(parseInvitationAttempt(raw,attempt.eventId,scope.userId)) !== serialized) throw Error('Check the saved invitation before starting another.');
    await AsyncStorage.setItem(k,serialized);
  });
  if (!scope.isCurrent()) throw Error('This invitation visit has ended.');
}
/** Caller must have a confirmed receipt or explicit server rejection; clear only that exact request. */
export async function clearInvitationAttempt(attempt: InvitationAttempt,scope: CreatorPageScope) {
  const k = key(attempt.eventId,scope);
  await ordered(k,async()=>{
    const raw = await AsyncStorage.getItem(k);if(raw === null) return;
    if(parseInvitationAttempt(raw,attempt.eventId,scope.userId).requestId !== attempt.requestId) throw Error('Check the saved invitation before starting another.');
    await AsyncStorage.removeItem(k);
  });
}
