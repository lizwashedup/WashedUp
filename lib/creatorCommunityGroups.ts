import { supabase } from './supabase';
import { ObsoleteCommunityOperationError, type CommunityOperationScope } from './communityChat';
import { getCommunityRoomIdentities, type CommunityRoomIdentity } from './communityRoomHistory';
export type CreatorGroupAttempt = { communityId: string; requestId: string; name: string };
export type CreatorGroupReceipt = CreatorGroupAttempt & { currentName: string | null; status: 'available' | 'archived' | 'unavailable' };
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export function normalizeCommunityRoomName(name: string) {
  const value = name.trim();
  if (!value || Array.from(value).length > 60 || /[\u0000-\u001f\u007f]/.test(name)) throw Error('Use a chat name of 1 to 60 characters.');
  return value;
}
async function account(scope: CommunityOperationScope) {
  if (!scope.isCurrent()) throw new ObsoleteCommunityOperationError();
  const { data, error } = await supabase.auth.getUser();
  if (!scope.isCurrent() || data.user?.id !== scope.userId) throw new ObsoleteCommunityOperationError();
  if (error) throw error;
}
function target(communityId: string, requestId?: string) {
  if (!uuid(communityId) || requestId !== undefined && !uuid(requestId)) throw Error('This community group is unavailable.');
}
function receipt(data: any, communityId: string, requestId: string): CreatorGroupReceipt {
  if (!data || data.community_id !== communityId || data.id !== requestId || typeof data.requested_name !== 'string'
    || normalizeCommunityRoomName(data.requested_name) !== data.requested_name || !['available','archived','unavailable'].includes(data.status)
    || (data.status === 'unavailable' ? data.name !== null : typeof data.name !== 'string' || !data.name.trim())) throw Error('Could not confirm this saved group. Check its status.');
  return { communityId, requestId, name: data.requested_name, currentName: data.name, status: data.status };
}
/** A read-only owner check for UI; every write also enforces page authority on the server. */
export async function canManageCommunityGroups(communityId: string, scope: CommunityOperationScope): Promise<boolean> {
  target(communityId); await account(scope);
  const { data, error } = await supabase.from('creator_page_publications').select('page_id,owner_id,page_kind').eq('page_id', communityId).eq('owner_id', scope.userId).maybeSingle();
  await account(scope); if (error) throw error;
  if (data?.page_id !== communityId || data?.owner_id !== scope.userId || data?.page_kind !== 'community') return false;
  return !!await getCommunityRoomIdentities(communityId, scope);
}
export async function getCreatorGroupCreation(communityId: string, requestId: string, scope: CommunityOperationScope): Promise<CreatorGroupReceipt | null> {
  target(communityId,requestId); await account(scope);
  const { data,error } = await supabase.rpc('get_community_group_creation',{p_community_id:communityId,p_request_id:requestId});
  await account(scope);if(error)throw error;
  return data===null ? null : receipt(data,communityId,requestId);
}
export async function createCreatorCommunityGroup(attempt: CreatorGroupAttempt, scope: CommunityOperationScope): Promise<CreatorGroupReceipt> {
  target(attempt.communityId,attempt.requestId);const name=normalizeCommunityRoomName(attempt.name);await account(scope);
  if(!scope.isCurrent())throw new ObsoleteCommunityOperationError();
  const {data,error}=await supabase.rpc('create_community_group',{p_community_id:attempt.communityId,p_request_id:attempt.requestId,p_name:name});
  await account(scope);if(error)throw error;
  const result=receipt(data,attempt.communityId,attempt.requestId);
  if(result.name!==name)throw Error('This saved group belongs to another request.');
  return result;
}
export async function renameCreatorCommunityRoom(communityId: string, room: CommunityRoomIdentity, name: string, scope: CommunityOperationScope): Promise<CommunityRoomIdentity> {
  target(communityId,room.id);const desired=normalizeCommunityRoomName(name);await account(scope);
  if(!scope.isCurrent())throw new ObsoleteCommunityOperationError();
  const {data,error}=await supabase.rpc('rename_community_room',{p_community_id:communityId,p_room_id:room.id,p_role:room.role,p_name:desired,p_expected_name:room.name});
  await account(scope);if(error)throw error;
  if(!data||data.community_id!==communityId||data.id!==room.id||data.role!==room.role||data.name!==desired)throw Error('Could not confirm this chat name. Refresh before retrying.');
  return {...room,name:desired};
}
