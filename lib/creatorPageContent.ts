/** Approved page content. Private edits and exact actor-owned save/publish recovery. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';

export interface CreatorPageContent {
  name: string; purpose: string; city: string; description: string | null;
  photo_url: string | null; cover_media_id: string | null;
  discovery_area?: string | null; categories?: string[] | null;
}
export interface CreatorPageContentState {
  page_id: string; page_kind: 'community' | 'organization'; state: 'approved' | 'published'; audience: string;
  version: number; published_version: number | null; content: CreatorPageContent; live_content: CreatorPageContent | null;
}
export interface CreatorPageContentAttempt {
  requestId: string; action: 'save' | 'publish'; expectedVersion: number; content: CreatorPageContent;
  refused?: string;
}
export interface CreatorPageContentDraft {
  pageId: string; userId: string; baseVersion: number; content: CreatorPageContent; pending?: CreatorPageContentAttempt;
}
export interface CreatorPageContentReceipt {
  request_id: string; page_id: string; actor_id: string; action: 'save' | 'publish';
  expected_version: number; version: number; published_version: number | null;
}
export class CreatorPageContentRefused extends Error {}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const whole = (n: unknown): n is number => Number.isInteger(n) && Number(n) >= 0;
const fields = ['name', 'purpose', 'city', 'description', 'photo_url', 'cover_media_id', 'discovery_area', 'categories'];
const current = (scope: CreatorPageScope) => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };
const key = (pageId: string, scope: CreatorPageScope) => `creator-page-content:v1:${scope.userId}:${pageId}`;
const writes = new Map<string, Promise<void>>();
const active = new Set<string>();
function contentShape(value: unknown): value is CreatorPageContent {
  const c = value as CreatorPageContent;
  return !!c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).every(k => fields.includes(k))
    && ['name', 'purpose', 'city'].every(k => typeof c[k as 'name'] === 'string')
    && ['description', 'photo_url', 'cover_media_id'].every(k => c[k as 'description'] === null || typeof c[k as 'description'] === 'string')
    && (c.cover_media_id === null || uuid.test(c.cover_media_id))
    && (c.discovery_area === undefined || c.discovery_area === null || typeof c.discovery_area === 'string')
    && (c.categories === undefined || c.categories === null || Array.isArray(c.categories) && c.categories.length <= 2
      && c.categories.every(category => typeof category === 'string'));
}
export function creatorPageContentProblems(content: CreatorPageContent) {
  const errors: Record<string, string> = {};
  for (const [field, min, max, label] of [['name', 2, 60, 'Name'], ['purpose', 10, 140, 'Purpose'], ['city', 2, 60, 'City']] as const) {
    const size = Array.from(content[field].trim()).length;
    if (size < min || size > max) errors[field] = `${label} needs ${min}–${max} characters.`;
  }
  if (Array.from(content.description ?? '').length > 5000) errors.description = 'About can have up to 5,000 characters.';
  return errors;
}
export function normalizeCreatorPageContent(content: CreatorPageContent): CreatorPageContent {
  if (!contentShape(content)) throw new Error('The page details could not be read.');
  const normalized = { ...content, name: content.name.trim(), purpose: content.purpose.trim(), city: content.city.trim(), description: content.description?.trim() || null };
  const errors = creatorPageContentProblems(normalized);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  return normalized;
}
export const sameCreatorPageContent = (a: CreatorPageContent, b: CreatorPageContent) => fields.every(k => k === 'categories'
  ? JSON.stringify(a.categories) === JSON.stringify(b.categories)
  : a[k as keyof CreatorPageContent] === b[k as keyof CreatorPageContent]);
function draftShape(value: unknown, pageId: string, scope: CreatorPageScope): value is CreatorPageContentDraft {
  const d = value as CreatorPageContentDraft, p = d?.pending;
  return !!d && d.pageId === pageId && d.userId === scope.userId && whole(d.baseVersion) && contentShape(d.content)
    && (!p || (uuid.test(p.requestId) && ['save', 'publish'].includes(p.action) && whole(p.expectedVersion)
      && p.expectedVersion === d.baseVersion && contentShape(p.content) && sameCreatorPageContent(p.content, d.content)
      && (p.refused === undefined || typeof p.refused === 'string')));
}
async function account(scope: CreatorPageScope) {
  current(scope); const result = await requestWithDeadline(supabase.auth.getUser(), 12_000); current(scope);
  if (result.error || result.data.user?.id !== scope.userId) throw new CreatorPageScopeExpired();
}
async function readLocal(pageId: string, scope: CreatorPageScope) {
  current(scope); const raw = await AsyncStorage.getItem(key(pageId, scope)); current(scope);
  if (!raw) return null;
  let data: unknown; try { data = JSON.parse(raw); } catch { throw new Error('The saved page changes could not be read.'); }
  if (!draftShape(data, pageId, scope)) throw new Error('The saved page changes could not be read.');
  return data;
}
export async function readCreatorPageContentDraft(pageId: string, scope: CreatorPageScope) {
  await writes.get(key(pageId, scope)); return readLocal(pageId, scope);
}
/** Physical writes remain ordered even if navigation retires their UI. */
async function writeDraft(draft: CreatorPageContentDraft, scope: CreatorPageScope, replacingPending: false | string = false) {
  current(scope);
  if (!draftShape(draft, draft.pageId, scope)) throw new Error('The page changes could not be saved on this device.');
  const storageKey = key(draft.pageId, scope), serialized = JSON.stringify(draft);
  const write = (writes.get(storageKey) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    {
      const raw = await AsyncStorage.getItem(storageKey);
      if (raw) {
        let prior: CreatorPageContentDraft; try { prior = JSON.parse(raw); } catch { throw new Error('The saved page changes could not be read.'); }
        if (!draftShape(prior, draft.pageId, scope)) throw new Error('The saved page changes could not be read.');
        if (!replacingPending && prior.pending && JSON.stringify(prior.pending) !== JSON.stringify(draft.pending)) throw new Error('Check the original saved attempt before editing again.');
        if (replacingPending && (prior.pending ? prior.pending.requestId !== replacingPending : replacingPending !== 'reconcile')) throw new Error('The saved attempt changed. Check the latest saved result.');
      }
    }
    await AsyncStorage.setItem(storageKey, serialized);
  });
  writes.set(storageKey, write);
  try { await write; } finally { if (writes.get(storageKey) === write) writes.delete(storageKey); }
  current(scope);
}
export const persistCreatorPageContentDraft = (draft: CreatorPageContentDraft, scope: CreatorPageScope) => writeDraft(draft, scope);
export function creatorPageContentBusy(pageId: string, scope: CreatorPageScope) { return active.has(key(pageId, scope)); }
export async function readCreatorPageContent(pageId: string, scope: CreatorPageScope): Promise<CreatorPageContentState> {
  await account(scope);
  const result = await requestWithDeadline(supabase.rpc('get_creator_page_content_v2', { p_page_id: pageId }), 12_000); current(scope);
  if (result.error) throw result.error;
  const s = result.data as CreatorPageContentState;
  if (!s || s.page_id !== pageId || !['community', 'organization'].includes(s.page_kind) || !['approved', 'published'].includes(s.state)
    || typeof s.audience !== 'string' || !whole(s.version) || !(s.published_version === null || whole(s.published_version) && s.published_version <= s.version)
    || !contentShape(s.content) || !(s.live_content === null || contentShape(s.live_content))
    || (s.state === 'published' && (s.published_version === null || s.live_content === null))
    || (s.state === 'approved' && (s.published_version !== null || s.live_content !== null))) throw new Error('The saved page could not be confirmed.');
  return s;
}
export async function loadCreatorPageContentEditor(pageId: string, scope: CreatorPageScope) {
  const state = await readCreatorPageContent(pageId, scope);
  const local = await readCreatorPageContentDraft(pageId, scope); current(scope);
  const draft = local ?? { pageId, userId: scope.userId, baseVersion: state.version, content: state.content };
  return { state, draft, conflict: draft.baseVersion !== state.version };
}
export function validateCreatorPageContentReceipt(value: unknown, pageId: string, attempt: CreatorPageContentAttempt, scope: CreatorPageScope): CreatorPageContentReceipt {
  const r = value as CreatorPageContentReceipt;
  if (!r || r.request_id !== attempt.requestId || r.page_id !== pageId || r.actor_id !== scope.userId || r.action !== attempt.action
    || r.expected_version !== attempt.expectedVersion || r.version !== attempt.expectedVersion + (attempt.action === 'save' ? 1 : 0)
    || !(r.published_version === null || whole(r.published_version) && r.published_version <= r.version)
    || (attempt.action === 'publish' && r.published_version !== r.version)
    || (attempt.action === 'save' && r.published_version !== null && r.published_version > attempt.expectedVersion)) throw new Error('The original page action has not been confirmed.');
  return r;
}
const refusal = (error: unknown) => {
  const e = error as { code?: string; message?: string };
  // A server version refusal is definitive. Network failures remain unresolved.
  if (e?.code === 'PT409' || e?.code === '40001') return 'A newer version was saved. Your changes are still here.';
  if (e?.code === '42501') return 'Page editing is unavailable for this account. Your changes are still here.';
  if (e?.code === '22023' || e?.code === '22P02') return 'These changes could not be accepted. Check your page details before trying again.';
  return null;
};
async function finish(draft: CreatorPageContentDraft, receipt: CreatorPageContentReceipt, scope: CreatorPageScope) {
  const saved = { ...draft, baseVersion: receipt.version, pending: undefined };
  await writeDraft(saved, scope, draft.pending!.requestId); return saved;
}
/** No mutation is automatically replayed: caller must explicitly request Retry. */
export async function dispatchCreatorPageContent(draft: CreatorPageContentDraft, action: 'save' | 'publish', scope: CreatorPageScope) {
  current(scope); const storageKey = key(draft.pageId, scope);
  if (active.has(storageKey)) throw new Error('The original page action is still finishing.');
  active.add(storageKey);
  let transport: PromiseLike<unknown> | undefined, transportSettled = true;
  try {
    const local = await readCreatorPageContentDraft(draft.pageId, scope);
    if (local?.pending && (!draft.pending || JSON.stringify(local.pending) !== JSON.stringify(draft.pending))) throw new Error('Check the original saved attempt before continuing.');
    const content = normalizeCreatorPageContent(draft.content);
    const attempt: CreatorPageContentAttempt = draft.pending ?? { requestId: Crypto.randomUUID(), action, expectedVersion: draft.baseVersion, content };
    if (attempt.action !== action || attempt.refused || !sameCreatorPageContent(attempt.content, content)) throw new Error('Check the original saved attempt before continuing.');
    if (action === 'publish' && !draft.pending) {
      const saved = await readCreatorPageContent(draft.pageId, scope);
      if (saved.version !== draft.baseVersion || !sameCreatorPageContent(saved.content, content)) throw new CreatorPageContentRefused('The saved page changed. Preview the latest changes before publishing.');
    }
    const prepared: CreatorPageContentDraft = { ...draft, content: attempt.content, pending: attempt };
    await writeDraft(prepared, scope); await account(scope);
    const args = { p_page_id: draft.pageId, p_request_id: attempt.requestId, p_expected_version: attempt.expectedVersion };
    transportSettled = false;
    transport = Promise.resolve(supabase.rpc(action === 'save' ? 'save_creator_page_content' : 'publish_creator_page_content', action === 'save' ? { ...args, p_content: attempt.content } : args))
      .finally(() => { transportSettled = true; });
    const result = await requestWithDeadline(transport as Promise<{ data: unknown; error: unknown }>, 25_000); current(scope);
    if (result.error) {
      const reason = refusal(result.error);
      if (reason) { await writeDraft({ ...prepared, pending: { ...attempt, refused: reason } }, scope, attempt.requestId); throw new CreatorPageContentRefused(reason); }
      throw result.error;
    }
    const receipt = validateCreatorPageContentReceipt(result.data, draft.pageId, attempt, scope);
    return { draft: await finish(prepared, receipt, scope), receipt };
  } finally {
    // A UI timeout does not release an RPC that can still commit.
    if (transport && !transportSettled) void Promise.resolve(transport).then(() => active.delete(storageKey), () => active.delete(storageKey));
    else active.delete(storageKey);
  }
}
export async function checkCreatorPageContentAttempt(pageId: string, scope: CreatorPageScope) {
  const draft = await readCreatorPageContentDraft(pageId, scope);
  if (!draft?.pending) return { draft, receipt: null, active: creatorPageContentBusy(pageId, scope) };
  await account(scope);
  const result = await requestWithDeadline(supabase.rpc('get_creator_page_content_attempt', { p_page_id: pageId, p_request_id: draft.pending.requestId }), 12_000); current(scope);
  if (result.error) throw result.error;
  if (result.data === null) return { draft, receipt: null, active: creatorPageContentBusy(pageId, scope) };
  const receipt = validateCreatorPageContentReceipt(result.data, pageId, draft.pending, scope);
  return { draft: await finish(draft, receipt, scope), receipt, active: creatorPageContentBusy(pageId, scope) };
}
/** Explicit conflict recovery: keep local words, or replace them with the current saved version. */
export async function reconcileCreatorPageContent(draft: CreatorPageContentDraft, keepChanges: boolean, scope: CreatorPageScope) {
  const storageKey = key(draft.pageId, scope);
  if (active.has(storageKey)) throw new Error('The original page action is still finishing.');
  active.add(storageKey);
  try {
    const local = await readCreatorPageContentDraft(draft.pageId, scope);
    if (local?.pending && !local.pending.refused) throw new Error('Check the original saved attempt before continuing.');
    const state = await readCreatorPageContent(draft.pageId, scope);
    const next: CreatorPageContentDraft = { pageId: draft.pageId, userId: scope.userId, baseVersion: state.version, content: keepChanges ? draft.content : state.content };
    await writeDraft(next, scope, local?.pending?.requestId ?? 'reconcile'); return { state, draft: next };
  } finally { active.delete(storageKey); }
}
