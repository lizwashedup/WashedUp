import { requestWithDeadline, RequestDeadlineError } from './requestWithDeadline';
import { supabase } from './supabase';

export class MessageStillVisibleError extends Error {
  constructor() { super('The message is still here. You can try removing it again.'); }
}

export class UnconfirmedMessageRemovalError extends Error {
  constructor() { super('Reopen this chat to check whether the message was removed.'); }
}

const rowFields = {
  event: {table:'messages', author:'user_id', parent:'event_id'},
  circle: {table:'messages', author:'user_id', parent:'circle_id'},
  topic: {table:'community_topic_messages', author:'sender_id', parent:'topic_id'},
  main: {table:'community_broadcasts', author:'sender_id', parent:'community_id'},
} as const;
type Conversation = { kind: keyof typeof rowFields; id: string };

/** Match the original row. Callers supply the author; database policies determine who may remove it. */
export async function removeChatMessageFromSender(
  conversation: Conversation, messageId: string, senderId: string, assertCurrent: () => void,
): Promise<void> {
  const {table, author, parent} = rowFields[conversation.kind];
  const row = (operation: 'remove' | 'check') => {
    const source = supabase.from(table);
    const query = operation === 'remove' ? source.delete().select('id') : source.select('id');
    const selected = query.eq('id',messageId).eq(author,senderId).eq(parent,conversation.id);
    // Main chat also contains introductions and community announcements.
    return (conversation.kind === 'main' ? selected.eq('kind','message') : selected).maybeSingle();
  };
  assertCurrent();
  const write = await requestWithDeadline(row('remove'), 12_000)
    .catch((error: unknown) => {
      assertCurrent();
      if (error instanceof RequestDeadlineError) throw error;
      return null; // The server may have committed before the connection closed.
    });
  assertCurrent();
  if (write?.error?.code === '42501') throw write.error;
  if (write && !write.error && write.data?.id === messageId) return;

  // An empty DELETE response can also mean the write affected zero rows.
  // Only an authorized, successful read establishes absence from this chat.
  const read = await requestWithDeadline(row('check'), 8_000)
    .catch(() => null);
  assertCurrent();
  if (!read || read.error || read.data !== null && read.data?.id !== messageId) throw new UnconfirmedMessageRemovalError();
  if (read.data) throw new MessageStillVisibleError();
}
