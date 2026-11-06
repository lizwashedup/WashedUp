import { supabase } from './supabase';
import { circleDisplay, type DisplayMember } from './circles/display';
import { seedSender } from './chatEngine/senderCache';
import { getBlockedWith } from './blocking';
import { formatChatPreview, comparePreviewTimes, type ChatPreview } from './chatPreview';

type MembershipObserver = (joined: ReadonlySet<string>) => void;

async function visiblePrivateChats(userId: string, previews: ChatPreview[]): Promise<ChatPreview[]> {
  const blocked = await getBlockedWith(userId, previews.filter(chat => chat.is_dm).map(chat => chat.dm_user_id));
  return previews.filter(chat => !chat.is_dm || (!!chat.dm_user_id && !blocked.has(chat.dm_user_id)));
}

/**
 * Build circle-chat previews for the current user. Reachable only behind
 * GROUPS_ENABLED. The caller retains this branch's cached rows on failure
 * while allowing plan conversations to load independently.
 */
export async function fetchCircleChats(
  userId: string, senderCache?: Map<string, string>, onMembership?: MembershipObserver,
): Promise<ChatPreview[]> {
  const { data: memberships, error: membershipError } = await supabase
    .from('circle_members')
    .select('circle_id, circles ( id, name, cover_upload_id, status, created_at )')
    .eq('user_id', userId)
    .eq('status', 'joined');

  if (membershipError) throw membershipError;
  if (!Array.isArray(memberships)) throw new Error('Circle membership unavailable');
  const circleIds = memberships.map((m: any) => m.circles?.id).filter(Boolean);
  onMembership?.(new Set<string>(circleIds));
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
    if (!lastRead || comparePreviewTimes(msg.created_at, lastRead) > 0) {
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
              return formatChatPreview(lastMsg, senderName);
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
export async function fetchCircleChatsViaCards(
  userId: string, senderCache?: Map<string, string>, onMembership?: MembershipObserver,
): Promise<ChatPreview[]> {
  const { data, error } = await supabase.rpc('get_my_circle_chat_cards');
  if (error) throw error;

  if (!Array.isArray(data)) throw new Error('Circle cards unavailable');
  onMembership?.(new Set<string>(data.map(card => card.circle_id)));

  const previews = data.map((card: any): ChatPreview => {
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
      preview = formatChatPreview(lastMsg, senderName);
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

