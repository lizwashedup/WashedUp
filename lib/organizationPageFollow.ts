/** Durable, page-specific follow attempts. Never reassign legacy account follows. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';
import { checkPublishedPageScope } from './publishedPageIdentity';
import type { PageImageScope } from './publishedPageCover';
export interface OrganizationFollowState { page_id: string; user_id: string; following: boolean; version: number; }
export interface OrganizationFollowAttempt { id: string; pageId: string; userId: string; expectedVersion: number; following: boolean; }
export interface OrganizationFollowReceipt { id: string; page_id: string; user_id: string; expected_version: number; following: boolean; result_version: number; }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const current = (scope: PageImageScope) => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };
const key = (pageId: string, scope: CreatorPageScope) => `organization-page-follow:v1:${scope.userId}:${pageId}`;
const active = new Set<string>();
async function mutate<T>(pageId: string, scope: CreatorPageScope, action: () => Promise<T>) {
  current(scope); const ownedKey = key(pageId, scope);
  if (active.has(ownedKey)) throw new Error('A follow action is still finishing. Check its saved status.');
  active.add(ownedKey); try { return await action(); } finally { active.delete(ownedKey); }
}
function validAttempt(a: unknown, pageId: string, scope: CreatorPageScope): a is OrganizationFollowAttempt {
  const v = a as OrganizationFollowAttempt;
  return !!v && v.pageId === pageId && uuid.test(pageId) && uuid.test(v.id) && v.userId === scope.userId
    && typeof v.following === 'boolean' && Number.isSafeInteger(v.expectedVersion) && v.expectedVersion >= 0;
}
async function account(scope: CreatorPageScope) {
  current(scope); const result = await supabase.auth.getUser(); current(scope);
  if (result.error || result.data.user?.id !== scope.userId) throw new CreatorPageScopeExpired();
}
function parseState(data: unknown, pageId: string, scope: CreatorPageScope): OrganizationFollowState {
  const s = data as OrganizationFollowState;
  if (!s || s.page_id !== pageId || s.user_id !== scope.userId || typeof s.following !== 'boolean'
    || !Number.isSafeInteger(s.version) || s.version < 0) throw new Error('Following could not be checked.');
  return s;
}
function parseReceipt(data: unknown, attempt: OrganizationFollowAttempt): OrganizationFollowReceipt {
  const r = data as OrganizationFollowReceipt;
  if (!r || r.id !== attempt.id || r.page_id !== attempt.pageId || r.user_id !== attempt.userId
    || r.expected_version !== attempt.expectedVersion || r.following !== attempt.following
    || r.result_version !== attempt.expectedVersion + 1) throw new Error('The saved follow result could not be confirmed.');
  return r;
}
export async function readPendingOrganizationFollow(pageId: string, scope: CreatorPageScope) {
  current(scope); const raw = await AsyncStorage.getItem(key(pageId, scope)); current(scope);
  if (!raw) return null;
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error('The saved follow attempt could not be read.'); }
  if (!validAttempt(value, pageId, scope)) throw new Error('The saved follow attempt could not be read.');
  return value;
}
export async function readOrganizationFollowState(pageId: string, scope: CreatorPageScope) {
  if (!uuid.test(pageId)) throw new Error('This page address is invalid.');
  await account(scope);
  const result = await supabase.rpc('get_creator_page_follow_state', { p_page_id: pageId }); current(scope);
  if (result.error) throw result.error;
  return parseState(result.data, pageId, scope);
}
export async function readOrganizationFollowerCount(pageId: string, scope: PageImageScope): Promise<number | null> {
  if (!uuid.test(pageId)) throw new Error('This page address is invalid.');
  await checkPublishedPageScope(scope);
  const result = await supabase.rpc('get_creator_page_follower_count', { p_page_id: pageId }); current(scope);
  if (result.error) throw result.error;
  await checkPublishedPageScope(scope);
  if (result.data !== null && (!Number.isSafeInteger(result.data) || result.data < 0)) throw new Error('Follower count could not be checked.');
  return result.data;
}
/** Local preparation only: make the exact intent durable before any mutation RPC. */
export const prepareOrganizationFollow = (state: OrganizationFollowState, following: boolean, scope: CreatorPageScope) => mutate(state.page_id, scope, async () => {
  parseState(state, state.page_id, scope); await account(scope);
  const pending = await readPendingOrganizationFollow(state.page_id, scope);
  if (pending) {
    const checked = await checkOrganizationFollowAttempt(pending, scope);
    if (!checked.receipt && !checked.conflict) throw new Error('Check the saved follow attempt before choosing again.');
    if (checked.state.version !== state.version || checked.state.following !== state.following) throw new Error('Following changed. Check the current state.');
  }
  const attempt = { id: Crypto.randomUUID(), pageId: state.page_id, userId: scope.userId, expectedVersion: state.version, following };
  if (!validAttempt(attempt, state.page_id, scope)) throw new Error('Invalid follow attempt.');
  await AsyncStorage.setItem(key(state.page_id, scope), JSON.stringify(attempt)); current(scope);
  return attempt;
});
/** Remote read-only reconciliation. An old receipt is distinct from the latest current state. */
export async function checkOrganizationFollowAttempt(attempt: OrganizationFollowAttempt, scope: CreatorPageScope) {
  if (!validAttempt(attempt, attempt.pageId, scope)) throw new Error('Invalid follow attempt.');
  await account(scope);
  const result = await supabase.from('creator_page_follow_attempts').select('id,page_id,user_id,expected_version,following,result_version')
    .eq('id', attempt.id).eq('page_id', attempt.pageId).eq('user_id', scope.userId).maybeSingle(); current(scope);
  if (result.error) throw result.error;
  const receipt = result.data ? parseReceipt(result.data, attempt) : null;
  const state = await readOrganizationFollowState(attempt.pageId, scope);
  if (receipt && state.version < receipt.result_version) throw new Error('Following has not finished refreshing.');
  return { receipt, state, conflict: !receipt && state.version !== attempt.expectedVersion };
}
export const sendOrganizationFollowAttempt = (attempt: OrganizationFollowAttempt, scope: CreatorPageScope) => mutate(attempt.pageId, scope, async () => {
  if (!validAttempt(attempt, attempt.pageId, scope)) throw new Error('Invalid follow attempt.');
  const saved = await readPendingOrganizationFollow(attempt.pageId, scope);
  if (!saved || saved.id !== attempt.id || saved.expectedVersion !== attempt.expectedVersion || saved.following !== attempt.following) throw new Error('The original follow attempt must be saved first.');
  await account(scope);
  const result = await supabase.rpc('set_creator_page_follow', { p_page_id: attempt.pageId, p_attempt_id: attempt.id,
    p_expected_version: attempt.expectedVersion, p_following: attempt.following }); current(scope);
  if (result.error) throw result.error;
  const receipt = parseReceipt(result.data, attempt);
  const state = await readOrganizationFollowState(attempt.pageId, scope);
  if (state.version < receipt.result_version) throw new Error('Following has not finished refreshing.');
  return { receipt, state };
});
/** Clear after a confirmed receipt or explicit current-state conflict reconciliation; no remote mutation. */
export const resolveOrganizationFollowAttempt = (attempt: OrganizationFollowAttempt, scope: CreatorPageScope) => mutate(attempt.pageId, scope, async () => {
  const result = await checkOrganizationFollowAttempt(attempt, scope);
  if (!result.receipt && !result.conflict) throw new Error('This follow attempt is still uncertain.');
  const saved = await readPendingOrganizationFollow(attempt.pageId, scope);
  if (saved && saved.id !== attempt.id) throw new Error('A different follow attempt is pending.');
  // A known receipt/current-state conflict remains confirmed if local marker cleanup fails.
  if (saved) { await AsyncStorage.removeItem(key(attempt.pageId, scope)).catch(() => undefined); current(scope); }
  return result.state;
});
