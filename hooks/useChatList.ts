import { useCallback, useEffect, useRef, useState } from 'react';
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

  const fetchChats = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const user = (await supabase.auth.getUser()).data?.user;
      if (!user) return;

      const { data: memberships, error: membershipsError } = await supabase
        .from('event_members')
        .select(`
          event_id,
          events (
            id, title, primary_vibe, image_url, start_time, member_count, tickets_url, status
          )
        `)
        .eq('user_id', user.id)
        .eq('status', 'joined');

      if (membershipsError || !memberships) return;

      // Fetch real member counts from event_members to avoid the known drift
      // in the events.member_count column (same approach as fetchRealMemberCounts in fetchPlans.ts)
      const allEventIds = memberships.map((m: any) => m.events?.id).filter(Boolean);
      const { data: memberCountRows } = await supabase
        .from('event_members')
        .select('event_id')
        .in('event_id', allEventIds)
        .eq('status', 'joined');
      const realCounts: Record<string, number> = {};
      (memberCountRows ?? []).forEach((r: any) => {
        realCounts[r.event_id] = (realCounts[r.event_id] ?? 0) + 1;
      });

      const eligible = memberships.filter((m: any) => {
        const e = m.events;
        return e && (realCounts[e.id] >= 2 || e.status === 'cancelled');
      });

      if (eligible.length === 0) {
        setChats([]);
        return;
      }

      const eventIds = eligible.map((m: any) => m.events.id);

      // Run all 3 queries in parallel — they only need eventIds + user.id
      const [{ data: allMessages }, { data: allReads }, { data: otherMessages }] = await Promise.all([
        supabase
          .from('messages')
          .select('event_id, content, created_at, image_url, user_id')
          .in('event_id', eventIds)
          .order('created_at', { ascending: false }),
        supabase
          .from('chat_reads')
          .select('event_id, last_read_at')
          .eq('user_id', user.id)
          .in('event_id', eventIds),
        supabase
          .from('messages')
          .select('event_id, created_at')
          .in('event_id', eventIds)
          .neq('user_id', user.id),
      ]);

      const lastMsgMap: Record<string, { content: string; created_at: string; image_url: string | null; user_id: string }> = {};
      (allMessages ?? []).forEach((msg: any) => {
        if (!lastMsgMap[msg.event_id]) {
          lastMsgMap[msg.event_id] = msg;
        }
      });

      // Fetch first names for last-message senders
      const senderIds = [...new Set(Object.values(lastMsgMap).map(m => m.user_id).filter(Boolean))];
      const senderNameMap: Record<string, string> = {};
      if (senderIds.length > 0) {
        const { data: senderProfiles } = await supabase
          .from('profiles_public')
          .select('id, first_name_display')
          .in('id', senderIds);
        (senderProfiles ?? []).forEach((p: any) => {
          if (p.first_name_display) senderNameMap[p.id] = p.first_name_display;
        });
      }

      const readMap: Record<string, string> = {};
      (allReads ?? []).forEach((r: any) => {
        readMap[r.event_id] = r.last_read_at;
      });

      const unreadMap: Record<string, number> = {};
      (otherMessages ?? []).forEach((msg: any) => {
        const lastRead = readMap[msg.event_id];
        if (!lastRead || msg.created_at > lastRead) {
          unreadMap[msg.event_id] = (unreadMap[msg.event_id] ?? 0) + 1;
        }
      });

      const previews: ChatPreview[] = eligible.map((m: any) => {
        const event = m.events;
        const isPast = event.status === 'cancelled' || new Date(event.start_time) < new Date(Date.now() - 48 * 60 * 60 * 1000);
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
            ? (() => {
                const isOwn = lastMsg.user_id === user.id;
                const senderName = isOwn ? 'You' : (senderNameMap[lastMsg.user_id] ?? null);
                const text = lastMsg.image_url ? 'sent a photo' : lastMsg.content;
                return senderName ? `${senderName}: ${text}` : text;
              })()
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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  const eventIdsRef = useRef(new Set<string>());
  useEffect(() => {
    eventIdsRef.current = new Set(chats.map(c => c.eventId));
  }, [chats]);

  const hasChatsRef = useRef(false);
  useEffect(() => {
    hasChatsRef.current = chats.length > 0;
  }, [chats.length]);

  useEffect(() => {
    const channel = supabase
      .channel('chat-list-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const eid = (payload.new as any)?.event_id;
          if (eid && hasChatsRef.current && eventIdsRef.current.has(eid)) fetchChats(true);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchChats]);

  return { chats, loading, refetch: fetchChats };
}
