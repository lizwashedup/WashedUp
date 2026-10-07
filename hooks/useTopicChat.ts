import { validOptionalMentionDocument, trimChatMentionDocument, sameChatMentionIdentity, type ChatMentionDocument } from '../lib/chatMentionIdentity';
import type { TopicDraftEdit } from '../lib/topicComposerDraft';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';

import { checkContent } from '../lib/contentFilter';
import {
  getTopicMessages,
  getCommunityBroadcasts,
  type TopicMessage,
  type TopicMessageReaction,
  type CommunityBroadcast,
} from '../lib/communityChat';
import { getCommunityMessageAnchorWindow, CommunityMessageUnavailableError, type CommunityMessageAnchor } from '../lib/communityMessageAnchor';
import { getCommunityRoomHistory, type CommunityRoomCursor } from '../lib/communityRoomHistory';
import { chronologicalCommunityRoomItems, replaceCommunitySourceWindow } from '../lib/communityRoomWindow';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { logError } from '../lib/logger';
import { mergeTopicMessagesWithPending } from '../lib/topicPendingMessages';
import { CHAT_NEWEST_PAGE_SIZE, replaceNewestChatPage } from '../lib/chatPaging';
import { resolveChatSendReceipt } from '../lib/chatSendReceipt';
import { supabase } from '../lib/supabase';
import { getBlockedWith } from '../lib/blocking';
import { useObservedUser } from './useObservedUser';
import { readLoadedTopicReactions } from '../lib/chatReactionReader';
import { readLoadedTopicEdits } from '../lib/topicLoadedHistory';

/** The request may have reached the server; its former UI no longer owns it. */
export class ObsoleteTopicOperationError extends Error {
  constructor() {
    super('This chat changed while that action was pending. Check the original chat before trying again.');
    this.name = 'ObsoleteTopicOperationError';
  }
}
export function isObsoleteTopicOperation(error: unknown): error is ObsoleteTopicOperationError {
  return error instanceof ObsoleteTopicOperationError;
}

type ReactionIntent = { selected: string; desired: string | null };

/** Retry keeps the original desired state; it must never toggle it again. */
export class UnconfirmedTopicReactionError extends Error {
  constructor(readonly retry: () => Promise<void>) {
    super('We could not confirm your reaction. Retry checks first and keeps the same change.');
    this.name = 'UnconfirmedTopicReactionError';
  }
}
export function isUnconfirmedTopicReaction(error: unknown): error is UnconfirmedTopicReactionError {
  return error instanceof UnconfirmedTopicReactionError;
}

function replaceUserReaction(reactions: TopicMessageReaction[], userId: string, next: TopicMessageReaction | undefined) {
  const others = reactions.filter(reaction => reaction.user_id !== userId);
  return next ? [...others, next] : others;
}

// A read is a snapshot. Keep confirmed sends and local changes made after it
// started, while still replacing unchanged rows in the newest server window.
function reconcileNewestTopicMessages(
  current: TopicMessage[], page: TopicMessage[], startedWith: ReadonlyMap<string, TopicMessage>,
  hasMore: boolean,
  window?: { cursor: CommunityRoomCursor | null; hasMore: boolean },
): TopicMessage[] {
  const currentById = new Map(current.map(message => [message.id, message]));
  const pageIds = new Set(page.map(message => message.id));
  const persisted = current.filter(message => message.delivery_state !== 'sending');
  const unchanged = persisted.filter(message => startedWith.get(message.id) === message);
  const changed = persisted.filter(message => startedWith.get(message.id) !== message &&
    // The server remains authoritative for a newly confirmed client UUID.
    !(pageIds.has(message.id) && (!startedWith.has(message.id) || startedWith.get(message.id)?.delivery_state === 'sending')));
  const refreshed = (window ? replaceCommunitySourceWindow(unchanged, page, 'topic', window)
    : hasMore ? replaceNewestChatPage(unchanged, page) : page).filter(message =>
    !startedWith.has(message.id) || currentById.has(message.id));
  return mergeTopicMessagesWithPending([...refreshed, ...changed], []);
}

export type TopicRoomContext = { kind: 'intros'; communityId: string } | { kind: 'waiting'; error?: boolean };
export function useTopicChat(topicId: string | undefined, context?: TopicRoomContext, anchor?: CommunityMessageAnchor | null) {
  const coreCommunityId = context?.kind === 'intros' ? context.communityId : undefined;
  const paused = context?.kind === 'waiting';
  const queryClient = useQueryClient();
  const { viewerId, epoch, isCurrent: isCurrentViewer, error: identityError, isLoading: identityLoading, retry: retryIdentity } = useObservedUser();
  const currentUserId = viewerId ?? null;
  const [introBroadcasts, setIntroBroadcasts] = useState<CommunityBroadcast[]>([]);
  const introBroadcastsRef = useRef<CommunityBroadcast[]>([]);
  const [messages, setMessages] = useState<TopicMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [anchorUnavailable, setAnchorUnavailable] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderLoadError, setOlderLoadError] = useState(false);
  const profileScope = useMemo(() => ({}), [viewerId, epoch]);
  const [profile, setProfile] = useState<{ scope: object; name: string | null; photo: string | null } | null>(null);
  const currentUserName = profile?.scope === profileScope ? profile.name : null;
  const currentUserPhoto = profile?.scope === profileScope ? profile.photo : null;
  const messagesRef = useRef<TopicMessage[]>([]);
  const reactionInFlightRef = useRef(new Set<string>());
  const reactionIntentsRef = useRef(new Map<string, ReactionIntent>());
  const messageChangesRef = useRef(new Map<string, object>());
  const editsInFlightRef = useRef(new Map<string, object>());
  const pendingMessagesRef = useRef(new Map<string, TopicMessage>());
  const loadingOlderRef = useRef(false);
  const hasOlderRef = useRef(false);
  const olderCursorRef = useRef<{ created_at: string; id: string } | CommunityRoomCursor | null>(null);
  const loadedOlderRef = useRef(false);
  const newestTopicMessageIdsRef = useRef(new Set<string>());
  const newestBroadcastIdsRef = useRef(new Set<string>());
  const newestCoreWindowRef = useRef<{ cursor: CommunityRoomCursor | null; hasMore: boolean } | undefined>(undefined);
  // Account epochs also retire a visit, including Alice → Bob → Alice in one
  // room. The observer's synchronous identity ref closes the pre-render gap.
  const roomGeneration = useMemo(() => ({ topicId, viewerId, epoch, coreCommunityId, paused }), [topicId, viewerId, epoch, coreCommunityId, paused]);
  const activeRoomGenerationRef = useRef<typeof roomGeneration | null>(null);
  const isCurrentRoom = useCallback(() => activeRoomGenerationRef.current === roomGeneration && !paused && isCurrentViewer(), [roomGeneration, paused, isCurrentViewer]);
  const windowGeneration = useMemo(() => ({ roomGeneration }), [roomGeneration, anchor?.id, anchor?.source]);
  const requestedWindowRef = useRef<typeof windowGeneration | null>(windowGeneration);
  useLayoutEffect(() => {
    requestedWindowRef.current = windowGeneration;
    return () => { if (requestedWindowRef.current === windowGeneration) requestedWindowRef.current = null; };
  }, [windowGeneration]);
  const snapshotWindowRef = useRef<typeof windowGeneration | null>(null);
  const mutationRoomRef = useRef<typeof roomGeneration | null>(null);
  const isCurrentWindow = useCallback(() => isCurrentRoom() && requestedWindowRef.current === windowGeneration, [isCurrentRoom, windowGeneration]);
  const newestRequestRef = useRef(0);
  const olderRequestRef = useRef(0);
  const newestReadRef = useRef<{ generation: typeof roomGeneration } | null>(null);
  const realtimeQueueRef = useRef<{
    generation: typeof roomGeneration; pending: boolean; inFlight: boolean;
  } | null>(null);
  const [realtimeRevision, setRealtimeRevision] = useState(0);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { introBroadcastsRef.current = introBroadcasts; }, [introBroadcasts]);

  useEffect(() => {
    let active = true;
    if (!viewerId) return;
    void (async () => {
      const { data, error } = await supabase
        .from('profiles_public')
        .select('first_name_display, profile_photo_url')
        .eq('id', viewerId)
        .maybeSingle();
      if (!active || !isCurrentViewer()) return;
      if (error) throw error;
      setProfile({ scope: profileScope, name: data?.first_name_display ?? null, photo: data?.profile_photo_url ?? null });
    })().catch((error) => { if (active && isCurrentViewer()) logError(error, 'useTopicChat.profile'); });
    return () => { active = false; };
  }, [viewerId, profileScope, isCurrentViewer]);

  const readPage = useCallback(async (cursor?: { created_at: string; id: string } | CommunityRoomCursor) => {
    if (!isCurrentWindow()) throw new ObsoleteTopicOperationError();
    if (anchor && !cursor) {
      const page = await getCommunityMessageAnchorWindow(coreCommunityId
        ? { kind: 'intros', communityId: coreCommunityId, topicId: topicId! } : { kind: 'topic', topicId: topicId! },
      anchor, { userId: viewerId ?? '', isCurrent: isCurrentWindow });
      return {
        messages: page.messages.flatMap(item => item.source === 'topic' ? [item.message] : []),
        broadcasts: page.messages.flatMap(item => item.source === 'broadcast' ? [item.message] : []),
        hasMore: page.hasMore, olderCursor: page.olderCursor,
        window: coreCommunityId ? { cursor: page.olderCursor as CommunityRoomCursor | null, hasMore: page.hasMore } : undefined,
      };
    }
    if (!coreCommunityId) return { ...await getTopicMessages(topicId!, cursor), broadcasts: [] as CommunityBroadcast[], window: undefined };
    const page = await getCommunityRoomHistory(coreCommunityId, 'intros', { userId: viewerId ?? '', isCurrent: isCurrentWindow }, cursor as CommunityRoomCursor | undefined);
    return {
      messages: page.messages.flatMap(item => item.source === 'topic' ? [item.message] : []),
      broadcasts: page.messages.flatMap(item => item.source === 'broadcast' ? [item.message] : []),
      hasMore: page.hasMore, olderCursor: page.olderCursor,
      window: { cursor: page.olderCursor, hasMore: page.hasMore },
    };
  }, [coreCommunityId, topicId, viewerId, isCurrentWindow, anchor?.id, anchor?.source]);

  const refresh = useCallback(async (silent = false) => {
    if (!topicId || !isCurrentRoom()) return;
    if (!viewerId) { if (!silent && viewerId === undefined) await retryIdentity(); return; }
    const request = ++newestRequestRef.current;
    const read = { generation: roomGeneration };
    newestReadRef.current = read;
    const isCurrent = () => isCurrentWindow() && newestRequestRef.current === request;
    const startedWith = new Map(messagesRef.current.map(message => [message.id, message]));
    // Explicit foreground retries supersede pagination. Silent message/reaction
    // refreshes keep its lock so a busy room cannot starve older-history reads.
    if (!silent) {
      olderRequestRef.current += 1;
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
    if (!silent) setLoading(true);
    try {
      const page = await requestWithDeadline(readPage(), 12_000);
      if (!isCurrent()) return;
      const blocked = await requestWithDeadline(getBlockedWith(viewerId, [...messagesRef.current, ...introBroadcastsRef.current].map((message) => message.sender_id)), 12_000);
      if (!isCurrent()) return;
      const keepOlderCursor = page.hasMore && (loadedOlderRef.current || (silent && loadingOlderRef.current));
      if (!keepOlderCursor) {
        olderCursorRef.current = page.olderCursor;
        loadedOlderRef.current = false;
        hasOlderRef.current = page.hasMore;
      }
      setHasOlder(hasOlderRef.current);
      newestCoreWindowRef.current = page.window;
      newestTopicMessageIdsRef.current = new Set(page.messages.map(message => message.id));
      newestBroadcastIdsRef.current = new Set(page.broadcasts.map(message => message.id));
      setMessages((current) => {
        if (!isCurrent()) return current;
        const visible = current.filter(message => !blocked.has(message.sender_id));
      const visiblePage = page.messages.filter(message => !blocked.has(message.sender_id));
        return mergeTopicMessagesWithPending(
          !page.window && visiblePage.length === 0 && page.hasMore
            ? visible
            : reconcileNewestTopicMessages(visible, visiblePage, startedWith, page.hasMore, page.window),
          pendingMessagesRef.current.values(),
        );
      });
      if (page.window) setIntroBroadcasts(current => isCurrent() ? replaceCommunitySourceWindow(
        current.filter(message => !message.sender_id || !blocked.has(message.sender_id)), page.broadcasts,
        'broadcast', page.window!,
      ) : current);
      setLoadError(false);
      setAnchorUnavailable(false);
    } catch (error) {
      if (isCurrent()) {
        setAnchorUnavailable(error instanceof CommunityMessageUnavailableError);
        if (error instanceof CommunityMessageUnavailableError) { setMessages([]); setIntroBroadcasts([]); }
        logError(error, 'useTopicChat.refresh');
        setLoadError(true);
      }
    } finally {
      if (isCurrent()) setLoading(false);
      if (newestReadRef.current === read) newestReadRef.current = null;
      const queue = realtimeQueueRef.current;
      // Automatic work waits behind an initial or explicit read. Wake it only
      // once that read has scheduled its accepted snapshot/loading state.
      if (isCurrent() && queue?.generation === roomGeneration && queue.pending && !queue.inFlight) {
        setRealtimeRevision(revision => revision + 1);
      }
    }
  }, [topicId, viewerId, retryIdentity, isCurrentRoom, roomGeneration, readPage, isCurrentWindow]);

  const loadOlder = useCallback(async () => {
    if (!topicId || !isCurrentRoom() || loadingOlderRef.current || !hasOlderRef.current) return;
    const cursor = olderCursorRef.current;
    if (!cursor) return;
    const request = ++olderRequestRef.current;
    const ownsRequest = () => isCurrentWindow() && olderRequestRef.current === request;
    const isCurrent = ownsRequest;
    const startedWith = new Map(messagesRef.current.map(message => [message.id, message]));
    const startedWithBroadcasts = new Map(introBroadcastsRef.current.map(message => [message.id, message]));
    const startedWindow = newestCoreWindowRef.current;
    const coveredByNewerWindow = (message: { id: string; created_at: string }, source: 'topic' | 'broadcast') => {
      const latest = newestCoreWindowRef.current;
      return !!latest && latest !== startedWindow && replaceCommunitySourceWindow([message], [], source, latest).length === 0;
    };
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setOlderLoadError(false);
    try {
      const page = await requestWithDeadline(readPage(cursor), 12_000);
      // A newest read that completed after this older read began may have
      // replaced the cursor. Never advance from a now-obsolete page boundary.
      if (!isCurrent() || olderCursorRef.current !== cursor) return;
      olderCursorRef.current = page.olderCursor;
      loadedOlderRef.current = true;
      hasOlderRef.current = page.hasMore;
      setHasOlder(hasOlderRef.current);
      if (page.window) setIntroBroadcasts(current => {
        if (!isCurrent()) return current;
        const currentById = new Map(current.map(message => [message.id, message]));
        const incoming = page.broadcasts.filter(message => {
          if (coveredByNewerWindow(message, 'broadcast')) return false;
          const latest = currentById.get(message.id);
          if (startedWithBroadcasts.has(message.id) && !latest) return false;
          return !latest || startedWithBroadcasts.get(message.id) === latest;
        });
        return [...new Map([...current, ...incoming].map(message => [message.id, message])).values()];
      });
      setMessages((current) => {
        if (!isCurrent()) return current;
        const currentById = new Map(current.map(message => [message.id, message]));
        const incoming = page.messages.filter(message => {
          if (coveredByNewerWindow(message, 'topic')) return false;
          const latest = currentById.get(message.id);
          if (startedWith.has(message.id) && !latest) return false;
          return !latest || latest.delivery_state === 'sending' || startedWith.get(message.id) === latest;
        });
        return mergeTopicMessagesWithPending([...current, ...incoming], pendingMessagesRef.current.values());
      });
    } catch (error) {
      if (isCurrent() && olderCursorRef.current === cursor) {
        logError(error, 'useTopicChat.loadOlder');
        setOlderLoadError(true);
      }
    } finally {
      if (ownsRequest()) {
        loadingOlderRef.current = false;
        setLoadingOlder(false);
      }
    }
  }, [topicId, isCurrentWindow, readPage]);

  useEffect(() => {
    activeRoomGenerationRef.current = roomGeneration;
    let active = true;
    // Switching between a notification and Latest changes the read window,
    // not ownership of an in-flight send, edit or reaction in this same room.
    if (mutationRoomRef.current !== roomGeneration) {
      pendingMessagesRef.current = new Map();
      reactionInFlightRef.current = new Set();
      reactionIntentsRef.current = new Map();
      messageChangesRef.current = new Map();
      editsInFlightRef.current = new Map();
      mutationRoomRef.current = roomGeneration;
    }
    snapshotWindowRef.current = windowGeneration;
    messagesRef.current = [...pendingMessagesRef.current.values()];
    introBroadcastsRef.current = []; setIntroBroadcasts([]);
    setMessages(messagesRef.current);
    setLoadError(false);
    setAnchorUnavailable(false);
    loadingOlderRef.current = false;
    setLoadingOlder(false);
    hasOlderRef.current = false;
    olderCursorRef.current = null;
    loadedOlderRef.current = false;
    newestTopicMessageIdsRef.current = new Set();
    newestBroadcastIdsRef.current = new Set();
    newestCoreWindowRef.current = undefined;
    setHasOlder(false);
    setOlderLoadError(false);
    if (!topicId || !viewerId || paused) {
      setLoading(false);
      return () => { if (isCurrentRoom()) activeRoomGenerationRef.current = null; };
    }
    // Owned by this committed effect, including effect teardown/restart, rather
    // than shared with a previous visit that happened to use the same topic ID.
    const queue = { generation: roomGeneration, pending: false, inFlight: false };
    realtimeQueueRef.current = queue;
    void refresh();

    const refreshIfActive = () => {
      if (!active || !isCurrentRoom() || realtimeQueueRef.current !== queue || queue.pending) return;
      queue.pending = true;
      setRealtimeRevision(revision => revision + 1);
    };
    const reactionBelongsHere = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
      const messageId = (payload.new?.message_id ?? payload.old?.message_id) as string | undefined;
      return !!messageId && messagesRef.current.some((message) => message.id === messageId);
    };
    const reactionQueue = { pending: false, running: false };
    const ownsReactionRead = () => active && isCurrentWindow() && snapshotWindowRef.current === windowGeneration;
    const refreshLoadedReactions = async () => {
      // Newest-page enrichment already handles the normal short conversation.
      if (!ownsReactionRead() || !loadedOlderRef.current) return;
      reactionQueue.pending = true;
      if (reactionQueue.running) return;
      reactionQueue.running = true;
      try {
        while (ownsReactionRead() && reactionQueue.pending) {
          reactionQueue.pending = false;
          const before = new Map(messagesRef.current.filter(message => message.delivery_state !== 'sending' && !newestTopicMessageIdsRef.current.has(message.id))
            .map(message => [message.id, message.reactions]));
          const rows = await readLoadedTopicReactions([...before.keys()], ownsReactionRead);
          if (!rows || !ownsReactionRead()) return;
          const byMessage = new Map<string, TopicMessageReaction[]>();
          for (const row of rows) {
            const reactions = byMessage.get(row.message_id) ?? [];
            reactions.push({ user_id: row.user_id, reaction: row.reaction });
            byMessage.set(row.message_id, reactions);
          }
          setMessages(current => ownsReactionRead() ? current.map(message => {
            if (!before.has(message.id)) return message;
            const beforeMine = before.get(message.id)?.find(reaction => reaction.user_id === viewerId);
            const currentMine = message.reactions.find(reaction => reaction.user_id === viewerId);
            const remote = byMessage.get(message.id) ?? [];
            const preserveMine = reactionInFlightRef.current.has(message.id) || beforeMine?.reaction !== currentMine?.reaction;
            return { ...message, reactions: preserveMine ? replaceUserReaction(remote, viewerId, currentMine) : remote };
          }) : current);
        }
      } catch (error) {
        if (ownsReactionRead()) logError(error, 'useTopicChat.loadedReactions');
      } finally {
        reactionQueue.running = false;
        if (ownsReactionRead() && reactionQueue.pending) void refreshLoadedReactions();
      }
    };

    const editQueue = { pending: false, running: false };
    const refreshLoadedEdits = async () => {
      if (!ownsReactionRead() || !loadedOlderRef.current) return;
      editQueue.pending = true;
      if (editQueue.running) return;
      editQueue.running = true;
      try {
        while (ownsReactionRead() && editQueue.pending) {
          editQueue.pending = false;
          const before = new Map(messagesRef.current.filter(message => message.delivery_state !== 'sending'
            && !newestTopicMessageIdsRef.current.has(message.id) && !editsInFlightRef.current.has(message.id))
            .map(message => [message.id, { message, revision: messageChangesRef.current.get(message.id) }]));
          const rows = await readLoadedTopicEdits(topicId, [...before.keys()], ownsReactionRead);
          if (!rows || !ownsReactionRead()) return;
          const byId = new Map(rows.map(row => [row.id, row]));
          setMessages(current => ownsReactionRead() ? current.flatMap(message => {
            const previous = before.get(message.id);
            if (!previous || editsInFlightRef.current.has(message.id)
              || previous.revision !== messageChangesRef.current.get(message.id)
              || previous.message.body !== message.body || previous.message.edited_at !== message.edited_at
              || previous.message.mention_data !== message.mention_data) return [message];
            const remote = byId.get(message.id);
            return remote ? [{ ...message, body: remote.body, edited_at: remote.edited_at,
              mention_data: remote.mention_data }] : [];
          }) : current);
        }
      } catch (error) {
        if (ownsReactionRead()) logError(error, 'useTopicChat.loadedEdits');
      } finally {
        editQueue.running = false;
        if (ownsReactionRead() && editQueue.pending) void refreshLoadedEdits();
      }
    };

    const broadcastQueue = { pending: false, running: false };
    const refreshLoadedBroadcasts = async () => {
      if (!coreCommunityId || !ownsReactionRead() || !loadedOlderRef.current) return;
      broadcastQueue.pending = true;
      if (broadcastQueue.running) return;
      broadcastQueue.running = true;
      try {
        while (ownsReactionRead() && broadcastQueue.pending) {
          broadcastQueue.pending = false;
          const before = new Map(introBroadcastsRef.current.filter(message => !newestBroadcastIdsRef.current.has(message.id))
            .map(message => [message.id, message]));
          const ids = [...before.keys()];
          const byId = new Map<string, CommunityBroadcast>();
          for (let offset = 0; offset < ids.length; offset += CHAT_NEWEST_PAGE_SIZE) {
            if (!ownsReactionRead()) return;
            const page = await requestWithDeadline(getCommunityBroadcasts(coreCommunityId, undefined,
              { userId: viewerId, isCurrent: ownsReactionRead },
              { messageIds: ids.slice(offset, offset + CHAT_NEWEST_PAGE_SIZE), strictEnrichment: true, broadcastKind: 'intro' }), 12_000);
            if (!ownsReactionRead()) return;
            for (const message of page.messages) byId.set(message.id, message);
          }
          // Apply only a complete, still-owned snapshot. Newest-page writes and
          // rows added/removed while this read was pending retain their identity.
          setIntroBroadcasts(current => ownsReactionRead() ? current.flatMap(message =>
            before.get(message.id) === message ? (byId.has(message.id) ? [byId.get(message.id)!] : []) : [message]) : current);
        }
      } catch (error) {
        if (ownsReactionRead()) logError(error, 'useTopicChat.loadedIntros');
      } finally {
        broadcastQueue.running = false;
        if (ownsReactionRead() && broadcastQueue.pending) void refreshLoadedBroadcasts();
      }
    };
    const refreshBroadcastsIfActive = () => {
      void refreshLoadedBroadcasts();
      refreshIfActive();
    };

    const channel = supabase
      .channel(`community-topic-chat:${topicId}`)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'community_topic_messages' }, payload => {
        // PostgreSQL DELETE payloads contain the primary key, not topic_id.
        // Only a message already present in this room needs reconciliation.
        const deletedId = (payload.old as { id?: string })?.id;
        if (!isCurrentRoom() || !deletedId) return;
        if (messagesRef.current.some(message => message.id === deletedId)) {
          setMessages(current => isCurrentRoom() ? current.filter(message => message.id !== deletedId) : current);
          refreshIfActive();
        }
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'community_topic_messages', filter: `topic_id=eq.${topicId}` },
        payload => {
          // Re-read older rows instead of trusting an out-of-order UPDATE payload.
          if (payload?.eventType === 'UPDATE') void refreshLoadedEdits();
          refreshIfActive();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'community_topic_message_reactions' },
        (payload) => {
          // DELETE payloads only carry this table's replica-identity column (its
          // own id), never message_id, so reactionBelongsHere can't be checked --
          // refresh unconditionally rather than silently drop the update.
          if (payload.eventType === 'DELETE' || reactionBelongsHere(payload as any)) {
            void refreshLoadedReactions();
            refreshIfActive();
          }
        },
      );
    if (coreCommunityId) {
      channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'community_broadcasts' }, payload => {
        const id = (payload.old as { id?: string })?.id;
        if (!ownsReactionRead() || !id || !introBroadcastsRef.current.some(message => message.id === id)) return;
        setIntroBroadcasts(current => ownsReactionRead() ? current.filter(message => message.id !== id) : current);
        refreshBroadcastsIfActive();
      });
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'community_broadcasts', filter: `community_id=eq.${coreCommunityId}` }, refreshBroadcastsIfActive)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'community_broadcast_reactions' }, refreshBroadcastsIfActive)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'community_broadcast_replies' }, refreshBroadcastsIfActive);
    }
    channel.on('system', {}, payload => {
      // A channel join can precede PostgreSQL readiness. Catch up after the
      // stream is ready, including messages committed during a reconnect.
      if (payload?.status === 'ok' && payload?.extension === 'postgres_changes') {
        void refreshLoadedBroadcasts();
        void refreshLoadedEdits();
        void refreshLoadedReactions();
        refreshIfActive();
      }
    }).subscribe();

    return () => {
      active = false;
      queue.pending = false;
      if (realtimeQueueRef.current === queue) realtimeQueueRef.current = null;
      if (newestReadRef.current?.generation === roomGeneration) newestReadRef.current = null;
      if (isCurrentRoom()) activeRoomGenerationRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [topicId, viewerId, refresh, roomGeneration, isCurrentRoom, isCurrentWindow, coreCommunityId, paused, windowGeneration]);

  useEffect(() => {
    const queue = realtimeQueueRef.current;
    if (!isCurrentRoom() || queue?.generation !== roomGeneration || !queue.pending || queue.inFlight ||
      newestReadRef.current?.generation === roomGeneration) return;
    queue.pending = false;
    queue.inFlight = true;
    void refresh(true).finally(() => {
      queue.inFlight = false;
      if (isCurrentRoom() && realtimeQueueRef.current === queue && queue.pending) {
        // Start catch-up in a post-commit effect, not the same promise chain:
        // the just-completed owned snapshot must paint before another request
        // increments its sequence. Events collapse into one pending flag.
        setRealtimeRevision(revision => revision + 1);
      }
    });
  }, [realtimeRevision, isCurrentRoom, refresh, roomGeneration]);

  const invalidateLists = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
    queryClient.invalidateQueries({ queryKey: ['community-chat-rows'] });
  }, [queryClient]);

  const sendMessage = useCallback(async (
    body: string, imageUrl?: string, replyToId?: string,
    location?: { latitude: number; longitude: number },
    sendIdOverride?: string,
    mentions?: ChatMentionDocument | null,
    sendScope?: { userId: string; isCurrent: () => boolean },
  ) => {
    const isCurrentSend = () => isCurrentRoom() && (!sendScope || sendScope.userId === viewerId && sendScope.isCurrent());
    if (!isCurrentSend()) throw new ObsoleteTopicOperationError();
    const userId = viewerId;
    const trimmed = body.trim().slice(0, 4000);
    if (!validOptionalMentionDocument(body, mentions) || mentions && body.trim().length > 4000) throw Error('Your selected mentions could not be checked.');
    const mentionData = mentions ? trimChatMentionDocument(body, mentions) : null;
    if (!topicId || !userId) throw new Error('This chat is not ready yet. Try again in a moment.');
    if (!trimmed && !imageUrl) throw new Error('Write a message before sending.');
    const filter = checkContent(trimmed);
    if (!filter.ok) throw new Error(filter.reason ?? 'Please revise your message.');

    const parent = replyToId
      ? messagesRef.current.find((message) => message.id === replyToId)
        ?? (await requestWithDeadline(getTopicMessages(topicId, undefined, { userId, isCurrent: isCurrentSend }, { messageIds: [replyToId], strictEnrichment: true }), 12_000)).messages.find(message => message.id === replyToId) ?? null
      : null;
    if (!isCurrentSend()) throw new ObsoleteTopicOperationError();
    if (replyToId && !parent) throw Error('The original message is unavailable. Your reply is kept.');
    const optimisticId = sendIdOverride ?? Crypto.randomUUID();
    const optimistic: TopicMessage = {
      id: optimisticId,
      body: trimmed,
      ...(mentions !== undefined ? { mention_data: mentionData } : {}),
      created_at: new Date().toISOString(),
      sender_id: userId,
      sender_name: currentUserName,
      sender_photo: currentUserPhoto,
      image_url: imageUrl ?? null,
      location_lat: location?.latitude ?? null,
      location_lng: location?.longitude ?? null,
      delivery_state: 'sending',
      reply_to_message_id: parent?.id ?? null,
      edited_at: null,
      reply_to: parent
        ? { id: parent.id, body: parent.body, sender_name: parent.sender_name }
        : null,
      reactions: [],
    };
    const pending = pendingMessagesRef.current;
    pending.set(optimisticId, optimistic);
    // Capture now: a fast receipt can remove the map entry before React runs
    // this updater. The following confirmation still owns the same UUID.
    const optimisticPending = [...pending.values()];
    setMessages((current) => isCurrentSend() ? mergeTopicMessagesWithPending(current, optimisticPending) : current);

    const media = !!imageUrl || !!location;
    const columns = media ? `id, created_at, body, image_url, location_lat, location_lng, reply_to_message_id${mentionData ? ', mention_data' : ''}` : mentionData ? 'id, created_at, body, mention_data' : 'id, created_at';
    const checkedReceipt = (result: any) => result.data &&
      ((media && (result.data.id !== optimisticId || result.data.body !== trimmed || result.data.image_url !== (imageUrl ?? null) ||
        result.data.location_lat !== (location?.latitude ?? null) || result.data.location_lng !== (location?.longitude ?? null) ||
        result.data.reply_to_message_id !== (parent?.id ?? null))) ||
        (mentionData && (result.data.body !== trimmed || !sameChatMentionIdentity(trimmed, mentionData, result.data.mention_data))))
        ? { data: null, error: Error('The saved message differs. Your original is kept.') } : result;
    const { receipt: confirmed, failure: insertFailure } = await resolveChatSendReceipt(
      async () => checkedReceipt(await requestWithDeadline(supabase
        .from('community_topic_messages')
        .insert({
          id: optimisticId,
          topic_id: topicId,
          sender_id: userId,
          body: trimmed,
          ...(mentions !== undefined ? { mention_data: mentionData } : {}),
          image_url: imageUrl ?? null,
          ...(location ? { location_lat: location.latitude, location_lng: location.longitude } : {}),
          reply_to_message_id: parent?.id ?? null,
        })
        .select(columns)
        .single(), 12_000)),
      async () => {
        if (!isCurrentSend()) throw new ObsoleteTopicOperationError();
        return checkedReceipt(await requestWithDeadline(supabase
        .from('community_topic_messages')
        .select(columns)
        .eq('id', optimisticId)
        .eq('topic_id', topicId)
        .eq('sender_id', userId)
        .maybeSingle(), 8_000));
      },
    );
    if (!isCurrentSend()) {
      if (pending.get(optimisticId) === optimistic) pending.delete(optimisticId);
      setMessages(current => isCurrentRoom() ? current.filter(message => message !== optimistic) : current);
      throw new ObsoleteTopicOperationError();
    }
    if (!confirmed) {
      if (pending.get(optimisticId) === optimistic) pending.delete(optimisticId);
      setMessages((current) => isCurrentSend() ? current.filter((message) => message !== optimistic) : current);
      if (insertFailure) logError(insertFailure, 'useTopicChat.sendMessage');
      throw new Error('Delivery could not be confirmed. Check this chat before trying again.');
    }
    pending.delete(optimisticId);
    setMessages((current) => isCurrentSend() ? current.map((message) =>
        message.id === optimisticId
          ? { ...message, id: confirmed.id, created_at: confirmed.created_at, delivery_state: undefined }
          : message,
      ) : current);
    invalidateLists();
  }, [currentUserName, currentUserPhoto, invalidateLists, topicId, viewerId, isCurrentRoom]);

  const sendLocation = useCallback(async (latitude: number, longitude: number, address: string, sendId?: string, sendScope?: { userId: string; isCurrent: () => boolean }) => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new Error('Choose a valid location before sending.');
    }
    await sendMessage(address.trim() || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`, undefined, undefined, { latitude, longitude }, sendId, undefined, sendScope);
  }, [sendMessage]);

  const editMessage = useCallback(async (messageId: string, body: string, mentions?: ChatMentionDocument | null, expected?: TopicDraftEdit) => {
    if (!isCurrentRoom()) throw new ObsoleteTopicOperationError();
    const userId = viewerId;
    const trimmed = body.trim().slice(0, 4000);
    if (!validOptionalMentionDocument(body, mentions) || mentions && body.trim().length > 4000) throw Error('Your selected mentions could not be checked.');
    const mentionData = mentions ? trimChatMentionDocument(body, mentions) : null;
    if (expected && !validOptionalMentionDocument(expected.body, expected.mentions)) throw Error('The original mentions could not be checked.');
    const checksIdentity = mentions !== undefined || expected?.mentions !== undefined;
    if (!userId || !trimmed) return;
    const filter = checkContent(trimmed);
    if (!filter.ok) throw new Error(filter.reason ?? 'Please revise your message.');
    const snapshot = messagesRef.current.find(message => message.id === messageId);
    const attempt = {};
    const changes = messageChangesRef.current;
    changes.set(messageId, attempt);
    const inFlight = editsInFlightRef.current;
    inFlight.set(messageId, attempt);
    const isCurrent = () => isCurrentRoom() && changes.get(messageId) === attempt;
    const editedAt = new Date().toISOString();
    setMessages((current) => isCurrent() ? current.map((message) =>
      message.id === messageId ? { ...message, body: trimmed, edited_at: editedAt, ...(checksIdentity ? { mention_data: mentionData } : {}) } : message,
    ) : current);
    try {
      let query = supabase.from('community_topic_messages')
        .update({ body: trimmed, edited_at: editedAt, ...(checksIdentity ? { mention_data: mentionData } : {}) })
        .eq('id', messageId).eq('sender_id', userId);
      // Restored pre-mention edits still carry their original body/revision.
      // Keep that conditional-write contract even when identity data is absent.
      if (checksIdentity || expected) {
        const original = expected ?? snapshot;
        if (!original) throw Error('The original message is unavailable. Your edit is kept.');
        const originalMentions = expected ? expected.mentions : snapshot?.mention_data;
        query = query.eq('topic_id', topicId).eq('body', original.body);
        query = original.edited_at == null ? query.is('edited_at', null) : query.eq('edited_at', original.edited_at);
        if (checksIdentity) query = originalMentions == null ? query.is('mention_data', null) : query.eq('mention_data', JSON.stringify(originalMentions));
        const result = await requestWithDeadline(query.select('id, body, mention_data').maybeSingle(), 12_000);
        if (!isCurrent()) throw new ObsoleteTopicOperationError();
        if (result.error) throw result.error;
        if (result.data?.id !== messageId || result.data.body !== trimmed || checksIdentity && !sameChatMentionIdentity(trimmed, mentionData, result.data.mention_data)) throw Error('Your changes have not been confirmed. Your edit is kept.');
      } else {
        const { error } = await query;
        if (!isCurrent()) throw new ObsoleteTopicOperationError();
        if (error) throw error;
      }
    } catch (error) {
      if (!isCurrent()) throw new ObsoleteTopicOperationError();
      // Roll back only this still-visible edit. A newer server/local body,
      // other fields, deleted rows and newly arrived messages remain intact.
      if (snapshot) setMessages(current => isCurrent() ? current.map(message =>
        message.id === messageId && message.body === trimmed && message.edited_at === editedAt
          ? { ...message, body: snapshot.body, edited_at: snapshot.edited_at, ...(checksIdentity ? { mention_data: snapshot.mention_data } : {}) } : message) : current);
      throw error;
    } finally {
      if (inFlight.get(messageId) === attempt) inFlight.delete(messageId);
    }
  }, [viewerId, isCurrentRoom, topicId]);

  const deleteMessage = useCallback(async (messageId: string) => {
    if (!isCurrentRoom()) throw new ObsoleteTopicOperationError();
    const userId = viewerId;
    if (!userId) return;
    const snapshot = messagesRef.current.find(message => message.id === messageId);
    const attempt = {};
    const changes = messageChangesRef.current;
    changes.set(messageId, attempt);
    const isCurrent = () => isCurrentRoom() && changes.get(messageId) === attempt;
    setMessages((current) => isCurrent() ? current.filter((message) => message.id !== messageId) : current);
    try {
      const { error } = await supabase
        .from('community_topic_messages')
        .delete()
        .eq('id', messageId)
        .eq('sender_id', userId);
      if (!isCurrent()) throw new ObsoleteTopicOperationError();
      if (error) throw error;
      invalidateLists();
    } catch (error) {
      if (!isCurrent()) throw new ObsoleteTopicOperationError();
      if (snapshot) setMessages(current => isCurrent() && !current.some(message => message.id === messageId)
        ? mergeTopicMessagesWithPending([...current, snapshot], []) : current);
      throw error;
    }
  }, [invalidateLists, viewerId, isCurrentRoom]);

  const toggleReaction = useCallback(async function changeReaction(messageId: string, reaction: string, expectedIntent?: ReactionIntent): Promise<void> {
    if (!isCurrentRoom()) throw new ObsoleteTopicOperationError();
    const userId = viewerId;
    const inFlight = reactionInFlightRef.current;
    const intents = reactionIntentsRef.current;
    if (expectedIntent && intents.get(messageId) !== expectedIntent) throw new ObsoleteTopicOperationError();
    if (!userId || inFlight.has(messageId)) return;
    inFlight.add(messageId);
    const retained = intents.get(messageId);
    const resumed = retained?.selected === reaction ? retained : undefined;
    // A newer explicit choice retires an old alert, even if its read fails.
    if (retained && !resumed) intents.delete(messageId);
    const snapshot = messagesRef.current.find((message) => message.id === messageId)?.reactions ?? [];
    const currentMine = snapshot.find((item) => item.user_id === userId);
    const optimisticMine = resumed
      ? (resumed.desired === null ? undefined : { user_id: userId, reaction: resumed.desired })
      : (currentMine?.reaction === reaction ? undefined : { user_id: userId, reaction });
    setMessages((prev) => isCurrentRoom() ? prev.map((message) =>
      message.id === messageId ? { ...message, reactions: replaceUserReaction(message.reactions, userId, optimisticMine) } : message,
    ) : prev);
    const readOwnReaction = async (timeout: number) => {
      const { data, error } = await requestWithDeadline(supabase
        .from('community_topic_message_reactions')
        .select('id, reaction')
        .eq('message_id', messageId)
        .eq('user_id', userId)
        .limit(1), timeout);
      if (!isCurrentRoom()) throw new ObsoleteTopicOperationError();
      if (error) throw error;
      return data?.[0] ?? null;
    };
    try {
      // Only the initial preflight chooses a toggle. An uncertain write's
      // explicit retry reuses its desired result, even if that write committed.
      const existing = await readOwnReaction(12_000);
      const intent = resumed ?? { selected: reaction, desired: existing?.reaction === reaction ? null : reaction };
      const nextMine = intent.desired === null ? undefined : { user_id: userId, reaction: intent.desired };
      if ((existing?.reaction ?? null) !== intent.desired) {
        intents.set(messageId, intent);
        try {
          const request = intent.desired === null
            ? supabase.from('community_topic_message_reactions').delete().eq('id', existing!.id)
            : existing
              ? supabase.from('community_topic_message_reactions').update({ reaction: intent.desired }).eq('id', existing.id)
              : supabase.from('community_topic_message_reactions').insert({ message_id: messageId, user_id: userId, reaction: intent.desired });
          const { error } = await requestWithDeadline(request, 12_000);
          if (!isCurrentRoom()) throw new ObsoleteTopicOperationError();
          if (error) throw error;
        } catch (error) {
          if (!isCurrentRoom()) throw new ObsoleteTopicOperationError();
          // A lost acknowledgement is not evidence the write failed. This
          // bounded read never dispatches a second mutation automatically.
          let confirmed = false;
          try { confirmed = ((await readOwnReaction(8_000))?.reaction ?? null) === intent.desired; }
          catch { if (!isCurrentRoom()) throw new ObsoleteTopicOperationError(); }
          if (!confirmed) throw new UnconfirmedTopicReactionError(() => changeReaction(messageId, reaction, intent));
        }
      }
      if (!isCurrentRoom()) throw new ObsoleteTopicOperationError();
      if (intents.get(messageId) === intent || intents.get(messageId) === retained) intents.delete(messageId);
      setMessages((prev) => isCurrentRoom() ? prev.map((message) =>
        message.id === messageId && message.reactions.find(item => item.user_id === userId) === optimisticMine
          ? { ...message, reactions: replaceUserReaction(message.reactions, userId, nextMine) } : message,
      ) : prev);
    } catch (error) {
      if (!isCurrentRoom()) throw new ObsoleteTopicOperationError();
      setMessages((prev) => isCurrentRoom() ? prev.map((message) =>
        message.id === messageId && message.reactions.find(item => item.user_id === userId) === optimisticMine
          ? { ...message, reactions: replaceUserReaction(message.reactions, userId, currentMine) } : message,
      ) : prev);
      // A failed retry preflight is still recovery of the retained change.
      if (resumed && intents.get(messageId) === resumed && !isUnconfirmedTopicReaction(error)) {
        throw new UnconfirmedTopicReactionError(() => changeReaction(messageId, reaction, resumed));
      }
      throw error;
    } finally {
      inFlight.delete(messageId);
    }
  }, [viewerId, isCurrentRoom]);

  return {
    messages: isCurrentWindow() && snapshotWindowRef.current === windowGeneration && !anchorUnavailable ? messages : [],
    anchorUnavailable: snapshotWindowRef.current === windowGeneration && anchorUnavailable,
    roomItems: isCurrentWindow() && snapshotWindowRef.current === windowGeneration && !anchorUnavailable && coreCommunityId ? chronologicalCommunityRoomItems([
      ...introBroadcasts.map(message => ({ key: `broadcast:${message.id}`, source: 'broadcast' as const, message })),
      ...messages.map(message => ({ key: `topic:${message.id}`, source: 'topic' as const, message })),
    ]) : [],
    loading: identityLoading || loading || snapshotWindowRef.current !== windowGeneration || (paused && !context?.error),
    loadError: !!identityError || loadError || (context?.kind === 'waiting' && !!context.error),
    hasOlder,
    loadingOlder,
    olderLoadError,
    currentUserId,
    currentUserName,
    isCurrent: isCurrentRoom,
    sendMessage,
    sendLocation,
    editMessage,
    deleteMessage,
    toggleReaction,
    refresh,
    loadOlder,
  };
}
