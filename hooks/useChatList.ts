import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { withTimeout } from '../lib/withTimeout';
import { GROUPS_ENABLED } from '../constants/FeatureFlags';
import { circleDisplay, type DisplayMember } from '../lib/circles/display';

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
}

/**
 * Build circle-chat previews for the current user. Reachable only behind
 * GROUPS_ENABLED (the circles tables/RPCs are not applied to prod yet), and the
 * caller wraps this so any failure degrades to an event-only list.
 */
async function fetchCircleChats(userId: string, senderCache?: Map<string, string>): Promise<ChatPreview[]> {
  const { data: memberships } = await supabase
    .from('circle_members')
    .select('circle_id, circles ( id, name, cover_upload_id, status, created_at )')
    .eq('user_id', userId)
    .eq('status', 'joined');

  const circleIds = (memberships ?? []).map((m: any) => m.circles?.id).filter(Boolean);
  if (circleIds.length === 0) return [];

  const [{ data: countRows }, { data: allMessages }, { data: allReads }, { data: otherMessages }, { data: memberRows }] = await Promise.all([
    supabase.from('circle_members').select('circle_id').in('circle_id', circleIds).eq('status', 'joined'),
    supabase.from('messages')
      .select('circle_id, content, created_at, image_url, audio_url, message_type, user_id')
      .in('circle_id', circleIds)
      .order('created_at', { ascending: false })
      .limit(circleIds.length * 3),
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

  const realCounts: Record<string, number> = {};
  (countRows ?? []).forEach((r: any) => { realCounts[r.circle_id] = (realCounts[r.circle_id] ?? 0) + 1; });

  const lastMsgMap: Record<string, any> = {};
  (allMessages ?? []).forEach((msg: any) => { if (!lastMsgMap[msg.circle_id]) lastMsgMap[msg.circle_id] = msg; });

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

  return (memberships ?? [])
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
}

export function useChatList() {
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const userIdRef = useRef<string | null>(null);
  // Sender name cache (user_id -> first_name_display), populated from the roster
  // fetch so the realtime handler doesn't fire a profiles_public lookup per
  // incoming message.
  const senderNameCacheRef = useRef<Map<string, string>>(new Map());

  const fetchChats = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Bound so a stale-session server refresh can't hang the whole list behind
      // it (the P1 freeze). On timeout, fall back to the CACHED session:
      // getSession does NO server refresh, so it can't hang; the list still
      // loads on a stale session instead of going empty. The RLS queries below
      // still enforce auth via the client token, so this only scopes the reads.
      let user = (await withTimeout(supabase.auth.getUser(), 3000, { data: { user: null } } as any)).data?.user ?? null;
      if (!user) {
        const cached = await withTimeout(supabase.auth.getSession(), 2000, { data: { session: null } } as any);
        user = cached.data?.session?.user ?? null;
      }
      if (!user) return;
      userIdRef.current = user.id;

      const { data: memberships, error: membershipsError } = await supabase
        .from('event_members')
        .select(`
          event_id,
          events (
            id, title, primary_vibe, image_url, start_time, member_count, tickets_url, status
          )
        `)
        .eq('user_id', user.id)
        .eq('status', 'joined');

      if (membershipsError || !memberships) return;

      const allEventIds = memberships.map((m: any) => m.events?.id).filter(Boolean);

      // Run all 5 queries in parallel against allEventIds. Member-count drift
      // correction (events.member_count vs real joined rows) used to be a
      // sequential pre-step before the batch; folding it in saves a round-trip.
      // The memberRows2 query also pulls first_name_display so we get sender
      // names alongside avatars without a separate sender-profiles lookup.
      let eventPreviews: ChatPreview[] = [];
      if (allEventIds.length > 0) {
        const [{ data: memberCountRows }, { data: allMessages }, { data: allReads }, { data: otherMessages }, { data: memberRows2 }] = await Promise.all([
          supabase
            .from('event_members')
            .select('event_id')
            .in('event_id', allEventIds)
            .eq('status', 'joined'),
          supabase
            .from('messages')
            .select('event_id, content, created_at, image_url, audio_url, message_type, user_id')
            .in('event_id', allEventIds)
            .order('created_at', { ascending: false })
            .limit(allEventIds.length * 3),
          supabase
            .from('chat_reads')
            .select('event_id, last_read_at')
            .eq('user_id', user.id)
            .in('event_id', allEventIds),
          supabase
            .from('messages')
            .select('event_id, created_at')
            .in('event_id', allEventIds)
            .neq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(allEventIds.length * 20),
          supabase
            .from('event_members')
            .select('event_id, user_id, profiles_public!inner(profile_photo_url, first_name_display)')
            .in('event_id', allEventIds)
            .eq('status', 'joined'),
        ]);

        const realCounts: Record<string, number> = {};
        (memberCountRows ?? []).forEach((r: any) => {
          realCounts[r.event_id] = (realCounts[r.event_id] ?? 0) + 1;
        });

        const eligible = memberships.filter((m: any) => {
          const e = m.events;
          return e && (realCounts[e.id] >= 2 || e.status === 'cancelled');
        });

        const lastMsgMap: Record<string, { content: string; created_at: string; image_url: string | null; audio_url: string | null; message_type: string | null; user_id: string }> = {};
        (allMessages ?? []).forEach((msg: any) => {
          if (!lastMsgMap[msg.event_id]) {
            lastMsgMap[msg.event_id] = msg;
          }
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
            senderNameCacheRef.current.set(r.user_id, name);
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
          const isPast = event.status === 'cancelled' || new Date(event.start_time) < new Date(Date.now() - 48 * 60 * 60 * 1000);
          const lastMsg = lastMsgMap[event.id];

          return {
            kind: 'event',
            conversationId: event.id,
            eventId: event.id,
            title: event.title,
            category: event.primary_vibe ?? null,
            image_url: event.image_url ?? null,
            start_time: event.start_time,
            member_count: realCounts[event.id] ?? event.member_count ?? 0,
            ticket_url: event.tickets_url ?? null,
            last_message: lastMsg
              ? (() => {
                  const isOwn = lastMsg.user_id === user.id;
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

      // Circle chats are additive and gated. Isolated so any circle-side failure
      // (tables not applied, RLS, network) degrades to an event-only list and can
      // never break the plan chat list.
      let circlePreviews: ChatPreview[] = [];
      if (GROUPS_ENABLED) {
        try {
          circlePreviews = await fetchCircleChats(user.id, senderNameCacheRef.current);
        } catch {
          circlePreviews = [];
        }
      }

      const previews = [...eventPreviews, ...circlePreviews];
      if (previews.length === 0) {
        setChats([]);
        return;
      }

      const active = previews
        .filter(p => !p.is_past)
        .sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''));
      const past = previews
        .filter(p => p.is_past)
        .sort((a, b) => b.start_time.localeCompare(a.start_time));

      setChats([...active, ...past]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  const convIdsRef = useRef(new Set<string>());
  useEffect(() => {
    convIdsRef.current = new Set(chats.map(c => c.conversationId));
  }, [chats]);

  const hasChatsRef = useRef(false);
  useEffect(() => {
    hasChatsRef.current = chats.length > 0;
  }, [chats.length]);

  useEffect(() => {
    const channel = supabase
      .channel('chat-list-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          const msg = payload.new as any;
          // Match either parent. circle_id is only considered behind the flag
          // (and is null on event messages), so plan chats are unaffected.
          const convId = msg?.event_id ?? (GROUPS_ENABLED ? msg?.circle_id : null);
          if (!convId || !hasChatsRef.current || !convIdsRef.current.has(convId)) return;

          // Incremental update: patch the affected chat instead of full refetch
          try {
            const isOwn = userIdRef.current === msg.user_id;
            let senderName: string | null = isOwn ? 'You' : null;
            if (!isOwn && msg.user_id) {
              // Prefer the cached sender name (seeded from the roster fetch);
              // only hit profiles_public on a miss, then cache it.
              senderName = senderNameCacheRef.current.get(msg.user_id) ?? null;
              if (senderName == null) {
                const { data: profile } = await supabase
                  .from('profiles_public')
                  .select('first_name_display')
                  .eq('id', msg.user_id)
                  .maybeSingle();
                senderName = profile?.first_name_display ?? null;
                if (senderName) senderNameCacheRef.current.set(msg.user_id, senderName);
              }
            }
            const text = msg.message_type === 'audio' || msg.audio_url
              ? 'sent a voice message'
              : msg.image_url ? 'sent a photo' : msg.content;
            const preview = senderName ? `${senderName}: ${text}` : text;

            setChats(prev => {
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
            // Fallback: full refetch on error
            fetchChats(true);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchChats]);

  return { chats, loading, refetch: fetchChats };
}
