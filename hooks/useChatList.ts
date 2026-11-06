import { classifyInboxInsert, withInboxDelivery } from '../lib/inboxMessageEvidence';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { GROUPS_ENABLED, CHAT_ENGINE_ENABLED } from '../constants/FeatureFlags';
import { chatListMemoryCache, subscribeChatListChanges } from '../lib/chatListCache';
import { readMemberChatBlockPreferences } from '../lib/memberChatBlockPreferences';
import { copyPreviewActivity, restrictGroupPreview, comparePreviewTimes, formatChatPreview, reconcilePreviewSnapshot, type ChatPreview } from '../lib/chatPreview';
import { fetchCircleChats, fetchCircleChatsViaCards } from '../lib/circleChatListReads';
import { attributeGroupUnreads, replaceBlockedGroupActivity } from '../lib/memberInboxActivity';
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
  const unverifiedWarmGroups = useRef(new Map<string, ChatPreview>());
  const pendingGroupPrivacy = useRef<Promise<boolean> | null>(null);
  const groupBlocks = useRef<ReadonlySet<string> | null>(null);
  const visitBlocks = useRef(new Set<string>());
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
      const sorted = sortChatPreviews(latest.map(row => restrictGroupPreview(row, groupBlocks.current)));
      chatListMemoryCache.set(userId, sorted);
      senderNameCacheRef.current = names;
      showChats(sorted);
      setLoadError(failed.event || failed.circle);
      setLoading(sorted.length === 0 && (pending.event || pending.circle));
    };

    // A failed secondary read can keep prior previews only for confirmed memberships.
    const retainJoined = (kind: ChatPreview['kind'], joined: ReadonlySet<string>) => {
      if (!current()) return;
      const rows = (chatListMemoryCache.get(userId) ?? latest).filter(row => row.kind === kind);
      const retained = rows.filter(row => joined.has(row.conversationId));
      if (retained.length !== rows.length) publish(kind, retained, false);
    };

    let privacy: Promise<boolean> | undefined;
    const checkPrivacy = () => {
      if (privacy) return;
      privacy = read(readMemberChatBlockPreferences(userId)).then(ids => {
        if (!current()) return false;
        groupBlocks.current = new Set([...ids, ...visitBlocks.current]);

        // Restore only preview activity for rows still in this account's
        // list. A confirmed departure must never be restored by this read.
        const warm = unverifiedWarmGroups.current;
        const rows = (chatListMemoryCache.get(userId) ?? latest).map(row => {
          const previous = !row.is_dm && warm.get(row.kind + ':' + row.conversationId);
          return restrictGroupPreview(previous ? copyPreviewActivity(row, previous) : row, groupBlocks.current);
        });
        warm.clear();
        latest = rows;
        showChats(sortChatPreviews(rows), userId);
        return true;
      }).catch(() => false);
      pendingGroupPrivacy.current = privacy;
    };

    if (latest.some(row => !row.is_dm)) void checkPrivacy();

    const publishGroupActivity = async (kind: 'event' | 'circle', rows: ChatPreview[], partial = false) => {
      if (!rows.some(row => !row.is_dm)) { publish(kind, rows, true, partial); return; }
      checkPrivacy();
      if (!await privacy) {
        // Only this visit's confirmed activity can survive an offline read.
        const kept = new Map(rowsRef.current.filter(row => row.kind === kind && !row.is_dm).map(row => [row.conversationId, row]));
        publish(kind, rows.map(row => {
          if (row.is_dm) return row;
          const previous = kept.get(row.conversationId);
          return previous ? copyPreviewActivity(row, previous) : restrictGroupPreview(row, null);
        }), true, true);
        return;
      }
      if (!current()) return;
      const blocked = groupBlocks.current;
      if (!blocked?.size) { publish(kind, rows, true, partial); return; }
      try {
        const counted = await attributeGroupUnreads(kind, rows, userId, blocked, read);
        const visible = await replaceBlockedGroupActivity(kind, counted, userId, blocked, names, read);
        publish(kind, visible, true, partial);
      } catch {
        publish(kind, rows, true, true);
      }
    };

    const loadEvents = async () => {
      try {
        const eventPreviews = await fetchEventChatPreviews(userId, names, read, silent ? undefined : {
          cachedRows: () => latest,
          publish: rows => publish('event', rows, false),
        }, joined => {
          retainJoined('event', joined);
          if (joined.size) void checkPrivacy();
        });
        await publishGroupActivity('event', eventPreviews);
      } catch {
        publish('event', null, true, true);
      }
    };
    const loadCircles = async () => {
      if (!GROUPS_ENABLED) return;
      let incomplete = false;
      let confirmedMemberships: ReadonlySet<string> | undefined;
      const readCircles = async (fetch: typeof fetchCircleChats) => {
        let active = true;
        try {
          return await read(fetch(userId, names, joined => {
            if (active) {
              confirmedMemberships = joined;
              retainJoined('circle', joined);
            }
          }, () => { if (active) incomplete = true; }));
        } finally {
          // A timed-out cards request must not trim the fallback's newer rows.
          active = false;
        }
      };
      try {
        let rows: ChatPreview[];
        if (CHAT_ENGINE_ENABLED) {
          try {
            rows = await readCircles(fetchCircleChatsViaCards);
            if (incomplete && current()) {
              incomplete = false;
              try {
                rows = await readCircles(fetchCircleChats);
              } catch {
                // Keep separately verified group cards, within the latest
                // membership evidence. Private rows need a successful check.
                incomplete = true;
                rows = rows.filter(row => !row.is_dm && confirmedMemberships?.has(row.conversationId));
              }
            }
          } catch {
            if (!current()) return;
            rows = await readCircles(fetchCircleChats);
          }
        } else {
          rows = await readCircles(fetchCircleChats);
        }
        await publishGroupActivity('circle', rows, incomplete);
      } catch {
        publish('circle', null, true, true);
      }
    };
    await Promise.all([loadEvents(), loadCircles()]);
  }, [knownUserId, showChats]);

  useEffect(() => {
    requestVersion.current++;
    userIdRef.current = knownUserId ?? null;
    pendingGroupPrivacy.current = null;
    groupBlocks.current = null;
    visitBlocks.current = new Set();
    removals.current = { sequence: 0, at: new Map() };
    livePreviews.current = { sequence: 0, at: new Map() };
    senderNameCacheRef.current = new Map();
    setLoadError(false);
    // A block may have changed on another device while this observer was gone.
    // Keep ordinary warm rows, but never paint a prior visit's private preview
    // until the existing mutual-block check authorizes it again. Retire it in
    // the shared cache too: a faster Plan response must not republish the DM.
    const previous = knownUserId ? chatListMemoryCache.get(knownUserId) : undefined;
    unverifiedWarmGroups.current = new Map(previous?.filter(row => !row.is_dm).map(row => [row.kind + ':' + row.conversationId, row]));
    const safeWarmRows = previous?.filter(chat => !chat.is_dm).map(row => restrictGroupPreview(row, null));
    if (knownUserId && previous?.length) {
      if (safeWarmRows?.length) chatListMemoryCache.set(knownUserId, safeWarmRows);
      // With only unverified private rows we have no confirmed inbox snapshot.
      // Removing the entry also keeps an immediate second remount in loading.
      else chatListMemoryCache.delete(knownUserId);
    }
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

  useEffect(() => subscribeChatListChanges((viewerId, blockedId) => {
    if (!mounted.current || currentViewer.current !== viewerId || knownUserId !== viewerId) return;
    if (blockedId) {
      visitBlocks.current.add(blockedId);
      if (groupBlocks.current) groupBlocks.current = new Set([...groupBlocks.current, blockedId]);
    }
    // Retire reads that started before a confirmed block or plan departure.
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
    const hydrating = new Set<string>();
    let recheck: ReturnType<typeof setTimeout> | null = null;
    // A cards response may contain only a total. Coalesce ambiguous older
    // deliveries into one read; never treat identical times as identical IDs.
    const recheckSnapshot = () => {
      if (!recheck) recheck = setTimeout(() => { recheck = null; if (isCurrent()) void fetchChats(true); }, 200);
    };
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

          const kind = msg.event_id ? 'event' : 'circle';
          const match = (row: ChatPreview) => row.kind === kind && row.conversationId === convId;
          const target = rowsRef.current.find(match);
          if (!target) return;
          const group = !target.is_dm;
          if (group && pendingGroupPrivacy.current && !await pendingGroupPrivacy.current) return;
          if (!isCurrentPreview()) return;
          const mayShow = () => !group || (!!msg.user_id && groupBlocks.current !== null && !groupBlocks.current.has(msg.user_id));
          if (!mayShow()) return;
          const classify = (row?: ChatPreview) => classifyInboxInsert(row?.inbox_evidence, msg.id, msg.created_at);
          const status = classify(rowsRef.current.find(match));
          if (status === 'known') return;
          if (status === 'check') { recheckSnapshot(); return; }
          const delivery = msg.id ? JSON.stringify([version, kind, convId, msg.id]) : null;
          if (delivery && hydrating.has(delivery)) return;
          if (delivery) hydrating.add(delivery);
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
              if (!isCurrentPreview() || !mayShow()) return prev;
              const updated = prev.map(c => {
                if (!match(c)) return c;
                // Sender hydration may finish after a snapshot or another
                // delivery of this very same database row.
                const afterHydration = classify(c);
                if (afterHydration === 'known') return c;
                if (afterHydration === 'check') { recheckSnapshot(); return c; }
                const countUnread = !isOwn && afterHydration !== 'read';
                const order = comparePreviewTimes(msg.created_at, c.last_message_at);
                // Sender hydration can finish out of order. Keep the newest
                // text/time, but still count each incoming message as unread.
                const replacePreview = order > 0 || (order === 0 && latestArrival.get(convId) === sequence);
                if (replacePreview) livePreviews.current.at.set(`${c.kind}:${convId}`, ++livePreviews.current.sequence);
                return {
                  ...c, inbox_evidence: withInboxDelivery(c.inbox_evidence, msg.id, msg.created_at, c.last_message_at),
                  ...(!c.is_dm && {
                    last_message_user_id: replacePreview ? msg.user_id : c.last_message_user_id,
                    unread_by_author: !countUnread ? c.unread_by_author : {
                      ...c.unread_by_author, [msg.user_id]: (c.unread_by_author?.[msg.user_id] ?? 0) + 1,
                    },
                  }),
                  last_message: replacePreview ? preview : c.last_message,
                  last_message_at: replacePreview ? msg.created_at : c.last_message_at,
                  unread_count: countUnread ? c.unread_count + 1 : c.unread_count,
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
          } finally { if (delivery) hydrating.delete(delivery); }
        },
      )
      .subscribe();
    return () => {
      active = false;
      if (recheck) clearTimeout(recheck);
      supabase.removeChannel(channel);
    };
  }, [fetchChats, knownUserId]);

  return { chats: currentViewer.current === userIdRef.current ? chats : [], loading, loadError, refetch: fetchChats, removeChat };
}
