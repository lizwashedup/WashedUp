import { supabase } from './supabase';
import type { ChatOperationScope, ConversationKey } from './chatMessageModel';

// The caller supplies the newest eligible row from the page it actually
// displayed. Keep the original database precision; device time is irrelevant.
export async function acknowledgeMemberChatPage(room: ConversationKey, at: string, scope: ChatOperationScope, visible: () => boolean) {
  const active = () => scope.isCurrent() && visible();
  if (!active()) return;
  const key = room.kind === 'event' ? 'event_id' : 'circle_id';
  const user = scope.userId;
  const inserted = await supabase.from('chat_reads')
    .upsert({ [key]: room.id, user_id: user, last_read_at: at }, {
      onConflict: room.kind === 'event' ? 'event_id,user_id' : 'user_id,circle_id', ignoreDuplicates: true,
    }).select('last_read_at');
  if (inserted.error) throw inserted.error;
  if (!active()) return;
  if (!inserted.data?.length) {
    // An older page from this phone cannot rewind another device's position.
    const advanced = await supabase.from('chat_reads').update({ last_read_at: at })
      .eq(key, room.id).eq('user_id', user).lt('last_read_at', at);
    if (advanced.error) throw advanced.error;
  }
  if (room.kind !== 'event' || !active()) return;
  const clear = () => supabase.from('app_notifications').update({ status: 'read' })
    .eq('event_id', room.id).eq('user_id', user).eq('type', 'new_message').eq('status', 'unread');
  const cleared = await clear().lte('created_at', at);
  if (cleared.error) throw cleared.error;
  if (!active()) return;

  // Reactions and delayed notices may be newer than the latest message.
  // Capture their exact IDs first. If newer history exists, we cannot tell
  // whether an unlinked notice belongs to it; leave it for the next visit.
  const later = await supabase.from('app_notifications').select('id')
    .eq('event_id', room.id).eq('user_id', user).eq('type', 'new_message')
    .eq('status', 'unread').gt('created_at', at).limit(100);
  if (later.error) throw later.error;
  const ids = later.data?.map(row => row.id).filter(Boolean);
  if (!ids?.length || !active()) return;
  const newer = await supabase.from('messages').select('id')
    .eq('event_id', room.id).gt('created_at', at).limit(1);
  if (newer.error) throw newer.error;
  if (!Array.isArray(newer.data) || newer.data.length || !active()) return;
  const confirmed = await clear().in('id', ids);
  if (confirmed.error) throw confirmed.error;
}
