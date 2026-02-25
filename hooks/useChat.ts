import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

export interface ChatMessage {
  id: string;
  event_id: string;
  user_id: string;
  content: string;
  message_type: 'user' | 'system';
  image_url?: string | null;
  created_at: string;
  sender?: {
    id: string;
    first_name: string | null;
    avatar_url: string | null;
  } | null;
}

async function attachSenders(messages: any[]): Promise<ChatMessage[]> {
  const userIds = [...new Set(messages.map(m => m.user_id).filter(Boolean))];
  if (userIds.length === 0) return messages as ChatMessage[];

  const { data: profiles } = await supabase
    .from('profiles_public')
    .select('id, first_name_display, profile_photo_url')
    .in('id', userIds);

  const profileMap = new Map(
    (profiles ?? []).map((p: any) => [p.id, {
      id: p.id,
      first_name: p.first_name_display ?? null,
      avatar_url: p.profile_photo_url ?? null,
    }]),
  );

  return messages.map(m => ({
    ...m,
    message_type: m.message_type ?? 'user',
    sender: profileMap.get(m.user_id) ?? null,
  })) as ChatMessage[];
}

export function useChat(eventId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  // Ref so the real-time channel closure always has the latest blocked set
  const blockedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  useEffect(() => {
    if (!eventId) return;
    fetchMessages();

    const channel = supabase
      .channel(`chat:${eventId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `event_id=eq.${eventId}` },
        async (payload) => {
          const newMsg = payload.new as any;
          // Drop real-time messages from blocked users without a full refetch
          if (blockedIdsRef.current.has(newMsg.user_id)) return;
          const enriched = await attachSenders([newMsg]);
          setMessages(prev => [...prev, enriched[0]]);
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [eventId]);

  const fetchMessages = async () => {
    setLoading(true);

    const { data } = await supabase
      .from('messages')
      .select('id, event_id, user_id, content, message_type, image_url, created_at')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });

    // Fetch current user's blocked list and mark chat as read in parallel
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const [{ data: profile }] = await Promise.all([
        supabase.from('profiles').select('blocked_users').eq('id', user.id).single(),
        supabase.from('chat_reads').upsert(
          { event_id: eventId, user_id: user.id, last_read_at: new Date().toISOString() },
          { onConflict: 'event_id,user_id' },
        ),
      ]);

      const blockedIds = new Set<string>(profile?.blocked_users ?? []);
      blockedIdsRef.current = blockedIds;

      const filtered = (data ?? []).filter((msg: any) => !blockedIds.has(msg.user_id));
      const enriched = await attachSenders(filtered);
      setMessages(enriched);
    } else {
      if (data) {
        const enriched = await attachSenders(data);
        setMessages(enriched);
      }
    }

    setLoading(false);
  };

  const sendMessage = useCallback(async (content: string, imageUrl?: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('messages').insert({
      event_id: eventId,
      user_id: user.id,
      content: content || '',
      message_type: 'user',
      image_url: imageUrl ?? null,
    });
  }, [eventId]);

  return { messages, loading, currentUserId, sendMessage };
}
