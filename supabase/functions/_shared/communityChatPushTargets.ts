/** Recheck actual chat notification sources immediately before provider dispatch. */
export interface CommunityChatNotice { id: string; user_id: string; type: string; topic_id?: string | null; }
export interface CommunityChatPushTarget {
  notification_id: string; user_id: string; source_kind: 'topic' | 'broadcast' | 'legacy';
  community_id: string | null; topic_id: string | null; broadcast_id: string | null; eligible: boolean;
  message_id?: string | null; message_source?: 'topic' | 'broadcast' | null; destination_topic_id?: string | null;
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export const isCommunityChatPushNotice = (notice: CommunityChatNotice) => notice.type === 'community_broadcast' || notice.type === 'new_message' && notice.topic_id != null;
export async function resolveCommunityChatPushTargets(database: { rpc: (name: string, args: any) => PromiseLike<any> }, notices: CommunityChatNotice[]) {
  const selected = notices.filter(isCommunityChatPushNotice), targets = new Map<string, CommunityChatPushTarget>();
  if (!selected.length) return targets;
  const expected = new Map(selected.map(n => [n.id, n]));
  if (expected.size !== selected.length) throw new Error('Duplicate community notice in claimed batch');
  const result = await database.rpc('get_community_chat_push_targets_v2', { p_notification_ids: selected.map(n => n.id) });
  if (result.error || !Array.isArray(result.data)) throw new Error('Community notification eligibility could not be confirmed');
  for (const row of result.data as CommunityChatPushTarget[]) {
    const notice = expected.get(row?.notification_id);
    if (!notice || targets.has(notice.id) || row.user_id !== notice.user_id || typeof row.eligible !== 'boolean'
      || !['topic', 'broadcast', 'legacy'].includes(row.source_kind)) throw new Error('Community notification target did not match');
    if (row.source_kind === 'topic') {
      if (notice.type !== 'new_message' || row.topic_id !== notice.topic_id || !uuid(row.topic_id) || row.broadcast_id !== null
        || row.eligible && !uuid(row.community_id)) throw new Error('Topic notification source did not match');
    } else if (notice.type !== 'community_broadcast' || row.topic_id !== null
      || row.source_kind === 'legacy' && (row.community_id !== null || row.broadcast_id !== null)
      || row.source_kind === 'broadcast' && (!uuid(row.community_id) || !uuid(row.broadcast_id))) throw new Error('Announcement notification source did not match');
    const reaction = row.message_id != null || row.message_source != null || row.destination_topic_id != null;
    if (reaction && (!uuid(row.message_id) || row.message_source !== row.source_kind
      || row.source_kind === 'topic' && row.destination_topic_id !== row.topic_id
      || row.source_kind === 'broadcast' && row.message_id !== row.broadcast_id
      || row.destination_topic_id != null && !uuid(row.destination_topic_id))) {
      throw new Error('Reaction notification source did not match');
    }
    targets.set(notice.id, row);
  }
  if (targets.size !== expected.size) throw new Error('Community notification target is missing');
  return targets;
}
export function communityChatPushData(target: CommunityChatPushTarget) {
  if (target.source_kind === 'legacy') return { type: 'community_broadcast' };
  const reaction = target.message_id ? { reactionMessageId: target.message_id, reactionMessageSource: target.message_source } : {};
  return target.source_kind === 'topic'
    ? { type: 'new_message', notificationId: target.notification_id, communityId: target.community_id, topicId: target.topic_id, ...reaction }
    : { type: 'community_broadcast', notificationId: target.notification_id, communityId: target.community_id, communityBroadcastId: target.broadcast_id, ...(target.destination_topic_id ? { topicId: target.destination_topic_id } : {}), ...reaction };
}
