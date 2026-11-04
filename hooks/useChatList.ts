import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { GROUPS_ENABLED, CHAT_ENGINE_ENABLED } from '../constants/FeatureFlags';
import { chatListMemoryCache, subscribeChatListPrivacy } from '../lib/chatListCache';
import { comparePreviewTimes, formatChatPreview, reconcilePreviewSnapshot, type ChatPreview } from '../lib/chatPreview';
import { fetchCircleChats, fetchCircleChatsViaCards } from '../lib/circleChatListReads';
import { fetchEventChatPreviews } from '../lib/eventChatListReads';
export type { ChatPreview } from '../lib/chatPreview';

function sortChatPreviews(previews: ChatPreview[]): ChatPreview[] {
  const active = previews
    .filter(preview => !preview.is_past)
    .sort((a, b) => comparePreviewTimes(b.last_message_at, a.last_message_at));
  const past = previews
    .filter(preview => preview.is_past)
    .sort((a, b) => b.start_time.localeCompare(a.start_time));
  return [...active, ...past];
}

export function useChatList(knownUserId: string | null | undefined) {
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const userIdRef = useRef<string | null>(null);
  const currentViewer = useRef(knownUserId);
  currentViewer.current = knownUserId;
  // Keep committed rows synchronous across independent reads and realtime
  // callbacks. React may batch renders; the cache must follow the same rows.
  const rowsRef = useRef<ChatPreview[]>([]);
  const showChats = useCallback((next: ChatPreview[] | ((rows: ChatPreview[]) => ChatPreview[]), cacheOwner?: string | null) => {
    if (cacheOwner && (currentViewer.current !== cacheOwner || userIdRef.current !== cacheOwner)) return;
    const rows = typeof next === 'function' ? next(rowsRef.current) : next;
    rowsRef.current = rows;
    if (cacheOwner) chatListMemoryCache.set(cacheOwner, rows);
    setChats(rows);
  }, []);
  const requestVersion = useRef(0);
  const removals = useRef({ sequence: 0, at: new Map<string, number>() });
  const livePreviews = useRef({ sequence: 0, at: new Map<string, number>() });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestVersion.current++; }; }, []);
  // Sender name cache (user_id -> first_name_display), populated from the roster
  // fetch so the realtime handler doesn't fire a profiles_public lookup per
  // incoming message.
  const senderNameCacheRef = useRef<Map<string, string>>(new Map());

  const fetchChats = useCallback(async (silent = false) => {
    if (!mounted.current || currentViewer.current !== knownUserId || knownUserId === undefined) return;
    if (knownUserId === null) {
      setLoading(false);
      return;
    }
    const version = ++requestVersion.current;
    const removalSequence = removals.current.sequence;
    const previewSequence = livePreviews.current.sequence;
    const current = () => mounted.current && currentViewer.current === knownUserId && requestVersion.current === version;
    const read = async <T,>(work: PromiseLike<T>): Promise<T> => {
      const result = await requestWithDeadline(work, 12_000);
      if (!current()) throw new Error('Chat list request retired');
      return result;
    };
    const userId = knownUserId;
    userIdRef.current = userId;
    const names = new Map<string, string>();
    let latest = chatListMemoryCache.get(userId) ?? [];
    const pending = { event: true, circle: GROUPS_ENABLED };
    const failed = { event: false, circle: false };
    if (!silent && latest.length === 0) setLoading(true);

    // Publish each independent conversation type as soon as it is ready.
    // A failed branch keeps only its own last confirmed rows; it cannot erase
    // or delay successful conversations from the other branch.
    const publish = (kind: ChatPreview['kind'], rows: ChatPreview[] | null, complete: boolean, error = false) => {
      if (!current()) return;
      latest = chatListMemoryCache.get(userId) ?? latest;
      if (rows !== null) {
        const currentRows = new Map(latest.filter(chat => chat.kind === kind).map(chat => [chat.conversationId, chat]));
        latest = [...latest.filter(chat => chat.kind !== kind), ...rows
          .filter(chat => (removals.current.at.get(chat.conversationId) ?? 0) <= removalSequence)
          .map(chat => reconcilePreviewSnapshot(chat,
            (livePreviews.current.at.get(`${kind}:${chat.conversationId}`) ?? 0) > previewSequence
              ? currentRows.get(chat.conversationId) : undefined))];
      }
      if (complete) pending[kind] = false;
      failed[kind] = error;
      const sorted = sortChatPreviews(latest);
      chatListMemoryCache.set(userId, sorted);
      senderNameCacheRef.current = names;
      showChats(sorted);
      setLoadError(failed.event || failed.circle);
      setLoading(sorted.length === 0 && (pending.event || pending.circle));
    };

    const loadEvents = async () => {
      try {
        const eventPreviews = await fetchEventChatPreviews(userId, names, read, silent ? undefined : {
          cachedRows: () => latest,
          publish: rows => publish('event', rows, false),
        });
        publish('event', eventPreviews, true);
      } catch {
        publish('event', null, true, true);
      }
    };
    const loadCircles = async () => {
      if (!GROUPS_ENABLED) return;
      try {
        let rows: ChatPreview[];
        if (CHAT_ENGINE_ENABLED) {
          try {
            rows = await read(fetchCircleChatsViaCards(userId, names));
          } catch {
            if (!current()) return;
            rows = await read(fetchCircleChats(userId, names));
          }
        } else {
          rows = await read(fetchCircleChats(userId, names));
        }
        publish('circle', rows, true);
      } catch {
        publish('circle', null, true, true);
      }
    };
    await Promise.all([loadEvents(), loadCircles()]);
  }, [knownUserId, showChats]);

  useEffect(() => {
    requestVersion.current++;
    userIdRef.current = knownUserId ?? null;
    removals.current = { sequence: 0, at: new Map() };
    livePreviews.current = { sequence: 0, at: new Map() };
    senderNameCacheRef.current = new Map();
    setLoadError(false);
    // A block may have changed on another device while this observer was gone.
    // Keep ordinary warm rows, but never paint a prior visit's private preview
    // until the existing mutual-block check authorizes it again. Retire it in
    // the shared cache too: a faster Plan response must not republish the DM.
    const previous = knownUserId ? chatListMemoryCache.get(knownUserId) : undefined;
    const safeWarmRows = previous?.filter(chat => !chat.is_dm);
    if (knownUserId && safeWarmRows) chatListMemoryCache.set(knownUserId, safeWarmRows);
    showChats(safeWarmRows ?? []);
    if (knownUserId === undefined) { setLoading(true); return; }
    if (knownUserId === null) {
      showChats([]);
      setLoading(false);
      return;
    }
    const cached = chatListMemoryCache.get(knownUserId);
    if (cached) {
      showChats(cached);
      setLoading(false);
    }
    void fetchChats(!!cached);
  }, [fetchChats]);

  useEffect(() => subscribeChatListPrivacy(viewerId => {
    if (!mounted.current || currentViewer.current !== viewerId || knownUserId !== viewerId) return;
    // Retire reads and realtime hydration started before the confirmed block.
    // A network failure must never restore the removed cached private row.
    requestVersion.current++;
    showChats(chatListMemoryCache.get(viewerId) ?? []);
    void fetchChats(true);
  }), [knownUserId, fetchChats]);

  // The caller has confirmed delete-chat / leave-circle (doc 120). Keep older
  // in-flight snapshots from restoring that row, without suppressing unrelated
  // rows or a later read after an intentional rejoin.
  const removeChat = useCallback((conversationId: string) => {
    if (!mounted.current || !knownUserId || currentViewer.current !== knownUserId) return;
    removals.current.at.set(conversationId, ++removals.current.sequence);
    showChats(prev => prev.filter(c => c.conversationId !== conversationId), knownUserId);
  }, [knownUserId, showChats]);

  const convIdsRef = useRef(new Set<string>());
  useEffect(() => {
    convIdsRef.current = new Set(chats.map(c => c.conversationId));
  }, [chats]);

  const hasChatsRef = useRef(false);
  useEffect(() => {
    hasChatsRef.current = chats.length > 0;
  }, [chats.length]);

  useEffect(() => {
    let active = true;
    let arrival = 0;
    const latestArrival = new Map<string, number>();
    const isCurrent = () => active && mounted.current && currentViewer.current === knownUserId;
    const channel = supabase
      .channel('chat-list-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          const version = requestVersion.current;
          const isCurrentPreview = () => isCurrent() && requestVersion.current === version;
          const msg = payload.new as any;
          // Match either parent. circle_id is only considered behind the flag
          // (and is null on event messages), so plan chats are unaffected.
          const convId = msg?.event_id ?? (GROUPS_ENABLED ? msg?.circle_id : null);
          if (!isCurrentPreview() || !convId || !hasChatsRef.current || !convIdsRef.current.has(convId)) return;

          const sequence = ++arrival;
          latestArrival.set(convId, sequence);

          // Incremental update: patch the affected chat instead of full refetch
          try {
            const isOwn = userIdRef.current === msg.user_id;
            let senderName: string | null = isOwn ? 'You' : null;
            if (!isOwn && msg.user_id) {
              // Prefer the cached sender name (seeded from the roster fetch);
              // only hit profiles_public on a miss, then cache it.
              senderName = senderNameCacheRef.current.get(msg.user_id) ?? null;
              if (senderName == null) {
                const { data: profile } = await requestWithDeadline(supabase
                  .from('profiles_public')
                  .select('first_name_display')
                  .eq('id', msg.user_id)
                  .maybeSingle(), 12_000);
                if (!isCurrentPreview()) return;
                senderName = profile?.first_name_display ?? null;
                if (senderName) senderNameCacheRef.current.set(msg.user_id, senderName);
              }
            }
            const preview = formatChatPreview(msg, senderName);

            showChats(prev => {
              if (!isCurrentPreview()) return prev;
              const updated = prev.map(c => {
                if (c.conversationId !== convId) return c;
                const order = comparePreviewTimes(msg.created_at, c.last_message_at);
                // Sender hydration can finish out of order. Keep the newest
                // text/time, but still count each incoming message as unread.
                const replacePreview = order > 0 || (order === 0 && latestArrival.get(convId) === sequence);
                if (replacePreview) livePreviews.current.at.set(`${c.kind}:${convId}`, ++livePreviews.current.sequence);
                return {
                  ...c,
                  last_message: replacePreview ? preview : c.last_message,
                  last_message_at: replacePreview ? msg.created_at : c.last_message_at,
                  unread_count: isOwn ? c.unread_count : c.unread_count + 1,
                };
              });
              // Re-sort: active chats by last_message_at desc
              const active = updated.filter(c => !c.is_past).sort((a, b) =>
                comparePreviewTimes(b.last_message_at, a.last_message_at));
              const past = updated.filter(c => c.is_past);
              return [...active, ...past];
            }, knownUserId);
          } catch {
            // Fallback: full refetch only for this active account.
            if (isCurrentPreview()) void fetchChats(true);
          }
        },
      )
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [fetchChats, knownUserId]);

  return { chats: currentViewer.current === userIdRef.current ? chats : [], loading, loadError, refetch: fetchChats, removeChat };
}
