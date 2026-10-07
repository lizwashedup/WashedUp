import { supabase } from './supabase';
import type { CommunityOperationScope } from './communityChat';

export interface CommunityChatPreference {
  communityId: string;
  userId: string;
  muted: boolean;
  version: number;
}
export class CommunityChatPreferenceConflictError extends Error {
  constructor() { super('Your notification setting changed. Check it before saving.'); }
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
function current(scope: CommunityOperationScope) {
  if (!scope.userId || !scope.isCurrent()) throw Error('This community changed.');
}
async function account(scope: CommunityOperationScope) {
  current(scope);
  const { data, error } = await supabase.auth.getUser();
  current(scope);
  if (error) throw error;
  if (data.user?.id !== scope.userId) throw Error('Sign in again to check this setting.');
}
function target(communityId: string, scope: CommunityOperationScope) {
  if (!uuid(communityId) || !uuid(scope.userId)) throw Error('This community setting is unavailable.');
  current(scope);
}
function receipt(raw: unknown, communityId: string, scope: CommunityOperationScope): CommunityChatPreference {
  const value = raw as Record<string, unknown> | null;
  if (!value || value.community_id !== communityId || value.user_id !== scope.userId
    || typeof value.muted !== 'boolean' || !Number.isSafeInteger(value.version) || (value.version as number) < 0) {
    throw Error('Your community notification setting could not be confirmed.');
  }
  return { communityId, userId: scope.userId, muted: value.muted, version: value.version as number };
}
/** Read-only recovery. A failed read is unknown, never an unmuted default. */
export async function getCommunityChatPreference(communityId: string, scope: CommunityOperationScope): Promise<CommunityChatPreference> {
  target(communityId, scope); await account(scope); current(scope);
  const { data, error } = await supabase.rpc('get_community_chat_preference', { p_community_id: communityId });
  await account(scope);
  if (error) throw error;
  return receipt(data, communityId, scope);
}
/** Explicit desired state, using a confirmed snapshot. This never changes any
 * individual room choice or automatically retries an uncertain save. */
export async function setCommunityChatPreference(
  observed: CommunityChatPreference, muted: boolean, scope: CommunityOperationScope,
): Promise<CommunityChatPreference> {
  target(observed.communityId, scope);
  if (observed.userId !== scope.userId || typeof observed.muted !== 'boolean' || typeof muted !== 'boolean'
    || !Number.isSafeInteger(observed.version) || observed.version < 0) throw Error('Check your notification setting before saving.');
  await account(scope); current(scope);
  const { data, error } = await supabase.rpc('set_community_chat_preference', {
    p_community_id: observed.communityId, p_muted: muted, p_expected_version: observed.version,
  });
  await account(scope);
  if (error?.code === 'PT409') throw new CommunityChatPreferenceConflictError();
  if (error) throw error;
  const confirmed = receipt(data, observed.communityId, scope);
  if (confirmed.muted !== muted || confirmed.version !== observed.version + (observed.muted === muted ? 0 : 1)) {
    throw Error('Your notification change could not be confirmed.');
  }
  return confirmed;
}
