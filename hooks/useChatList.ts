import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { GROUPS_ENABLED, CHAT_ENGINE_ENABLED } from '../constants/FeatureFlags';
import { circleDisplay, type DisplayMember } from '../lib/circles/display';
import { seedSender } from '../lib/chatEngine/senderCache';
import { getPlanChatTiming } from '../lib/planChatExpiry';
import { getBlockedWith } from '../lib/blocking';
import { chatListMemoryCache, subscribeChatListPrivacy } from '../lib/chatListCache';

export interface ChatPreview {
  // A conversation row is either a plan (event) chat or a circle chat.
  kind: 'event' | 'circle';
  // Generic id used for routing + list keys, regardless of kind.
  conversationId: string;
  // Event rows only (kept so event-specific call sites keep compiling).
  eventId?: string;
  title: string;
  category: string | null;
  image_url: string | null;
  start_time: string;
  end_time?: string | null;
  member_count: number;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  is_past: boolean;
  ticket_url: string | null;
  member_avatars: string[];
  // A DM (unnamed 2-person circle): the row shows the counterpart's face, not a
  // circle monogram. Undefined for plans and real circles.
  is_dm?: boolean;
  /** Identity used only to remove a blocked private conversation from previews. */
  dm_user_id?: string | null;
}

async function visiblePrivateChats(userId: string, previews: ChatPreview[]): Promise<ChatPreview[]> {
  const blocked = await getBlockedWith(userId, previews.filter(chat => chat.is_dm).map(chat => chat.dm_user_id));
  return previews.filter(chat => !chat.is_dm || (!!chat.dm_user_id && !blocked.has(chat.dm_user_id)));
}

function sortChatPreviews(previews: ChatPreview[]): ChatPreview[] {
  const active = previews
    .filter(preview => !preview.is_past)
    .sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''));
  const past = previews
    .filter(preview => preview.is_past)
    .sort((a, b) => b.start_time.localeCompare(a.start_time));
  return [...active, ...past];
}

/**
 * Build circle-chat previews for the current user. Reachable only behind
 * GROUPS_ENABLED. The caller retains this branch's cached rows on failure
 * while allowing plan conversations to load independently.
 */
async function fetchCircleChats(userId: string, senderCache?: Map<string, string>): Promise<ChatPreview[]> {
  const { data: memberships, error: membershipError } = await supabase
    .from('circle_members')
    .select('circle_id, circles ( id, name, cover_upload_id, status, created_at )')
    .eq('user_id', userId)
    .eq('status', 'joined');

  if (membershipError) throw membershipError;
  const circleIds = (memberships ?? []).map((m: any) => m.circles?.id).filter(Boolean);
  if (circleIds.length === 0) return [];

  const results = await Promise.all([
    supabase.from('circle_members').select('circle_id').in('circle_id', circleIds).eq('status', 'joined'),
    // Limit inside each parent so busy chats cannot crowd out older history.
    supabase.from('circles')
      .select('id, latest_message:messages!messages_circle_id_fkey(circle_id, content, created_at, image_url, audio_url, message_type, user_id)')
      .in('id', circleIds)
      .order('created_at', { referencedTable: 'latest_message', ascending: false })
      .order('id', { referencedTable: 'latest_message', ascending: false })
      .limit(1, { referencedTable: 'latest_message' }),
    supabase.from('chat_reads').select('circle_id, last_read_at').eq('user_id', userId).in('circle_id', circleIds),
    supabase.from('messages')
      .select('circle_id, created_at')
      .in('circle_id', circleIds)
      .neq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(circleIds.length * 20),
    supabase.from('circle_members')
      .select('circle_id, user_id, profiles_public!inner(profile_photo_url, first_name_display)')
      .in('circle_id', circleIds)
      .eq('status', 'joined'),
  ]);

  const failed = results.find(result => result.error);
  if (failed?.error) throw failed.error;
  const [{ data: countRows }, { data: messageParents }, { data: allReads }, { data: otherMessages }, { data: memberRows }] = results;
  const realCounts: Record<string, number> = {};
  (countRows ?? []).forEach((r: any) => { realCounts[r.circle_id] = (realCounts[r.circle_id] ?? 0) + 1; });

  const lastMsgMap: Record<string, any> = {};
  (messageParents ?? []).forEach((parent: any) => {
    const message = parent.latest_message?.[0];
    if (message) lastMsgMap[parent.id] = message;
  });

  const senderNameMap: Record<string, string> = {};
  const avatarMap: Record<string, string[]> = {};
  // Full per-circle roster (for DM vs circle title + the DM counterpart's face).
  const membersByCircle: Record<string, DisplayMember[]> = {};
  (memberRows ?? []).forEach((r: any) => {
    const profile = r.profiles_public as any;
    const name = profile?.first_name_display;
    if (name && r.user_id && !senderNameMap[r.user_id]) {
      senderNameMap[r.user_id] = name;
      senderCache?.set(r.user_id, name); // seed the cross-render realtime cache
    }
    const url = profile?.profile_photo_url;
    if (url && r.circle_id) {
      if (!avatarMap[r.circle_id]) avatarMap[r.circle_id] = [];
      if (avatarMap[r.circle_id].length < 4) avatarMap[r.circle_id].push(url);
    }
    if (r.circle_id) {
      if (!membersByCircle[r.circle_id]) membersByCircle[r.circle_id] = [];
      membersByCircle[r.circle_id].push({
        user_id: r.user_id,
        name: name ?? null,
        avatar_url: url ?? null,
      });
    }
  });

  const readMap: Record<string, string> = {};
  (allReads ?? []).forEach((r: any) => { readMap[r.circle_id] = r.last_read_at; });

  const unreadMap: Record<string, number> = {};
  (otherMessages ?? []).forEach((msg: any) => {
    const lastRead = readMap[msg.circle_id];
    if (!lastRead || msg.created_at > lastRead) {
      unreadMap[msg.circle_id] = (unreadMap[msg.circle_id] ?? 0) + 1;
    }
  });

  const previews = (memberships ?? [])
    .map((m: any) => m.circles)
    .filter(Boolean)
    .map((circle: any): ChatPreview => {
      const lastMsg = lastMsgMap[circle.id];
      const disp = circleDisplay(circle.name, membersByCircle[circle.id] ?? [], userId);
      return {
        kind: 'circle',
        conversationId: circle.id,
        title: disp.title,
        category: null,
        // DM rows render the counterpart's face; real circles use the monogram.
        image_url: disp.isDm ? disp.otherAvatar : null,
        is_dm: disp.isDm,
        dm_user_id: disp.otherUserId,
        start_time: circle.created_at,
        member_count: realCounts[circle.id] ?? 0,
        ticket_url: null,
        last_message: lastMsg
          ? (() => {
              const isOwn = lastMsg.user_id === userId;
              const senderName = isOwn ? 'You' : (senderNameMap[lastMsg.user_id] ?? null);
              const text = lastMsg.message_type === 'audio' || lastMsg.audio_url
                ? 'sent a voice message'
                : lastMsg.image_url ? 'sent a photo' : lastMsg.content;
              return senderName ? `${senderName}: ${text}` : text;
            })()
          : null,
        last_message_at: lastMsg?.created_at ?? null,
        unread_count: unreadMap[circle.id] ?? 0,
        is_past: false,
        member_avatars: avatarMap[circle.id] ?? [],
      };
    });
  return visiblePrivateChats(userId, previews);
}

/**
 * SQL-100 path: ONE get_my_circle_chat_cards() round trip replaces the six
 * queries in fetchCircleChats. Reachable only behind CHAT_ENGINE_ENABLED,
 * and only as an ATTEMPT: any error (including the RPC not yet applied to
 * prod) falls back to the legacy path, so this ships dark until apply + flag.
 * Card shapes are defined in SQL-100-circle-chat-cards-proposal.sql.
 */
async function fetchCircleChatsViaCards(userId: string, senderCache?: Map<string, string>): Promise<ChatPreview[]> {
  const { data, error } = await supabase.rpc('get_my_circle_chat_cards');
  if (error) throw error;

  const previews = ((data ?? []) as any[]).map((card: any): ChatPreview => {
    const members: DisplayMember[] = (card.members ?? []).map((m: any) => ({
      user_id: m.user_id,
      name: m.first_name ?? null,
      avatar_url: m.avatar_url ?? null,
    }));
    // Seed both sender caches from the roster: the realtime handler's name
    // cache here, and the chat engine's profile cache so a thread opened from
    // this list paints names/faces without its own profile round-trip.
    members.forEach((m) => {
      if (!m.user_id) return;
      if (m.name) senderCache?.set(m.user_id, m.name);
      seedSender({ id: m.user_id, first_name: m.name, avatar_url: m.avatar_url });
    });

    const disp = circleDisplay(card.name ?? '', members, userId);
    const lastMsg = card.last_message ?? null;
    let preview: string | null = null;
    if (lastMsg) {
      const isOwn = lastMsg.user_id === userId;
      const senderName = isOwn ? 'You' : (lastMsg.sender_name ?? null);
      const text = lastMsg.message_type === 'audio' || lastMsg.audio_url
        ? 'sent a voice message'
        : lastMsg.image_url ? 'sent a photo' : lastMsg.content;
      preview = senderName ? `${senderName}: ${text}` : text;
    }

    return {
      kind: 'circle',
      conversationId: card.circle_id,
      title: disp.title,
      category: null,
      // DM rows render the counterpart's face; real circles use the monogram.
      image_url: disp.isDm ? disp.otherAvatar : null,
      is_dm: disp.isDm,
      dm_user_id: disp.otherUserId,
      start_time: card.created_at,
      member_count: card.member_count ?? 0,
      ticket_url: null,
      last_message: preview,
      last_message_at: lastMsg?.created_at ?? null,
      unread_count: card.unread_count ?? 0,
      is_past: false,
      member_avatars: members
        .map((m) => m.avatar_url)
        .filter((url): url is string => !!url)
        .slice(0, 4),
    };
  });
  return visiblePrivateChats(userId, previews);
}

export function useChatList(knownUserId: string | null | undefined) {
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const userIdRef = useRef<string | null>(null);
  const currentViewer = useRef(knownUserId);
  currentViewer.current = knownUserId;
  const requestVersion = useRef(0);
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
      if (rows !== null) latest = [...latest.filter(chat => chat.kind !== kind), ...rows];
      if (complete) pending[kind] = false;
      failed[kind] = error;
      const sorted = sortChatPreviews(latest);
      chatListMemoryCache.set(userId, sorted);
      senderNameCacheRef.current = names;
      setChats(sorted);
      setLoadError(failed.event || failed.circle);
      setLoading(sorted.length === 0 && (pending.event || pending.circle));
    };

    const loadEvents = async () => {
      try {
        const { data: memberships, error: membershipsError } = await read(supabase
          .from('event_members')
          .select(`
            event_id,
            events (
              id, title, primary_vibe, image_url, start_time, end_time, member_count, tickets_url, status
            )
          `)
          .eq('user_id', userId)
          .eq('status', 'joined'));

        if (membershipsError || !memberships) throw membershipsError ?? new Error('Chats could not load');

        const allEventIds = memberships.map((m: any) => m.events?.id).filter(Boolean);

        // The membership response already contains enough event information for
        // a useful first paint. Show those rows before message previews, unread
        // counts, and avatars finish enriching the list.
        if (!silent) {
          const cachedEvents = new Map(latest.filter(chat => chat.kind === 'event').map(chat => [chat.conversationId, chat]));
          const firstPaint = memberships
            .map((membership: any) => membership.events)
            .filter((event: any) => event && ((event.member_count ?? 0) >= 2 || event.status === 'cancelled' || !!cachedEvents.get(event.id)?.last_message_at))
            .map((event: any): ChatPreview => ({
              kind: 'event',
              conversationId: event.id,
              eventId: event.id,
              title: event.title,
              category: event.primary_vibe ?? null,
              image_url: event.image_url ?? null,
              start_time: event.start_time,
              end_time: event.end_time ?? null,
              member_count: event.member_count ?? 0,
              ticket_url: event.tickets_url ?? null,
              last_message: null,
              last_message_at: null,
              unread_count: 0,
              is_past: getPlanChatTiming(event.start_time, event.end_time, event.status).isPast,
              member_avatars: [],
            }));
          if (firstPaint.length > 0) {
            publish('event', firstPaint.map(chat => {
              const cached = cachedEvents.get(chat.conversationId);
              return { ...chat, last_message: cached?.last_message ?? null, last_message_at: cached?.last_message_at ?? null,
                unread_count: cached?.unread_count ?? 0, member_avatars: cached?.member_avatars ?? [] };
            }), false);
          }
        }

        // Run all 5 queries in parallel against allEventIds. Member-count drift
        // correction (events.member_count vs real joined rows) used to be a
        // sequential pre-step before the batch; folding it in saves a round-trip.
        // The memberRows2 query also pulls first_name_display so we get sender
        // names alongside avatars without a separate sender-profiles lookup.
        let eventPreviews: ChatPreview[] = [];
        if (allEventIds.length > 0) {
          const enrichment = await read(Promise.all([
            supabase
              .from('event_members')
              .select('event_id')
              .in('event_id', allEventIds)
              .eq('status', 'joined'),
            supabase.from('events')
              .select('id, latest_message:messages!messages_event_id_fkey(event_id, content, created_at, image_url, audio_url, message_type, user_id)')
              .in('id', allEventIds)
              .order('created_at', { referencedTable: 'latest_message', ascending: false })
              .order('id', { referencedTable: 'latest_message', ascending: false })
              .limit(1, { referencedTable: 'latest_message' }),
            supabase
              .from('chat_reads')
              .select('event_id, last_read_at')
              .eq('user_id', userId)
              .in('event_id', allEventIds),
            supabase
              .from('messages')
              .select('event_id, created_at')
              .in('event_id', allEventIds)
              .neq('user_id', userId)
              .order('created_at', { ascending: false })
              .limit(allEventIds.length * 20),
            supabase
              .from('event_members')
              .select('event_id, user_id, profiles_public!inner(profile_photo_url, first_name_display)')
              .in('event_id', allEventIds)
              .eq('status', 'joined'),
          ]));
          const failedRead = enrichment.find(result => result.error);
          if (failedRead?.error) throw failedRead.error;
          const [{ data: memberCountRows }, { data: messageParents }, { data: allReads }, { data: otherMessages }, { data: memberRows2 }] = enrichment;

          const realCounts: Record<string, number> = {};
          (memberCountRows ?? []).forEach((r: any) => {
            realCounts[r.event_id] = (realCounts[r.event_id] ?? 0) + 1;
          });

          const lastMsgMap: Record<string, { content: string; created_at: string; image_url: string | null; audio_url: string | null; message_type: string | null; user_id: string }> = {};
          (messageParents ?? []).forEach((parent: any) => {
            const message = parent.latest_message?.[0];
            if (message) lastMsgMap[parent.id] = message;
          });

          // Joined members keep access to an existing conversation after others
          // leave. An unused one-person plan still stays out of the chat list.
          const eligible = memberships.filter((m: any) => {
            const e = m.events;
            return e && (realCounts[e.id] >= 2 || e.status === 'cancelled' || !!lastMsgMap[e.id]);
          });

          // Build sender-name + avatar maps from the single memberRows2 query.
          const senderNameMap: Record<string, string> = {};
          const avatarMap: Record<string, string[]> = {};
          (memberRows2 ?? []).forEach((r: any) => {
            const profile = r.profiles_public as any;
            const name = profile?.first_name_display;
            if (name && r.user_id && !senderNameMap[r.user_id]) {
              senderNameMap[r.user_id] = name;
              // Persist into the cross-render cache the realtime handler reads.
              names.set(r.user_id, name);
            }
            const url = profile?.profile_photo_url;
            if (url && r.event_id) {
              if (!avatarMap[r.event_id]) avatarMap[r.event_id] = [];
              if (avatarMap[r.event_id].length < 4) avatarMap[r.event_id].push(url);
            }
          });

          const readMap: Record<string, string> = {};
          (allReads ?? []).forEach((r: any) => {
            readMap[r.event_id] = r.last_read_at;
          });

          const unreadMap: Record<string, number> = {};
          (otherMessages ?? []).forEach((msg: any) => {
            const lastRead = readMap[msg.event_id];
            if (!lastRead || msg.created_at > lastRead) {
              unreadMap[msg.event_id] = (unreadMap[msg.event_id] ?? 0) + 1;
            }
          });

          eventPreviews = eligible.map((m: any): ChatPreview => {
            const event = m.events;
            const isPast = getPlanChatTiming(event.start_time, event.end_time, event.status).isPast;
            const lastMsg = lastMsgMap[event.id];

            return {
              kind: 'event',
              conversationId: event.id,
              eventId: event.id,
              title: event.title,
              category: event.primary_vibe ?? null,
              image_url: event.image_url ?? null,
              start_time: event.start_time,
              end_time: event.end_time ?? null,
              member_count: realCounts[event.id] ?? event.member_count ?? 0,
              ticket_url: event.tickets_url ?? null,
              last_message: lastMsg
                ? (() => {
                    const isOwn = lastMsg.user_id === userId;
                    const senderName = isOwn ? 'You' : (senderNameMap[lastMsg.user_id] ?? null);
                    const text = lastMsg.message_type === 'audio' || lastMsg.audio_url
                      ? 'sent a voice message'
                      : lastMsg.image_url ? 'sent a photo' : lastMsg.content;
                    return senderName ? `${senderName}: ${text}` : text;
                  })()
                : null,
              last_message_at: lastMsg?.created_at ?? null,
              unread_count: unreadMap[event.id] ?? 0,
              is_past: isPast,
              member_avatars: avatarMap[event.id] ?? [],
            };
          });
        }

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
  }, [knownUserId]);

  useEffect(() => {
    requestVersion.current++;
    userIdRef.current = knownUserId ?? null;
    senderNameCacheRef.current = new Map();
    setLoadError(false);
    setChats(knownUserId ? chatListMemoryCache.get(knownUserId) ?? [] : []);
    if (knownUserId === undefined) { setLoading(true); return; }
    if (knownUserId === null) {
      setChats([]);
      setLoading(false);
      return;
    }
    const cached = chatListMemoryCache.get(knownUserId);
    if (cached) {
      setChats(cached);
      setLoading(false);
    }
    void fetchChats(!!cached);
  }, [fetchChats]);

  useEffect(() => subscribeChatListPrivacy(viewerId => {
    if (!mounted.current || currentViewer.current !== viewerId || knownUserId !== viewerId) return;
    // Retire reads and realtime hydration started before the confirmed block.
    // A network failure must never restore the removed cached private row.
    requestVersion.current++;
    setChats(chatListMemoryCache.get(viewerId) ?? []);
    void fetchChats(true);
  }), [knownUserId, fetchChats]);

  // Optimistic removal for delete-chat / leave-circle (doc 120). Dropping the
  // row also drops its id from convIdsRef (the effect below), so the realtime
  // handler stops patching a conversation the user just left.
  const removeChat = useCallback((conversationId: string) => {
    setChats(prev => prev.filter(c => c.conversationId !== conversationId));
  }, []);

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
            const text = msg.message_type === 'audio' || msg.audio_url
              ? 'sent a voice message'
              : msg.image_url ? 'sent a photo' : msg.content;
            const preview = senderName ? `${senderName}: ${text}` : text;

            setChats(prev => {
              if (!isCurrentPreview()) return prev;
              const updated = prev.map(c => {
                if (c.conversationId !== convId) return c;
                return {
                  ...c,
                  last_message: preview,
                  last_message_at: msg.created_at,
                  unread_count: isOwn ? c.unread_count : c.unread_count + 1,
                };
              });
              // Re-sort: active chats by last_message_at desc
              const active = updated.filter(c => !c.is_past).sort((a, b) =>
                (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''));
              const past = updated.filter(c => c.is_past);
              return [...active, ...past];
            });
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
