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

export interface ReplyTo {
  id: string;
  content: string;
  sender_name: string | null;
}

export interface ChatMessage {
  id: string;
  event_id: string;
  user_id: string;
  content: string;
  message_type: 'user' | 'system' | 'location';
  image_url?: string | null;
  created_at: string;
  reply_to_message_id?: string | null;
  reply_to?: ReplyTo | null;
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
  const reactionInFlightRef = useRef<Set<string>>(new Set());
  const messagesRef = useRef<ChatMessage[]>([]);
  const queryClient = useQueryClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setCurrentUserId(user.id);
        currentUserIdRef.current = user.id;
      }
    });
  }, []);

  // Keep messagesRef in sync for stable callbacks
  useEffect(() => { messagesRef.current = messages; }, [messages]);

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
              const deduped = prev.filter(m => !(m.id.startsWith('optimistic-') && m.user_id === newMsg.user_id));
              if (deduped.some(m => m.id === enriched[0].id)) return deduped;
              let msg = enriched[0];
              // Resolve reply reference from existing messages
              if (msg.reply_to_message_id) {
                const parent = deduped.find(m => m.id === msg.reply_to_message_id);
                if (parent) {
                  msg = { ...msg, reply_to: { id: parent.id, content: parent.content, sender_name: parent.sender?.first_name ?? null } };
                }
              }
              return [...deduped, msg];
            });
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `event_id=eq.${eventId}` },
        (payload) => {
          const updated = payload.new as any;
          if (updated?.id && !cancelledRef.current) {
            setMessages(prev => prev.map(m =>
              m.id === updated.id ? { ...m, content: updated.content, image_url: updated.image_url } : m,
            ));
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

  const fetchMessages = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [{ data }, { data: { user } }] = await Promise.all([
        supabase
          .from('messages')
          .select('id, event_id, user_id, content, message_type, image_url, created_at, reply_to_message_id')
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
        const withReactions = enriched.map(m => ({ ...m, reactions: reactionsByMsg[m.id] ?? [] }));
        // Resolve reply references from the same message array
        const msgMap: Record<string, ChatMessage> = {};
        withReactions.forEach(m => { msgMap[m.id] = m; });
        const withReplies = withReactions.map(m => {
          if (m.reply_to_message_id && msgMap[m.reply_to_message_id]) {
            const parent = msgMap[m.reply_to_message_id];
            return { ...m, reply_to: { id: parent.id, content: parent.content, sender_name: parent.sender?.first_name ?? null } };
          }
          return m;
        });
        if (!cancelledRef.current) setMessages(withReplies);
      } else {
        if (data) {
          const enriched = await attachSenders(data);
          if (!cancelledRef.current) setMessages(enriched);
        }
      }
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [eventId]);

  const toggleReaction = useCallback(async (messageId: string, reaction = 'heart') => {
    const userId = currentUserIdRef.current;
    if (!userId) return;

    // Prevent concurrent reaction toggles on the same message
    if (reactionInFlightRef.current.has(messageId)) return;
    reactionInFlightRef.current.add(messageId);

    // Snapshot current reactions for rollback on failure
    const snapshot = messagesRef.current.find(m => m.id === messageId)?.reactions ?? [];

    try {
    const { data: existingRows, error: fetchErr } = await supabase
      .from('message_reactions')
      .select('id, reaction')
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (fetchErr) throw fetchErr;

    const existing = existingRows?.[0] ?? null;

    if (existing && existing.reaction === reaction) {
      setMessages(prev => prev.map(m =>
        m.id === messageId
          ? { ...m, reactions: (m.reactions ?? []).filter(r => r.user_id !== userId) }
          : m,
      ));
      const { error: delErr } = await supabase.from('message_reactions').delete().eq('id', existing.id);
      if (delErr) throw delErr;
    } else if (existing) {
      setMessages(prev => prev.map(m =>
        m.id === messageId
          ? { ...m, reactions: (m.reactions ?? []).map(r => r.user_id === userId ? { ...r, reaction } : r) }
          : m,
      ));
      const { error: updErr } = await supabase.from('message_reactions').update({ reaction }).eq('id', existing.id);
      if (updErr) throw updErr;
    } else {
      setMessages(prev => prev.map(m =>
        m.id === messageId
          ? { ...m, reactions: [...(m.reactions ?? []), { user_id: userId, reaction }] }
          : m,
      ));
      const { error: insErr } = await supabase.from('message_reactions').insert({
        message_id: messageId,
        user_id: userId,
        reaction,
      });
      if (insErr) throw insErr;
    }

    // Send push notification (only for new/replaced reactions, not removals)
    if (!(existing && existing.reaction === reaction)) {
      try {
        const msg = messagesRef.current.find(m => m.id === messageId);
        if (msg && msg.user_id !== userId) {
          // Dedup: skip if we already notified for this message in the last 60s
          const { count } = await supabase
            .from('app_notifications')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', msg.user_id)
            .eq('event_id', eventId)
            .eq('type', 'new_message')
            .gte('created_at', new Date(Date.now() - 60000).toISOString())
            .like('title', `%reacted%`);

          if ((count ?? 0) === 0) {
            const { data: profile } = await supabase
              .from('profiles_public')
              .select('first_name_display')
              .eq('id', userId)
              .maybeSingle();
            const name = profile?.first_name_display ?? 'Someone';
            const emojiDisplay = reaction === 'heart' ? '\u2764\uFE0F' : reaction;
            await supabase.from('app_notifications').insert({
              user_id: msg.user_id,
              type: 'new_message',
              title: `${name} reacted ${emojiDisplay}`,
              body: msg.content?.slice(0, 80) || 'to your message',
              event_id: eventId,
            });
          }
        }
      } catch (e) { console.warn('[WashedUp] Reaction notification failed:', e); }
    }
    } catch (err) {
      console.warn('[WashedUp] Reaction toggle failed, rolling back:', err);
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, reactions: snapshot } : m,
      ));
    } finally {
      reactionInFlightRef.current.delete(messageId);
    }
  }, [eventId]);

  const deleteMessage = useCallback(async (messageId: string) => {
    const userId = currentUserIdRef.current;
    if (!userId) return;

    let previousMessages: ChatMessage[] = [];
    setMessages(prev => { previousMessages = prev; return prev.filter(m => m.id !== messageId); });

    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId)
      .eq('user_id', userId);

    if (error) {
      setMessages(previousMessages);
      Alert.alert('Could not delete', 'Something went wrong. Please try again.');
    }
  }, []);

  const sendMessage = useCallback(async (content: string, imageUrl?: string, replyToId?: string) => {
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
    // Build reply_to for optimistic display
    let replyTo: ReplyTo | null = null;
    if (replyToId) {
      const parentMsg = messagesRef.current.find(m => m.id === replyToId);
      if (parentMsg) {
        replyTo = { id: parentMsg.id, content: parentMsg.content, sender_name: parentMsg.sender?.first_name ?? null };
      }
    }

    const optimisticMsg: ChatMessage = {
      id: optimisticId,
      event_id: eventId,
      user_id: userId,
      content: content || '',
      message_type: 'user',
      image_url: imageUrl ?? null,
      created_at: new Date().toISOString(),
      reply_to_message_id: replyToId ?? null,
      reply_to: replyTo,
      reactions: [],
      sender: null,
    };
    setMessages(prev => [...prev, optimisticMsg]);

    // Insert and select back the real row so we can confirm the message even if real-time is slow
    const insertData: any = {
      event_id: eventId,
      user_id: userId,
      content: content || '',
      message_type: 'user',
      image_url: imageUrl ?? null,
    };
    if (replyToId && replyTo) insertData.reply_to_message_id = replyToId;

    const { data: inserted, error } = await supabase.from('messages').insert(insertData).select('id, created_at').single();

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

  const editMessage = useCallback(async (messageId: string, newContent: string) => {
    const userId = currentUserIdRef.current;
    if (!userId) return;

    // Optimistic update
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, content: newContent } : m,
    ));

    const { error } = await supabase
      .from('messages')
      .update({ content: newContent })
      .eq('id', messageId)
      .eq('user_id', userId);

    if (error) {
      fetchMessages(true);
      Alert.alert('Could not edit', 'Something went wrong. Please try again.');
    }
  }, [fetchMessages]);

  return { messages, loading, currentUserId, sendMessage, sendLocation, deleteMessage, editMessage, toggleReaction, refetch: fetchMessages };
}
