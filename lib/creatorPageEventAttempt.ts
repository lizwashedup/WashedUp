import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';
export interface CreatorPageEventAttempt { pageId: string; eventId: string; title: string; category: string; categories?: string[]; }
const key = (pageId: string, scope: CreatorPageScope) => `creator-page-event-attempt:v1:${scope.userId}:${pageId}`;
const current = (scope: CreatorPageScope) => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };
export async function readCreatorPageEventAttempt(pageId: string, scope: CreatorPageScope) {
  current(scope);
  const raw = await AsyncStorage.getItem(key(pageId, scope));
  current(scope);
  if (!raw) return null;
  const value = JSON.parse(raw) as CreatorPageEventAttempt;
  if (value.pageId !== pageId || typeof value.eventId !== 'string' || !value.eventId
    || typeof value.title !== 'string' || typeof value.category !== 'string') {
    throw new Error('Could not read the saved event attempt.');
  }
  return value;
}
/** Persist before dispatch. Returning after an uncertain response reuses this ID. */
export async function prepareCreatorPageEventAttempt(pageId: string, title: string, category: string, scope: CreatorPageScope, categories?: string[]) {
  const existing = await readCreatorPageEventAttempt(pageId, scope);
  if (existing) return existing;
  const attempt = { pageId, eventId: Crypto.randomUUID(), title: title.trim(), category, ...(categories?{categories}: {}) };
  await AsyncStorage.setItem(key(pageId, scope), JSON.stringify(attempt));
  current(scope);
  return attempt;
}
/** Clear only after the same event is confirmed. No automatic creation retries. */
export async function clearCreatorPageEventAttempt(attempt: CreatorPageEventAttempt, scope: CreatorPageScope) {
  const existing = await readCreatorPageEventAttempt(attempt.pageId, scope);
  if (existing?.eventId === attempt.eventId) await AsyncStorage.removeItem(key(attempt.pageId, scope));
  current(scope);
}
