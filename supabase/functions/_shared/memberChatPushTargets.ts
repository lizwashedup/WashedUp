/** Recheck Plan/Circle (including DM) access at the existing dispatch boundary. */
export interface MemberChatNotice {
  id: string; user_id: string; type: string;
  event_id?: string | null; circle_id?: string | null; topic_id?: string | null;
}
export interface MemberChatPushTarget {
  notification_id: string; user_id: string;
  event_id: string | null; circle_id: string | null; eligible: boolean;
  reaction_message_id: string | null;
}
export const isMemberChatPushNotice = (notice: MemberChatNotice) =>
  notice.type === 'new_message' && notice.topic_id == null && (notice.event_id != null || notice.circle_id != null);

export async function resolveMemberChatPushTargets(
  database: { rpc: (name: string, args: any) => PromiseLike<any> }, notices: MemberChatNotice[],
) {
  const selected = notices.filter(isMemberChatPushNotice);
  const targets = new Map<string, MemberChatPushTarget>();
  if (!selected.length) return targets;
  const expected = new Map(selected.map(notice => [notice.id, notice]));
  if (expected.size !== selected.length) throw new Error('Duplicate member chat notice in claimed batch');
  const result = await database.rpc('get_member_chat_push_targets_v2', { p_notification_ids: selected.map(notice => notice.id) });
  if (result.error || !Array.isArray(result.data)) throw new Error('Member chat notification eligibility could not be confirmed');
  for (const row of result.data as MemberChatPushTarget[]) {
    const notice = expected.get(row?.notification_id);
    if (!notice || targets.has(notice.id) || row.user_id !== notice.user_id || typeof row.eligible !== 'boolean'
      || row.event_id !== (notice.event_id ?? null) || row.circle_id !== (notice.circle_id ?? null)
      || row.reaction_message_id === undefined
      || row.reaction_message_id !== null && (!row.eligible || typeof row.reaction_message_id !== 'string'
        || !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(row.reaction_message_id))) {
      throw new Error('Member chat notification target did not match');
    }
    targets.set(notice.id, row);
  }
  if (targets.size !== expected.size) throw new Error('Member chat notification target is missing');
  return targets;
}

export function memberChatPushData(target: MemberChatPushTarget) {
  return { type: 'new_message', eventId: target.event_id, circleId: target.circle_id, topicId: null,
    ...(target.reaction_message_id ? { notificationId: target.notification_id,
      reactionMessageId: target.reaction_message_id, reactionMessageSource: 'chat' } : {}) };
}
