import { validOptionalMentionDocument, sameChatMentionIdentity, type ChatMentionDocument } from '../lib/chatMentionIdentity';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Alert } from 'react-native';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import { checkContent } from '../lib/contentFilter';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { logError } from '../lib/logger';
import { editOwnChatMessage, isChatEditRefused } from '../lib/chatMessageEdit';
import { readLoadedChatReactions } from '../lib/chatReactionReader';
import { getBlockedWith } from '../lib/blocking';
import { resolveChatSendReceipt } from '../lib/chatSendReceipt';
import { useQueryClient } from '@tanstack/react-query';
import { UNREAD_CHATS_KEY } from '../constants/QueryKeys';
import { useObservedUser } from './useObservedUser';
import { readObservedUser } from '../lib/observedUserRead';
import { getMemberChatAnchorWindow, MemberChatMessageUnavailableError } from '../lib/memberChatMessageAnchor';
import {
  CHAT_NEWEST_PAGE_SIZE,
  compareChatSequence,
  type ChatPageCursor,
  mergeChatBurst,
  olderChatFilter,
  oldestChatCursor,
  replaceNewestChatPage,
  toChronologicalChatPage,
} from '../lib/chatPaging';

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
  mention_data?: ChatMentionDocument | null;
  id: string;
  // A message is parented by EITHER an event (plan) OR a circle, never both
  // (DB XOR constraint). Both optional here so the same shape serves both.
  event_id?: string | null;
  circle_id?: string | null;
  user_id: string;
  content: string;
  message_type: 'user' | 'system' | 'location' | 'audio';
  image_url?: string | null;
  audio_url?: string | null;
  duration_seconds?: number | null;
  created_at: string;
  reply_to_message_id?: string | null;
  // A system message carrying ref_event_id renders as a compact plan card
  // (delivered by invite_person_to_plan / invite_people_to_plan).
  ref_event_id?: string | null;
  reply_to?: ReplyTo | null;
  reactions?: MessageReaction[];
  sender?: {
    id: string;
    first_name: string | null;
    avatar_url: string | null;
  } | null;
}

/**
 * A chat conversation is keyed by either a plan (event) or a circle. The hook
 * switches its data source, realtime channel, and read path on this key. Plan
 * chats behave exactly as before; the circle branch is reachable only behind
 * GROUPS_ENABLED + the gated circle route.
 */
export type ConversationKey =
  | { kind: 'event'; id: string }
  | { kind: 'circle'; id: string };

/** A caller may additionally retire an entry when its admission gate closes. */
export interface ChatOperationScope {
  readonly userId: string;
  readonly isCurrent: () => boolean;
}

export class ObsoleteChatOperationError extends Error {
  constructor() {
    super('This chat action belongs to a previous visit.');
    this.name = 'ObsoleteChatOperationError';
  }
}
export function isObsoleteChatOperation(error: unknown): error is ObsoleteChatOperationError {
  return error instanceof ObsoleteChatOperationError;
}
type ChatReactionIntent = { selected: string; desired: string | null; scope: ChatOperationScope };

export class UnconfirmedChatReactionError extends Error {
  constructor(readonly retry: () => Promise<void>) {
    super('We could not confirm your reaction. Retry checks first and keeps the same change.');
    this.name = 'UnconfirmedChatReactionError';
  }
}
export function isUnconfirmedChatReaction(error: unknown): error is UnconfirmedChatReactionError {
  return error instanceof UnconfirmedChatReactionError;
}

function assertChatScope(scope: ChatOperationScope): void {
  if (!scope.userId || !scope.isCurrent()) throw new ObsoleteChatOperationError();
}
async function scopedChatRequest<T>(scope: ChatOperationScope, request: () => PromiseLike<T>): Promise<T> {
  assertChatScope(scope);
  try { return await request(); } finally { assertChatScope(scope); }
}

async function attachSenders(messages: any[]): Promise<ChatMessage[]> {
  const allIds = messages.map(m => m.user_id).filter(Boolean);
  const userIds = allIds.filter((id: string, i: number) => allIds.indexOf(id) === i);
  if (userIds.length === 0) return messages as ChatMessage[];

  const { data: profiles, error: profileError } = await requestWithDeadline(supabase
    .from('profiles_public')
    .select('id, first_name_display, profile_photo_url')
    .in('id', userIds), 12_000);
  if (profileError) throw profileError;

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

// Reconcile a newest-page snapshot without undoing activity that happened
// while the read was pending. Object identity distinguishes the unchanged
// snapshot rows from realtime/local edits; UUIDs still identify actual sends.
function reconcileNewestMessages(
  current: ChatMessage[],
  page: ChatMessage[],
  startedWith: ReadonlyMap<string, ChatMessage>,
  hasMore: boolean,
): ChatMessage[] {
  const currentById = new Map(current.map(message => [message.id, message]));
  const persisted = current.filter(message => !message.id.startsWith('optimistic-'));
  const unchanged = persisted.filter(message => startedWith.get(message.id) === message);
  const changed = persisted.filter(message => startedWith.get(message.id) !== message);
  const refreshed = (hasMore ? replaceNewestChatPage(unchanged, page) : page).filter(message =>
    // A row removed locally during the request must not reappear from its
    // earlier server snapshot. Keep the original page boundary for history.
    !startedWith.has(message.id) || currentById.has(message.id),
  );
  const confirmedIds = new Set([...refreshed, ...changed].map(message => message.id));
  const optimistic = current.filter(message => message.id.startsWith('optimistic-') &&
    !confirmedIds.has(message.id.slice('optimistic-'.length)));
  return mergeChatBurst(mergeChatBurst(refreshed, changed), optimistic);
}

export function useChat(key: ConversationKey, anchorId: string | null = null) {
  const { viewerId, epoch, isCurrent: isCurrentViewer, error: identityError, isLoading: identityLoading, retry: retryIdentity } = useObservedUser();
  // Primitive fields drive all effect/callback deps so a fresh key object on
  // each render does not re-subscribe the realtime channel.
  const { kind, id: conversationId } = key;
  // Polymorphic parent column: plans use event_id, circles use circle_id.
  const parentCol: 'event_id' | 'circle_id' = kind === 'event' ? 'event_id' : 'circle_id';
  // Spread onto inserts/optimistic rows so exactly one parent column is set.
  const parentFields: Record<string, string> = { [parentCol]: conversationId };

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [olderLoadError, setOlderLoadError] = useState(false);
  const [anchorUnavailable, setAnchorUnavailable] = useState(false);
  const currentUserId = viewerId ?? '';
  // Ref so the real-time channel closure always has the latest blocked set
  const blockedIdsRef = useRef<Record<string, boolean>>({});
  const blockedReadyRef = useRef(false);
  const reactionInFlightRef = useRef<Set<string>>(new Set());
  const reactionIntentsRef = useRef(new Map<string, ChatReactionIntent>());
  const messageChangesRef = useRef(new Map<string, object>());
  const messagesRef = useRef<ChatMessage[]>([]);
  const loadingOlderRef = useRef(false);
  const hasOlderRef = useRef(false);
  const queryClient = useQueryClient();

  // Keep messagesRef in sync for stable callbacks
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Identity belongs to one visit, not just a room id: A → B → A creates a
  // new generation, so retired subscriptions and paging callbacks stay stale.
  const roomGeneration = useMemo(() => ({ kind, conversationId, viewerId, epoch }), [kind, conversationId, viewerId, epoch]);
  // A notification changes the read window, not the room's draft, sends or
  // realtime subscription. Every asynchronous read owns its exact window.
  const readWindow = useMemo(() => ({ anchorId, ready: false, upper: null as ChatPageCursor | null,
    older: null as ChatPageCursor | null }), [anchorId, roomGeneration]);
  const readWindowRef = useRef(readWindow); readWindowRef.current = readWindow;
  const appliedWindowRef = useRef<typeof readWindow | null>(null);
  const refreshWindowRef = useRef<(silent?: boolean) => Promise<void>>(async () => {});
  const activeRoomGenerationRef = useRef<typeof roomGeneration | null>(null);
  const isCurrentRoom = useCallback(() => activeRoomGenerationRef.current === roomGeneration && isCurrentViewer(), [roomGeneration, isCurrentViewer]);
  const operationScope = useMemo<ChatOperationScope | null>(() => viewerId && conversationId
    ? { userId: viewerId, isCurrent: isCurrentRoom } : null, [viewerId, conversationId, isCurrentRoom]);
  const captureOperation = useCallback((entry?: ChatOperationScope): ChatOperationScope | null => {
    // Even an old callback retained before identity resolved cannot acquire a
    // later account. Both closures describe the initiating committed visit.
    if (!isCurrentRoom()) throw new ObsoleteChatOperationError();
    if (!operationScope) return null;
    const scope: ChatOperationScope = entry ? {
      userId: operationScope.userId,
      isCurrent: () => operationScope.isCurrent() && entry.userId === operationScope.userId && entry.isCurrent(),
    } : operationScope;
    assertChatScope(scope);
    return scope;
  }, [isCurrentRoom, operationScope]);
  const assertSendCurrent = useCallback((scope: ChatOperationScope, optimistic: ChatMessage) => {
    if (scope.isCurrent()) return;
    // Admission may close while the room/account still exists. Remove only
    // this attempt's exact optimistic object, never a confirmed realtime row
    // or another attempt that reused its UUID after returning to the entry.
    if (operationScope?.isCurrent()) setMessages(prev => operationScope.isCurrent()
      ? prev.filter(message => message !== optimistic) : prev);
    throw new ObsoleteChatOperationError();
  }, [operationScope]);
  const newestRequestRef = useRef(0);

  useEffect(() => {
    activeRoomGenerationRef.current = roomGeneration;
    appliedWindowRef.current = readWindowRef.current;
    loadingOlderRef.current = false;
    hasOlderRef.current = false;
    blockedIdsRef.current = {};
    blockedReadyRef.current = false;
    messagesRef.current = [];
    reactionInFlightRef.current = new Set();
    reactionIntentsRef.current = new Map();
    messageChangesRef.current = new Map();
    setMessages([]);
    setLoadError(false);
    setOlderLoadError(false);
    setAnchorUnavailable(false);
    setLoading(!!viewerId && !!conversationId);
    if (!conversationId || !viewerId) return () => {
      if (activeRoomGenerationRef.current === roomGeneration) activeRoomGenerationRef.current = null;
    };
    fetchMessages().catch((err) => logError(err, 'useChat.fetchMessages'));

    // Event channel name kept byte-identical to before; circles use a distinct name.
    const channelName = kind === 'event' ? `chat:${conversationId}` : `chat:circle:${conversationId}`;
    const filter = `${parentCol}=eq.${conversationId}`;

    // Reactions have no conversation column. Read only this visit's loaded
    // message IDs through RLS, coalescing bursts without reloading the thread.
    const reactionQueue = { pending: false, running: false };
    const refreshReactions = async () => {
      if (!isCurrentRoom()) return;
      reactionQueue.pending = true;
      if (reactionQueue.running) return;
      reactionQueue.running = true;
      try {
        while (isCurrentRoom() && reactionQueue.pending) {
          reactionQueue.pending = false;
          const snapshot = new Map(messagesRef.current.filter(message => !message.id.startsWith('optimistic-'))
            .map(message => [message.id, message.reactions]));
          if (!snapshot.size) continue;
          const data = await readLoadedChatReactions([...snapshot.keys()], isCurrentRoom);
          if (!data || !isCurrentRoom()) return;
          const byMessage = new Map<string, MessageReaction[]>();
          for (const row of data ?? []) {
            const reactions = byMessage.get(row.message_id) ?? [];
            reactions.push({ user_id: row.user_id, reaction: row.reaction });
            byMessage.set(row.message_id, reactions);
          }
          setMessages(previous => isCurrentRoom() ? previous.map(message => {
            if (!snapshot.has(message.id)) return message;
            const beforeMine = snapshot.get(message.id)?.find(reaction => reaction.user_id === viewerId);
            const currentMine = message.reactions?.find(reaction => reaction.user_id === viewerId);
            const remote = byMessage.get(message.id) ?? [];
            // Sender hydration can replace the array while this read is in
            // flight. Preserve only a newer own reaction, not the entire old
            // array, or a first arriving remote reaction is silently lost.
            const preserveMine = reactionInFlightRef.current.has(message.id) || beforeMine?.reaction !== currentMine?.reaction;
            const reactions = preserveMine
              ? [...remote.filter(reaction => reaction.user_id !== viewerId), ...(currentMine ? [currentMine] : [])]
              : remote;
            return { ...message, reactions };
          }) : previous);
        }
      } catch (error) {
        if (isCurrentRoom()) logError(error, 'useChat.realtimeReactions');
      } finally {
        reactionQueue.running = false;
        // A later event can arrive while a snapshot fails. Drain that event,
        // without retrying a failed read when no newer work was queued.
        if (isCurrentRoom() && reactionQueue.pending) void refreshReactions();
      }
    };

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter },
        async (payload) => {
          const newMsg = payload.new as any;
          const window = readWindowRef.current;
          const inWindow = () => readWindowRef.current === window && (!window.anchorId || (window.ready &&
            (!window.upper || compareChatSequence(newMsg, window.upper) <= 0)));
          if (!isCurrentRoom() || !inWindow() || blockedIdsRef.current[newMsg.user_id]) return;
          let enriched: ChatMessage[];
          try { enriched = await attachSenders([newMsg]); }
          catch (error) { if (isCurrentRoom()) logError(error, 'useChat.realtimeSender'); return; }
          if (isCurrentRoom()) {
            setMessages(prev => {
              if (!isCurrentRoom() || !inWindow() || blockedIdsRef.current[newMsg.user_id]) return prev;
              const incoming = enriched[0];
              // Already present as the real row (the insert response may have
              // already swapped the optimistic id for this id).
              if (prev.some(m => m.id === incoming.id)) return prev;
              // Match only the client UUID. Identical rapid messages are
              // separate sends; content matching could eat the wrong row.
              const optIdx = prev.findIndex(m => m.id === `optimistic-${incoming.id}`);
              let msg = incoming;
              // Resolve reply reference from existing messages
              if (msg.reply_to_message_id) {
                const parent = prev.find(m => m.id === msg.reply_to_message_id);
                if (parent) {
                  msg = { ...msg, reply_to: { id: parent.id, content: parent.content, sender_name: parent.sender?.first_name ?? null } };
                }
              }
              if (optIdx >= 0) {
                return mergeChatBurst(prev.filter((_, index) => index !== optIdx), [msg]);
              }
              return mergeChatBurst(prev, [msg]);
            });
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter },
        (payload) => {
          const updated = payload.new as any;
          if (updated?.id && isCurrentRoom()) {
            setMessages(prev => isCurrentRoom() ? prev.map(m =>
              m.id === updated.id ? { ...m, content: updated.content, image_url: updated.image_url, mention_data: updated.mention_data ?? null } : m,
            ) : prev);
          }
        },
      )
      .on(
        'postgres_changes',
        // DELETE carries only its replica-identity ID; a parent filter drops it.
        { event: 'DELETE', schema: 'public', table: 'messages' },
        (payload) => {
          const deleted = payload.old as any;
          if (deleted?.id && isCurrentRoom()) {
            if (deleted.id === readWindowRef.current.anchorId) {
              ++newestRequestRef.current;
              readWindowRef.current.ready = false;
              hasOlderRef.current = false;
              setAnchorUnavailable(true); setLoadError(false); setLoading(false);
              setMessages([]); messagesRef.current = [];
              return;
            }
            setMessages(prev => isCurrentRoom() ? prev.filter(m => m.id !== deleted.id) : prev);
          }
        },
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, payload => {
        const messageId = (payload.new as { message_id?: string })?.message_id;
        if (payload.eventType === 'DELETE' || messagesRef.current.some(message => message.id === messageId)) {
          void refreshReactions();
        }
      })
      .on('system', {}, async (payload) => {
        // Channel SUBSCRIBED can precede the PostgreSQL stream becoming ready.
        // A message committed in that gap persists without an INSERT callback.
        // Reconcile history at actual readiness, including after reconnect,
        // through the existing account/room-owned, non-blocking refresh.
        if (!isCurrentRoom() || payload?.status !== 'ok' || payload?.extension !== 'postgres_changes') return;
        await refreshWindowRef.current(true);
      })
      .subscribe();

    return () => {
      if (isCurrentRoom()) activeRoomGenerationRef.current = null;
      newestRequestRef.current += 1;
      supabase.removeChannel(channel);
    };
  }, [kind, conversationId, roomGeneration, isCurrentRoom, viewerId]);

  const fetchMessages = useCallback(async (silent = false) => {
    if (!isCurrentRoom()) return;
    if (!operationScope) { if (!silent && viewerId === undefined) await retryIdentity(); return; }
    const request = ++newestRequestRef.current;
    const window = readWindowRef.current;
    const isCurrent = () => isCurrentRoom() && readWindowRef.current === window && newestRequestRef.current === request;
    const startedWith = new Map(messagesRef.current.map(message => [message.id, message]));
    if (!silent) setLoading(true);
    try {
      // Selected mention identity requires the verified mention-data migration
      // before a candidate is enabled. Only the circle path selects circle_id;
      // keep the event and circle parent boundaries separate.
      const selectCols = `id, event_id, user_id, content, message_type, image_url, audio_url, duration_seconds, created_at, reply_to_message_id, ref_event_id, mention_data${kind === 'circle' ? ', circle_id' : ''}`;
      // Keep the auth-lock fallback, but accept only this observed account.
      // A refresh failure keeps previously owned history; it cannot adopt an
      // account returned by a delayed authentication response.
      // Privacy remains a first-paint gate, using the shared per-account
      // cache and the existing block invalidation contract.
      const readBlocked = () => queryClient.fetchQuery<Record<string, boolean>>({
          queryKey: ['profile-blocked', operationScope.userId],
          staleTime: 60_000,
          queryFn: async () => {
            const { data: profile, error: profileError } = await scopedChatRequest(operationScope, () => supabase
              .from('profiles')
              .select('blocked_users')
              .eq('id', operationScope.userId)
              .maybeSingle());
            if (profileError) throw profileError;
            const lookup: Record<string, boolean> = {};
            (profile?.blocked_users ?? []).forEach((uid: string) => { lookup[uid] = true; });
            return lookup;
          },
        });
      const readBlockedLookup = async () => {
        try { return await requestWithDeadline(readBlocked(), 12_000); }
        catch (error) {
          if (!isCurrent() || !isObsoleteChatOperation(error)) throw error;
          // An in-flight cache request may belong to a retired room.
          return await requestWithDeadline(readBlocked(), 12_000);
        }
      };
      // Verify this exact account before accessing its private preferences,
      // but do not make that access wait for independent history delivery.
      const verifiedUser = scopedChatRequest(operationScope, () => requestWithDeadline(readObservedUser(), 8_000))
          .then(({ data: d, error }) => { if (error) throw error; return d.user; })
          .catch(async (err) => {
            assertChatScope(operationScope);
            logError(err, 'useChat.fetchMessages.getUser');
            const { data: cached } = await scopedChatRequest(operationScope, () => requestWithDeadline(supabase.auth.getSession(), 4_000)).catch(() => {
              assertChatScope(operationScope);
              return { data: { session: null } };
            });
            return cached.session?.user ?? null;
          }).then(user => {
        if (!isCurrent()) throw new ObsoleteChatOperationError();
        if (!user || user.id !== operationScope.userId) throw new Error('Could not verify this chat account.');
        return user;
      });
      const [snapshot, user, initialBlockedLookup] = await Promise.all([
        window.anchorId
          ? getMemberChatAnchorWindow({ kind, id: conversationId }, window.anchorId, { userId: operationScope.userId, isCurrent })
            .then(anchor => ({ data: anchor.messages, error: null, anchor }))
          : requestWithDeadline(supabase
          .from('messages')
          .select(selectCols)
          .eq(parentCol, conversationId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(CHAT_NEWEST_PAGE_SIZE), 12_000).then(result => ({ ...result, anchor: null })),
        verifiedUser,
        verifiedUser.then(() => readBlockedLookup()),
      ]);
      if (!isCurrent()) return;
      const { data, error: messageError, anchor } = snapshot;
      if (messageError) throw messageError;
      if (!user || user.id !== operationScope.userId) throw new Error('Could not verify this chat account.');
      setLoadError(false);
      setAnchorUnavailable(false);
      const page = toChronologicalChatPage((data ?? []) as unknown as ChatMessage[]);
      const more = anchor ? anchor.hasMore : page.length === CHAT_NEWEST_PAGE_SIZE;
      const pageCursor = anchor?.olderCursor ?? oldestChatCursor(page);
      const retainedOlderPages = !!window.older && !!pageCursor && compareChatSequence(window.older, pageCursor) < 0;
      if (!retainedOlderPages) hasOlderRef.current = more;
      if (user) {
        const userId = operationScope.userId;
        const msgIds = page.map((m: any) => m.id);
        // Mark this conversation read. Plans and circles use different unique
        // keys on chat_reads, so the onConflict target differs.
        const readUpsert = () => scopedChatRequest(operationScope, () => kind === 'event'
          ? supabase.from('chat_reads').upsert(
              { event_id: conversationId, user_id: userId, last_read_at: new Date().toISOString() },
              { onConflict: 'event_id,user_id' },
            )
          : supabase.from('chat_reads').upsert(
              { circle_id: conversationId, user_id: userId, last_read_at: new Date().toISOString() },
              { onConflict: 'user_id,circle_id' },
            ));
        // new_message notifications are event-only today; circles have no
        // notification type yet, so the circle branch skips the clear + badge.
        const notifClear = () => scopedChatRequest(operationScope, () => kind === 'event'
          ? supabase.from('app_notifications')
              .update({ status: 'read' })
              .eq('user_id', userId)
              .eq('event_id', conversationId)
              .eq('type', 'new_message')
              .eq('status', 'unread')
          : Promise.resolve({ data: null }));

        const blockedLookup = { ...initialBlockedLookup, ...anchor?.blockedIds };
        blockedIdsRef.current = blockedLookup;
        blockedReadyRef.current = true;
        const filtered = page.filter((msg: any) => !blockedLookup[msg.user_id]);
        if (window.anchorId && !filtered.some(message => message.id === window.anchorId)) throw new MemberChatMessageUnavailableError();
        window.ready = true;
        window.upper = anchor?.upperCursor ?? null;
        if (!retainedOlderPages) window.older = pageCursor;
        const existingById = new Map(messagesRef.current.map(message => [message.id, message]));
        const firstPaint = filtered.map((message) => ({
          ...message,
          message_type: message.message_type ?? 'user',
          // Keep existing presentation until its refresh hydration completes;
          // returning to the room must not briefly erase photos/reactions.
          sender: existingById.get(message.id)?.sender,
          reply_to: existingById.get(message.id)?.reply_to,
          reactions: existingById.get(message.id)?.reactions ?? [],
        })) as ChatMessage[];
        const firstPaintById = new Map(firstPaint.map(message => [message.id, message]));

        // The message text is the useful first paint. Sender photos, reactions,
        // read receipts, and notification cleanup are secondary and must not
        // hold the entire thread behind a spinner.
        // Silent focus refreshes need the same reconciliation as initial
        // reads: mapping hydration over existing IDs alone loses missed rows.
        setMessages(prev => isCurrent() ? reconcileNewestMessages(
          prev.filter(message => !blockedLookup[message.user_id]), firstPaint, startedWith, more,
        ) : prev);
        setLoading(false);

        void (async () => {
          try {
            // Receipts and notification cleanup must not delay names/photos.
            // These idempotent background writes keep their original scope.
            // Viewing an old notification must not mark unseen newer messages
            // read or dismiss their notifications.
            if (!window.anchorId) void Promise.all([readUpsert(), notifClear()]).then(() => {
              if (isCurrent()) void queryClient.invalidateQueries({ queryKey: UNREAD_CHATS_KEY });
            }).catch(error => { if (isCurrent()) logError(error, 'useChat.readReceipts'); });
            const [{ data: reactionsData, error: reactionsError }, enriched] = await Promise.all([
              msgIds.length > 0
                ? requestWithDeadline(supabase.from('message_reactions').select('message_id, user_id, reaction').in('message_id', msgIds), 12_000)
                : Promise.resolve({ data: [] as any[], error: null }),
              attachSenders(filtered),
            ]);
            if (reactionsError) throw reactionsError;
            if (!isCurrent()) return;

            const reactionsByMsg: Record<string, MessageReaction[]> = {};
            (reactionsData ?? []).forEach((reaction: any) => {
              if (!reactionsByMsg[reaction.message_id]) reactionsByMsg[reaction.message_id] = [];
              reactionsByMsg[reaction.message_id].push({
                user_id: reaction.user_id,
                reaction: reaction.reaction,
              });
            });
            const withReactions = enriched.map(message => ({
              ...message,
              reactions: reactionsByMsg[message.id] ?? [],
            }));
            const byId: Record<string, ChatMessage> = {};
            withReactions.forEach(message => { byId[message.id] = message; });
            const hydrated = withReactions.map(message => {
              const parent = message.reply_to_message_id ? byId[message.reply_to_message_id] : null;
              return parent
                ? {
                    ...message,
                    reply_to: {
                      id: parent.id,
                      content: parent.content,
                      sender_name: parent.sender?.first_name ?? null,
                    },
                  }
                : message;
            });
            const hydratedById = new Map(hydrated.map(message => [message.id, message]));
            setMessages(prev => isCurrent() ? prev.map(message =>
              firstPaintById.get(message.id) === message
                ? hydratedById.get(message.id) ?? message
                : message,
            ) : prev);
            queryClient.invalidateQueries({ queryKey: UNREAD_CHATS_KEY });
          } catch (error) {
            if (isCurrent()) { logError(error, 'useChat.hydrateNewestPage'); setLoadError(true); }
          }
        })();
      }
    } catch (error) {
      if (isCurrent()) {
        if (error instanceof MemberChatMessageUnavailableError) {
          window.ready = false; hasOlderRef.current = false;
          setMessages([]); messagesRef.current = [];
          setAnchorUnavailable(true); setLoadError(false);
        } else { logError(error, 'useChat.fetchMessages'); setLoadError(true); }
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [kind, conversationId, isCurrentRoom, operationScope, viewerId, retryIdentity]);
  refreshWindowRef.current = fetchMessages;

  useEffect(() => {
    if (!isCurrentRoom() || appliedWindowRef.current === readWindow) return;
    appliedWindowRef.current = readWindow;
    ++newestRequestRef.current;
    loadingOlderRef.current = false; hasOlderRef.current = false;
    // Keep in-flight sends owned by this room while replacing only history.
    const pending = messagesRef.current.filter(message => message.id.startsWith('optimistic-'));
    messagesRef.current = pending; setMessages(pending);
    setLoadError(false); setOlderLoadError(false); setAnchorUnavailable(false);
    void fetchMessages();
  }, [readWindow, isCurrentRoom, fetchMessages]);

  const loadOlder = useCallback(async (retry = false) => {
    if (!isCurrentRoom() || loadingOlderRef.current || !hasOlderRef.current || (olderLoadError && !retry)) return;
    const window = readWindowRef.current;
    const isCurrent = () => isCurrentRoom() && readWindowRef.current === window && (!window.anchorId || window.ready);
    const cursor = window.older ?? oldestChatCursor(
      messagesRef.current.filter(message => !message.id.startsWith('optimistic-')),
    );
    if (!cursor) return;

    loadingOlderRef.current = true;
    setOlderLoadError(false);
    try {
      const selectCols = `id, event_id, user_id, content, message_type, image_url, audio_url, duration_seconds, created_at, reply_to_message_id, ref_event_id, mention_data${kind === 'circle' ? ', circle_id' : ''}`;
      const { data, error } = await requestWithDeadline(supabase
        .from('messages')
        .select(selectCols)
        .eq(parentCol, conversationId)
        .or(olderChatFilter(cursor))
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(CHAT_NEWEST_PAGE_SIZE), 12_000);
      if (!isCurrent()) return;
      if (error) throw error;

      const page = toChronologicalChatPage((data ?? []) as unknown as ChatMessage[]);
      const more = page.length === CHAT_NEWEST_PAGE_SIZE;

      const filtered = page.filter(message => !blockedIdsRef.current[message.user_id]);
      const enriched = await attachSenders(filtered);
      if (!isCurrent()) return;
      const msgIds = enriched.map(message => message.id);
      const { data: reactionsData, error: reactionsError } = msgIds.length > 0
        ? await requestWithDeadline(supabase
            .from('message_reactions')
            .select('message_id, user_id, reaction')
            .in('message_id', msgIds), 12_000)
        : { data: [] as any[], error: null };
      if (reactionsError) throw reactionsError;
      if (!isCurrent()) return;
      // Move the raw cursor only once the page is usable. A hydration failure
      // must retry the same page, including neighbors hidden by blocking.
      hasOlderRef.current = more;
      window.older = oldestChatCursor(page);

      const reactionsByMsg: Record<string, MessageReaction[]> = {};
      (reactionsData ?? []).forEach((reaction: any) => {
        if (!reactionsByMsg[reaction.message_id]) reactionsByMsg[reaction.message_id] = [];
        reactionsByMsg[reaction.message_id].push({ user_id: reaction.user_id, reaction: reaction.reaction });
      });
      const withReactions = enriched.map(message => ({
        ...message,
        reactions: reactionsByMsg[message.id] ?? [],
      }));

      setMessages(prev => {
        if (!isCurrent()) return prev;
        const merged = mergeChatBurst(prev, withReactions);
        const byId = new Map(merged.map(message => [message.id, message]));
        return merged.map(message => {
          const parent = message.reply_to_message_id ? byId.get(message.reply_to_message_id) : null;
          return parent
            ? { ...message, reply_to: { id: parent.id, content: parent.content, sender_name: parent.sender?.first_name ?? null } }
            : message;
        });
      });
    } catch (error) {
      if (isCurrent()) { logError(error, 'useChat.loadOlder'); setOlderLoadError(true); }
    } finally {
      // A retired read must not unlock a page request in the current room.
      if (isCurrent()) loadingOlderRef.current = false;
    }
  }, [kind, parentCol, conversationId, olderLoadError, isCurrentRoom]);

  const toggleReaction = useCallback(async function changeReaction(messageId: string, reaction = 'heart', entryScope?: ChatOperationScope, expectedIntent?: ChatReactionIntent): Promise<void> {
    const scope = captureOperation(entryScope);
    if (!scope) return;
    const userId = scope.userId;
    // Each room/account visit owns its lock and unresolved desired states.
    const inFlight = reactionInFlightRef.current;
    const intents = reactionIntentsRef.current;
    if (expectedIntent && intents.get(messageId) !== expectedIntent) throw new ObsoleteChatOperationError();
    if (inFlight.has(messageId)) return;
    inFlight.add(messageId);
    const retained = intents.get(messageId);
    const resumed = retained?.selected === reaction && retained.scope.isCurrent() ? retained : undefined;
    // A newer explicit choice retires the old alert before its preflight, even
    // if that read later fails. An expired writable entry cannot resume either.
    if (retained && !resumed) intents.delete(messageId);
    const previousMine = messagesRef.current.find(m => m.id === messageId)?.reactions?.find(r => r.user_id === userId);
    let optimisticMine: MessageReaction | undefined;
    let changed = false;
    const replaceMine = (reactions: MessageReaction[], next: MessageReaction | undefined) => {
      const others = reactions.filter(r => r.user_id !== userId);
      return next ? [...others, next] : others;
    };
    const readOwnReaction = async (timeout: number) => {
      const { data, error } = await scopedChatRequest(scope, () => requestWithDeadline(supabase
        .from('message_reactions').select('id, reaction').eq('message_id', messageId).eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(1), timeout));
      if (error) throw error;
      return data?.[0] ?? null;
    };
    try {
      const existing = await readOwnReaction(12_000);
      const intent = resumed ?? { selected: reaction, desired: existing?.reaction === reaction ? null : reaction, scope };
      optimisticMine = intent.desired === null ? undefined : { user_id: userId, reaction: intent.desired };
      changed = true;
      setMessages(prev => scope.isCurrent() ? prev.map(m => m.id === messageId
        ? { ...m, reactions: replaceMine(m.reactions ?? [], optimisticMine) } : m) : prev);
      if ((existing?.reaction ?? null) !== intent.desired) {
        intents.set(messageId, intent);
        try {
          const { error } = await scopedChatRequest(scope, () => requestWithDeadline(intent.desired === null
            ? supabase.from('message_reactions').delete().eq('id', existing!.id)
            : existing
              ? supabase.from('message_reactions').update({ reaction: intent.desired }).eq('id', existing.id)
              : supabase.from('message_reactions').insert({ message_id: messageId, user_id: userId, reaction: intent.desired }), 12_000));
          if (error) throw error;
        } catch (error) {
          assertChatScope(scope);
          // A lost write reply is uncertain. Read once; never automatically
          // toggle again or send a second mutation to manufacture confirmation.
          let confirmed = false;
          try { confirmed = ((await readOwnReaction(8_000))?.reaction ?? null) === intent.desired; }
          catch { assertChatScope(scope); }
          if (!confirmed) throw new UnconfirmedChatReactionError(() => changeReaction(messageId, reaction, entryScope, intent));
        }
      }
      assertChatScope(scope);
      if (intents.get(messageId) === intent || intents.get(messageId) === retained) intents.delete(messageId);
    } catch (error) {
      assertChatScope(scope);
      logError(error, 'useChat.toggleReaction');
      if (changed) setMessages(prev => scope.isCurrent() ? prev.map(m =>
        m.id === messageId && m.reactions?.find(r => r.user_id === userId) === optimisticMine
          ? { ...m, reactions: replaceMine(m.reactions ?? [], previousMine) } : m,
      ) : prev);
      if (resumed && intents.get(messageId) === resumed && !isUnconfirmedChatReaction(error)) {
        throw new UnconfirmedChatReactionError(() => changeReaction(messageId, reaction, entryScope, resumed));
      }
      throw error;
    } finally {
      inFlight.delete(messageId);
    }
  }, [captureOperation]);

  const deleteMessage = useCallback(async (messageId: string, entryScope?: ChatOperationScope) => {
    const scope = captureOperation(entryScope);
    if (!scope) return;
    const userId = scope.userId;
    const original = messagesRef.current.find(message => message.id === messageId);
    const changes = messageChangesRef.current;
    const attempt = {};
    changes.set(messageId, attempt);
    setMessages(prev => scope.isCurrent() ? prev.filter(m => m.id !== messageId) : prev);
    try {
      const { error } = await scopedChatRequest(scope, () => supabase.from('messages').delete()
        .eq('id', messageId).eq('user_id', userId));
      assertChatScope(scope);
      if (error) throw error;
    } catch (error) {
      assertChatScope(scope);
      logError(error, 'useChat.deleteMessage');
      // Restore only the deleted row if this attempt still owns its absence.
      // A failed delete must not replace a newer history/realtime snapshot.
      if (original) setMessages(prev => scope.isCurrent() && changes.get(messageId) === attempt && !prev.some(m => m.id === messageId)
        ? mergeChatBurst(prev, [original]) : prev);
      Alert.alert('Could not delete', 'Something went wrong. Please try again.');
    }
  }, [captureOperation]);

  const sendMessage = useCallback(async (content: string, imageUrl?: string, replyToId?: string, sendIdOverride?: string, entryScope?: ChatOperationScope, mentions?: ChatMentionDocument | null) => {
    const scope = captureOperation(entryScope);
    if (!scope) return false;
    if (!validOptionalMentionDocument(content, mentions)) throw Error('Your selected mentions could not be checked.');
    const mentionData = mentions == null ? null : JSON.parse(JSON.stringify(mentions)) as ChatMentionDocument;
    const filter = checkContent(content);
    if (!filter.ok) {
      Alert.alert('Content not allowed', filter.reason ?? 'Please revise your message.');
      return false;
    }

    // Capture the initiating account once; never adopt a later session.
    const userId = scope.userId;

    // Optimistic insert — synchronous, appears immediately with zero lag
    const sendId = sendIdOverride ?? Crypto.randomUUID();
    const optimisticId = `optimistic-${sendId}`;
    // Build reply_to for optimistic display
    let replyTo: ReplyTo | null = null;
    if (replyToId) {
      let parentMsg = messagesRef.current.find(m => m.id === replyToId);
      if (!parentMsg) {
        const target = await scopedChatRequest(scope, () => requestWithDeadline(supabase.from('messages')
          .select('id,content,user_id').eq(parentCol, conversationId).eq('id', replyToId).maybeSingle(), 12_000));
        if (target.error) throw target.error;
        if (!target.data) throw Error('The original reply is no longer available. Your message is kept.');
        const targetMessage = target.data;
        const blocked = await scopedChatRequest(scope, () => requestWithDeadline(getBlockedWith(userId, [targetMessage.user_id]), 12_000));
        if (blocked.has(targetMessage.user_id)) throw Error('The original reply is unavailable.');
        parentMsg = target.data as ChatMessage;
      }
      if (parentMsg) {
        replyTo = { id: parentMsg.id, content: parentMsg.content, sender_name: parentMsg.sender?.first_name ?? null };
      }
    }

    const optimisticMsg: ChatMessage = {
      id: optimisticId,
      ...parentFields,
      user_id: userId,
      content: content || '',
      ...(mentionData ? { mention_data: mentionData } : {}),
      message_type: 'user',
      image_url: imageUrl ?? null,
      created_at: new Date().toISOString(),
      reply_to_message_id: replyToId ?? null,
      reply_to: replyTo,
      reactions: [],
      sender: null,
    };
    setMessages(prev => scope.isCurrent() && !prev.some(row => row.id === sendId) ? [...prev.filter(row => row.id !== optimisticId), optimisticMsg] : prev);

    // Insert and select back the real row so we can confirm the message even if real-time is slow
    const insertData: any = {
      id: sendId,
      ...parentFields,
      user_id: userId,
      content: content || '',
      ...(mentionData ? { mention_data: mentionData } : {}),
      message_type: 'user',
      image_url: imageUrl ?? null,
    };
    if (replyToId && replyTo) insertData.reply_to_message_id = replyToId;

    // A text receipt is the final send acknowledgement. Validate the complete
    // intent here so the composer need not perform a second network round trip.
    const receiptColumns = imageUrl ? 'id, created_at, content, image_url, mention_data'
      : `id, created_at, ${parentCol}, user_id, content, message_type, image_url, reply_to_message_id, mention_data`;
    const checkedReceipt = (result: any) => {
      const row = result.data;
      if (!row) return result;
      const matches = imageUrl
        ? row.id === sendId && row.content === (content || '') && row.image_url === imageUrl
          && (!mentionData || sameChatMentionIdentity(content, mentionData, row.mention_data))
        : row.id === sendId && row[parentCol] === conversationId && row.user_id === userId
          && row.content === (content || '') && row.message_type === 'user' && !row.image_url
          && (row.reply_to_message_id ?? null) === (replyToId ?? null)
          && sameChatMentionIdentity(content, mentionData, row.mention_data);
      return matches ? result : { data: null, error: Error('The saved message differs. Your original is kept.') };
    };
    const { receipt: inserted, failure } = await resolveChatSendReceipt(
      async () => checkedReceipt(await scopedChatRequest(scope, () =>
        requestWithDeadline(supabase.from('messages').insert(insertData).select(receiptColumns).single(), 12_000))),
      async () => checkedReceipt(await scopedChatRequest(scope, () => {
        const read = supabase.from('messages').select(receiptColumns)
          .eq('id', sendId).eq(parentCol, conversationId).eq('user_id', userId).maybeSingle();
        return requestWithDeadline(read, 8_000);
      })),
    );
    // The receipt helper catches transport errors; retirement must still be
    // surfaced as obsolete rather than a false failure or confirmation.
    assertSendCurrent(scope, optimisticMsg);
    if (!inserted) {
      if (failure) logError(failure, 'useChat.sendMessage');
      setMessages(prev => scope.isCurrent() ? prev.filter(m => m.id !== optimisticId) : prev);
      // Scoped callers keep their original draft/selection and own recovery UI.
      // A second native alert would cover that retry and misdirect the sender.
      if (!entryScope) Alert.alert('Delivery unconfirmed', 'Check this chat before retrying your message.');
      return false;
    } else {
      // Replace optimistic ID with real DB row ID — message is now confirmed regardless of real-time
      // Real-time handler will dedup correctly (checks for the real ID, won't add a duplicate)
      setMessages(prev => scope.isCurrent() ? prev.map(m =>
        m.id === optimisticId ? { ...m, id: inserted.id, created_at: inserted.created_at } : m,
      ) : prev);
      return true;
    }
  }, [kind, conversationId, captureOperation, assertSendCurrent]);

  const sendLocation = useCallback(async (lat: number, lng: number, address: string, entryScope?: ChatOperationScope, sendIdOverride?: string) => {
    const scope = captureOperation(entryScope);
    if (!scope) return false;
    const userId = scope.userId;

    const content = JSON.stringify({ lat, lng, address });

    // Optimistic insert — synchronous, no async delay
    const sendId = sendIdOverride ?? Crypto.randomUUID();
    const optimisticId = `optimistic-${sendId}`;
    const optimisticMsg: ChatMessage = {
      id: optimisticId,
      ...parentFields,
      user_id: userId,
      content,
      message_type: 'location',
      image_url: null,
      created_at: new Date().toISOString(),
      reactions: [],
      sender: null,
    };
    setMessages(prev => scope.isCurrent() && !prev.some(row => row.id === sendId) ? [...prev.filter(row => row.id !== optimisticId), optimisticMsg] : prev);

    const receiptColumns = 'id, created_at, message_type, content';
    const checkedReceipt = (result: any) => result.data && (
      result.data.id !== sendId || result.data.message_type !== 'location' || result.data.content !== content)
      ? { data: null, error: Error('The saved pin differs. Your original is kept.') } : result;
    const { receipt: inserted, failure } = await resolveChatSendReceipt(
      async () => checkedReceipt(await scopedChatRequest(scope, () => requestWithDeadline(supabase.from('messages').insert({
        id: sendId, ...parentFields, user_id: userId, content, message_type: 'location',
      }).select(receiptColumns).single(), 12_000))),
      async () => checkedReceipt(await scopedChatRequest(scope, () => requestWithDeadline(supabase.from('messages').select(receiptColumns)
        .eq('id', sendId).eq(parentCol, conversationId).eq('user_id', userId).maybeSingle(), 8_000))),
    );
    // The receipt helper catches transport errors; retirement must still be
    // surfaced as obsolete rather than a false failure or confirmation.
    assertSendCurrent(scope, optimisticMsg);
    if (!inserted) {
      if (failure) logError(failure, 'useChat.sendLocation');
      setMessages(prev => scope.isCurrent() ? prev.filter(m => m.id !== optimisticId) : prev);
      return false;
    } else {
      setMessages(prev => scope.isCurrent() ? prev.map(m =>
        m.id === optimisticId ? { ...m, id: inserted.id, created_at: inserted.created_at } : m,
      ) : prev);
      return true;
    }
  }, [kind, conversationId, captureOperation, assertSendCurrent]);

  const sendAudio = useCallback(async (audioUrl: string, durationSeconds: number, entryScope?: ChatOperationScope, sendIdOverride?: string) => {
    const scope = captureOperation(entryScope);
    if (!scope) return false;
    const userId = scope.userId;

    // Optimistic insert: the audio is already uploaded by the caller, so this
    // mirrors sendMessage/sendLocation: show immediately, reconcile the real id.
    const sendId = sendIdOverride ?? Crypto.randomUUID();
    const optimisticId = `optimistic-${sendId}`;
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
      sender: null,
    };
    setMessages(prev => scope.isCurrent() && !prev.some(row => row.id === sendId) ? [...prev.filter(row => row.id !== optimisticId), optimisticMsg] : prev);

    const receiptColumns = 'id, created_at, message_type, audio_url, duration_seconds';
    const checkedReceipt = (result: any) => result.data && (
      result.data.id !== sendId || result.data.message_type !== 'audio' ||
      result.data.audio_url !== audioUrl || Number(result.data.duration_seconds) !== durationSeconds)
      ? { data: null, error: Error('The saved recording differs. Your original is kept.') } : result;
    const { receipt: inserted, failure } = await resolveChatSendReceipt(
      async () => checkedReceipt(await scopedChatRequest(scope, () => requestWithDeadline(supabase.from('messages').insert({
        id: sendId, ...parentFields, user_id: userId, content: '',
        message_type: 'audio', audio_url: audioUrl, duration_seconds: durationSeconds,
      }).select(receiptColumns).single(), 12_000))),
      async () => checkedReceipt(await scopedChatRequest(scope, () => requestWithDeadline(supabase.from('messages').select(receiptColumns)
        .eq('id', sendId).eq(parentCol, conversationId).eq('user_id', userId).maybeSingle(), 8_000))),
    );
    // The receipt helper catches transport errors; retirement must still be
    // surfaced as obsolete rather than a false failure or confirmation.
    assertSendCurrent(scope, optimisticMsg);
    if (!inserted) {
      if (failure) logError(failure, 'useChat.sendAudio');
      setMessages(prev => scope.isCurrent() ? prev.filter(m => m.id !== optimisticId) : prev);
      return false;
    } else {
      setMessages(prev => scope.isCurrent() ? prev.map(m =>
        m.id === optimisticId ? { ...m, id: inserted.id, created_at: inserted.created_at } : m,
      ) : prev);
      return true;
    }
  }, [kind, conversationId, captureOperation, assertSendCurrent]);

  const editMessage = useCallback(async (messageId: string, newContent: string, entryScope?: ChatOperationScope, expectedContent?: string, mentions?: ChatMentionDocument | null, expectedMentions?: ChatMentionDocument | null, options?: { errorPresentation?: 'hook' | 'caller' }) => {
    const scope = captureOperation(entryScope);
    if (!scope) return false;
    const userId = scope.userId;
    const original = messagesRef.current.find(message => message.id === messageId);
    const changes = messageChangesRef.current;
    const attempt = {};
    changes.set(messageId, attempt);
    let optimistic: ChatMessage | undefined;
    setMessages(prev => scope.isCurrent() ? prev.map(m => {
      if (m.id !== messageId) return m;
      optimistic = { ...m, content: newContent, mention_data: mentions ?? null };
      return optimistic;
    }) : prev);
    try {
      const expected = expectedContent ?? original?.content;
      if (expected === undefined) throw new Error('The original message is unavailable. Your edit is kept.');
      await editOwnChatMessage({ kind, id: conversationId }, messageId, expected, newContent, scope, mentions, expectedMentions !== undefined ? expectedMentions : original?.mention_data);
      assertChatScope(scope);
      return true;
    } catch (error) {
      assertChatScope(scope);
      logError(error, 'useChat.editMessage');
      if (original) setMessages(prev => scope.isCurrent() && changes.get(messageId) === attempt ? prev.map(m =>
        m === optimistic ? { ...m, content: original.content, mention_data: original.mention_data } : m,
      ) : prev);
      if (isChatEditRefused(error)) throw error;
      if (options?.errorPresentation !== 'caller') Alert.alert('Could not edit', 'Something went wrong. Please try again.');
      return false;
    }
  }, [captureOperation]);

  const visibleMessages = useMemo(() => readWindow.anchorId
    ? messages.filter(message => readWindow.ready && (!readWindow.upper || compareChatSequence(message, readWindow.upper) <= 0))
    : messages, [messages, readWindow, readWindow.ready, readWindow.upper]);

  return {
    // Realtime may arrive during the first privacy read. Keep its rows for
    // reconciliation, but expose nothing until this account's filter is known.
    messages: isCurrentRoom() && appliedWindowRef.current === readWindow && blockedReadyRef.current
      ? visibleMessages : [],
    loading: identityLoading || loading || appliedWindowRef.current !== readWindow,
    anchorUnavailable,
    loadError: !!identityError || loadError,
    olderLoadError,
    currentUserId,
    operationScope,
    sendMessage,
    sendLocation,
    sendAudio,
    deleteMessage,
    editMessage,
    toggleReaction,
    loadOlder,
    refetch: fetchMessages,
  };
}
