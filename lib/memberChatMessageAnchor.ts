import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';
import { getBlockedWith } from './blocking';
import { CHAT_NEWEST_PAGE_SIZE, olderChatFilter, toChronologicalChatPage } from './chatPaging';
import type { ChatMessage, ChatOperationScope, ConversationKey } from '../hooks/useChat';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export const parseMemberReactionAnchor = (id: unknown, source: unknown): string | null =>
  source === 'chat' && uuid(id) ? id.toLowerCase() : null;
export class MemberChatMessageUnavailableError extends Error {
  constructor() { super('This message is no longer available.'); this.name = 'MemberChatMessageUnavailableError'; }
}
const current = (scope: ChatOperationScope) => { if (!scope.userId || !scope.isCurrent()) throw Error('This message belongs to a previous visit.'); };

/** Read the surrounding window, preserving the gap to latest rather than
 * appending one old message to unrelated recent history. RLS still owns access. */
export async function getMemberChatAnchorWindow(key: ConversationKey, messageId: string, scope: ChatOperationScope) {
  current(scope);
  if (!uuid(key.id) || !uuid(messageId)) throw new MemberChatMessageUnavailableError();
  const parent = key.kind === 'circle' ? 'circle_id' : 'event_id';
  const columns = 'id,event_id,circle_id,user_id,content,message_type,image_url,audio_url,duration_seconds,created_at,reply_to_message_id,ref_event_id,mention_data';
  const query = () => { current(scope); return supabase.from('messages').select(columns).eq(parent, key.id); };
  const exact = async () => {
    const result = await requestWithDeadline(query().eq('id', messageId).maybeSingle(), 12_000);
    current(scope);
    if (result.error) throw result.error;
    const message = result.data as ChatMessage | null;
    if (!message || message.id !== messageId || message[parent] !== key.id) throw new MemberChatMessageUnavailableError();
    return message;
  };
  const target = await exact();
  const [before, after] = await Promise.all([
    requestWithDeadline(query().or(olderChatFilter(target)).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(CHAT_NEWEST_PAGE_SIZE), 12_000),
    requestWithDeadline(query().or(`created_at.gt.${target.created_at},and(created_at.eq.${target.created_at},id.gt.${target.id})`).order('created_at', { ascending: true }).order('id', { ascending: true }).limit(CHAT_NEWEST_PAGE_SIZE), 12_000),
  ]);
  current(scope);
  if (before.error || after.error) throw before.error ?? after.error;
  const candidates = [target, ...(before.data ?? []), ...(after.data ?? [])];
  const [checked, blocked] = await Promise.all([exact(), requestWithDeadline(getBlockedWith(scope.userId, candidates.map(message => message.user_id)), 12_000)]);
  current(scope);
  if (checked.created_at !== target.created_at || checked.user_id !== target.user_id || blocked.has(checked.user_id)) throw new MemberChatMessageUnavailableError();
  const older = (before.data ?? []) as ChatMessage[], newer = (after.data ?? []) as ChatMessage[];
  return {
    messages: toChronologicalChatPage([...older, checked, ...newer]).filter(message => !blocked.has(message.user_id)),
    hasMore: older.length === CHAT_NEWEST_PAGE_SIZE,
    olderCursor: older.at(-1) ?? null,
    upperCursor: newer.length === CHAT_NEWEST_PAGE_SIZE ? newer.at(-1)! : null,
    blockedIds: Object.fromEntries([...blocked].map(id => [id, true])) as Record<string, boolean>,
  };
}
