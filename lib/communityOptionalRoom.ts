import { supabase } from './supabase';
import { ObsoleteCommunityOperationError, type CommunityOperationScope } from './communityChat';
import { getCommunityRoomIdentities, type CommunityRoomIdentities } from './communityRoomHistory';

function current(scope: CommunityOperationScope) {
  if (!scope.isCurrent()) throw new ObsoleteCommunityOperationError();
}
export function requireOptionalRoom(layout: CommunityRoomIdentities | null, topicId: string) {
  const room = layout?.rooms.find(item => item.id === topicId && item.storage === 'topic');
  if (!room || room.role !== 'optional' || room.included) throw Error('This group is unavailable. Refresh your chats.');
  return room;
}
export type OptionalRoomWriteObserver = {
  dispatched(): void;
  // Bookkeeping only: an old route may receive its exact statement receipt,
  // but must not start the follow-up read or navigate from that receipt.
  acknowledged(): void;
  failed?(error: unknown): void;
};
/** Existing membership store and default notification choice. Repeated joining
 * does not overwrite a saved mute; only explicit optional rooms can change. */
export async function setOptionalRoomMembership(communityId: string, topicId: string, joined: boolean, scope: CommunityOperationScope, observer?: OptionalRoomWriteObserver): Promise<CommunityRoomIdentities> {
  current(scope);
  const before = await getCommunityRoomIdentities(communityId, scope);
  const room = requireOptionalRoom(before, topicId);
  current(scope);
  if (room.joined === joined) return before!;
  observer?.dispatched();
  const request = joined
    ? supabase.from('community_topic_members').upsert({ topic_id: topicId, user_id: scope.userId }, { onConflict: 'topic_id,user_id', ignoreDuplicates: true })
    : supabase.from('community_topic_members').delete().eq('topic_id', topicId).eq('user_id', scope.userId);
  const { data, error } = await request.select('topic_id,user_id');
  if (error) { observer?.failed?.(error); current(scope); throw error; }
  if (!Array.isArray(data) || data.length > 1 || data.some(row => row.topic_id !== topicId || row.user_id !== scope.userId)) throw Error('Could not confirm this group change. Check its status.');
  observer?.acknowledged();
  current(scope);
  // Empty receipts can mean a concurrent same-state change, never assumed success.
  const after = await getCommunityRoomIdentities(communityId, scope);
  if (requireOptionalRoom(after, topicId).joined !== joined) throw Error('Could not confirm this group change. Check its status.');
  current(scope);
  return after!;
}
