import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface ChatPreview {
  eventId: string;
  title: string;
  category: string | null;
  image_url: string | null;
  start_time: string;
  member_count: number;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  is_past: boolean;
  ticket_url: string | null;
}

export function useChatList() {
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchChats = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: memberships } = await supabase
      .from('event_members')
      .select(`
        event_id,
        events (
          id, title, primary_vibe, image_url, start_time, member_count, tickets_url, status
        )
      `)
      .eq('user_id', user.id)
      .eq('status', 'joined');

    if (!memberships) { setLoading(false); return; }

    const eligible = memberships.filter((m: any) => {
      const e = m.events;
      return e && e.member_count >= 2;
    });

    if (eligible.length === 0) {
      setChats([]);
      setLoading(false);
      return;
    }

    const eventIds = eligible.map((m: any) => m.events.id);

    // Batch: last message per event (single query using distinct-on via ordering trick)
    // We fetch the most recent message per event in one go
    const { data: allMessages } = await supabase
      .from('messages')
      .select('event_id, content, created_at, image_url')
      .in('event_id', eventIds)
      .order('created_at', { ascending: false });

    const lastMsgMap: Record<string, { content: string; created_at: string; image_url: string | null }> = {};
    (allMessages ?? []).forEach((msg: any) => {
      if (!lastMsgMap[msg.event_id]) {
        lastMsgMap[msg.event_id] = msg;
      }
    });

    // Batch: all read receipts for this user
    const { data: allReads } = await supabase
      .from('chat_reads')
      .select('event_id, last_read_at')
      .eq('user_id', user.id)
      .in('event_id', eventIds);

    const readMap: Record<string, string> = {};
    (allReads ?? []).forEach((r: any) => {
      readMap[r.event_id] = r.last_read_at;
    });

    // Batch: all messages from others (for unread count)
    const { data: otherMessages } = await supabase
      .from('messages')
      .select('event_id, created_at')
      .in('event_id', eventIds)
      .neq('user_id', user.id);

    const unreadMap: Record<string, number> = {};
    (otherMessages ?? []).forEach((msg: any) => {
      const lastRead = readMap[msg.event_id];
      if (!lastRead || msg.created_at > lastRead) {
        unreadMap[msg.event_id] = (unreadMap[msg.event_id] ?? 0) + 1;
      }
    });

    const previews: ChatPreview[] = eligible.map((m: any) => {
      const event = m.events;
      const isPast = new Date(event.start_time) < new Date(Date.now() - 48 * 60 * 60 * 1000);
      const lastMsg = lastMsgMap[event.id];

      return {
        eventId: event.id,
        title: event.title,
        category: event.primary_vibe ?? null,
        image_url: event.image_url ?? null,
        start_time: event.start_time,
        member_count: event.member_count ?? 0,
        ticket_url: event.tickets_url ?? null,
        last_message: lastMsg
          ? (lastMsg.image_url ? 'Sent a photo' : lastMsg.content)
          : null,
        last_message_at: lastMsg?.created_at ?? null,
        unread_count: unreadMap[event.id] ?? 0,
        is_past: isPast,
      };
    });

    const active = previews
      .filter(p => !p.is_past)
      .sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''));
    const past = previews
      .filter(p => p.is_past)
      .sort((a, b) => b.start_time.localeCompare(a.start_time));

    setChats([...active, ...past]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  useEffect(() => {
    if (chats.length === 0) return;
    const eventIds = new Set(chats.map(c => c.eventId));
    const channel = supabase
      .channel('chat-list-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const eid = (payload.new as any)?.event_id;
          if (eid && eventIds.has(eid)) fetchChats();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [chats, fetchChats]);

  return { chats, loading, refetch: fetchChats };
}
