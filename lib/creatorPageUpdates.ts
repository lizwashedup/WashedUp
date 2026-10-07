/** Exact page updates using the existing broadcast ledger. No automatic dispatch. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestWithDeadline } from './requestWithDeadline';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';

export interface PageUpdateAttempt {
  id: string; pageId: string; userId: string; body: string; stage: 'prepared' | 'dispatched';
}
export interface PageUpdateReceipt {
  id: string; page_id: string; sender_user_id: string; body: string;
  created_at: string; queued_recipient_count: number;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId = (id: unknown): id is string => typeof id === 'string' && uuid.test(id);
const validBody = (body: unknown): body is string => typeof body === 'string' && body === body.trim()
  && body.length > 0 && body.length <= 2000;
const current = (scope: CreatorPageScope) => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };
const key = (pageId: string, scope: CreatorPageScope) => `creator-page-update:v1:${scope.userId}:${pageId}`;
const active = new Set<string>();
const columns = 'id,creator_page_id,sender_user_id,body,created_at,queued_recipient_count';
function identity(pageId: string, scope: CreatorPageScope) {
  current(scope);
  if (!validId(pageId) || !validId(scope.userId)) throw new Error('This page or account address is invalid.');
}
async function account(scope: CreatorPageScope) {
  current(scope);
  const result = await requestWithDeadline(supabase.auth.getUser(), 12_000);
  current(scope);
  if (result.error || result.data.user?.id !== scope.userId) throw new CreatorPageScopeExpired();
}
async function exclusive<T>(pageId: string, scope: CreatorPageScope, action: () => Promise<T>) {
  identity(pageId, scope);
  const ownedKey = key(pageId, scope);
  if (active.has(ownedKey)) throw new Error('An update action is still finishing.');
  active.add(ownedKey);
  try { return await action(); } finally { active.delete(ownedKey); }
}
function validateAttempt(value: unknown, pageId: string, scope: CreatorPageScope): PageUpdateAttempt {
  const a = value as PageUpdateAttempt;
  identity(pageId, scope);
  if (!a || !validId(a.id) || a.pageId !== pageId || a.userId !== scope.userId || !validBody(a.body)
    || !['prepared', 'dispatched'].includes(a.stage)) throw new Error('The saved update could not be read.');
  return a;
}
function receipt(value: unknown, pageId: string, userId: string, attempt?: PageUpdateAttempt): PageUpdateReceipt {
  const r = value as PageUpdateReceipt;
  if (!r || !validId(r.id) || r.page_id !== pageId || r.sender_user_id !== userId || !validBody(r.body)
    || typeof r.created_at !== 'string' || !Number.isFinite(Date.parse(r.created_at))
    || !Number.isSafeInteger(r.queued_recipient_count) || r.queued_recipient_count < 0
    || (attempt && (r.id !== attempt.id || r.body !== attempt.body))) {
    throw new Error('The saved update result could not be confirmed.');
  }
  return { id: r.id, page_id: r.page_id, sender_user_id: r.sender_user_id, body: r.body,
    created_at: r.created_at, queued_recipient_count: r.queued_recipient_count };
}
const fromRow = (row: unknown) => row && typeof row === 'object'
  ? { ...row, page_id: (row as { creator_page_id?: unknown }).creator_page_id } : row;
function same(a: PageUpdateAttempt, b: PageUpdateAttempt) {
  return a.id === b.id && a.pageId === b.pageId && a.userId === b.userId && a.body === b.body;
}
export async function readPendingPageUpdate(pageId: string, scope: CreatorPageScope): Promise<PageUpdateAttempt | null> {
  identity(pageId, scope);
  const raw = await AsyncStorage.getItem(key(pageId, scope));
  current(scope);
  if (raw === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('The saved update could not be read.'); }
  return validateAttempt(parsed, pageId, scope);
}
/** Exact receipt lookup only. Missing receipt is not permission to abandon/recreate an unknown send. */
export async function checkPageUpdate(attempt: PageUpdateAttempt, scope: CreatorPageScope): Promise<PageUpdateReceipt | null> {
  validateAttempt(attempt, attempt.pageId, scope);
  await account(scope);
  const result = await requestWithDeadline(supabase.from('follower_broadcasts').select(columns)
    .eq('id', attempt.id).eq('creator_page_id', attempt.pageId).eq('sender_user_id', scope.userId).maybeSingle(), 12_000);
  current(scope);
  if (result.error) throw result.error;
  await account(scope);
  return result.data === null ? null : receipt(fromRow(result.data), attempt.pageId, scope.userId, attempt);
}
/** Save for review before any remote mutation. A previous unknown send cannot be replaced. */
export const preparePageUpdate = (pageId: string, body: string, scope: CreatorPageScope) => exclusive(pageId, scope, async () => {
  const trimmed = body.trim();
  if (!validBody(trimmed)) throw new Error('Write an update of 1 to 2000 characters.');
  await account(scope);
  const pending = await readPendingPageUpdate(pageId, scope);
  if (pending && !await checkPageUpdate(pending, scope)) throw new Error('Check or finish your saved update first.');
  const attempt: PageUpdateAttempt = { id: Crypto.randomUUID(), pageId, userId: scope.userId, body: trimmed, stage: 'prepared' };
  validateAttempt(attempt, pageId, scope);
  await AsyncStorage.setItem(key(pageId, scope), JSON.stringify(attempt));
  current(scope);
  return attempt;
});
/** Editing is safe only before the durable dispatch marker exists. Never discard an unknown send. */
export const editPreparedPageUpdate = (attempt: PageUpdateAttempt, scope: CreatorPageScope) => exclusive(attempt.pageId, scope, async () => {
  validateAttempt(attempt, attempt.pageId, scope);
  await account(scope);
  const pending = await readPendingPageUpdate(attempt.pageId, scope);
  if (!pending || !same(pending, attempt) || pending.stage !== 'prepared') throw new Error('Check the saved update before editing.');
  await AsyncStorage.removeItem(key(attempt.pageId, scope));
  current(scope);
  return pending.body;
});
/** Requires durable exact intent; retries use the same server idempotency key and body. */
export const sendPageUpdate = (attempt: PageUpdateAttempt, scope: CreatorPageScope) => exclusive(attempt.pageId, scope, async () => {
  validateAttempt(attempt, attempt.pageId, scope);
  const pending = await readPendingPageUpdate(attempt.pageId, scope);
  if (!pending || !same(pending, attempt)) throw new Error('The original update must be saved first.');
  await account(scope);
  await AsyncStorage.setItem(key(attempt.pageId, scope), JSON.stringify({ ...pending, stage: 'dispatched' }));
  // Recheck after local persistence, immediately before the only remote mutation.
  await account(scope);
  const result = await requestWithDeadline(supabase.rpc('send_creator_page_broadcast', {
    p_page_id: attempt.pageId, p_attempt_id: attempt.id, p_body: attempt.body,
  }), 25_000);
  current(scope);
  if (result.error) throw result.error;
  await account(scope);
  return receipt(result.data, attempt.pageId, scope.userId, attempt);
});
/** Confirm remotely before local cleanup. A cleanup failure never changes the confirmed outcome. */
export const resolvePageUpdate = (attempt: PageUpdateAttempt, scope: CreatorPageScope) => exclusive(attempt.pageId, scope, async () => {
  const confirmed = await checkPageUpdate(attempt, scope);
  if (!confirmed) throw new Error('This update is still unconfirmed.');
  const pending = await readPendingPageUpdate(attempt.pageId, scope);
  if (pending && !same(pending, attempt)) throw new Error('A different update is pending.');
  let cleared = !pending;
  if (pending) {
    try { await AsyncStorage.removeItem(key(attempt.pageId, scope)); cleared = true; } catch { /* Keep confirmed receipt visible. */ }
  }
  current(scope);
  return { receipt: confirmed, cleared };
});
/** Bounded recent history for the exact page and current sender; never mixes legacy account updates. */
export async function readRecentPageUpdates(pageId: string, scope: CreatorPageScope): Promise<PageUpdateReceipt[]> {
  identity(pageId, scope);
  await account(scope);
  const result = await requestWithDeadline(supabase.from('follower_broadcasts').select(columns)
    .eq('creator_page_id', pageId).eq('sender_user_id', scope.userId)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(25), 12_000);
  current(scope);
  if (result.error) throw result.error;
  await account(scope);
  if (!Array.isArray(result.data)) throw new Error('Recent updates could not be checked.');
  const rows = result.data.map(row => receipt(fromRow(row), pageId, scope.userId));
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Recent updates could not be checked.');
  return rows;
}
