import { validOptionalMentionDocument, sameChatMentionIdentity, type ChatMentionDocument } from './chatMentionIdentity';
import { supabase } from './supabase';
import type { ChatOperationScope, ConversationKey } from '../hooks/useChat';

export class ChatEditRefusedError extends Error {
  constructor(reason: string) {
    super(reason === 'changed' ? 'The original message changed. Your edit is kept; check the conversation before changing it.'
      : reason === 'closed' ? 'This conversation is read-only. Your edit is kept.'
      : reason === 'invalid' ? 'Write a message of 1 to 1,000 characters.'
      : 'This message is no longer available to edit. Your draft is kept.');
    this.name = 'ChatEditRefusedError';
  }
}
export const isChatEditRefused = (error: unknown): error is ChatEditRefusedError => error instanceof ChatEditRefusedError;
export async function editOwnChatMessage(room: ConversationKey, messageId: string, expectedContent: string, content: string, owner: ChatOperationScope, mentions?: ChatMentionDocument | null, expectedMentions?: ChatMentionDocument | null) {
  const current = () => { if (!owner.isCurrent()) throw Error('This conversation visit changed.'); };
  current();
  if (!validOptionalMentionDocument(content, mentions) || !validOptionalMentionDocument(expectedContent, expectedMentions)) throw Error('Your selected mentions could not be checked.');
  const withMentions = mentions != null || expectedMentions != null;
  const session = await supabase.auth.getSession();
  current();
  if (session.error) throw session.error;
  if (session.data.session?.user.id !== owner.userId || !session.data.session.access_token) throw Error('This account changed.');
  const result = await supabase.rpc(withMentions ? 'edit_own_chat_message_with_mentions' : 'edit_own_chat_message', {
    p_message_id: messageId, p_kind: room.kind, p_conversation_id: room.id,
    p_expected_content: expectedContent, p_content: content,
    ...(withMentions ? {p_expected_mentions: expectedMentions ?? null, p_mentions: mentions ?? null} : {}),
  }).setHeader('Authorization', `Bearer ${session.data.session.access_token}`);
  current();
  if (result.error) throw result.error;
  const receipt = result.data;
  if (receipt && ['unavailable', 'closed', 'invalid', 'changed'].includes(receipt.status)) throw new ChatEditRefusedError(receipt.status);
  if (receipt?.status !== 'saved' || receipt.id !== messageId || receipt.content !== content || withMentions && !sameChatMentionIdentity(content, mentions, receipt.mention_data)) throw Error('The edit could not be confirmed. Your draft is kept.');
  return true;
}
