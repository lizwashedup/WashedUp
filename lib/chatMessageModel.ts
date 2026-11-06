import type { ChatMentionDocument } from './chatMentionIdentity';

export interface MessageReaction {
  user_id: string;
  reaction: string;
}

export interface ReplyTo {
  id: string;
  content: string;
  sender_name: string | null;
}

export interface ChatMessage {
  mention_data?: ChatMentionDocument | null;
  id: string;
  // A message is parented by EITHER an event (plan) OR a circle, never both
  // (DB XOR constraint). Both optional here so the same shape serves both.
  event_id?: string | null;
  circle_id?: string | null;
  user_id: string;
  content: string;
  message_type: 'user' | 'system' | 'location' | 'audio';
  image_url?: string | null;
  audio_url?: string | null;
  duration_seconds?: number | null;
  created_at: string;
  reply_to_message_id?: string | null;
  // A system message carrying ref_event_id renders as a compact plan card
  // (delivered by invite_person_to_plan / invite_people_to_plan).
  ref_event_id?: string | null;
  reply_to?: ReplyTo | null;
  reactions?: MessageReaction[];
  sender?: {
    id: string;
    first_name: string | null;
    avatar_url: string | null;
  } | null;
}

// A successful plural history read returns an array, including for an empty
// room. A missing representation must leave the page and cursor retryable.
export function requireMemberHistoryPage(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) throw new Error('Chat history was not returned.');
  return value;
}

/**
 * A chat conversation is keyed by either a plan (event) or a circle. The hook
 * switches its data source, realtime channel, and read path on this key. Plan
 * chats behave exactly as before; the circle branch is reachable only behind
 * GROUPS_ENABLED + the gated circle route.
 */
export type ConversationKey =
  | { kind: 'event'; id: string }
  | { kind: 'circle'; id: string };

/** A caller may additionally retire an entry when its admission gate closes. */
export interface ChatOperationScope {
  readonly userId: string;
  readonly isCurrent: () => boolean;
}

export class ObsoleteChatOperationError extends Error {
  constructor() {
    super('This chat action belongs to a previous visit.');
    this.name = 'ObsoleteChatOperationError';
  }
}
export function isObsoleteChatOperation(error: unknown): error is ObsoleteChatOperationError {
  return error instanceof ObsoleteChatOperationError;
}
export type ChatReactionIntent = { selected: string; desired: string | null; scope: ChatOperationScope };

export class UnconfirmedChatReactionError extends Error {
  constructor(readonly retry: () => Promise<void>) {
    super('We could not confirm your reaction. Retry checks first and keeps the same change.');
    this.name = 'UnconfirmedChatReactionError';
  }
}
export function isUnconfirmedChatReaction(error: unknown): error is UnconfirmedChatReactionError {
  return error instanceof UnconfirmedChatReactionError;
}

