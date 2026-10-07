import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';

export interface ChatReactionRow {
  message_id: string;
  user_id: string;
  reaction: string;
}

// Loaded history can exceed the server's URL and response-row limits.
// Keep every read membership-scoped and commit only the complete snapshot.
const MESSAGE_BATCH_SIZE = 200;
const REACTION_PAGE_SIZE = 500;

export async function readLoadedChatReactions(
  messageIds: readonly string[],
  isCurrent: () => boolean,
): Promise<ChatReactionRow[] | null> {
  return readLoadedReactions('message_reactions', messageIds, isCurrent);
}

export async function readLoadedTopicReactions(
  messageIds: readonly string[],
  isCurrent: () => boolean,
): Promise<ChatReactionRow[] | null> {
  return readLoadedReactions('community_topic_message_reactions', messageIds, isCurrent);
}

async function readLoadedReactions(
  table: 'message_reactions' | 'community_topic_message_reactions',
  messageIds: readonly string[],
  isCurrent: () => boolean,
): Promise<ChatReactionRow[] | null> {
  const ids = [...new Set(messageIds)];
  const rows: ChatReactionRow[] = [];
  for (let batch = 0; batch < ids.length; batch += MESSAGE_BATCH_SIZE) {
    const selected = ids.slice(batch, batch + MESSAGE_BATCH_SIZE);
    for (let offset = 0; ; offset += REACTION_PAGE_SIZE) {
      if (!isCurrent()) return null;
      const { data, error } = await requestWithDeadline(supabase
        .from(table)
        .select('message_id, user_id, reaction')
        .in('message_id', selected)
        .order('message_id', { ascending: true })
        .order('user_id', { ascending: true })
        .range(offset, offset + REACTION_PAGE_SIZE - 1), 12_000);
      if (!isCurrent()) return null;
      if (error) throw error;
      const page = (data ?? []) as ChatReactionRow[];
      rows.push(...page);
      if (page.length < REACTION_PAGE_SIZE) break;
    }
  }
  return rows;
}
