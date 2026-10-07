import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { validPageEventSaveInput, type PageEventSaveInput } from './creatorPageEventSave';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';
export interface PageEventSaveAttempt { version: 1; pageId: string; eventId: string; userId: string; requestId: string; input: PageEventSaveInput }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const queues = new Map<string,Promise<unknown>>();
const key = (pageId: string, eventId: string, scope: CreatorPageScope) => `creator-page-event-save:v1:${scope.userId}:${pageId}:${eventId}`;
function current(pageId: string, eventId: string, scope: CreatorPageScope) {
  if (!scope.isCurrent() || !uuid(scope.userId) || !uuid(pageId) || !uuid(eventId)) throw new CreatorPageScopeExpired();
}
async function serial<T>(k: string, action: () => Promise<T>): Promise<T> {
  const next = (queues.get(k) ?? Promise.resolve()).catch(()=>undefined).then(action); queues.set(k,next);
  try { return await next; } finally { if (queues.get(k) === next) queues.delete(k); }
}
async function read(pageId: string,eventId: string,scope: CreatorPageScope): Promise<PageEventSaveAttempt | null> {
  current(pageId,eventId,scope); const raw = await AsyncStorage.getItem(key(pageId,eventId,scope)); current(pageId,eventId,scope);
  if (raw === null) return null;
  const a = JSON.parse(raw) as PageEventSaveAttempt;
  if (!a || a.version !== 1 || a.pageId !== pageId || a.eventId !== eventId || a.userId !== scope.userId || !uuid(a.requestId) || !validPageEventSaveInput(a.input)) throw Error('The saved event attempt needs to be checked.');
  return a;
}
export function readPageEventSaveAttempt(pageId: string,eventId: string,scope: CreatorPageScope) {
  return serial(key(pageId,eventId,scope),()=>read(pageId,eventId,scope));
}
export function preparePageEventSaveAttempt(pageId: string,eventId: string,input: PageEventSaveInput,scope: CreatorPageScope) {
  current(pageId,eventId,scope);
  if (!validPageEventSaveInput(input)) throw Error('Check the event and offer settings.');
  const snapshot = JSON.parse(JSON.stringify(input)) as PageEventSaveInput;
  return serial(key(pageId,eventId,scope),async()=>{
    const existing = await read(pageId,eventId,scope); if (existing) return {attempt:existing,created:false};
    const attempt:PageEventSaveAttempt = {version:1,pageId,eventId,userId:scope.userId,requestId:Crypto.randomUUID(),input:snapshot};
    current(pageId,eventId,scope); await AsyncStorage.setItem(key(pageId,eventId,scope),JSON.stringify(attempt)); current(pageId,eventId,scope);
    return {attempt,created:true};
  });
}
export function clearPageEventSaveAttempt(attempt: PageEventSaveAttempt,scope: CreatorPageScope) {
  return serial(key(attempt.pageId,attempt.eventId,scope),async()=>{
    const existing = await read(attempt.pageId,attempt.eventId,scope);
    if (!existing || JSON.stringify(existing) !== JSON.stringify(attempt)) return false;
    await AsyncStorage.removeItem(key(attempt.pageId,attempt.eventId,scope)); current(attempt.pageId,attempt.eventId,scope); return true;
  });
}
