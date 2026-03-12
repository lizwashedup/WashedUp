import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { checkContent } from '../lib/contentFilter';
import { useQueryClient } from '@tanstack/react-query';
import { UNREAD_CHATS_KEY } from '../constants/QueryKeys';

export interface MessageReaction {
  user_id: string;
  reaction: string;
}

export interface ChatMessage {
  id: string;
  event_id: string;
  user_id: string;
  content: string;
  message_type: 'user' | 'system' | 'location';
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
  // Ref mirrors currentUserId for synchronous access inside callbacks (avoids async round-trip on send)
  const currentUserIdRef = useRef<string>('');
  // Ref so the real-time channel closure always has the latest blocked set
  const blockedIdsRef = useRef<Record<string, boolean>>({});
  const queryClient = useQueryClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setCurrentUserId(user.id);
        currentUserIdRef.current = user.id;
      }
    });
  }, []);

  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!eventId) return;
    cancelledRef.current = false;
    fetchMessages();

    const channel = supabase
      .channel(`chat:${eventId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `event_id=eq.${eventId}` },
        async (payload) => {
          const newMsg = payload.new as any;
          if (blockedIdsRef.current[newMsg.user_id]) return;
          const enriched = await attachSenders([newMsg]);
          if (!cancelledRef.current) {
            setMessages(prev => {
              // Drop optimistic placeholders from the same user (real row now confirmed)
              const deduped = prev.filter(m => !(m.id.startsWith('optimistic-') && m.user_id === newMsg.user_id));
              // Guard against duplicate real rows
              if (deduped.some(m => m.id === enriched[0].id)) return deduped;
              return [...deduped, enriched[0]];
            });
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages', filter: `event_id=eq.${eventId}` },
        (payload) => {
          const deleted = payload.old as any;
          if (deleted?.id && !cancelledRef.current) {
            setMessages(prev => prev.filter(m => m.id !== deleted.id));
          }
        },
      )
      .subscribe();

    return () => { cancelledRef.current = true; supabase.removeChannel(channel); };
  }, [eventId]);

  const fetchMessages = async () => {
    setLoading(true);
    try {
      const [{ data }, { data: { user } }] = await Promise.all([
        supabase
          .from('messages')
          .select('id, event_id, user_id, content, message_type, image_url, created_at')
          .eq('event_id', eventId)
          .order('created_at', { ascending: true }),
        supabase.auth.getUser(),
      ]);
      if (cancelledRef.current) return;
      if (user) {
        const msgIds = (data ?? []).map((m: any) => m.id);
        const [{ data: profile }, , , { data: reactionsData }] = await Promise.all([
          supabase.from('profiles').select('blocked_users').eq('id', user.id).single(),
          supabase.from('chat_reads').upsert(
            { event_id: eventId, user_id: user.id, last_read_at: new Date().toISOString() },
            { onConflict: 'event_id,user_id' },
          ),
          // Mark new_message notifications for this chat as read so the tab badge clears
          supabase.from('app_notifications')
            .update({ status: 'read' })
            .eq('user_id', user.id)
            .eq('event_id', eventId)
            .eq('type', 'new_message')
            .eq('status', 'unread'),
          msgIds.length > 0
            ? supabase.from('message_reactions').select('message_id, user_id, reaction').in('message_id', msgIds)
            : Promise.resolve({ data: [] as any[] }),
        ]);
        if (cancelledRef.current) return;
        // Invalidate tab badge so it reflects the just-cleared notifications
        queryClient.invalidateQueries({ queryKey: UNREAD_CHATS_KEY });

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
        if (!cancelledRef.current) setMessages(enriched.map(m => ({ ...m, reactions: reactionsByMsg[m.id] ?? [] })));
      } else {
        if (data) {
          const enriched = await attachSenders(data);
          if (!cancelledRef.current) setMessages(enriched);
        }
      }
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
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

  const deleteMessage = useCallback(async (messageId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setMessages(prev => prev.filter(m => m.id !== messageId));

    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId)
      .eq('user_id', user.id);

    if (error) {
      Alert.alert('Could not delete', 'Something went wrong. Please try again.');
    }
  }, []);

  const sendMessage = useCallback(async (content: string, imageUrl?: string) => {
    const filter = checkContent(content);
    if (!filter.ok) {
      Alert.alert('Content not allowed', filter.reason ?? 'Please revise your message.');
      return;
    }

    // Use the ref for instant, synchronous access — no async round-trip before showing the message
    const userId = currentUserIdRef.current;
    if (!userId) return;

    // Optimistic insert — synchronous, appears immediately with zero lag
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: optimisticId,
      event_id: eventId,
      user_id: userId,
      content: content || '',
      message_type: 'user',
      image_url: imageUrl ?? null,
      created_at: new Date().toISOString(),
      reactions: [],
      sender: null,
    };
    setMessages(prev => [...prev, optimisticMsg]);

    // Insert and select back the real row so we can confirm the message even if real-time is slow
    const { data: inserted, error } = await supabase.from('messages').insert({
      event_id: eventId,
      user_id: userId,
      content: content || '',
      message_type: 'user',
      image_url: imageUrl ?? null,
    }).select('id, created_at').single();

    if (error) {
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
      Alert.alert("Couldn't send message", "Your message failed to send. Please try again.");
    } else if (inserted) {
      // Replace optimistic ID with real DB row ID — message is now confirmed regardless of real-time
      // Real-time handler will dedup correctly (checks for the real ID, won't add a duplicate)
      setMessages(prev => prev.map(m =>
        m.id === optimisticId ? { ...m, id: inserted.id, created_at: inserted.created_at } : m,
      ));
    }
  }, [eventId]);

  const sendLocation = useCallback(async (lat: number, lng: number, address: string) => {
    const userId = currentUserIdRef.current;
    if (!userId) return;

    const content = JSON.stringify({ lat, lng, address });

    // Optimistic insert — synchronous, no async delay
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: optimisticId,
      event_id: eventId,
      user_id: userId,
      content,
      message_type: 'location',
      image_url: null,
      created_at: new Date().toISOString(),
      reactions: [],
      sender: null,
    };
    setMessages(prev => [...prev, optimisticMsg]);

    const { data: inserted, error } = await supabase.from('messages').insert({
      event_id: eventId,
      user_id: userId,
      content,
      message_type: 'location',
    }).select('id, created_at').single();

    if (error) {
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
      Alert.alert("Couldn't send location", "Your location failed to send. Please try again.");
    } else if (inserted) {
      setMessages(prev => prev.map(m =>
        m.id === optimisticId ? { ...m, id: inserted.id, created_at: inserted.created_at } : m,
      ));
    }
  }, [eventId]);

  return { messages, loading, currentUserId, sendMessage, sendLocation, deleteMessage, toggleReaction };
}
