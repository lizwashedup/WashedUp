import { requestWithDeadline, RequestDeadlineError } from './requestWithDeadline';
import { supabase } from './supabase';

export class MessageStillVisibleError extends Error {
  constructor() { super('The message is still here. You can try removing it again.'); }
}

export class UnconfirmedMessageRemovalError extends Error {
  constructor() { super('Reopen this chat to check whether the message was removed.'); }
}

type Conversation = { kind: 'event' | 'circle' | 'topic'; id: string };

/** Match the original row. Callers supply the author; database policies determine who may remove it. */
export async function removeChatMessageFromSender(
  conversation: Conversation, messageId: string, senderId: string, assertCurrent: () => void,
): Promise<void> {
  const topic = conversation.kind === 'topic';
  const table = topic ? 'community_topic_messages' : 'messages';
  const author = topic ? 'sender_id' : 'user_id';
  const parent = topic ? 'topic_id' : conversation.kind === 'circle' ? 'circle_id' : 'event_id';

  assertCurrent();
  const write = await requestWithDeadline(supabase.from(table).delete()
    .eq('id', messageId).eq(author, senderId).eq(parent, conversation.id).select('id').maybeSingle(), 12_000)
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
  const read = await requestWithDeadline(supabase.from(table).select('id')
    .eq('id', messageId).eq(author, senderId).eq(parent, conversation.id).maybeSingle(), 8_000)
    .catch(() => null);
  assertCurrent();
  if (!read || read.error || read.data !== null && read.data?.id !== messageId) throw new UnconfirmedMessageRemovalError();
  if (read.data) throw new MessageStillVisibleError();
}
