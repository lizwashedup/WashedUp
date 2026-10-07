import { supabase } from './supabase';
import type { CommunityChatRowData, CommunityOperationScope } from './communityChat';
import { getCommunityChatPreference } from './communityChatPreference';

export type CommunityNotificationContext = { kind: 'persistent' | 'event'; communityId: string };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
async function account(scope: CommunityOperationScope) {
  if (!scope.isCurrent()) throw Error('This chat changed.');
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!scope.isCurrent() || data.user?.id !== scope.userId) throw Error('This chat account changed.');
}
/** Staged context read includes immutable event provenance. A cleared event FK
 * must never cause an old attendee conversation to inherit community mute. */
export async function getCommunityTopicNotificationContext(topicId: string, scope: CommunityOperationScope): Promise<CommunityNotificationContext> {
  if (!uuid(topicId)) throw Error('This chat is unavailable.');
  await account(scope);
  const { data, error } = await supabase.from('community_topics')
    .select('id,community_id,explore_event_id,original_event_id').eq('id', topicId).maybeSingle();
  await account(scope);
  if (error) throw error;
  if (!data || data.id !== topicId || !uuid(data.community_id)
    || !(data.explore_event_id === null || uuid(data.explore_event_id))
    || !(data.original_event_id === null || uuid(data.original_event_id))) throw Error('This chat notification context could not be confirmed.');
  return { communityId: data.community_id, kind: data.original_event_id !== null || data.explore_event_id !== null ? 'event' : 'persistent' };
}
/** Preserve every row and unread count if one setting is unavailable. Reads
 * are bounded to three at once and only target authorized community parents. */
export async function getCommunityInboxNotificationState(rows: readonly CommunityChatRowData[], scope: CommunityOperationScope): Promise<CommunityChatRowData[]> {
  await account(scope);
  const ids = [...new Set(rows.filter(row => row.kind === 'community').map(row => row.communityId))];
  const states = new Map<string, boolean | null>();
  for (let i = 0; i < ids.length; i += 3) {
    await Promise.all(ids.slice(i, i + 3).map(async id => {
      try { states.set(id, (await getCommunityChatPreference(id, scope)).muted); }
      catch { if (!scope.isCurrent()) throw Error('This chat account changed.'); states.set(id, null); }
    }));
  }
  await account(scope);
  return rows.map(row => states.has(row.communityId) && (row.kind === 'community' || row.eventId === null)
    ? { ...row, communityMuted: states.get(row.communityId)! } : row);
}
