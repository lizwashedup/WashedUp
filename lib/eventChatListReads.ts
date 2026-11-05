import { supabase } from './supabase';
import { getPlanChatTiming } from './planChatExpiry';
import { formatChatPreview, comparePreviewTimes, type ChatPreview } from './chatPreview';

type ScopedRead = <T>(work: PromiseLike<T>) => Promise<T>;
type FirstPaint = { cachedRows: () => ChatPreview[]; publish: (rows: ChatPreview[]) => void };

/** Keep database reads and preview mapping independent of React ownership.
 * The caller supplies its existing scoped/deadline read and optional first paint. */
export async function fetchEventChatPreviews(userId: string, names: Map<string, string>, read: ScopedRead, firstPaint?: FirstPaint): Promise<ChatPreview[]> {
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
  if (firstPaint) {
    const cachedEvents = new Map(firstPaint.cachedRows().filter(chat => chat.kind === 'event').map(chat => [chat.conversationId, chat]));
    const initialRows = memberships
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
    if (initialRows.length > 0) {
      firstPaint.publish(initialRows.map(chat => {
        const cached = cachedEvents.get(chat.conversationId);
        return { ...chat, last_message: cached?.last_message ?? null, last_message_at: cached?.last_message_at ?? null,
          unread_count: cached?.unread_count ?? 0, member_avatars: cached?.member_avatars ?? [] };
      }));
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
      if (!lastRead || comparePreviewTimes(msg.created_at, lastRead) > 0) {
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
              return formatChatPreview(lastMsg, senderName);
            })()
          : null,
        last_message_at: lastMsg?.created_at ?? null,
        unread_count: unreadMap[event.id] ?? 0,
        is_past: isPast,
        member_avatars: avatarMap[event.id] ?? [],
      };
    });
  }

  return eventPreviews;
}
