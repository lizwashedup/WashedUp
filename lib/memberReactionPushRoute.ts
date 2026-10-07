const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);

/** Ordinary messages retain their established routes; reactions keep identity. */
export function memberReactionPushRoute(data: Record<string, unknown>): string | null {
  if (data.type !== 'new_message' || data.topicId != null ||
    data.reactionMessageId == null && data.reactionMessageSource == null) return null;
  if (data.reactionMessageSource !== 'chat' || !uuid(data.reactionMessageId) ||
    (data.eventId != null) === (data.circleId != null)) return '/(tabs)/chats';
  const circle = data.circleId != null, id = circle ? data.circleId : data.eventId;
  if (!uuid(id)) return '/(tabs)/chats';
  return `/(tabs)/chats/${circle ? 'circle/' : ''}${id}?reactionMessageId=${data.reactionMessageId}&reactionMessageSource=chat`;
}
