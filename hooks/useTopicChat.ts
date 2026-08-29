import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { checkContent } from '../lib/contentFilter';
import {
  getTopicMessages,
  type TopicMessage,
  type TopicMessageReaction,
} from '../lib/communityChat';
import { logError } from '../lib/logger';
import { supabase } from '../lib/supabase';

let optimisticSequence = 0;

function nextOptimisticId(): string {
  optimisticSequence += 1;
  return `topic-optimistic-${Date.now()}-${optimisticSequence}`;
}

export function useTopicChat(topicId: string | undefined) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<TopicMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [currentUserPhoto, setCurrentUserPhoto] = useState<string | null>(null);
  const messagesRef = useRef<TopicMessage[]>([]);
  const userIdRef = useRef<string | null>(null);
  const reactionInFlightRef = useRef(new Set<string>());

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data }) => {
      const userId = data.user?.id ?? null;
      if (!active) return;
      setCurrentUserId(userId);
      userIdRef.current = userId;
      if (!userId) return;
      const { data: profile } = await supabase
        .from('profiles_public')
        .select('first_name_display, profile_photo_url')
        .eq('id', userId)
        .maybeSingle();
      if (!active) return;
      setCurrentUserName(profile?.first_name_display ?? null);
      setCurrentUserPhoto(profile?.profile_photo_url ?? null);
    }).catch((error) => logError(error, 'useTopicChat.getUser'));
    return () => { active = false; };
  }, []);

  const refresh = useCallback(async (silent = false) => {
    if (!topicId) return;
    if (!silent) setLoading(true);
    try {
      const rows = await getTopicMessages(topicId);
      setMessages(rows);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [topicId]);

  useEffect(() => {
    if (!topicId) return;
    let active = true;
    setMessages([]);
    refresh().catch((error) => logError(error, 'useTopicChat.refresh'));

    const refreshIfActive = () => {
      if (active) refresh(true).catch((error) => logError(error, 'useTopicChat.realtimeRefresh'));
    };
    const reactionBelongsHere = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
      const messageId = (payload.new?.message_id ?? payload.old?.message_id) as string | undefined;
      return !!messageId && messagesRef.current.some((message) => message.id === messageId);
    };

    const channel = supabase
      .channel(`community-topic-chat:${topicId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'community_topic_messages', filter: `topic_id=eq.${topicId}` },
        refreshIfActive,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'community_topic_message_reactions' },
        (payload) => {
          // DELETE payloads only carry this table's replica-identity column (its
          // own id), never message_id, so reactionBelongsHere can't be checked --
          // refresh unconditionally rather than silently drop the update.
          if (payload.eventType === 'DELETE' || reactionBelongsHere(payload as any)) refreshIfActive();
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [topicId, refresh]);

  const invalidateLists = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
    queryClient.invalidateQueries({ queryKey: ['community-chat-rows'] });
  }, [queryClient]);

  const sendMessage = useCallback(async (body: string, imageUrl?: string, replyToId?: string) => {
    const userId = userIdRef.current;
    const trimmed = body.trim().slice(0, 4000);
    if (!topicId || !userId || (!trimmed && !imageUrl)) return;
    const filter = checkContent(trimmed);
    if (!filter.ok) throw new Error(filter.reason ?? 'Please revise your message.');

    const parent = replyToId
      ? messagesRef.current.find((message) => message.id === replyToId) ?? null
      : null;
    const optimisticId = nextOptimisticId();
    const optimistic: TopicMessage = {
      id: optimisticId,
      body: trimmed,
      created_at: new Date().toISOString(),
      sender_id: userId,
      sender_name: currentUserName,
      sender_photo: currentUserPhoto,
      image_url: imageUrl ?? null,
      reply_to_message_id: parent?.id ?? null,
      edited_at: null,
      reply_to: parent
        ? { id: parent.id, body: parent.body, sender_name: parent.sender_name }
        : null,
      reactions: [],
    };
    setMessages((current) => [...current, optimistic]);

    const { data, error } = await supabase
      .from('community_topic_messages')
      .insert({
        topic_id: topicId,
        sender_id: userId,
        body: trimmed,
        image_url: imageUrl ?? null,
        reply_to_message_id: parent?.id ?? null,
      })
      .select('id, created_at')
      .single();
    if (error) {
      setMessages((current) => current.filter((message) => message.id !== optimisticId));
      throw error;
    }
    setMessages((current) => current.map((message) =>
      message.id === optimisticId
        ? { ...message, id: data.id, created_at: data.created_at }
        : message,
    ));
    invalidateLists();
  }, [currentUserName, currentUserPhoto, invalidateLists, topicId]);

  const editMessage = useCallback(async (messageId: string, body: string) => {
    const userId = userIdRef.current;
    const trimmed = body.trim().slice(0, 4000);
    if (!userId || !trimmed) return;
    const filter = checkContent(trimmed);
    if (!filter.ok) throw new Error(filter.reason ?? 'Please revise your message.');
    const snapshot = messagesRef.current;
    const editedAt = new Date().toISOString();
    setMessages((current) => current.map((message) =>
      message.id === messageId ? { ...message, body: trimmed, edited_at: editedAt } : message,
    ));
    const { error } = await supabase
      .from('community_topic_messages')
      .update({ body: trimmed, edited_at: editedAt })
      .eq('id', messageId)
      .eq('sender_id', userId);
    if (error) {
      setMessages(snapshot);
      throw error;
    }
  }, []);

  const deleteMessage = useCallback(async (messageId: string) => {
    const userId = userIdRef.current;
    if (!userId) return;
    const snapshot = messagesRef.current;
    setMessages((current) => current.filter((message) => message.id !== messageId));
    const { error } = await supabase
      .from('community_topic_messages')
      .delete()
      .eq('id', messageId)
      .eq('sender_id', userId);
    if (error) {
      setMessages(snapshot);
      throw error;
    }
    invalidateLists();
  }, [invalidateLists]);

  const toggleReaction = useCallback(async (messageId: string, reaction: string) => {
    const userId = userIdRef.current;
    if (!userId || reactionInFlightRef.current.has(messageId)) return;
    reactionInFlightRef.current.add(messageId);
    const snapshot = messagesRef.current.find((message) => message.id === messageId)?.reactions ?? [];
    const currentMine = snapshot.find((item) => item.user_id === userId);
    const optimisticNext = currentMine?.reaction === reaction
      ? snapshot.filter((item) => item.user_id !== userId)
      : currentMine
        ? snapshot.map((item) => item.user_id === userId ? { ...item, reaction } : item)
        : [...snapshot, { user_id: userId, reaction }];
    setMessages((current) => current.map((message) =>
      message.id === messageId ? { ...message, reactions: optimisticNext } : message,
    ));
    try {
      const { data: rows, error: readError } = await supabase
        .from('community_topic_message_reactions')
        .select('id, reaction')
        .eq('message_id', messageId)
        .eq('user_id', userId)
        .limit(1);
      if (readError) throw readError;
      const existing = rows?.[0] ?? null;
      let next: TopicMessageReaction[];
      if (existing?.reaction === reaction) {
        next = snapshot.filter((item) => item.user_id !== userId);
        const { error } = await supabase
          .from('community_topic_message_reactions')
          .delete()
          .eq('id', existing.id);
        if (error) throw error;
      } else if (existing) {
        next = snapshot.map((item) => item.user_id === userId ? { ...item, reaction } : item);
        const { error } = await supabase
          .from('community_topic_message_reactions')
          .update({ reaction })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        next = [...snapshot, { user_id: userId, reaction }];
        const { error } = await supabase
          .from('community_topic_message_reactions')
          .insert({ message_id: messageId, user_id: userId, reaction });
        if (error) throw error;
      }
      setMessages((current) => current.map((message) =>
        message.id === messageId ? { ...message, reactions: next } : message,
      ));
    } catch (error) {
      setMessages((current) => current.map((message) =>
        message.id === messageId ? { ...message, reactions: snapshot } : message,
      ));
      throw error;
    } finally {
      reactionInFlightRef.current.delete(messageId);
    }
  }, []);

  return {
    messages,
    loading,
    currentUserId,
    currentUserName,
    sendMessage,
    editMessage,
    deleteMessage,
    toggleReaction,
    refresh,
  };
}
