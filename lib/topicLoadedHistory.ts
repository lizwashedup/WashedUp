import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';
import type { TopicMessage } from './communityChat';

export type TopicMessageEdit = Pick<TopicMessage, 'id' | 'body' | 'edited_at' | 'mention_data'>;

/** Reconcile the mutable fields of already-loaded older rows after reconnect.
 * IDs come from this visit; topic RLS and the explicit room filter still apply. */
export async function readLoadedTopicEdits(
  topicId: string, messageIds: readonly string[], isCurrent: () => boolean,
): Promise<TopicMessageEdit[] | null> {
  const ids = [...new Set(messageIds)];
  const rows: TopicMessageEdit[] = [];
  for (let offset = 0; offset < ids.length; offset += 200) {
    if (!isCurrent()) return null;
    const { data, error } = await requestWithDeadline(supabase
      .from('community_topic_messages')
      .select('id, body, edited_at, mention_data')
      .eq('topic_id', topicId)
      .in('id', ids.slice(offset, offset + 200)), 12_000);
    if (!isCurrent()) return null;
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}
