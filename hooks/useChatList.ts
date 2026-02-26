import { useState, useEffect } from 'react';
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

  useEffect(() => {
    fetchChats();
  }, []);

  const fetchChats = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    // Get all events the user has joined
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

    // Only show events with 2+ members (chat unlocks at 2)
    const eligible = memberships.filter((m: any) => {
      const e = m.events;
      return e && e.member_count >= 2;
    });

    const previews: ChatPreview[] = await Promise.all(
      eligible.map(async (m: any) => {
        const event = m.events;
        const isPast = new Date(event.start_time) < new Date(Date.now() - 48 * 60 * 60 * 1000);

        // Last message
        const { data: lastMsgArr } = await supabase
          .from('messages')
          .select('content, created_at, image_url')
          .eq('event_id', event.id)
          .order('created_at', { ascending: false })
          .limit(1);

        const lastMsg = lastMsgArr?.[0];

        // Unread count
        const { data: readData } = await supabase
          .from('chat_reads')
          .select('last_read_at')
          .eq('event_id', event.id)
          .eq('user_id', user.id)
          .maybeSingle();

        let unreadCount = 0;
        if (readData?.last_read_at) {
          const { count } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('event_id', event.id)
            .gt('created_at', readData.last_read_at)
            .neq('user_id', user.id);
          unreadCount = count ?? 0;
        }

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
          unread_count: unreadCount,
          is_past: isPast,
        };
      }),
    );

    // Active chats sorted by most recent message, then past plans
    const active = previews
      .filter(p => !p.is_past)
      .sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''));
    const past = previews
      .filter(p => p.is_past)
      .sort((a, b) => b.start_time.localeCompare(a.start_time));

    setChats([...active, ...past]);
    setLoading(false);
  };

  return { chats, loading, refetch: fetchChats };
}
