/** Legacy community settings, using the same columns/RPC and server authorization. */
import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';
import type { JoinGateSettings, JoinPolicy, JoinQuestionsConfig } from './creatorMode';

export type JoiningDetails = { settings: JoinGateSettings; questions: JoinQuestionsConfig | null };
export type JoiningAttempt = { kind: 'details'; details: JoiningDetails } | { kind: 'method'; method: 'open' | 'approval_required' };
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const current = (scope: CreatorPageScope) => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };
export class JoiningSettingsOutcomeUnknown extends Error {
  constructor() { super('Couldn’t confirm this save. Check the saved settings before making another change.'); }
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

async function readMethod(communityId: string, token: string, scope: CreatorPageScope): Promise<JoinPolicy | null> {
  current(scope);
  const { data, error } = await requestWithDeadline(supabase.from('communities').select('id,join_policy')
    .eq('id', communityId).single().setHeader('Authorization', token), 12_000);
  current(scope);
  // A legacy schema without this optional column offers no method control.
  if (error?.code === '42703') return null;
  if (error) throw error;
  if (data?.id !== communityId || !['open', 'approval_required', 'invite_only'].includes(data.join_policy)) throw new Error('Couldn’t check the joining method.');
  return data.join_policy;
}
export async function readCommunityJoiningMethod(communityId: string, scope: CreatorPageScope) {
  return readMethod(communityId, await authorization(communityId, scope), scope);
}

/** Current deployed admission only opens automatically for published page communities. */
export async function readCommunityOpenJoining(communityId: string, scope: CreatorPageScope) {
  const token = await authorization(communityId, scope);
  const { data, error } = await requestWithDeadline(supabase.from('creator_page_publications')
    .select('page_id,page_kind').eq('page_id', communityId).eq('page_kind', 'community').maybeSingle()
    .setHeader('Authorization', token), 12_000);
  current(scope);
  if (error) throw error;
  if (data === null) return false;
  if (data?.page_id !== communityId || data.page_kind !== 'community') throw new Error('Couldn’t check joining availability.');
  return true;
}

/** One UPDATE prevents a successful welcome save followed by failed question saves. */
export async function saveCommunityJoiningDetails(communityId: string, details: JoiningDetails, scope: CreatorPageScope) {
  const values = patch(details), token = await authorization(communityId, scope);
  current(scope);
  let response;
  try {
    response = await requestWithDeadline(supabase.from('communities').update(values)
      .eq('id', communityId).select(['id', ...Object.keys(values)].join(',')).single().setHeader('Authorization', token), 12_000);
  } catch { current(scope); throw new JoiningSettingsOutcomeUnknown(); }
  current(scope);
  if (response.error && /^[0-9A-Z]{5}$/.test(response.error.code ?? '')) throw response.error;
  if (response.error || !exact(response.data, communityId, values)) throw new JoiningSettingsOutcomeUnknown();
}
export async function changeCommunityJoiningMethod(communityId: string, method: 'open' | 'approval_required', scope: CreatorPageScope) {
  if (!['open', 'approval_required'].includes(method)) throw new Error('Choose Open or Review requests.');
  const token = await authorization(communityId, scope);
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
}
/** Reconcile the exact attempted values; this path never issues a write. */
export async function checkCommunityJoiningSave(communityId: string, attempt: JoiningAttempt, scope: CreatorPageScope) {
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
