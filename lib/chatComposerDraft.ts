import { validOptionalMentionDocument, trimChatMentionDocument, sameChatMentionIdentity, type ChatMentionDocument } from './chatMentionIdentity';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { getBlockedWith } from './blocking';
import { requestWithDeadline } from './requestWithDeadline';
import type { ChatOperationScope, ConversationKey } from '../hooks/useChat';

export type ChatDraftReply = { id: string; content: string; senderName: string };
export type ChatDraftEdit = { mentions?: ChatMentionDocument | null; id: string; content: string };
export type ChatDraftAttempt = { mentions?: ChatMentionDocument | null; id: string; text: string; replyId: string | null; edit: ChatDraftEdit | null };
export type ChatComposerDraft = { attemptDetached?: boolean; mentions?: ChatMentionDocument | null; text: string; reply: ChatDraftReply | null; edit: ChatDraftEdit | null; attempt: ChatDraftAttempt | null };
export const emptyChatComposer = (): ChatComposerDraft => ({ text: '', reply: null, edit: null, attempt: null });
const identifier = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100 && /^[\w-]+$/.test(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 10000;
const validEdit = (v: any): boolean => v === null || !!v && identifier(v.id) && text(v.content) && validOptionalMentionDocument(v.content, v.mentions);
function valid(d: any): d is ChatComposerDraft {
  const a = d?.attempt;
  return !!d && (d.attemptDetached === undefined || typeof d.attemptDetached === 'boolean' && (!d.attemptDetached || !!a)) && text(d.text) && validOptionalMentionDocument(d.text, d.mentions) && validEdit(d.edit) && !(d.reply && d.edit)
    && (d.reply === null || !!d.reply && identifier(d.reply.id) && text(d.reply.content) && text(d.reply.senderName))
    && (a === null || !!a && identifier(a.id) && text(a.text) && validOptionalMentionDocument(a.text, a.mentions) && !!a.text.trim() && validEdit(a.edit)
      && (a.replyId === null || identifier(a.replyId)) && (!a.edit || a.edit.id === a.id && a.replyId === null));
}
const writes = new Map<string, Promise<unknown>>();
const retained = new Map<string, ChatComposerDraft>();
function current(owner: ChatOperationScope) {
  if (!owner.isCurrent() || !identifier(owner.userId)) throw Error('This conversation visit changed.');
}
function key(room: ConversationKey, owner: ChatOperationScope) {
  current(owner);
  if (!identifier(room.id) || !['event', 'circle'].includes(room.kind)) throw Error('This conversation is unavailable.');
  return `chat-composer:v1:${owner.userId}:${room.kind}:${room.id}`;
}
async function serial<T>(k: string, work: () => Promise<T>): Promise<T> {
  const next = (writes.get(k) ?? Promise.resolve()).catch(() => undefined).then(work);
  writes.set(k, next);
  try { return await next; } finally { if (writes.get(k) === next) writes.delete(k); }
}
export async function readChatComposer(room: ConversationKey, owner: ChatOperationScope) {
  const k = key(room, owner);
  return serial(k, async () => {
    current(owner);
    const memory = retained.get(k);
    if (memory) return { draft: memory, unsaved: true };
    const raw = await AsyncStorage.getItem(k);
    current(owner);
    if (raw === null) return { draft: emptyChatComposer(), unsaved: false };
    const saved = JSON.parse(raw);
    if (saved.version !== 1 || saved.userId !== owner.userId || saved.kind !== room.kind || saved.id !== room.id || !valid(saved.draft)) {
      throw Error('Your saved message could not be read.');
    }
    return { draft: saved.draft as ChatComposerDraft, unsaved: false };
  });
}
export async function saveChatComposer(room: ConversationKey, owner: ChatOperationScope, draft: ChatComposerDraft) {
  const k = key(room, owner);
  if (!valid(draft)) throw Error('Your message could not be kept.');
  const snapshot = JSON.parse(JSON.stringify(draft)) as ChatComposerDraft;
  // An accepted write finishes under its original account/room after navigation.
  return serial(k, async () => {
    try {
      await AsyncStorage.setItem(k, JSON.stringify({ version: 1, userId: owner.userId, ...room, draft: snapshot }));
      retained.delete(k);
    } catch (error) { retained.set(k, snapshot); throw error; }
  });
}
export function prepareChatComposer(draft: ChatComposerDraft): ChatDraftAttempt {
  if (draft.attempt) return draft.attempt;
  if (!draft.text.trim()) throw Error('Write a message first.');
  return { id: draft.edit?.id ?? Crypto.randomUUID(), text: draft.text.trim(), replyId: draft.reply?.id ?? null, edit: draft.edit,
    ...(draft.mentions ? { mentions: trimChatMentionDocument(draft.text, draft.mentions) } : {}) };
}
export function finishChatComposer(draft: ChatComposerDraft, attempt: ChatDraftAttempt): ChatComposerDraft {
  if (JSON.stringify(draft.attempt) !== JSON.stringify(attempt)) return draft;
  if (draft.attemptDetached) return { ...draft, attempt: null, attemptDetached: false };
  const sameContext = attempt.edit ? draft.edit?.id === attempt.id : !draft.edit && (draft.reply?.id ?? null) === attempt.replyId;
  const sameMentions = sameChatMentionIdentity(attempt.text, draft.mentions ? trimChatMentionDocument(draft.text, draft.mentions) : null, attempt.mentions);
  if (sameContext && (!draft.text || draft.text.trim() === attempt.text && sameMentions)) return emptyChatComposer();
  return { ...draft, attempt: null };
}
async function loadOriginalMessage(room: ConversationKey, id: string, owner: ChatOperationScope, includeMentions = false) {
  current(owner);
  const session = await supabase.auth.getSession();
  current(owner);
  if (session.error) throw session.error;
  if (session.data.session?.user.id !== owner.userId || !session.data.session.access_token) throw Error('This account changed.');
  const table = supabase.from('messages');
  const query = includeMentions
    ? table.select('id,user_id,content,reply_to_message_id,message_type,image_url,mention_data')
    : table.select('id,user_id,content,reply_to_message_id,message_type,image_url');
  const result = await query
    .eq(room.kind === 'event' ? 'event_id' : 'circle_id', room.id).eq('id', id).maybeSingle()
    .setHeader('Authorization', `Bearer ${session.data.session.access_token}`);
  current(owner);
  if (result.error) throw result.error;
  if (result.data) {
    const blocked = await getBlockedWith(owner.userId, [result.data.user_id]);
    current(owner);
    if (blocked.has(result.data.user_id)) throw Error('The original message is unavailable.');
  }
  return result.data;
}
async function readMessage(room: ConversationKey, id: string, owner: ChatOperationScope, includeMentions = false) {
  const message = await requestWithDeadline(loadOriginalMessage(room, id, owner, includeMentions), 12_000);
  current(owner);
  return message;
}
export async function checkChatComposerAttempt(room: ConversationKey, attempt: ChatDraftAttempt, owner: ChatOperationScope) {
  const message = await readMessage(room, attempt.id, owner, attempt.mentions !== undefined);
  if (!message) return false;
  if (message.user_id !== owner.userId || message.message_type !== 'user' || message.image_url) throw Error('Your original message could not be confirmed.');
  if (message.content !== attempt.text) return false;
  if (attempt.mentions !== undefined && !sameChatMentionIdentity(attempt.text, attempt.mentions, ('mention_data' in message ? message.mention_data : undefined))) return false;
  if (!attempt.edit && (message.reply_to_message_id ?? null) !== attempt.replyId) throw Error('Your original reply could not be confirmed.');
  return true;
}
export async function verifyChatComposerTarget(room: ConversationKey, attempt: ChatDraftAttempt, owner: ChatOperationScope) {
  const target = attempt.edit?.id ?? attempt.replyId;
  if (!target) return;
  const message = await readMessage(room, target, owner, attempt.edit?.mentions !== undefined);
  if (!message) throw Error('The original message is no longer available. Your draft is kept.');
  if (attempt.edit && (message.user_id !== owner.userId || message.content !== attempt.edit.content || message.message_type !== 'user' || message.image_url
    || attempt.edit.mentions !== undefined && !sameChatMentionIdentity(message.content, attempt.edit.mentions, ('mention_data' in message ? message.mention_data : undefined)))) {
    throw Error('The original message changed. Your edit is kept; check the conversation before changing it.');
  }
}
