import { validOptionalMentionDocument, trimChatMentionDocument, sameChatMentionIdentity, type ChatMentionDocument } from './chatMentionIdentity';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { getBlockedWith } from './blocking';
import { requestWithDeadline } from './requestWithDeadline';
import type { CommunityOperationScope } from './communityChat';
export type TopicComposerRoom = string | { kind: 'main' | 'reply'; id: string };
function roomId(room: TopicComposerRoom) { return typeof room === 'string' ? room : room.id; }
function roomKind(room: TopicComposerRoom) { return typeof room === 'string' ? 'topic' : room.kind; }
function isMainRoom(room: TopicComposerRoom) { return roomKind(room) === 'main'; }
export type TopicDraftReply = { id: string; body: string; sender_name: string | null };
export type TopicDraftEdit = { mentions?: ChatMentionDocument | null; id: string; body: string; edited_at: string | null };
export type TopicDraftAttempt = { mentions?: ChatMentionDocument | null; id: string; kind: 'send' | 'edit'; text: string; replyId: string | null; edit: TopicDraftEdit | null };
export type TopicComposerDraft = { attemptDetached?: boolean; mentions?: ChatMentionDocument | null; text: string; reply: TopicDraftReply | null; edit: TopicDraftEdit | null; attempt: TopicDraftAttempt | null };
export const emptyTopicComposer = (): TopicComposerDraft => ({ text: '', reply: null, edit: null, attempt: null });
const uuid = (s: unknown): s is string => typeof s === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(s);
const text = (s: unknown): s is string => typeof s === 'string' && s.length <= 4000;
function validEdit(e: any) { return e === null || !!e && uuid(e.id) && text(e.body) && validOptionalMentionDocument(e.body, e.mentions) && (e.edited_at === null || typeof e.edited_at === 'string' && Number.isFinite(Date.parse(e.edited_at))); }
function valid(d: any): d is TopicComposerDraft {
  const a=d?.attempt;
  return !!d && (d.attemptDetached === undefined || typeof d.attemptDetached === 'boolean' && (!d.attemptDetached || !!a)) && text(d.text) && validOptionalMentionDocument(d.text, d.mentions) && validEdit(d.edit) && (d.reply===null || !!d.reply && uuid(d.reply.id) && text(d.reply.body) && (d.reply.sender_name===null || typeof d.reply.sender_name==='string')) && !(d.reply && d.edit)
    && (a===null || !!a && uuid(a.id) && ['send','edit'].includes(a.kind) && text(a.text) && validOptionalMentionDocument(a.text, a.mentions) && !!a.text.trim() && (a.replyId===null || uuid(a.replyId)) && validEdit(a.edit) && (a.kind==='edit' ? !!a.edit && a.edit.id===a.id && a.replyId===null : a.edit===null));
}
const writes=new Map<string,Promise<unknown>>(), retained=new Map<string,TopicComposerDraft>();
function current(owner:CommunityOperationScope){if(!owner.isCurrent()||!uuid(owner.userId))throw Error('This conversation visit changed.');}
function key(topicId:TopicComposerRoom,owner:CommunityOperationScope){current(owner);if(!uuid(roomId(topicId)))throw Error('This conversation is unavailable.');return `${roomKind(topicId)==='reply'?'community-reply-composer':isMainRoom(topicId)?'community-main-composer':'topic-composer'}:v1:${owner.userId}:${roomId(topicId)}`;}
async function serial<T>(k:string,work:()=>Promise<T>){const next=(writes.get(k)??Promise.resolve()).catch(()=>undefined).then(work);writes.set(k,next);try{return await next;}finally{if(writes.get(k)===next)writes.delete(k);}}
export async function readTopicComposer(topicId:TopicComposerRoom,owner:CommunityOperationScope){const k=key(topicId,owner);return serial(k,async()=>{current(owner);const memory=retained.get(k);if(memory)return {draft:memory,unsaved:true};const raw=await AsyncStorage.getItem(k);current(owner);if(raw===null)return {draft:emptyTopicComposer(),unsaved:false};const r=JSON.parse(raw);if(r.version!==1||r.topicId!==roomId(topicId)||(r.roomKind??'topic')!==roomKind(topicId)||r.userId!==owner.userId||!valid(r.draft))throw Error('Your saved message could not be read.');return {draft:r.draft as TopicComposerDraft,unsaved:false};});}
export async function saveTopicComposer(topicId:TopicComposerRoom,owner:CommunityOperationScope,draft:TopicComposerDraft){const k=key(topicId,owner);if(!valid(draft))throw Error('Your message could not be kept.');const snapshot=JSON.parse(JSON.stringify(draft)) as TopicComposerDraft;return serial(k,async()=>{try{await AsyncStorage.setItem(k,JSON.stringify({version:1,topicId:roomId(topicId),...(typeof topicId!=='string'?{roomKind:topicId.kind}:{}),userId:owner.userId,draft:snapshot}));retained.delete(k);}catch(error){retained.set(k,snapshot);throw error;}});}
export function prepareTopicComposer(d:TopicComposerDraft):TopicDraftAttempt {if(d.attempt)return d.attempt;if(!d.text.trim())throw Error('Write a message first.');return {id:d.edit?.id??Crypto.randomUUID(),kind:d.edit?'edit':'send',text:d.text.trim(),replyId:d.reply?.id??null,edit:d.edit,...(d.mentions!==undefined?{mentions:d.mentions?trimChatMentionDocument(d.text,d.mentions):null}:{})};}
export function finishTopicComposer(d:TopicComposerDraft,a:TopicDraftAttempt):TopicComposerDraft {if(JSON.stringify(d.attempt)!==JSON.stringify(a))return d;if(d.attemptDetached)return {...d,attempt:null,attemptDetached:false};const same=d.text.trim()===a.text && sameChatMentionIdentity(a.text,d.mentions?trimChatMentionDocument(d.text,d.mentions):null,a.mentions) && (a.kind==='edit'?d.edit?.id===a.id:!d.edit && (d.reply?.id??null)===a.replyId);return same?emptyTopicComposer():{...d,attempt:null};}
type StoredComposerMessage = { id: string; sender_id: string; body: string; kind?: string; reply_to_message_id?: string | null; edited_at: string | null; mention_data?: unknown };
async function loadOriginalMessage(topicId: TopicComposerRoom, id: string, owner: CommunityOperationScope, includeMentions = false, replyParent = false) {
  current(owner);
  const session = await supabase.auth.getSession();
  current(owner);
  if (session.error) throw session.error;
  if (session.data.session?.user.id !== owner.userId || !session.data.session.access_token) throw Error('This account changed.');
  const main = isMainRoom(topicId);
  const reply = roomKind(topicId) === 'reply';
  const table = supabase.from(replyParent || main ? 'community_broadcasts' : reply ? 'community_broadcast_replies' : 'community_topic_messages');
  const columns = replyParent ? 'id,sender_id,body,kind' : reply ? 'id,broadcast_id,sender_id,body' : main
    ? 'id,community_id,sender_id,body,kind,edited_at'
    : 'id,topic_id,sender_id,body,reply_to_message_id,edited_at';
  let query = table.select(columns + (includeMentions ? ',mention_data' : '')).eq('id', id);
  if (!replyParent) query = query.eq(main ? 'community_id' : reply ? 'broadcast_id' : 'topic_id', roomId(topicId));
  if (main) query = query.eq('kind', 'message');
  const result = await query.maybeSingle()
    .setHeader('Authorization', `Bearer ${session.data.session.access_token}`);
  // Column selection differs by storage table; both adapters return this common shape.
  const message = result.data as unknown as StoredComposerMessage | null;
  current(owner);
  if (result.error) throw result.error;
  if (message && message.sender_id) {
    if (main && message.kind !== 'message') throw Error('The original message is unavailable.');
    const blocked = await getBlockedWith(owner.userId, [message.sender_id]);
    current(owner);
    if (blocked.has(message.sender_id)) throw Error('The original message is unavailable.');
  }
  return message;
}
async function readMessage(topicId: TopicComposerRoom, id: string, owner: CommunityOperationScope, includeMentions = false, replyParent = false) {
  // Bound the entire preflight, including session and block checks. A deadline
  // only ends this read; the saved draft/uncertain attempt is never discarded.
  let active = true;
  const readOwner = { userId: owner.userId, isCurrent: () => active && owner.isCurrent() };
  try {
    const message = await requestWithDeadline(loadOriginalMessage(topicId, id, readOwner, includeMentions, replyParent), 12_000);
    current(readOwner);
    return message;
  } finally {
    active = false;
  }
}
export async function checkTopicComposerAttempt(topicId:TopicComposerRoom,a:TopicDraftAttempt,owner:CommunityOperationScope){const m=await readMessage(topicId,a.id,owner,a.mentions!==undefined);if(!m)return false;if(m.sender_id!==owner.userId)throw Error('Your original message is unavailable.');if(m.body!==a.text)return false;if(a.mentions!==undefined&&!sameChatMentionIdentity(a.text,a.mentions,('mention_data' in m ? m.mention_data : undefined)))return false;if(a.kind==='send'&&(m.reply_to_message_id??null)!==a.replyId)throw Error('Your original reply could not be confirmed.');return true;}
export async function verifyTopicComposerTarget(topicId:TopicComposerRoom,a:TopicDraftAttempt,owner:CommunityOperationScope){if(roomKind(topicId)==='reply'){if(a.kind!=='send'||a.edit||a.replyId)throw Error('This reply cannot be sent.');const parent=await readMessage(topicId,roomId(topicId),owner,false,true);if(!parent)throw Error('The original message is no longer available. Your draft is kept.');return;}const id=a.edit?.id??a.replyId;if(!id)return;const m=await readMessage(topicId,id,owner,a.edit?.mentions!==undefined);if(!m)throw Error('The original message is no longer available. Your draft is kept.');if(a.edit&&(m.sender_id!==owner.userId||m.body!==a.edit.body||(m.edited_at??null)!==a.edit.edited_at||a.edit.mentions!==undefined&&!sameChatMentionIdentity(m.body,a.edit.mentions,('mention_data' in m ? m.mention_data : undefined))))throw Error('The original message changed. Your edit is kept; check the conversation before changing it.');}
