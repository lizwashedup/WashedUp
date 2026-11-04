/** Legacy community settings, using the same columns/RPC and server authorization. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { getCommunityJoiningOptions, hasPublishedCommunityJoining } from './communityJoiningOptions';
import { requestWithDeadline } from './requestWithDeadline';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';
import type { JoinGateSettings, JoinPolicy, JoinQuestionsConfig } from './creatorMode';

export type JoiningDetails = { settings: JoinGateSettings; questions: JoinQuestionsConfig | null };
export type JoiningAttempt = { kind: 'details'; details: JoiningDetails } | { kind: 'method'; method: 'open' | 'approval_required' };
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const current = (scope: CreatorPageScope) => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };
export class JoiningSettingsOutcomeUnknown extends Error {
  constructor(readonly attempt?: JoiningAttempt) { super('Couldn’t confirm this save. Check the saved settings before making another change.'); }
}
async function authorization(communityId: string, scope: CreatorPageScope) {
  current(scope);
  if (!uuid.test(communityId)) throw new Error('This community could not be checked.');
  const { data, error } = await requestWithDeadline(supabase.auth.getSession(), 8_000);
  current(scope);
  if (error) throw error;
  if (data.session?.user.id !== scope.userId || !data.session.access_token) throw new CreatorPageScopeExpired();
  return `Bearer ${data.session.access_token}`;
}
function patch(details: JoiningDetails): Record<string, string | boolean | null> {
  const { settings, questions } = details;
  const text = (value: unknown, max: number) => {
    if (value !== null && typeof value !== 'string') throw new Error('Check your joining text.');
    const result = (value as string | null)?.trim() || null;
    if (result && result.length > max) throw new Error('Check your joining text.');
    return result;
  };
  const values: Record<string, string | boolean | null> = {
    join_welcome_message: text(settings.join_welcome_message, 1000),
    join_intro_question: text(settings.join_intro_question, 200),
    guidelines_url: text(settings.guidelines_url, 2048),
  };
  if (values.guidelines_url && !/^https?:\/\/\S+$/i.test(String(values.guidelines_url))) throw new Error('Check the guidelines link.');
  if (questions) {
    if ([questions.askReason, questions.askSource, questions.askRulesConfirm].some(value => typeof value !== 'boolean')) throw new Error('Check your joining questions.');
    Object.assign(values, { join_ask_reason: questions.askReason, join_ask_source: questions.askSource,
      join_ask_rules_confirm: questions.askRulesConfirm, join_open_question: text(questions.openQuestion, 200) });
  }
  return values;
}
const exact = (row: unknown, id: string, values: Record<string, unknown>) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const record = row as Record<string, unknown>;
  return record.id === id && Object.entries(values).every(([key, value]) => record[key] === value);
};

const journalKey = (communityId: string, scope: CreatorPageScope) => `community-joining-attempt:v1:${scope.userId}:${communityId}`;
const operations = new Map<string, JoiningAttempt>();
function validAttempt(value: unknown): asserts value is JoiningAttempt {
  const attempt = value as JoiningAttempt;
  if (attempt?.kind === 'method' && ['open', 'approval_required'].includes(attempt.method)) return;
  if (attempt?.kind === 'details' && attempt.details && typeof attempt.details === 'object') { patch(attempt.details); return; }
  throw new Error('Couldn’t read the saved settings attempt.');
}
function sameAttempt(a: JoiningAttempt, b: JoiningAttempt) {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'method' && b.kind === 'method') return a.method === b.method;
  if (a.kind === 'details' && b.kind === 'details') return JSON.stringify(patch(a.details)) === JSON.stringify(patch(b.details));
  return false;
}
export async function readCommunityJoiningAttempt(communityId: string, scope: CreatorPageScope): Promise<JoiningAttempt | null> {
  current(scope);
  const raw = await requestWithDeadline(AsyncStorage.getItem(journalKey(communityId, scope)), 8_000);
  current(scope);
  if (raw === null) return null;
  let record;
  try { record = JSON.parse(raw); } catch { throw new Error('Couldn’t read the saved settings attempt.'); }
  if (record?.userId !== scope.userId || record?.communityId !== communityId) throw new Error('Couldn’t read the saved settings attempt.');
  validAttempt(record.attempt);
  return record.attempt;
}
/** Persist before dispatch; reopening cannot silently forget a save with a lost response. */
async function withAttempt(communityId: string, attempt: JoiningAttempt, scope: CreatorPageScope, write: (token: string) => Promise<void>) {
  current(scope); validAttempt(attempt);
  const key = journalKey(communityId, scope);
  if (operations.has(key)) throw new JoiningSettingsOutcomeUnknown(operations.get(key));
  operations.set(key, attempt);
  try {
    const token = await authorization(communityId, scope);
    const saved = await readCommunityJoiningAttempt(communityId, scope);
    if (saved && !sameAttempt(saved, attempt)) throw new JoiningSettingsOutcomeUnknown(saved);
    if (!saved) await requestWithDeadline(AsyncStorage.setItem(key, JSON.stringify({ communityId, userId: scope.userId, attempt })), 8_000);
    current(scope);
    try { await write(token); }
    catch (error) {
      if (!saved && /^[0-9A-Z]{5}$/.test((error as { code?: string })?.code ?? '')) {
        try { current(scope); await requestWithDeadline(AsyncStorage.removeItem(key), 8_000); current(scope); }
        catch { current(scope); throw new JoiningSettingsOutcomeUnknown(attempt); }
      }
      throw error;
    }
    try { current(scope); await requestWithDeadline(AsyncStorage.removeItem(key), 8_000); current(scope); }
    catch { current(scope); throw new JoiningSettingsOutcomeUnknown(); }
  } finally { operations.delete(key); }
}

async function readMethod(communityId: string, token: string, scope: CreatorPageScope): Promise<JoinPolicy | null> {
  current(scope);
  const options = await getCommunityJoiningOptions(communityId, token);
  current(scope);
  if (options) return options.method;
  const { data, error } = await requestWithDeadline(supabase.from('communities').select('id,join_policy')
    .eq('id', communityId).single().setHeader('Authorization', token), 12_000);
  current(scope);
  // A legacy schema without this optional column offers no method control.
  if (error?.code === '42703') return null;
  if (error) throw error;
  if (data?.id !== communityId || !['open', 'approval_required', 'invite_only'].includes(data.join_policy)) throw new Error('Couldn’t check the joining method.');
  if (data.join_policy !== 'open') return data.join_policy;
  const published = await hasPublishedCommunityJoining(communityId, token);
  current(scope);
  return published ? 'open' : 'approval_required';
}
export async function readCommunityJoiningMethod(communityId: string, scope: CreatorPageScope) {
  return readMethod(communityId, await authorization(communityId, scope), scope);
}

/** Offer Open only when the server can actually apply that choice. */
export async function readCommunityOpenJoining(communityId: string, scope: CreatorPageScope) {
  const token = await authorization(communityId, scope);
  const options = await getCommunityJoiningOptions(communityId, token);
  current(scope);
  if (options) return true;
  const published = await hasPublishedCommunityJoining(communityId, token);
  current(scope);
  return published;
}

/** One UPDATE prevents a successful welcome save followed by failed question saves. */
export async function saveCommunityJoiningDetails(communityId: string, details: JoiningDetails, scope: CreatorPageScope) {
  const values = patch(details);
  return withAttempt(communityId, { kind: 'details', details }, scope, async token => {
  current(scope);
  let response;
  try {
    response = await requestWithDeadline(supabase.from('communities').update(values)
      .eq('id', communityId).select(['id', ...Object.keys(values)].join(',')).single().setHeader('Authorization', token), 12_000);
  } catch { current(scope); throw new JoiningSettingsOutcomeUnknown(); }
  current(scope);
  if (response.error && /^[0-9A-Z]{5}$/.test(response.error.code ?? '')) throw response.error;
  if (response.error || !exact(response.data, communityId, values)) throw new JoiningSettingsOutcomeUnknown();
  });
}
export async function changeCommunityJoiningMethod(communityId: string, method: 'open' | 'approval_required', scope: CreatorPageScope) {
  if (!['open', 'approval_required'].includes(method)) throw new Error('Choose Open or Review requests.');
  return withAttempt(communityId, { kind: 'method', method }, scope, async token => {
  current(scope);
  let response;
  try {
    response = await requestWithDeadline(supabase.rpc('set_community_join_policy', {
      p_community_id: communityId, p_join_policy: method,
    }).setHeader('Authorization', token), 12_000);
  } catch { current(scope); throw new JoiningSettingsOutcomeUnknown(); }
  current(scope);
  if (response.error && /^[0-9A-Z]{5}$/.test(response.error.code ?? '')) throw response.error;
  if (response.error) throw new JoiningSettingsOutcomeUnknown();
  try { if (await readMethod(communityId, token, scope) !== method) throw new JoiningSettingsOutcomeUnknown(); }
  catch { current(scope); throw new JoiningSettingsOutcomeUnknown(); }
  });
}
/** Reconcile the exact attempted values; this path never issues a write. */
async function matchesCommunityJoiningSave(communityId: string, attempt: JoiningAttempt, scope: CreatorPageScope) {
  const token = await authorization(communityId, scope);
  if (attempt.kind === 'method') return await readMethod(communityId, token, scope) === attempt.method;
  const values = patch(attempt.details);
  current(scope);
  const { data, error } = await requestWithDeadline(supabase.from('communities')
    .select(['id', ...Object.keys(values)].join(',')).eq('id', communityId).single().setHeader('Authorization', token), 12_000);
  current(scope);
  if (error) throw error;
  return exact(data, communityId, values);
}

export async function checkCommunityJoiningSave(communityId: string, attempt: JoiningAttempt, scope: CreatorPageScope) {
  current(scope); validAttempt(attempt);
  const key = journalKey(communityId, scope);
  if (operations.has(key)) throw new JoiningSettingsOutcomeUnknown(operations.get(key));
  operations.set(key, attempt);
  try {
    const saved = await readCommunityJoiningAttempt(communityId, scope);
    if (saved && !sameAttempt(saved, attempt)) throw new Error('Check the original saved attempt before changing it.');
    const matches = await matchesCommunityJoiningSave(communityId, attempt, scope);
    if (matches && saved) { current(scope); await requestWithDeadline(AsyncStorage.removeItem(key), 8_000); current(scope); }
    return matches;
  } finally { operations.delete(key); }
}
