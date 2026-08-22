/**
 * Community chat, member side (doc 09 section 3): the Chats communities
 * section, the community container (broadcast pinned + topics), and topic
 * threads. NEW plumbing beside plan and circle chat, never a refactor of
 * them. Cards come from get_my_community_chat_cards (one round trip);
 * read-marking is direct upserts on the reads tables (self RLS); reactions,
 * replies, and topic messages ride their phase 1 RLS tables; mute goes
 * through set_community_broadcast_mute. No 48-hour expiry anywhere here:
 * community chat is permanent by construction.
 */

import { supabase } from './supabase';
import { getTodayInLA } from './laDate';
import { getBlockedWith } from './blocking';

// -- the cards (Chats tab section) ---------------------------------------------

export interface ChatCardTopic {
  id: string;
  name: string;
  is_default: boolean;
  explore_event_id: string | null;
  joined: boolean;
  notifications_on: boolean;
  unread: number;
  last_message_at: string | null;
}

/** An event chat you are in by ATTENDANCE (RSVP) without community membership. */
export interface AttendeeTopic {
  id: string;
  name: string;
  community_id: string;
  community_name: string;
  accent_color: string | null;
  explore_event_id: string;
  notifications_on: boolean;
  unread: number;
  last_message_at: string | null;
  joined_at: string;
}

export interface CommunityChatPayload {
  cards: CommunityChatCard[];
  attendee_topics: AttendeeTopic[];
}

export interface CommunityChatCard {
  community_id: string;
  handle: string;
  name: string;
  accent_color: string | null;
  role: 'leader' | 'co_leader' | 'admin' | 'events' | 'member_care' | 'finance' | 'member';
  latest_broadcast: { id: string; body: string; created_at: string; sender_id: string | null } | null;
  unread_broadcasts: number;
  topics: ChatCardTopic[];
  unread_total: number;
  last_activity_at: string | null;
}

export async function getCommunityChatPayload(): Promise<CommunityChatPayload> {
  const { data, error } = await supabase.rpc('get_my_community_chat_cards');
  if (error) throw error;
  const payload = (data ?? {}) as Partial<CommunityChatPayload>;
  return {
    cards: payload.cards ?? [],
    attendee_topics: payload.attendee_topics ?? [],
  };
}

// -- the chats-list rows (revised doc 09: no hub screen, chats are just chats) --

export interface CommunityChatRowData {
  key: string;
  kind: 'community' | 'room';
  /** communityId for community rows, topicId for room rows */
  targetId: string;
  communityId: string;
  title: string;
  /** the community name, shown small on room rows */
  secondary: string | null;
  preview: string;
  lastAt: string | null;
  unread: number;
  accent: string | null;
  /** the community's first cover image (rooms: the event's image when it has
   *  one), doc 121 T3; null keeps the letter placeholder */
  image: string | null;
}

/**
 * One row per community (its conversation: the broadcasts) plus one row per
 * JOINED room, flattened for the Chats list. Unjoined rooms are discoverable
 * from the community page, not here. Room previews come from a light
 * client-side pass over recent messages (no schema change).
 */
export async function getCommunityChatRows(): Promise<CommunityChatRowData[]> {
  const { cards, attendee_topics } = await getCommunityChatPayload();
  if (cards.length === 0 && attendee_topics.length === 0) return [];

  // a community with no broadcasts yet anchors at YOUR join time (a fresh
  // chat enters the list when it begins, then floats on real activity)
  const { data: { user } } = await supabase.auth.getUser();
  const joinedAtByCommunity = new Map<string, string>();
  if (user) {
    const { data: memberships } = await supabase
      .from('community_members')
      .select('community_id, joined_at')
      .eq('user_id', user.id)
      .eq('status', 'active');
    for (const m of (memberships ?? []) as { community_id: string; joined_at: string | null }[]) {
      if (m.joined_at) joinedAtByCommunity.set(m.community_id, m.joined_at);
    }
  }

  const joinedTopicIds = [
    ...cards.flatMap((c) => c.topics.filter((t) => t.joined).map((t) => t.id)),
    ...attendee_topics.map((t) => t.id),
  ];
  const previewByTopic = new Map<string, string>();
  // when you joined each topic: the recency anchor for a chat with no
  // messages yet. Without it a fresh event chat (RSVP just seated you) has a
  // null last_message_at and sinks to the very bottom of the unified list,
  // which read as "the row is missing" on the tour (part 4, bug 2).
  const topicJoinedAt = new Map<string, string>();
  // T3 (doc 121): the pictures. A community row wears its first cover image
  // (the same resolution getMyCommunities uses); an event room wears its
  // event's image, falling back to the community cover. expo-image caches
  // these on device, so the list pays the download once.
  const communityIds = Array.from(new Set([
    ...cards.map((c) => c.community_id),
    ...attendee_topics.map((t) => t.community_id),
  ]));
  const eventIds = Array.from(new Set([
    ...cards.flatMap((c) => c.topics.map((t) => t.explore_event_id).filter(Boolean) as string[]),
    ...attendee_topics.map((t) => t.explore_event_id),
  ]));
  const [{ data: recent }, { data: myTopicRows }, { data: coverBlocks }, { data: eventRows }] = await Promise.all([
    joinedTopicIds.length > 0
      ? supabase
          .from('community_topic_messages')
          .select('topic_id, body, created_at')
          .in('topic_id', joinedTopicIds)
          .order('created_at', { ascending: false })
          .limit(120)
      : Promise.resolve({ data: [] } as any),
    joinedTopicIds.length > 0 && user
      ? supabase
          .from('community_topic_members')
          .select('topic_id, joined_at')
          .eq('user_id', user.id)
          .in('topic_id', joinedTopicIds)
      : Promise.resolve({ data: [] } as any),
    communityIds.length > 0
      ? supabase
          .from('community_blocks')
          .select('community_id, content, position')
          .in('community_id', communityIds)
          .eq('block_type', 'cover')
          .eq('visible', true)
          .order('position', { ascending: true })
      : Promise.resolve({ data: [] } as any),
    eventIds.length > 0
      ? supabase.from('explore_events').select('id, image_url').in('id', eventIds)
      : Promise.resolve({ data: [] } as any),
  ]);
  for (const m of (recent ?? []) as { topic_id: string; body: string }[]) {
    if (!previewByTopic.has(m.topic_id)) previewByTopic.set(m.topic_id, m.body);
  }
  for (const r of (myTopicRows ?? []) as { topic_id: string; joined_at: string | null }[]) {
    if (r.joined_at) topicJoinedAt.set(r.topic_id, r.joined_at);
  }
  const coverByCommunity = new Map<string, string>();
  for (const b of (coverBlocks ?? []) as { community_id: string; content: any }[]) {
    if (coverByCommunity.has(b.community_id)) continue;
    const images = Array.isArray(b.content?.images) ? (b.content.images as string[]) : [];
    if (images.length > 0) coverByCommunity.set(b.community_id, images[0]);
  }
  const imageByEvent = new Map<string, string>();
  for (const e of (eventRows ?? []) as { id: string; image_url: string | null }[]) {
    if (e.image_url) imageByEvent.set(e.id, e.image_url);
  }

  const rows: CommunityChatRowData[] = [];
  for (const c of cards) {
    rows.push({
      key: `community-${c.community_id}`,
      kind: 'community',
      targetId: c.community_id,
      communityId: c.community_id,
      title: c.name,
      secondary: null,
      // LIZ COPY
      preview: c.latest_broadcast?.body ?? 'you are in.',
      lastAt: c.latest_broadcast?.created_at ?? joinedAtByCommunity.get(c.community_id) ?? null,
      unread: c.unread_broadcasts,
      accent: c.accent_color,
      image: coverByCommunity.get(c.community_id) ?? null,
    });
    for (const t of c.topics) {
      if (!t.joined) continue;
      rows.push({
        key: `room-${t.id}`,
        kind: 'room',
        targetId: t.id,
        communityId: c.community_id,
        title: t.name,
        secondary: c.name,
        // LIZ COPY (event chats echo the attendee line: RSVP put you here)
        preview:
          previewByTopic.get(t.id) ??
          (t.explore_event_id ? "you're going. talk it out here." : 'quiet so far'),
        lastAt: t.last_message_at ?? topicJoinedAt.get(t.id) ?? null,
        unread: t.unread,
        accent: c.accent_color,
        image:
          (t.explore_event_id ? imageByEvent.get(t.explore_event_id) : null) ??
          coverByCommunity.get(c.community_id) ??
          null,
      });
    }
  }
  // event chats you attend without membership are rows of their own
  for (const at of attendee_topics) {
    rows.push({
      key: `room-${at.id}`,
      kind: 'room',
      targetId: at.id,
      communityId: at.community_id,
      title: at.name,
      secondary: at.community_name,
      // LIZ COPY
      preview: previewByTopic.get(at.id) ?? "you're going. talk it out here.",
      lastAt: at.last_message_at ?? at.joined_at,
      unread: at.unread,
      accent: at.accent_color,
      image: imageByEvent.get(at.explore_event_id) ?? coverByCommunity.get(at.community_id) ?? null,
    });
  }
  // newest activity first, community rows float above their rooms on ties
  rows.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
  return rows;
}

// -- read markers ----------------------------------------------------------------

export async function markBroadcastsRead(communityId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from('community_broadcast_reads')
    .upsert(
      { community_id: communityId, user_id: user.id, last_read_at: new Date().toISOString() },
      { onConflict: 'community_id,user_id' },
    );
  if (error) throw error;
}

export async function markTopicRead(topicId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from('community_topic_reads')
    .upsert(
      { topic_id: topicId, user_id: user.id, last_read_at: new Date().toISOString() },
      { onConflict: 'topic_id,user_id' },
    );
  if (error) throw error;
}

// -- broadcasts (the pinned voice) ----------------------------------------------

export interface BroadcastReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface IntroPayload {
  user_id: string;
  first_name: string;
  area: string | null;
  question: string;
  answer: string;
}

export interface CommunityBroadcast {
  id: string;
  body: string;
  created_at: string;
  sender_id: string | null;
  sender_name: string | null;
  sender_photo: string | null;
  kind: 'broadcast' | 'intro' | 'message';
  payload: IntroPayload | null;
  reactions: BroadcastReaction[];
  reply_count: number;
}

/**
 * LIZ COPY: the intro card template. The system introduces the new member in
 * warm third person, no pronouns: name as typed, area from their zip (never
 * the zip itself), the leader's question woven in lowercase with their answer.
 * Template lives here so wording changes ship OTA; the DB body is a fallback.
 */
export function composeIntroLine(p: IntroPayload): string {
  const fragment = p.question.trim().replace(/[?.!]+$/, '').toLowerCase();
  const from = p.area ? `, from ${p.area}` : '';
  const punct = /[.!?]$/.test(p.answer) ? '' : '.';
  return `this is ${p.first_name}${from}. ${fragment}: ${p.answer}${punct}`;
}

/**
 * The length rule (Liz, part-2 reactions): a short question weaves inline;
 * a long one breaks the card into two lines, the greeting first, then the
 * question and answer as their own line. LIZ COPY defaults, gold pass later.
 */
export const INTRO_QUESTION_INLINE_MAX = 40;

export interface IntroCardText {
  lead: string;
  /** null = the whole intro fits on the inline lead */
  qa: string | null;
}

export function composeIntroCard(p: IntroPayload): IntroCardText {
  const fragment = p.question.trim().replace(/[?.!]+$/, '').toLowerCase();
  const from = p.area ? `, from ${p.area}` : '';
  const punct = /[.!?]$/.test(p.answer) ? '' : '.';
  if (fragment.length <= INTRO_QUESTION_INLINE_MAX) {
    return { lead: `this is ${p.first_name}${from}. ${fragment}: ${p.answer}${punct}`, qa: null };
  }
  return { lead: `this is ${p.first_name}${from}.`, qa: `${fragment}: ${p.answer}${punct}` };
}

export async function getCommunityBroadcasts(communityId: string): Promise<CommunityBroadcast[]> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: rows, error } = await supabase
    .from('community_broadcasts')
    .select('id, body, created_at, sender_id, kind, payload')
    .eq('community_id', communityId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  const fetched = rows ?? [];
  if (fetched.length === 0) return [];

  // hide messages from anyone blocked (either direction). System cards with a
  // null sender always stay. This runs for the initial load AND every realtime
  // refetch (the thread screen invalidates this query on insert).
  const blocked = await getBlockedWith(user?.id, fetched.map((b) => b.sender_id));
  const broadcasts = fetched.filter((b) => !b.sender_id || !blocked.has(b.sender_id));
  if (broadcasts.length === 0) return [];

  const ids = broadcasts.map((b) => b.id);
  const senderIds = Array.from(new Set(broadcasts.map((b) => b.sender_id).filter(Boolean))) as string[];
  const [{ data: reactions }, { data: replies }, { data: profiles }] = await Promise.all([
    supabase.from('community_broadcast_reactions').select('broadcast_id, emoji, user_id').in('broadcast_id', ids),
    supabase.from('community_broadcast_replies').select('broadcast_id').in('broadcast_id', ids),
    senderIds.length > 0
      ? supabase.from('profiles_public').select('id, first_name_display, profile_photo_url').in('id', senderIds)
      : Promise.resolve({ data: [] } as any),
  ]);

  const nameById = new Map<string, string | null>(
    (profiles ?? []).map((p: any) => [p.id as string, (p.first_name_display ?? null) as string | null]),
  );
  // T3 (doc 121): faces in the main community chat, same source the topic
  // rooms already use (profiles_public, one identity everywhere)
  const photoById = new Map<string, string | null>(
    (profiles ?? []).map((p: any) => [p.id as string, (p.profile_photo_url ?? null) as string | null]),
  );
  const replyCounts = new Map<string, number>();
  (replies ?? []).forEach((r: any) => replyCounts.set(r.broadcast_id, (replyCounts.get(r.broadcast_id) ?? 0) + 1));
  const reactionMap = new Map<string, Map<string, { count: number; mine: boolean }>>();
  (reactions ?? []).forEach((r: any) => {
    const perBroadcast = reactionMap.get(r.broadcast_id) ?? new Map();
    const entry = perBroadcast.get(r.emoji) ?? { count: 0, mine: false };
    entry.count += 1;
    if (user && r.user_id === user.id) entry.mine = true;
    perBroadcast.set(r.emoji, entry);
    reactionMap.set(r.broadcast_id, perBroadcast);
  });

  return broadcasts.map((b) => ({
    ...b,
    sender_name: b.sender_id ? (nameById.get(b.sender_id) ?? null) : null,
    sender_photo: b.sender_id ? (photoById.get(b.sender_id) ?? null) : null,
    reactions: Array.from((reactionMap.get(b.id) ?? new Map()).entries()).map(
      ([emoji, e]: [string, { count: number; mine: boolean }]) => ({ emoji, count: e.count, mine: e.mine }),
    ),
    reply_count: replyCounts.get(b.id) ?? 0,
  }));
}

/**
 * The open composer (batch 21): any active member speaks in the main chat.
 * kind='message' rides the same stream as broadcasts and intro cards, so
 * ordering, unreads, previews, and realtime all inherit.
 */
export async function sendCommunityMessage(communityId: string, body: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const trimmed = body.trim();
  if (!trimmed) return;
  const { error } = await supabase.from('community_broadcasts').insert({
    community_id: communityId,
    sender_id: user.id,
    body: trimmed.slice(0, 4000),
    kind: 'message',
  });
  if (error) throw error;
}

export async function toggleBroadcastReaction(broadcastId: string, emoji: string, on: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  if (on) {
    const { error } = await supabase
      .from('community_broadcast_reactions')
      .insert({ broadcast_id: broadcastId, user_id: user.id, emoji });
    if (error && (error as { code?: string }).code !== '23505') throw error; // already reacted = fine
  } else {
    const { error } = await supabase
      .from('community_broadcast_reactions')
      .delete()
      .eq('broadcast_id', broadcastId)
      .eq('user_id', user.id)
      .eq('emoji', emoji);
    if (error) throw error;
  }
}

export interface BroadcastReply {
  id: string;
  body: string;
  created_at: string;
  sender_id: string;
  sender_name: string | null;
  sender_photo: string | null;
}

export async function getBroadcastReplies(broadcastId: string): Promise<BroadcastReply[]> {
  const { data, error } = await supabase
    .from('community_broadcast_replies')
    .select('id, body, created_at, sender_id')
    .eq('broadcast_id', broadcastId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  return attachSenderProfiles(data ?? []);
}

export async function sendBroadcastReply(broadcastId: string, body: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase
    .from('community_broadcast_replies')
    .insert({ broadcast_id: broadcastId, sender_id: user.id, body: body.trim() });
  if (error) throw error;
}

// -- topics (the rooms) ----------------------------------------------------------

export interface TopicMessage {
  id: string;
  body: string;
  created_at: string;
  sender_id: string;
  sender_name: string | null;
  sender_photo: string | null;
}

/**
 * The topic row itself. The screen used to load messages and nothing else,
 * so it had no idea whether the room was still open: an archived topic still
 * rendered a live composer and the send came back as a raw RLS refusal. The
 * archive cron runs daily over community event topics, so every past event's
 * room is in exactly that state.
 */
export interface TopicMeta {
  id: string;
  name: string;
  archived: boolean;
  community_id: string;
  explore_event_id: string | null;
  /**
   * Live bug fix (2026-08-19): a cancelled event and one that simply ended
   * both just archive the topic, with nothing recording which reason it
   * was. explore_events.status already carries that distinction at the
   * event level, so it's pulled in here (embedded select via the FK) so the
   * closed-room copy can tell them apart. Null for persistent community
   * rooms, which have no linked event.
   */
  /**
   * SC-09/C-24 (2026-08-19): host_user_id rides the same embed so the
   * welcome-message banner can tell "the creator's own first message" apart
   * from a member happening to type first. Same null-for-persistent-rooms
   * shape as status above.
   */
  /**
   * SC-08 (2026-08-19): event_date/start_time/venue ride the same embed so
   * the room header can show a real logistics recap and a real expiry
   * timestamp instead of neither. Null for persistent community rooms.
   */
  explore_events: {
    status: string | null;
    host_user_id: string | null;
    event_date: string | null;
    start_time: string | null;
    venue: string | null;
  } | null;
}

export async function getTopicMeta(topicId: string): Promise<TopicMeta | null> {
  const { data, error } = await supabase
    .from('community_topics')
    .select(
      'id, name, archived, community_id, explore_event_id, explore_events(status, host_user_id, event_date, start_time, venue)',
    )
    .eq('id', topicId)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as TopicMeta;
}

/**
 * SC-08: the room's real close time, computed the same way the live cron
 * actually computes it right now (id 29, archive-community-event-topics:
 * coalesce(start_time, event_date) + 48h -- keyed off the event START, a
 * known bug, fix written but unapplied in
 * 20260819030000_fix_event_chat_archive_timer.sql). This intentionally
 * mirrors today's REAL behavior, not the fixed behavior, so the timestamp
 * shown is never wrong about what will actually happen until that migration
 * is applied. Null when there is nothing to key off (persistent room, or a
 * linked event with neither field set).
 */
export function computeEventRoomExpiry(meta: Pick<TopicMeta, 'explore_events'>): Date | null {
  const ev = meta.explore_events;
  if (!ev) return null;
  const base = ev.start_time ?? (ev.event_date ? `${ev.event_date}T00:00:00` : null);
  if (!base) return null;
  const d = new Date(base);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 48 * 60 * 60 * 1000);
}

export async function getTopicMessages(topicId: string): Promise<TopicMessage[]> {
  const { data, error } = await supabase
    .from('community_topic_messages')
    .select('id, body, created_at, sender_id')
    .eq('topic_id', topicId)
    .order('created_at', { ascending: true })
    .limit(300);
  if (error) throw error;
  return attachSenderProfiles(data ?? []);
}

export async function sendTopicMessage(topicId: string, body: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase
    .from('community_topic_messages')
    .insert({ topic_id: topicId, sender_id: user.id, body: body.trim() });
  if (error) throw error;
}

/**
 * Creator moderation, distinct from the existing report/block (inventory
 * C-14): remove a message from the room for everyone, not just the caller's
 * own view. RLS-gated (community_topic_messages_delete already allows the
 * message's sender OR the topic's community leader OR an admin) -- this is
 * a raw delete, same pattern as removeMember() in creatorMode.ts, no new
 * RPC needed since the policy already covers it.
 */
export async function deleteTopicMessage(messageId: string): Promise<void> {
  const { error } = await supabase.from('community_topic_messages').delete().eq('id', messageId);
  if (error) throw error;
}

/** Joining a topic = subscribing to it (doc 09: push ON once joined). */
export async function joinTopic(topicId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase
    .from('community_topic_members')
    .upsert({ topic_id: topicId, user_id: user.id }, { onConflict: 'topic_id,user_id' });
  if (error) throw error;
}

export async function setTopicNotifications(topicId: string, on: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase
    .from('community_topic_members')
    .update({ notifications_on: on })
    .eq('topic_id', topicId)
    .eq('user_id', user.id);
  if (error) throw error;
}

/**
 * Leaders-only creation (RLS enforced; member-created topics stay a Liz
 * call). The creator is subscribed to their own room on the spot: the tour
 * found a leader's new room absent from her chat lists until she joined it
 * from the page like a stranger.
 */
export async function createTopic(communityId: string, name: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('community_topics')
    .insert({ community_id: communityId, name: name.trim(), created_by: user.id })
    .select('id')
    .single();
  if (error) throw error;
  if (data?.id) await joinTopic(data.id);
}

/** The community's open rooms (never event topics), for the creator's list. */
export interface CommunityRoom {
  id: string;
  name: string;
  created_at: string;
}

export async function getCommunityRooms(communityId: string): Promise<CommunityRoom[]> {
  const { data, error } = await supabase
    .from('community_topics')
    .select('id, name, created_at')
    .eq('community_id', communityId)
    .eq('archived', false)
    .is('explore_event_id', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CommunityRoom[];
}

// -- mute (doc 09: mutable, not leavable) ----------------------------------------

export async function setBroadcastMute(communityId: string, muted: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_community_broadcast_mute', {
    p_community_id: communityId,
    p_muted: muted,
  });
  if (error) throw error;
}

export async function getMyBroadcastMute(communityId: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from('community_members')
    .select('broadcasts_muted')
    .eq('community_id', communityId)
    .eq('user_id', user.id)
    .maybeSingle();
  return !!data?.broadcasts_muted;
}

// -- event chat say-hi gate (Liz 7-07: nobody creeps silently in an event room) ----

/** True once the caller has sent at least one message in this topic. */
export async function hasSaidHiInTopic(topicId: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase
    .from('community_topic_messages')
    .select('id')
    .eq('topic_id', topicId)
    .eq('sender_id', user.id)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

// -- pinned event (chat model 7-07: main chat pins the soonest upcoming) ----------

export interface PinnedCommunityEvent {
  id: string;
  title: string;
  event_date: string | null;
  start_time: string | null;
  venue: string | null;
  image_url: string | null;
}

/**
 * The soonest upcoming Live community event with pin_to_chat on, or null.
 * Reads through the existing explore_events public-read policy.
 */
export async function getPinnedCommunityEvent(communityId: string): Promise<PinnedCommunityEvent | null> {
  const { y, m, d } = getTodayInLA();
  const todayStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const { data, error } = await supabase
    .from('explore_events')
    .select('id, title, event_date, start_time, venue, image_url')
    .eq('community_id', communityId)
    .eq('status', 'Live')
    .eq('pin_to_chat', true)
    .gte('event_date', todayStr)
    .order('event_date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0] as PinnedCommunityEvent | undefined) ?? null;
}

// -- shared ----------------------------------------------------------------------

async function attachSenderProfiles<T extends { sender_id: string }>(
  rows: T[],
): Promise<(T & { sender_name: string | null; sender_photo: string | null })[]> {
  if (rows.length === 0) return [];
  // drop messages from anyone blocked (either direction) before doing anything
  // else. Covers topic messages and broadcast replies (both flow through here).
  const { data: { user } } = await supabase.auth.getUser();
  const blocked = await getBlockedWith(user?.id, rows.map((r) => r.sender_id));
  const shown = blocked.size > 0 ? rows.filter((r) => !blocked.has(r.sender_id)) : rows;
  if (shown.length === 0) return [];
  rows = shown;
  const ids = Array.from(new Set(rows.map((r) => r.sender_id)));
  const { data: profiles } = await supabase
    .from('profiles_public')
    .select('id, first_name_display, profile_photo_url')
    .in('id', ids);
  const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]));
  return rows.map((r) => ({
    ...r,
    sender_name: byId.get(r.sender_id)?.first_name_display ?? null,
    sender_photo: byId.get(r.sender_id)?.profile_photo_url ?? null,
  }));
}
