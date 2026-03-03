import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { checkContent } from '../lib/contentFilter';

export interface MessageReaction {
  user_id: string;
  reaction: string;
}

export interface ChatMessage {
  id: string;
  event_id: string;
  user_id: string;
  content: string;
  message_type: 'user' | 'system';
  image_url?: string | null;
  created_at: string;
  reactions?: MessageReaction[];
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

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const msgIds = (data ?? []).map((m: any) => m.id);
      const [{ data: profile }, , { data: reactionsData }] = await Promise.all([
        supabase.from('profiles').select('blocked_users').eq('id', user.id).single(),
        supabase.from('chat_reads').upsert(
          { event_id: eventId, user_id: user.id, last_read_at: new Date().toISOString() },
          { onConflict: 'event_id,user_id' },
        ),
        msgIds.length > 0
          ? supabase.from('message_reactions').select('message_id, user_id, reaction').in('message_id', msgIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const reactionsByMsg: Record<string, MessageReaction[]> = {};
      (reactionsData ?? []).forEach((r: any) => {
        if (!reactionsByMsg[r.message_id]) reactionsByMsg[r.message_id] = [];
        reactionsByMsg[r.message_id].push({ user_id: r.user_id, reaction: r.reaction });
      });

      const blockedLookup: Record<string, boolean> = {};
      (profile?.blocked_users ?? []).forEach((uid: string) => { blockedLookup[uid] = true; });
      blockedIdsRef.current = blockedLookup;

      const filtered = (data ?? []).filter((msg: any) => !blockedLookup[msg.user_id]);
      const enriched = await attachSenders(filtered);
      setMessages(enriched.map(m => ({ ...m, reactions: reactionsByMsg[m.id] ?? [] })));
    } else {
      if (data) {
        const enriched = await attachSenders(data);
        setMessages(enriched);
      }
    }

    setLoading(false);
  };

  const toggleReaction = useCallback(async (messageId: string, reaction = 'heart') => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: existing } = await supabase
      .from('message_reactions')
      .select('id')
      .eq('message_id', messageId)
      .eq('user_id', user.id)
      .eq('reaction', reaction)
      .maybeSingle();

    if (existing) {
      await supabase.from('message_reactions').delete().eq('id', existing.id);
      setMessages(prev => prev.map(m =>
        m.id === messageId
          ? { ...m, reactions: (m.reactions ?? []).filter(r => !(r.user_id === user.id && r.reaction === reaction)) }
          : m,
      ));
    } else {
      await supabase.from('message_reactions').insert({
        message_id: messageId,
        user_id: user.id,
        reaction,
      });
      setMessages(prev => prev.map(m =>
        m.id === messageId
          ? { ...m, reactions: [...(m.reactions ?? []), { user_id: user.id, reaction }] }
          : m,
      ));
    }
  }, []);

  const sendMessage = useCallback(async (content: string, imageUrl?: string) => {
    const filter = checkContent(content);
    if (!filter.ok) {
      Alert.alert('Content not allowed', filter.reason ?? 'Please revise your message.');
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from('messages').insert({
      event_id: eventId,
      user_id: user.id,
      content: content || '',
      message_type: 'user',
      image_url: imageUrl ?? null,
    });

    if (error) {
      Alert.alert("Couldn't send message", "Your message failed to send. Please try again.");
    }
  }, [eventId]);

  return { messages, loading, currentUserId, sendMessage, toggleReaction };
}
