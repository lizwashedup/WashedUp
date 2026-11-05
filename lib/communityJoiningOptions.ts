import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';

export type CommunityJoiningOptions = { version: 1; community_id: string | null; method: 'open' | 'approval_required' | null };
/** Missing deployment is distinct from denied access, malformed data and an outage. */
export async function getCommunityJoiningOptions(communityId: string | null, token?: string): Promise<CommunityJoiningOptions | null> {
  let request = supabase.rpc('get_community_joining_options', { p_community_id: communityId });
  if (token) request = request.setHeader('Authorization', token);
  const { data, error } = await requestWithDeadline(request, 12_000);
  if (error) {
    if (['PGRST202', '42883'].includes(error.code ?? '') && error.message?.includes('get_community_joining_options')) return null;
    throw error;
  }
  if (!data || data.version !== 1 || data.community_id !== communityId
    || (communityId === null ? data.method !== null : !['open', 'approval_required'].includes(data.method))) {
    throw new Error('Couldn’t check the joining method.');
  }
  return data as CommunityJoiningOptions;
}

/** Before the explicit-choice upgrade, only published creator pages support Open. */
export async function hasPublishedCommunityJoining(communityId: string, token?: string) {
  let request = supabase.from('creator_page_publications').select('page_id,page_kind')
    .eq('page_id', communityId).eq('page_kind', 'community').maybeSingle();
  if (token) request = request.setHeader('Authorization', token);
  const { data, error } = await requestWithDeadline(request, 12_000);
  if (error) throw error;
  if (data === null) return false;
  if (data?.page_id !== communityId || data.page_kind !== 'community') throw new Error('Couldn’t check joining availability.');
  return true;
}
