import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { validPageEventStatusInput, type PageEventStatusInput } from './creatorPageEventStatus';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';
export interface PageEventStatusAttempt { version: 1; pageId: string; eventId: string; userId: string; requestId: string; input: PageEventStatusInput }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const queues = new Map<string,Promise<unknown>>();
const key = (pageId: string, eventId: string, scope: CreatorPageScope) => `creator-page-event-status:v1:${scope.userId}:${pageId}:${eventId}`;
function current(pageId: string, eventId: string, scope: CreatorPageScope) {
  if (!scope.isCurrent() || !uuid(scope.userId) || !uuid(pageId) || !uuid(eventId)) throw new CreatorPageScopeExpired();
}
async function serial<T>(k: string, action: () => Promise<T>): Promise<T> {
  const next = (queues.get(k) ?? Promise.resolve()).catch(()=>undefined).then(action); queues.set(k,next);
  try { return await next; } finally { if (queues.get(k) === next) queues.delete(k); }
}
async function read(pageId: string,eventId: string,scope: CreatorPageScope): Promise<PageEventStatusAttempt | null> {
  current(pageId,eventId,scope); const raw = await AsyncStorage.getItem(key(pageId,eventId,scope)); current(pageId,eventId,scope);
  if (raw === null) return null;
  const a = JSON.parse(raw) as PageEventStatusAttempt;
  if (!a || a.version !== 1 || a.pageId !== pageId || a.eventId !== eventId || a.userId !== scope.userId || !uuid(a.requestId) || !validPageEventStatusInput(a.input)) throw Error('The saved event action needs to be checked.');
  return a;
}
export function readPageEventStatusAttempt(pageId: string,eventId: string,scope: CreatorPageScope) {
  return serial(key(pageId,eventId,scope),()=>read(pageId,eventId,scope));
}
export function preparePageEventStatusAttempt(pageId: string,eventId: string,input: PageEventStatusInput,scope: CreatorPageScope) {
  current(pageId,eventId,scope);
  if (!validPageEventStatusInput(input)) throw Error('Check the event action.');
  const snapshot = JSON.parse(JSON.stringify(input)) as PageEventStatusInput;
  return serial(key(pageId,eventId,scope),async()=>{
    const existing = await read(pageId,eventId,scope); if (existing) return {attempt:existing,created:false};
    const attempt:PageEventStatusAttempt = {version:1,pageId,eventId,userId:scope.userId,requestId:Crypto.randomUUID(),input:snapshot};
    current(pageId,eventId,scope); await AsyncStorage.setItem(key(pageId,eventId,scope),JSON.stringify(attempt)); current(pageId,eventId,scope);
    return {attempt,created:true};
  });
}
export function clearPageEventStatusAttempt(attempt: PageEventStatusAttempt,scope: CreatorPageScope) {
  return serial(key(attempt.pageId,attempt.eventId,scope),async()=>{
    const existing = await read(attempt.pageId,attempt.eventId,scope);
    if (!existing || JSON.stringify(existing) !== JSON.stringify(attempt)) return false;
    await AsyncStorage.removeItem(key(attempt.pageId,attempt.eventId,scope)); current(attempt.pageId,attempt.eventId,scope); return true;
  });
}
