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
  const allIds = messages.map(m => m.user_id).filter(Boolean);
  const userIds = allIds.filter((id: string, i: number) => allIds.indexOf(id) === i);
  if (userIds.length === 0) return messages as ChatMessage[];

  const { data: profiles } = await supabase
    .from('profiles_public')
    .select('id, first_name_display, profile_photo_url')
    .in('id', userIds);

  const profileMap: Record<string, any> = {};
  (profiles ?? []).forEach((p: any) => {
    profileMap[p.id] = {
      id: p.id,
      first_name: p.first_name_display ?? null,
      avatar_url: p.profile_photo_url ?? null,
    };
  });

  return messages.map(m => ({
    ...m,
    message_type: m.message_type ?? 'user',
    sender: profileMap[m.user_id] ?? null,
  })) as ChatMessage[];
}

export function useChat(eventId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  // Ref so the real-time channel closure always has the latest blocked set
  const blockedIdsRef = useRef<Record<string, boolean>>({});

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
          if (blockedIdsRef.current[newMsg.user_id]) return;
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

      const blockedLookup: Record<string, boolean> = {};
      (profile?.blocked_users ?? []).forEach((uid: string) => { blockedLookup[uid] = true; });
      blockedIdsRef.current = blockedLookup;

      const filtered = (data ?? []).filter((msg: any) => !blockedLookup[msg.user_id]);
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
    if (!user) {
      console.warn('[Chat] sendMessage: no authenticated user');
      return;
    }

    const { error } = await supabase.from('messages').insert({
      event_id: eventId,
      user_id: user.id,
      content: content || '',
      message_type: 'user',
      image_url: imageUrl ?? null,
    });

    if (error) {
      console.error('[Chat] sendMessage failed:', error.message, error.code, error.details);
    }
  }, [eventId]);

  return { messages, loading, currentUserId, sendMessage };
}
