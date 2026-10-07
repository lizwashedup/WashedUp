const isId = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
/** Route only explicit community payloads; existing room admission remains authoritative. */
export function communityChatPushRoute(data: Record<string, unknown>, enabled: boolean): string | null {
  if (!(data.type === 'community_broadcast' || data.type === 'new_message' && data.topicId != null)) return null;
  const fallback = '/(tabs)/chats';
  // Existing topic pushes were reachable regardless of the community feature flag.
  if (!enabled && data.topicId == null) return fallback;
  if (data.notificationId != null && !isId(data.notificationId)) return fallback;
  const reaction = data.reactionMessageId != null || data.reactionMessageSource != null;
  if (reaction && (!isId(data.reactionMessageId) || !['broadcast', 'topic'].includes(data.reactionMessageSource as string)
    || data.type === 'new_message' && data.reactionMessageSource !== 'topic'
    || data.type === 'community_broadcast' && (data.reactionMessageSource !== 'broadcast' || data.reactionMessageId !== data.communityBroadcastId))) return fallback;
  const route = data.topicId != null ? isId(data.topicId) ? `/community-topic/${data.topicId}` : null
    : isId(data.communityId) && isId(data.communityBroadcastId) ? `/community-thread/${data.communityId}` : null;
  if (!route) return fallback;
  const query = reaction ? `?reactionMessageId=${data.reactionMessageId}&reactionMessageSource=${data.reactionMessageSource}` : '';
  return route + query;
}
