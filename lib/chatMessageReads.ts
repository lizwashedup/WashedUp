import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';
import { mergeChatBurst, replaceNewestChatPage } from './chatPaging';
import type { ChatMessage } from './chatMessageModel';

export async function attachSenders(messages: any[]): Promise<ChatMessage[]> {
  const allIds = messages.map(m => m.user_id).filter(Boolean);
  const userIds = allIds.filter((id: string, i: number) => allIds.indexOf(id) === i);
  if (userIds.length === 0) return messages as ChatMessage[];

  const { data: profiles, error: profileError } = await requestWithDeadline(supabase
    .from('profiles_public')
    .select('id, first_name_display, profile_photo_url')
    .in('id', userIds), 12_000);
  if (profileError) throw profileError;

  const profileMap: Record<string, any> = {};
  (profiles ?? []).forEach((p: any) => {
    profileMap[p.id] = {
      id: p.id,
      first_name: p.first_name_display ?? null,
      avatar_url: p.profile_photo_url ?? null,
    };
  });

  return messages.map(m => ({
    ...m,
    message_type: m.message_type ?? 'user',
    sender: profileMap[m.user_id] ?? null,
  })) as ChatMessage[];
}

// Reconcile a newest-page snapshot without undoing activity that happened
// while the read was pending. Object identity distinguishes the unchanged
// snapshot rows from realtime/local edits; UUIDs still identify actual sends.
export function reconcileNewestMessages(
  current: ChatMessage[],
  page: ChatMessage[],
  startedWith: ReadonlyMap<string, ChatMessage>,
  hasMore: boolean,
): ChatMessage[] {
  const currentById = new Map(current.map(message => [message.id, message]));
  const persisted = current.filter(message => !message.id.startsWith('optimistic-'));
  const unchanged = persisted.filter(message => startedWith.get(message.id) === message);
  const changed = persisted.filter(message => startedWith.get(message.id) !== message);
  const refreshed = (hasMore ? replaceNewestChatPage(unchanged, page) : page).filter(message =>
    // A row removed locally during the request must not reappear from its
    // earlier server snapshot. Keep the original page boundary for history.
    !startedWith.has(message.id) || currentById.has(message.id),
  );
  const confirmedIds = new Set([...refreshed, ...changed].map(message => message.id));
  const optimistic = current.filter(message => message.id.startsWith('optimistic-') &&
    !confirmedIds.has(message.id.slice('optimistic-'.length)));
  return mergeChatBurst(mergeChatBurst(refreshed, changed), optimistic);
}

