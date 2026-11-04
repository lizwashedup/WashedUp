/** Legacy community publication/visibility. Existing columns and RLS remain authoritative. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';

export type CommunityPublicationState = { id: string; status: 'draft' | 'active' | 'archived'; discoverable: boolean };
export type CommunityPublicationAction = 'publish' | 'unpublish' | 'archive' | 'show' | 'hide';
export type CommunityPublicationAttempt = { action: CommunityPublicationAction; before: CommunityPublicationState; after: CommunityPublicationState };
const actions = ['publish', 'unpublish', 'archive', 'show', 'hide'];
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const locks = new Set<string>();
const key = (id: string, scope: CreatorPageScope) => `community-publication:v1:${scope.userId}:${id}`;
const current = (scope: CreatorPageScope) => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };
export class CommunityPublicationUnknown extends Error {
  constructor() { super('We couldn’t confirm this change. Check the saved status before trying again.'); }
}
function state(value: unknown, id: string): CommunityPublicationState {
  const row = value as CommunityPublicationState;
  if (!row || row.id !== id || !['draft', 'active', 'archived'].includes(row.status) || typeof row.discoverable !== 'boolean') {
    throw new Error('Couldn’t check this community’s visibility.');
  }
  return { id, status: row.status, discoverable: row.discoverable };
}
const same = (a: CommunityPublicationState, b: CommunityPublicationState) => a.id === b.id && a.status === b.status && a.discoverable === b.discoverable;
export function publicationAttempt(before: CommunityPublicationState, action: CommunityPublicationAction): CommunityPublicationAttempt {
  state(before, before.id);
  if (!uuid.test(before.id) || !actions.includes(action)) throw new Error('Check this community before continuing.');
  if (before.status === 'archived' || (action === 'publish' && before.status !== 'draft') || (action === 'unpublish' && before.status !== 'active')) {
    throw new Error('This community’s status changed. Refresh it before continuing.');
  }
  const after = { ...before };
  if (action === 'publish') after.status = 'active';
  else if (action === 'unpublish') after.status = 'draft';
  else if (action === 'archive') after.status = 'archived';
  else after.discoverable = action === 'show';
  return { action, before: { ...before }, after };
}
function validateAttempt(value: CommunityPublicationAttempt, id: string) {
  if (!value || !actions.includes(value.action)) throw new Error('Couldn’t read the earlier visibility change.');
  const before = state(value.before, id), after = state(value.after, id);
  if (!same(publicationAttempt(before, value.action).after, after)) throw new Error('Couldn’t read the earlier visibility change.');
}
async function token(id: string, scope: CreatorPageScope) {
  current(scope);
  if (!uuid.test(id)) throw new Error('Couldn’t check this community.');
  const { data, error } = await requestWithDeadline(supabase.auth.getSession(), 8_000);
  current(scope);
  if (error) throw error;
  if (data.session?.user.id !== scope.userId || !data.session.access_token) throw new CreatorPageScopeExpired();
  return `Bearer ${data.session.access_token}`;
}
async function read(id: string, scope: CreatorPageScope, authorization: string) {
  current(scope);
  const member = await requestWithDeadline(supabase.from('community_members').select('community_id,user_id,status,role')
    .eq('community_id', id).eq('user_id', scope.userId).maybeSingle().setHeader('Authorization', authorization), 12_000);
  current(scope);
  if (member.error) throw member.error;
  const row = member.data;
  if (!row || row.community_id !== id || row.user_id !== scope.userId || row.status !== 'active' || !['leader', 'co_leader'].includes(row.role)) {
    throw new Error('Only this community’s leader or co-leader can change its visibility.');
  }
  const result = await requestWithDeadline(supabase.from('communities').select('id,status,discoverable')
    .eq('id', id).single().setHeader('Authorization', authorization), 12_000);
  current(scope);
  if (result.error) throw result.error;
  return state(result.data, id);
}
export async function readCommunityPublication(id: string, scope: CreatorPageScope) {
  return read(id, scope, await token(id, scope));
}
/** A readable column does not imply creators can update it. Probe the supported RPC contract. */
export async function readCommunityDiscoveryAvailable(id: string, scope: CreatorPageScope) {
  const authorization = await token(id, scope);
  const result = await requestWithDeadline(supabase.rpc('get_community_visibility_options', { p_community_id: id })
    .setHeader('Authorization', authorization), 12_000);
  current(scope);
  if (result.error) {
    if (['PGRST202', '42883'].includes(result.error.code ?? '') && result.error.message?.includes('get_community_visibility_options')) return false;
    throw result.error;
  }
  if (result.data?.version !== 1 || result.data.community_id !== id || result.data.can_change_discovery !== true) {
    throw new Error('Couldn’t check discovery settings.');
  }
  return true;
}
export async function readCommunityPublicationAttempt(id: string, scope: CreatorPageScope): Promise<CommunityPublicationAttempt | null> {
  current(scope);
  const raw = await requestWithDeadline(AsyncStorage.getItem(key(id, scope)), 8_000);
  current(scope);
  if (raw === null) return null;
  let saved;
  try { saved = JSON.parse(raw); } catch { throw new Error('Couldn’t read the earlier visibility change.'); }
  if (saved.userId !== scope.userId || saved.communityId !== id) throw new Error('Couldn’t read the earlier visibility change.');
  validateAttempt(saved.attempt, id);
  return saved.attempt;
}
export async function changeCommunityPublication(attempt: CommunityPublicationAttempt, scope: CreatorPageScope) {
  current(scope); validateAttempt(attempt, attempt.before.id);
  const id = attempt.before.id, journalKey = key(id, scope);
  if (locks.has(journalKey)) throw new CommunityPublicationUnknown();
  locks.add(journalKey);
  try {
    const authorization = await token(id, scope);
    const saved = await readCommunityPublicationAttempt(id, scope);
    if (saved && (saved.action !== attempt.action || !same(saved.before, attempt.before) || !same(saved.after, attempt.after))) throw new CommunityPublicationUnknown();
    const latest = await read(id, scope, authorization);
    if (saved && same(latest, attempt.after)) {
      await requestWithDeadline(AsyncStorage.removeItem(journalKey), 8_000); current(scope); return latest;
    }
    if (!same(latest, attempt.before)) throw new Error('These settings changed. Check the saved status before continuing.');
    const discovery = attempt.action === 'show' || attempt.action === 'hide';
    if (discovery && !await readCommunityDiscoveryAvailable(id, scope)) throw new Error('Discovery changes aren’t available yet. Your saved visibility stays the same.');
    if (!saved) await requestWithDeadline(AsyncStorage.setItem(journalKey, JSON.stringify({ userId: scope.userId, communityId: id, attempt })), 8_000);
    current(scope);
    let result;
    try {
      const request = discovery ? supabase.rpc('set_community_discoverable', {
        p_community_id: id, p_expected_status: attempt.before.status,
        p_expected_discoverable: attempt.before.discoverable, p_discoverable: attempt.after.discoverable,
      }) : supabase.from('communities').update({ status: attempt.after.status })
        .eq('id', id).eq('status', attempt.before.status).eq('discoverable', attempt.before.discoverable)
        .select('id,status,discoverable').maybeSingle();
      result = await requestWithDeadline(request.setHeader('Authorization', authorization), 12_000);
    } catch { current(scope); throw new CommunityPublicationUnknown(); }
    current(scope);
    // A first dispatch explicitly rejected by PostgreSQL did not commit. A rejected
    // retry cannot settle an earlier lost response, so keep that original journal.
    if (!saved && result.error && ['42501', 'PT409', '22023'].includes(result.error.code ?? '')) {
      await requestWithDeadline(AsyncStorage.removeItem(journalKey), 8_000); current(scope);
      throw new Error(result.error.code === '42501'
        ? 'Your creator access changed. Check the saved status before continuing.'
        : 'These settings changed. Check the saved status before continuing.');
    }
    // A lost response or an unreadable/zero-row result is not a successful save.
    if (result.error || !result.data) throw new CommunityPublicationUnknown();
    let confirmed;
    try { confirmed = state(result.data, id); } catch { throw new CommunityPublicationUnknown(); }
    if (!same(confirmed, attempt.after)) throw new CommunityPublicationUnknown();
    await requestWithDeadline(AsyncStorage.removeItem(journalKey), 8_000); current(scope);
    return confirmed;
  } finally { locks.delete(journalKey); }
}
/** Read-only reconciliation. A mismatch retains the original attempt for explicit retry. */
export async function checkCommunityPublication(id: string, scope: CreatorPageScope) {
  const journalKey = key(id, scope);
  if (locks.has(journalKey)) throw new CommunityPublicationUnknown();
  locks.add(journalKey);
  try {
    const attempt = await readCommunityPublicationAttempt(id, scope);
    const latest = await readCommunityPublication(id, scope);
    const matched = !!attempt && same(latest, attempt.after);
    if (matched) { await requestWithDeadline(AsyncStorage.removeItem(journalKey), 8_000); current(scope); }
    return { state: latest, attempt: matched ? null : attempt };
  } finally { locks.delete(journalKey); }
}
