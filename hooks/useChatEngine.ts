/**
 * useChatEngine -- the doc-123 chat data layer.
 *
 * Same conversation model as useChat (event | circle parent, optimistic sends
 * that reconcile on ack, realtime channel per conversation) with the three
 * structural upgrades doc 123 ruled in:
 *
 *   1. CURSOR PAGINATION. The initial fetch loads only the newest page
 *      (INITIAL_PAGE) ordered newest-first, so cold open renders the bottom
 *      of the thread without waiting on the full history. Older pages load
 *      on demand via loadOlder() (compound created_at+id cursor, so
 *      same-timestamp rows can't be skipped or duplicated).
 *   2. NON-BLOCKING HYDRATION. First paint gates only on the message page.
 *      Sender profiles resolve synchronously from the module cache
 *      (lib/chatEngine/senderCache) when warm; misses, reactions, reply
 *      parents outside the page, the read receipt, and the blocklist refresh
 *      all hydrate after render and merge in.
 *   3. BATCHED REALTIME. Insert payloads buffer for REALTIME_FLUSH_MS and
 *      apply in one state update, so a burst in a busy chat costs one render,
 *      not one per message.
 *
 * The public shape is a superset of useChat's, so the engine thread component
 * consumes it the same way ChatThread consumes useChat.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { checkContent } from '../lib/contentFilter';
import { logError } from '../lib/logger';
import { useQueryClient } from '@tanstack/react-query';
import { UNREAD_CHATS_KEY } from '../constants/QueryKeys';
import { getCachedSender, ensureSenders } from '../lib/chatEngine/senderCache';
import type { ChatMessage, MessageReaction, ReplyTo, ConversationKey } from './useChat';

// Page sizes: the initial page is what stands between tap and first paint, so
// it stays lean; older pages can afford to be bigger since the user is already
// reading. Both cover the doc-123 "500-message history" bar in a few pages.
const INITIAL_PAGE = 60;
const OLDER_PAGE = 100;
// Realtime insert batching window. One frame is too tight for a network burst;
// anything human-noticeable is too loose. 80ms folds a burst into one render
// while staying imperceptible on a single incoming message.
const REALTIME_FLUSH_MS = 80;

const MESSAGE_COLS =
  'id, event_id, user_id, content, message_type, image_url, audio_url, duration_seconds, created_at, reply_to_message_id, ref_event_id, circle_id';

// Monotonic optimistic-message id (same rationale as useChat's: Date.now()
// alone collides on rapid consecutive sends).
let optimisticSeq = 0;
function nextOptimisticId(): string {
  optimisticSeq += 1;
  return `optimistic-engine-${Date.now()}-${optimisticSeq}`;
}

// Last-known blocklist per user, module-level so a thread open never waits on
// the profiles query to hide a blocked sender (mirrors useChat's ref, but
// survives across thread mounts).
let blockedIdsCache: Record<string, boolean> = {};

function attachCachedSender(m: any): ChatMessage {
  return {
    ...m,
    message_type: m.message_type ?? 'user',
    sender: getCachedSender(m.user_id),
    reactions: m.reactions ?? [],
  } as ChatMessage;
}

/** Resolve reply_to for every message that has a parent inside `all`. */
function resolveRepliesInPlace(list: ChatMessage[]): ChatMessage[] {
  const byId: Record<string, ChatMessage> = {};
  list.forEach(m => { byId[m.id] = m; });
  return list.map(m => {
    if (m.reply_to_message_id && !m.reply_to) {
      const parent = byId[m.reply_to_message_id];
      if (parent) {
        return { ...m, reply_to: { id: parent.id, content: parent.content, sender_name: parent.sender?.first_name ?? null } };
      }
    }
    return m;
  });
}

export function useChatEngine(key: ConversationKey) {
  const { kind, id: conversationId } = key;
  const parentCol: 'event_id' | 'circle_id' = kind === 'event' ? 'event_id' : 'circle_id';
  const parentFields: Record<string, string> = { [parentCol]: conversationId };

  // Messages in chronological order (oldest → newest), matching the
  // non-inverted FlashList the engine renders.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const currentUserIdRef = useRef<string>('');
  const messagesRef = useRef<ChatMessage[]>([]);
  const reactionInFlightRef = useRef<Set<string>>(new Set());
  const cancelledRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const hasMoreRef = useRef(false);
  const queryClient = useQueryClient();

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setCurrentUserId(user.id);
        currentUserIdRef.current = user.id;
      }
    }).catch((err) => logError(err, 'useChatEngine.getUser'));
  }, []);

  const setMessagesSafe = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    if (!cancelledRef.current) setMessages(updater);
  }, []);

  // ── Hydration (post-paint): senders, reactions, off-page reply parents ──
  const hydrateMessages = useCallback(async (rows: ChatMessage[]) => {
    const ids = rows.map(m => m.id).filter(id => !id.startsWith('optimistic-'));
    const senderIds = [...new Set(rows.map(m => m.user_id).filter(Boolean))];
    const missingSenders = senderIds.filter(uid => !getCachedSender(uid));

    // Reply parents that live outside the loaded window: fetch stubs so the
    // quote renders even when the parent hasn't been paged in yet.
    const loadedIds = new Set(messagesRef.current.map(m => m.id));
    rows.forEach(m => loadedIds.add(m.id));
    const orphanParentIds = [...new Set(
      rows
        .map(m => m.reply_to_message_id)
        .filter((pid): pid is string => !!pid && !loadedIds.has(pid)),
    )];

    const [reactionsRes, parentsRes] = await Promise.all([
      ids.length > 0
        ? supabase.from('message_reactions').select('message_id, user_id, reaction').in('message_id', ids)
        : Promise.resolve({ data: [] as any[] }),
      orphanParentIds.length > 0
        ? supabase.from('messages').select('id, content, user_id').in('id', orphanParentIds)
        : Promise.resolve({ data: [] as any[] }),
      missingSenders.length > 0 ? ensureSenders(missingSenders) : Promise.resolve(),
    ]);
    if (cancelledRef.current) return;

    // Parent stubs may introduce senders of their own -- make sure their names
    // are cached before building the quote lines.
    const parentRows = (parentsRes.data ?? []) as { id: string; content: string; user_id: string }[];
    const parentSenderIds = parentRows.map(p => p.user_id).filter(uid => !getCachedSender(uid));
    if (parentSenderIds.length > 0) await ensureSenders(parentSenderIds);
    if (cancelledRef.current) return;

    const reactionsByMsg: Record<string, MessageReaction[]> = {};
    ((reactionsRes.data ?? []) as any[]).forEach((r: any) => {
      if (!reactionsByMsg[r.message_id]) reactionsByMsg[r.message_id] = [];
      reactionsByMsg[r.message_id].push({ user_id: r.user_id, reaction: r.reaction });
    });

    const parentById: Record<string, ReplyTo> = {};
    parentRows.forEach(p => {
      parentById[p.id] = {
        id: p.id,
        content: p.content,
        sender_name: getCachedSender(p.user_id)?.first_name ?? null,
      };
    });

    const hydratedIds = new Set(rows.map(m => m.id));
    setMessagesSafe(prev => resolveRepliesInPlace(prev.map(m => {
      if (!hydratedIds.has(m.id)) return m;
      let next = m;
      if (!next.sender) {
        const sender = getCachedSender(next.user_id);
        if (sender) next = { ...next, sender };
      }
      const reactions = reactionsByMsg[m.id];
      if (reactions) next = next === m ? { ...m, reactions } : { ...next, reactions };
      if (next.reply_to_message_id && !next.reply_to && parentById[next.reply_to_message_id]) {
        next = next === m ? { ...m, reply_to: parentById[next.reply_to_message_id] } : { ...next, reply_to: parentById[next.reply_to_message_id] };
      }
      return next;
    })));
  }, [setMessagesSafe]);

  // Read receipt + notification clear + badge refresh -- never on the paint path.
  const markRead = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelledRef.current) return;
      const readUpsert = kind === 'event'
        ? supabase.from('chat_reads').upsert(
            { event_id: conversationId, user_id: user.id, last_read_at: new Date().toISOString() },
            { onConflict: 'event_id,user_id' },
          )
        : supabase.from('chat_reads').upsert(
            { circle_id: conversationId, user_id: user.id, last_read_at: new Date().toISOString() },
            { onConflict: 'user_id,circle_id' },
          );
      const notifClear = kind === 'event'
        ? supabase.from('app_notifications')
            .update({ status: 'read' })
            .eq('user_id', user.id)
            .eq('event_id', conversationId)
            .eq('type', 'new_message')
            .eq('status', 'unread')
        : Promise.resolve({ data: null });
      // Blocklist refresh rides the same background pass; last-known applies
      // synchronously on fetch, this keeps it current.
      const [, , { data: profile }] = await Promise.all([
        readUpsert,
        notifClear,
        supabase.from('profiles').select('blocked_users').eq('id', user.id).maybeSingle(),
      ]);
      if (cancelledRef.current) return;
      if (profile) {
        const blockedLookup: Record<string, boolean> = {};
        (profile.blocked_users ?? []).forEach((uid: string) => { blockedLookup[uid] = true; });
        blockedIdsCache = blockedLookup;
        setMessagesSafe(prev => prev.filter(m => !blockedLookup[m.user_id]));
      }
      queryClient.invalidateQueries({ queryKey: UNREAD_CHATS_KEY });
    } catch (err) {
      logError(err, 'useChatEngine.markRead');
    }
  }, [kind, conversationId, queryClient, setMessagesSafe]);

  // ── Initial page / focus resync ──────────────────────────────────────────
  const fetchNewestPage = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select(MESSAGE_COLS)
        .eq(parentCol, conversationId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(INITIAL_PAGE);
      if (error) throw error;
      if (cancelledRef.current) return;

      const page = (data ?? [])
        .slice()
        .reverse()
        .filter((m: any) => !blockedIdsCache[m.user_id])
        .map(attachCachedSender);
      const more = (data ?? []).length === INITIAL_PAGE;
      hasMoreRef.current = more;
      setHasMore(more);

      setMessagesSafe(prev => {
        if (prev.length === 0) return resolveRepliesInPlace(page);
        // Focus resync: merge the fresh newest page into what's loaded without
        // dropping older pages the user already scrolled in. In-flight
        // optimistic rows stay until their own ack/echo reconciles them.
        const byId = new Map(prev.map(m => [m.id, m]));
        page.forEach(m => {
          const existing = byId.get(m.id);
          byId.set(m.id, existing ? { ...existing, ...m, sender: existing.sender ?? m.sender, reactions: existing.reactions?.length ? existing.reactions : m.reactions, reply_to: existing.reply_to ?? m.reply_to } : m);
        });
        const merged = [...byId.values()].sort((a, b) =>
          a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at));
        return resolveRepliesInPlace(merged);
      });

      // Post-paint hydration + read receipt, fire-and-forget.
      void hydrateMessages(page).catch(err => logError(err, 'useChatEngine.hydrate'));
      void markRead();
    } catch (err) {
      logError(err, 'useChatEngine.fetchNewestPage');
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [parentCol, conversationId, hydrateMessages, markRead, setMessagesSafe]);

  // ── Older history (cursor-paged) ─────────────────────────────────────────
  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasMoreRef.current) return;
    const oldest = messagesRef.current.find(m => !m.id.startsWith('optimistic-'));
    if (!oldest) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      // Compound cursor: strictly older, or same-timestamp with a smaller id
      // (matches the fetch ordering created_at desc, id desc).
      const { data, error } = await supabase
        .from('messages')
        .select(MESSAGE_COLS)
        .eq(parentCol, conversationId)
        .or(`created_at.lt.${oldest.created_at},and(created_at.eq.${oldest.created_at},id.lt.${oldest.id})`)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(OLDER_PAGE);
      if (error) throw error;
      if (cancelledRef.current) return;

      const page = (data ?? [])
        .slice()
        .reverse()
        .filter((m: any) => !blockedIdsCache[m.user_id])
        .map(attachCachedSender);
      const more = (data ?? []).length === OLDER_PAGE;
      hasMoreRef.current = more;
      setHasMore(more);

      if (page.length > 0) {
        setMessagesSafe(prev => {
          const known = new Set(prev.map(m => m.id));
          const fresh = page.filter(m => !known.has(m.id));
          return resolveRepliesInPlace([...fresh, ...prev]);
        });
        void hydrateMessages(page).catch(err => logError(err, 'useChatEngine.hydrateOlder'));
      }
    } catch (err) {
      logError(err, 'useChatEngine.loadOlder');
    } finally {
      loadingOlderRef.current = false;
      if (!cancelledRef.current) setLoadingOlder(false);
    }
  }, [parentCol, conversationId, hydrateMessages, setMessagesSafe]);

  // ── Realtime (batched inserts) ───────────────────────────────────────────
  const insertBufferRef = useRef<any[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushInserts = useCallback(async () => {
    flushTimerRef.current = null;
    const batch = insertBufferRef.current;
    insertBufferRef.current = [];
    if (batch.length === 0 || cancelledRef.current) return;

    const senderIds = [...new Set(batch.map(m => m.user_id).filter(Boolean))]
      .filter(uid => !getCachedSender(uid));
    if (senderIds.length > 0) {
      try { await ensureSenders(senderIds); } catch {}
    }
    if (cancelledRef.current) return;

    setMessagesSafe(prev => {
      let next = prev;
      let changed = false;
      for (const raw of batch) {
        if (blockedIdsCache[raw.user_id]) continue;
        const incoming = attachCachedSender(raw);
        if (next.some(m => m.id === incoming.id)) continue;
        // Reconcile exactly ONE matching optimistic row from this sender
        // (same rule as useChat: a blanket strip dropped rapid second sends).
        const optIdx = next.findIndex(m =>
          m.id.startsWith('optimistic-') &&
          m.user_id === incoming.user_id &&
          (m.content ?? '') === (incoming.content ?? '') &&
          (m.image_url ?? null) === (incoming.image_url ?? null) &&
          (m.reply_to_message_id ?? null) === (incoming.reply_to_message_id ?? null),
        );
        let msg = incoming;
        if (msg.reply_to_message_id) {
          const parent = next.find(m => m.id === msg.reply_to_message_id);
          if (parent) {
            msg = { ...msg, reply_to: { id: parent.id, content: parent.content, sender_name: parent.sender?.first_name ?? null } };
          }
        }
        if (optIdx >= 0) {
          const copy = next.slice();
          copy[optIdx] = msg;
          next = copy;
        } else {
          next = [...next, msg];
        }
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [setMessagesSafe]);

  useEffect(() => {
    if (!conversationId) return;
    cancelledRef.current = false;
    fetchNewestPage().catch((err) => logError(err, 'useChatEngine.fetchNewestPage'));

    // Distinct channel name so an engine thread and a legacy thread can never
    // collide on the same channel while both code paths exist.
    const channelName = kind === 'event' ? `chat-engine:${conversationId}` : `chat-engine:circle:${conversationId}`;
    const filter = `${parentCol}=eq.${conversationId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter },
        (payload) => {
          insertBufferRef.current.push(payload.new);
          if (!flushTimerRef.current) {
            flushTimerRef.current = setTimeout(() => {
              void flushInserts();
            }, REALTIME_FLUSH_MS);
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter },
        (payload) => {
          const updated = payload.new as any;
          if (updated?.id) {
            setMessagesSafe(prev => prev.map(m =>
              m.id === updated.id ? { ...m, content: updated.content, image_url: updated.image_url } : m,
            ));
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages', filter },
        (payload) => {
          const deleted = payload.old as any;
          if (deleted?.id) {
            setMessagesSafe(prev => prev.filter(m => m.id !== deleted.id));
          }
        },
      )
      .subscribe();

    return () => {
      cancelledRef.current = true;
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      insertBufferRef.current = [];
      supabase.removeChannel(channel);
    };
  }, [kind, conversationId, parentCol, fetchNewestPage, flushInserts, setMessagesSafe]);

  // ── Reactions / delete / edit (same semantics as useChat) ────────────────
  const toggleReaction = useCallback(async (messageId: string, reaction = 'heart') => {
    const userId = currentUserIdRef.current;
    if (!userId) return;
    if (reactionInFlightRef.current.has(messageId)) return;
    reactionInFlightRef.current.add(messageId);

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
        setMessagesSafe(prev => prev.map(m =>
          m.id === messageId
            ? { ...m, reactions: (m.reactions ?? []).filter(r => r.user_id !== userId) }
            : m,
        ));
        const { error: delErr } = await supabase.from('message_reactions').delete().eq('id', existing.id);
        if (delErr) throw delErr;
      } else if (existing) {
        setMessagesSafe(prev => prev.map(m =>
          m.id === messageId
            ? { ...m, reactions: (m.reactions ?? []).map(r => r.user_id === userId ? { ...r, reaction } : r) }
            : m,
        ));
        const { error: updErr } = await supabase.from('message_reactions').update({ reaction }).eq('id', existing.id);
        if (updErr) throw updErr;
      } else {
        setMessagesSafe(prev => prev.map(m =>
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
    } catch (err) {
      logError(err, 'useChatEngine.toggleReaction');
      setMessagesSafe(prev => prev.map(m =>
        m.id === messageId ? { ...m, reactions: snapshot } : m,
      ));
    } finally {
      reactionInFlightRef.current.delete(messageId);
    }
  }, [setMessagesSafe]);

  const deleteMessage = useCallback(async (messageId: string) => {
    const userId = currentUserIdRef.current;
    if (!userId) return;

    let previousMessages: ChatMessage[] = [];
    setMessagesSafe(prev => { previousMessages = prev; return prev.filter(m => m.id !== messageId); });

    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId)
      .eq('user_id', userId);

    if (error) {
      logError(error, 'useChatEngine.deleteMessage');
      setMessagesSafe(() => previousMessages);
      Alert.alert('Could not delete', 'Something went wrong. Please try again.');
    }
  }, [setMessagesSafe]);

  const editMessage = useCallback(async (messageId: string, newContent: string) => {
    const userId = currentUserIdRef.current;
    if (!userId) return;

    setMessagesSafe(prev => prev.map(m =>
      m.id === messageId ? { ...m, content: newContent } : m,
    ));

    const { error } = await supabase
      .from('messages')
      .update({ content: newContent })
      .eq('id', messageId)
      .eq('user_id', userId);

    if (error) {
      logError(error, 'useChatEngine.editMessage');
      fetchNewestPage(true).catch((e) => logError(e, 'useChatEngine.fetchNewestPage'));
      Alert.alert('Could not edit', 'Something went wrong. Please try again.');
    }
  }, [fetchNewestPage, setMessagesSafe]);

  // ── Sends (optimistic, reconcile on ack) ─────────────────────────────────
  const sendMessage = useCallback(async (content: string, imageUrl?: string, replyToId?: string) => {
    const filter = checkContent(content);
    if (!filter.ok) {
      Alert.alert('Content not allowed', filter.reason ?? 'Please revise your message.');
      return;
    }

    const userId = currentUserIdRef.current;
    if (!userId) return;

    const optimisticId = nextOptimisticId();
    let replyTo: ReplyTo | null = null;
    if (replyToId) {
      const parentMsg = messagesRef.current.find(m => m.id === replyToId);
      if (parentMsg) {
        replyTo = { id: parentMsg.id, content: parentMsg.content, sender_name: parentMsg.sender?.first_name ?? null };
      }
    }

    const optimisticMsg: ChatMessage = {
      id: optimisticId,
      ...parentFields,
      user_id: userId,
      content: content || '',
      message_type: 'user',
      image_url: imageUrl ?? null,
      created_at: new Date().toISOString(),
      reply_to_message_id: replyToId ?? null,
      reply_to: replyTo,
      reactions: [],
      sender: getCachedSender(userId),
    };
    setMessagesSafe(prev => [...prev, optimisticMsg]);

    const insertData: any = {
      ...parentFields,
      user_id: userId,
      content: content || '',
      message_type: 'user',
      image_url: imageUrl ?? null,
    };
    if (replyToId && replyTo) insertData.reply_to_message_id = replyToId;

    const { data: inserted, error } = await supabase.from('messages').insert(insertData).select('id, created_at').single();

    if (error) {
      logError(error, 'useChatEngine.sendMessage');
      setMessagesSafe(prev => prev.filter(m => m.id !== optimisticId));
      Alert.alert("Couldn't send message", 'Your message failed to send. Please try again.');
    } else if (inserted) {
      setMessagesSafe(prev => prev.map(m =>
        m.id === optimisticId ? { ...m, id: inserted.id, created_at: inserted.created_at } : m,
      ));
    }
  }, [kind, conversationId, setMessagesSafe]);

  const sendLocation = useCallback(async (lat: number, lng: number, address: string) => {
    const userId = currentUserIdRef.current;
    if (!userId) return;

    const content = JSON.stringify({ lat, lng, address });
    const optimisticId = nextOptimisticId();
    const optimisticMsg: ChatMessage = {
      id: optimisticId,
      ...parentFields,
      user_id: userId,
      content,
      message_type: 'location',
      image_url: null,
      created_at: new Date().toISOString(),
      reactions: [],
      sender: getCachedSender(userId),
    };
    setMessagesSafe(prev => [...prev, optimisticMsg]);

    const { data: inserted, error } = await supabase.from('messages').insert({
      ...parentFields,
      user_id: userId,
      content,
      message_type: 'location',
    }).select('id, created_at').single();

    if (error) {
      logError(error, 'useChatEngine.sendLocation');
      setMessagesSafe(prev => prev.filter(m => m.id !== optimisticId));
      Alert.alert("Couldn't send location", 'Your location failed to send. Please try again.');
    } else if (inserted) {
      setMessagesSafe(prev => prev.map(m =>
        m.id === optimisticId ? { ...m, id: inserted.id, created_at: inserted.created_at } : m,
      ));
    }
  }, [kind, conversationId, setMessagesSafe]);

  const sendAudio = useCallback(async (audioUrl: string, durationSeconds: number) => {
    const userId = currentUserIdRef.current;
    if (!userId) return;

    const optimisticId = nextOptimisticId();
    const optimisticMsg: ChatMessage = {
      id: optimisticId,
      ...parentFields,
      user_id: userId,
      content: '',
      message_type: 'audio',
      image_url: null,
      audio_url: audioUrl,
      duration_seconds: durationSeconds,
      created_at: new Date().toISOString(),
      reactions: [],
      sender: getCachedSender(userId),
    };
    setMessagesSafe(prev => [...prev, optimisticMsg]);

    const { data: inserted, error } = await supabase.from('messages').insert({
      ...parentFields,
      user_id: userId,
      content: '',
      message_type: 'audio',
      audio_url: audioUrl,
      duration_seconds: durationSeconds,
    }).select('id, created_at').single();

    if (error) {
      logError(error, 'useChatEngine.sendAudio');
      setMessagesSafe(prev => prev.filter(m => m.id !== optimisticId));
      Alert.alert("Couldn't send voice message", 'Your voice message failed to send. Please try again.');
    } else if (inserted) {
      setMessagesSafe(prev => prev.map(m =>
        m.id === optimisticId ? { ...m, id: inserted.id, created_at: inserted.created_at } : m,
      ));
    }
  }, [kind, conversationId, setMessagesSafe]);

  return {
    messages,
    loading,
    loadingOlder,
    hasMore,
    currentUserId,
    sendMessage,
    sendLocation,
    sendAudio,
    deleteMessage,
    editMessage,
    toggleReaction,
    loadOlder,
    refetch: fetchNewestPage,
  };
}
