import { checkLatestMessageParents, PEER_ACTIVITY_LIMIT } from './inboxActivityResponse';
import { supabase } from './supabase';
import { formatChatPreview, type ChatPreview } from './chatPreview';
type ActivityMessage = {
  event_id?: string;
  circle_id?: string;
  user_id: string;
  created_at: string;
  content: string | null;
  image_url: string | null;
  audio_url: string | null;
  message_type: string | null;
};
type ActivityResponse = { data: { id: string; latest_message: ActivityMessage[] }[] | null; error: unknown };

type ScopedRead = <T>(work: PromiseLike<T>) => Promise<T>;

function blockFilter(blocked: ReadonlySet<string>): string {
  return '(' + [...blocked].map(id => '"' + id.replace(/["\\]/g, '\\$&') + '"').join(',') + ')';
}

// A blocked latest message still proves the joined conversation exists. Read
// the prior permitted snippet separately so filtering cannot hide the conversation.
export async function replaceBlockedGroupActivity(kind: 'event' | 'circle', rows: ChatPreview[], viewer: string, blocked: ReadonlySet<string>,
  names: ReadonlyMap<string, string>, read: ScopedRead): Promise<ChatPreview[]> {
  const affected = rows.filter(row => !row.is_dm && row.last_message_user_id && blocked.has(row.last_message_user_id));
  if (!affected.length) return rows;
  // Keep PostgREST URLs bounded. With a very long block list the caller
  // will still redact the preview and retain the conversation and permitted badge.
  if (blocked.size > 100) return rows;
  const replacements = new Map<string, ChatPreview>();
  const list = blockFilter(blocked);
  for (let offset = 0; offset < affected.length; offset += 50) {
    const batch = affected.slice(offset, offset + 50);
    const roomIds = batch.map(row => row.conversationId);
    const select = kind === 'event'
      ? supabase.from('events').select('id, latest_message:messages!messages_event_id_fkey(event_id,user_id,content,created_at,image_url,audio_url,message_type)')
      : supabase.from('circles').select('id, latest_message:messages!messages_circle_id_fkey(circle_id,user_id,content,created_at,image_url,audio_url,message_type)');
    const { data, error } = await read<ActivityResponse>(select.in('id', roomIds).not('latest_message.user_id', 'in', list)
      .order('created_at', {referencedTable:'latest_message', ascending:false})
      .order('id', {referencedTable:'latest_message', ascending:false})
      .limit(1, {referencedTable:'latest_message'}));
    if (error) throw error;
    checkLatestMessageParents(data);
    const parents = new Map((data ?? []).map(parent => [parent.id, parent.latest_message?.[0]]));
    for (const row of batch) {
      const msg = parents.get(row.conversationId);
      if (!msg?.user_id || msg[kind === 'event' ? 'event_id' : 'circle_id'] !== row.conversationId || blocked.has(msg.user_id)) continue;
      replacements.set(row.conversationId, {...row, last_message_user_id:msg.user_id, last_message_at:msg.created_at,
        last_message:formatChatPreview(msg, msg.user_id === viewer ? 'You' : names.get(msg.user_id) ?? null)});
    }
  }
  return rows.map(row => replacements.get(row.conversationId) ?? row);
}

// Cards may not attribute unread counts. A limited peer page may also be
// filled by blocked authors. Count permitted unread rows directly when the
// bounded sample cannot establish the visible “9+” badge.
export async function attributeGroupUnreads(kind: 'event' | 'circle', rows: ChatPreview[], viewer: string, blocked: ReadonlySet<string>,
  read: ScopedRead): Promise<ChatPreview[]> {
  const key = kind === 'event' ? 'event_id' : 'circle_id';
  const needsCounts = rows.filter(row => {
    if (row.is_dm || !row.unread_count) return false;
    if (!row.unread_by_author) return true;
    if (row.unread_count < PEER_ACTIVITY_LIMIT) return false;
    return Object.entries(row.unread_by_author).reduce((n, [id,count]) => n + (blocked.has(id) ? 0 : count), 0) < 10;
  });
  if (!blocked.size || !needsCounts.length || blocked.size > 100) return rows;
  const {data: markers, error} = await read(supabase.from('chat_reads').select('event_id,circle_id,last_read_at')
    .eq('user_id', viewer).in(key, needsCounts.map(row => row.conversationId)));
  if (error || !Array.isArray(markers)) throw error ?? new Error('Chat read positions unavailable');
  const seen = new Map(markers.map(row => [row[key], row.last_read_at]));
  const counts = new Map<string, Record<string, number>>();
  for (let offset = 0; offset < needsCounts.length; offset += 4) {
    await Promise.all(needsCounts.slice(offset, offset + 4).map(async row => {
      const id = row.conversationId;
      let query = supabase.from('messages').select('user_id').eq(key, id).neq('user_id', viewer)
        .not('user_id', 'in', blockFilter(blocked));
      const lastRead = seen.get(id);
      if (lastRead) query = query.gt('created_at', lastRead);
      const {data, error: readError} = await read(query.order('created_at',{ascending:false}).limit(10));
      if (readError || !Array.isArray(data)) throw readError ?? new Error('Chat unread messages unavailable');
      const byAuthor: Record<string,number> = {};
      for (const message of data) {
        const author = message.user_id;
        if (author && author !== viewer && !blocked.has(author)) byAuthor[author] = (byAuthor[author] ?? 0) + 1;
      }
      counts.set(id, byAuthor);
    }));
  }
  return rows.map(row => counts.has(row.conversationId) ? {...row, unread_by_author:counts.get(row.conversationId)} : row);
}
