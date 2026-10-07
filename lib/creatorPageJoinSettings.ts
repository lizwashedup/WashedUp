/** Page-owned joining settings. Reuse the existing community fields and admission contract. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';
export interface PageJoinSettings {
  join_policy: 'open' | 'approval_required';
  join_welcome_message: string | null; join_intro_question: string | null; guidelines_url: string | null;
  join_ask_reason: boolean; join_ask_source: boolean; join_ask_rules_confirm: boolean; join_open_question: string | null;
}
export interface PageJoinState {
  page_id: string; owner_id: string; name: string; published: boolean; audience: string;
  version: number; pending_count: number; settings: PageJoinSettings;
}
export interface PageJoinDraft {
  pageId: string; userId: string; baseVersion: number; settings: PageJoinSettings; pending: boolean;
}
const idValid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const fields = ['join_policy','join_welcome_message','join_intro_question','guidelines_url','join_ask_reason','join_ask_source','join_ask_rules_confirm','join_open_question'] as const;
const textFields = ['join_welcome_message','join_intro_question','guidelines_url','join_open_question'] as const;
const key = (page: string, scope: CreatorPageScope) => `creator-page-join-settings:v1:${scope.userId}:${page}`;
const current = (scope: CreatorPageScope) => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };
const writes = new Map<string, Promise<void>>(), mutations = new Set<string>();
export function normalizePageJoinSettings(value: PageJoinSettings): PageJoinSettings {
  if (!value || typeof value !== 'object' || Object.keys(value).length !== fields.length || fields.some(f => !(f in value))
    || !['open','approval_required'].includes(value.join_policy)
    || ['join_ask_reason','join_ask_source','join_ask_rules_confirm'].some(f => typeof value[f as keyof PageJoinSettings] !== 'boolean')
    || textFields.some(f => value[f] !== null && typeof value[f] !== 'string')) throw new Error('Check the joining settings.');
  const result = { ...value };
  for (const field of textFields) result[field] = value[field]?.trim() || null;
  if ((result.join_welcome_message?.length ?? 0) > 1000 || (result.join_intro_question?.length ?? 0) > 200
    || (result.join_open_question?.length ?? 0) > 200 || (result.guidelines_url && !/^https?:\/\/\S+$/i.test(result.guidelines_url))) throw new Error('Check the question text or guidelines link.');
  return result;
}
export const samePageJoinSettings = (a: PageJoinSettings, b: PageJoinSettings) => fields.every(field => a[field] === b[field]);
async function account(scope: CreatorPageScope) {
  current(scope); const result = await requestWithDeadline(supabase.auth.getUser(), 12_000); current(scope);
  if (result.error || result.data.user?.id !== scope.userId) throw new CreatorPageScopeExpired();
}
function validDraft(draft: PageJoinDraft, pageId: string, scope: CreatorPageScope) {
  if (!draft || draft.pageId !== pageId || !idValid(pageId) || draft.userId !== scope.userId
    || !Number.isSafeInteger(draft.baseVersion) || draft.baseVersion < 0 || typeof draft.pending !== 'boolean') throw new Error('The saved joining draft could not be read.');
  normalizePageJoinSettings(draft.settings);
  return draft;
}
function parseState(value: PageJoinState, pageId: string, scope: CreatorPageScope) {
  if (!value || value.page_id !== pageId || value.owner_id !== scope.userId || typeof value.name !== 'string'
    || typeof value.published !== 'boolean' || !['everyone','women_only','men_only','nonbinary_only'].includes(value.audience)
    || !Number.isSafeInteger(value.version) || value.version < 0 || !Number.isSafeInteger(value.pending_count) || value.pending_count < 0) throw new Error('Joining settings could not be confirmed.');
  normalizePageJoinSettings(value.settings);
  return value;
}
export async function readPageJoinSettings(pageId: string, scope: CreatorPageScope): Promise<PageJoinState> {
  if (!idValid(pageId)) throw new Error('This page address is invalid.');
  await account(scope);
  const result = await requestWithDeadline(supabase.rpc('get_creator_page_join_settings', { p_page_id: pageId }), 12_000);
  await account(scope);
  if (result.error) throw result.error;
  return parseState(result.data, pageId, scope);
}
export async function readPageJoinDraft(pageId: string, scope: CreatorPageScope): Promise<PageJoinDraft | null> {
  current(scope); await writes.get(key(pageId, scope));
  const raw = await AsyncStorage.getItem(key(pageId, scope)); current(scope);
  if (!raw) return null;
  try { return validDraft(JSON.parse(raw), pageId, scope); }
  catch { throw new Error('The saved joining draft could not be read.'); }
}
/** Keep typing writes ordered; a later edit never loses to a slower earlier write. */
export function persistPageJoinDraft(draft: PageJoinDraft, scope: CreatorPageScope): Promise<void> {
  current(scope); validDraft(draft, draft.pageId, scope);
  const ownedKey = key(draft.pageId, scope);
  const serialized = JSON.stringify(draft);
  const next = (writes.get(ownedKey) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    current(scope); await AsyncStorage.setItem(ownedKey, serialized); current(scope);
  });
  writes.set(ownedKey, next);
  void next.finally(() => { if (writes.get(ownedKey) === next) writes.delete(ownedKey); }).catch(() => undefined);
  return next;
}
export const draftFromPageJoinState = (state: PageJoinState): PageJoinDraft => ({ pageId: state.page_id, userId: state.owner_id,
  baseVersion: state.version, settings: state.settings, pending: false });
export async function loadPageJoinEditor(pageId: string, scope: CreatorPageScope) {
  const state = await readPageJoinSettings(pageId, scope), saved = await readPageJoinDraft(pageId, scope);
  const draft = saved ?? draftFromPageJoinState(state);
  const matches = samePageJoinSettings(normalizePageJoinSettings(draft.settings), state.settings);
  return { state, draft, confirmed: !!draft.pending && matches && state.version > 0,
    conflict: draft.baseVersion !== state.version && !matches };
}
/** Resolve an unknown result by comparing current state; this never issues a settings mutation. */
export async function resolvePageJoinSave(pageId: string, scope: CreatorPageScope) {
  const result = await loadPageJoinEditor(pageId, scope);
  if (!result.confirmed) throw new Error(result.conflict ? 'Joining settings changed. Your draft is still saved.' : 'This save is still unconfirmed.');
  const draft = draftFromPageJoinState(result.state);
  await persistPageJoinDraft(draft, scope); return draft;
}
export async function savePageJoinDraft(draft: PageJoinDraft, scope: CreatorPageScope) {
  const ownedKey = key(draft.pageId, scope); current(scope);
  if (mutations.has(ownedKey)) throw new Error('A joining save is still finishing.');
  mutations.add(ownedKey);
  try {
    validDraft(draft, draft.pageId, scope); await account(scope);
    const saved = await readPageJoinDraft(draft.pageId, scope);
    const settings = normalizePageJoinSettings(draft.settings);
    if (saved?.pending && (saved.baseVersion !== draft.baseVersion || !samePageJoinSettings(normalizePageJoinSettings(saved.settings), settings))) throw new Error('Check the original saved attempt before changing it.');
    const pending = { ...draft, settings, pending: true };
    await persistPageJoinDraft(pending, scope); await account(scope);
    const response = await requestWithDeadline(supabase.rpc('save_creator_page_join_settings', { p_page_id: draft.pageId, p_expected_version: draft.baseVersion, p_settings: settings }), 25_000);
    await account(scope);
    if (response.error) throw response.error;
    const state = parseState(response.data, draft.pageId, scope);
    if (state.version < draft.baseVersion || state.version === 0 || !samePageJoinSettings(state.settings, settings)) throw new Error('The saved joining result could not be confirmed.');
    const confirmed = draftFromPageJoinState(state);
    // If local cleanup fails the confirmed remote state remains provable on the next read.
    await persistPageJoinDraft(confirmed, scope); return confirmed;
  } finally { mutations.delete(ownedKey); }
}
