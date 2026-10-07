import { validOptionalMentionDocument, trimChatMentionDocument, sameChatMentionIdentity, type ChatMentionDocument } from './chatMentionIdentity';
import type { TopicDraftEdit } from './topicComposerDraft';
import { requestWithDeadline } from './requestWithDeadline';
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
import * as Crypto from 'expo-crypto';
import { getTodayInLA } from './laDate';
import { getBlockedWith } from './blocking';
import { CHAT_NEWEST_PAGE_SIZE, olderChatFilter } from './chatPaging';
import { resolveChatSendReceipt } from './chatSendReceipt';
import { parseCommunityLocation, communityMessagePreview } from './communityLocationMessage';

/** Optional caller-owned account/room visit. A retired visit must never revive. */
export interface CommunityOperationScope {
  readonly userId: string;
  readonly isCurrent: () => boolean;
}

export class ObsoleteCommunityOperationError extends Error {
  constructor() {
    super('This community operation belongs to a previous visit.');
    this.name = 'ObsoleteCommunityOperationError';
  }
}

export function isObsoleteCommunityOperation(error: unknown): error is ObsoleteCommunityOperationError {
  return error instanceof ObsoleteCommunityOperationError;
}

function assertCommunityScope(scope?: CommunityOperationScope): void {
  if (scope && (!scope.userId || !scope.isCurrent())) throw new ObsoleteCommunityOperationError();
}

/** Guard rejected as well as successful responses; never start the next request
 * for a retired caller. Requests already dispatched still need server authority. */
async function scopedCommunityRequest<T>(scope: CommunityOperationScope | undefined, request: () => PromiseLike<T>): Promise<T> {
  assertCommunityScope(scope);
  try {
    return await request();
  } finally {
    assertCommunityScope(scope);
  }
}

async function communityOperationUser(scope?: CommunityOperationScope) {
  const { data: { user }, error } = await scopedCommunityRequest(scope, () => supabase.auth.getUser());
  assertCommunityScope(scope);
  if (scope) {
    if (error) throw error;
    if (!user || user.id !== scope.userId) throw new ObsoleteCommunityOperationError();
  }
  return user;
}

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
  /** Screen 37: the main chat's own display name, independent of the
   *  community's name (communities.main_chat_name via get_my_community_chat_cards,
   *  migration 20260906200000). Null until that migration is applied, or for
   *  a community that has never had one explicitly set -- callers fall back
   *  to "community chat", same default the column itself carries. */
  main_chat_name: string | null;
  accent_color: string | null;
  role: 'leader' | 'co_leader' | 'admin' | 'events' | 'member_care' | 'finance' | 'member';
  latest_broadcast: { id: string; body: string; created_at: string; sender_id: string | null } | null;
  unread_broadcasts: number;
  topics: ChatCardTopic[];
  unread_total: number;
  last_activity_at: string | null;
}

/** The community event chat's topic id, keyed by the event itself
 *  (community_topics.explore_event_id) -- created at event publish time
 *  (20260707120000_event_chat_model.sql), so any confirmed attendee can
 *  look it up regardless of how they attended (RSVP or ticket purchase). */
export async function getEventTopicId(eventId: string, strict = false): Promise<string | null> {
  const { data, error } = await supabase
    .from('community_topics')
    .select('id')
    .eq('explore_event_id', eventId)
    .maybeSingle();
  if (strict && error) throw error;
  if (strict && data && (typeof data.id !== 'string' || !data.id)) throw new Error('The event chat could not be checked.');
  return (data?.id as string | undefined) ?? null;
}

export async function getCommunityChatPayload(
  scopeOrQueryContext?: CommunityOperationScope | { queryKey: readonly unknown[] },
): Promise<CommunityChatPayload> {
  // Existing screens pass this function directly as a React Query queryFn.
  // Its context is not an operation scope; scoped callers pass an explicit one.
  const scope = scopeOrQueryContext && 'isCurrent' in scopeOrQueryContext ? scopeOrQueryContext : undefined;
  const { data, error } = await scopedCommunityRequest(scope, () => supabase.rpc('get_my_community_chat_cards'));
  assertCommunityScope(scope);
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
  /** Explicit provenance for grouping. Undefined is an older/unclassified
   * cached row; only null means a persistent community conversation. */
  eventId?: string | null;
  isDefault?: boolean;
  /** Existing stream name; never infer that a mixed broadcast stream is Intros. */
  roomName?: string | null;
  /** Explicit server mapping; absent on legacy/unclassified rows. */
  roomRole?: 'intros' | 'main' | 'optional';
  /** Current individual preference and independent parent override. Unknown stays unknown. */
  roomNotificationsOn?: boolean;
  communityMuted?: boolean | null;
  lastMessageId?: string | null;
  lastMessageSource?: 'broadcast' | 'topic' | null;
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
      // deliberately still the community's name, not c.main_chat_name
      // (Screen 37): this row belongs to the Chats-list surface, not the
      // community-thread screen -- left untouched here rather than decided
      // on this screen's behalf.
      title: c.name,
      secondary: null,
      // LIZ COPY
      preview: c.latest_broadcast?.body ? communityMessagePreview(c.latest_broadcast.body) : 'you are in.',
      lastAt: c.latest_broadcast?.created_at ?? joinedAtByCommunity.get(c.community_id) ?? null,
      unread: c.unread_broadcasts,
      accent: c.accent_color,
      image: coverByCommunity.get(c.community_id) ?? null,
      eventId: null,
      roomName: c.main_chat_name,
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
        eventId: t.explore_event_id,
        isDefault: t.is_default,
        roomNotificationsOn: t.notifications_on,
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
      eventId: at.explore_event_id,
      roomNotificationsOn: at.notifications_on,
      accent: at.accent_color,
      image: imageByEvent.get(at.explore_event_id) ?? coverByCommunity.get(at.community_id) ?? null,
    });
  }
  // newest activity first, community rows float above their rooms on ties
  rows.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
  return rows;
}

// -- read markers ----------------------------------------------------------------

export async function markBroadcastsRead(communityId: string, scope?: CommunityOperationScope): Promise<void> {
  const user = await communityOperationUser(scope);
  if (!user) return;
  const { error } = await scopedCommunityRequest(scope, () => supabase
    .from('community_broadcast_reads')
    .upsert(
      { community_id: communityId, user_id: user.id, last_read_at: new Date().toISOString() },
      { onConflict: 'community_id,user_id' },
    ));
  assertCommunityScope(scope);
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
  /** Versioned standard introduction; older composed cards keep their formatting. */
  format?: 'member_intro_v1';
  user_id: string;
  first_name: string;
  area: string | null;
  question: string;
  answer: string;
}

export interface CommunityBroadcast {
  mention_data?: ChatMentionDocument | null;
  id: string;
  body: string;
  created_at: string;
  sender_id: string | null;
  sender_name: string | null;
  sender_photo: string | null;
  kind: 'broadcast' | 'intro' | 'message';
  payload: IntroPayload | null;
  image_url: string | null;
  edited_at: string | null;
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
  if (p.format === 'member_intro_v1') return `${p.first_name}: ${p.answer}`;
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
  if (p.format === 'member_intro_v1') return { lead: p.first_name, qa: p.answer };
  const fragment = p.question.trim().replace(/[?.!]+$/, '').toLowerCase();
  const from = p.area ? `, from ${p.area}` : '';
  const punct = /[.!?]$/.test(p.answer) ? '' : '.';
  if (fragment.length <= INTRO_QUESTION_INLINE_MAX) {
    return { lead: `this is ${p.first_name}${from}. ${fragment}: ${p.answer}${punct}`, qa: null };
  }
  return { lead: `this is ${p.first_name}${from}.`, qa: `${fragment}: ${p.answer}${punct}` };
}

export interface CommunityBroadcastPage {
  messages: CommunityBroadcast[];
  hasMore: boolean;
  olderCursor: { created_at: string; id: string } | null;
}

/** Exact-source reads let the D09 reader reuse enrichment without scanning another room. */
export interface CommunityMessageReadOptions {
  messageIds?: readonly string[];
  strictEnrichment?: boolean;
  resolveReplyParents?: boolean;
  /** Ascending context after a checked source row. The returned olderCursor
   * remains the raw page-end cursor (therefore the newest row in this mode). */
  after?: { cursor: { created_at: string; id: string }; sameTime?: 'all' | 'none' };
  broadcastKind?: 'intro' | 'main';
}

export async function getCommunityBroadcasts(
  communityId: string,
  olderThan?: { created_at: string; id: string },
  scope?: CommunityOperationScope,
  options?: CommunityMessageReadOptions,
): Promise<CommunityBroadcastPage> {
  const user = await communityOperationUser(scope);
  assertCommunityScope(scope);
  const viewerId = user?.id;
  if (options?.messageIds?.length === 0) return { messages: [], hasMore: false, olderCursor: null };
  let query = supabase
    .from('community_broadcasts')
    .select('id, body, created_at, sender_id, kind, payload, image_url, edited_at, mention_data')
    .eq('community_id', communityId)
    .order('created_at', { ascending: !!options?.after })
    .order('id', { ascending: !!options?.after })
    .limit(CHAT_NEWEST_PAGE_SIZE);
  if (options?.messageIds) query = query.in('id', [...options.messageIds]);
  if (options?.after) {
    if (olderThan) throw Error('Choose one history direction.');
    const { cursor, sameTime } = options.after;
    if (!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(cursor.id) ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(cursor.created_at) ||
      !Number.isFinite(Date.parse(cursor.created_at))) throw Error('This history cursor could not be checked.');
    if (sameTime === 'all') query = query.gte('created_at', cursor.created_at);
    else if (sameTime === 'none') query = query.gt('created_at', cursor.created_at);
    else query = query.or(`created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`);
  }
  if (options?.broadcastKind === 'intro') query = query.eq('kind', 'intro');
  if (options?.broadcastKind === 'main') query = query.neq('kind', 'intro');

  if (olderThan) query = query.or(olderChatFilter(olderThan));
  const { data: rows, error } = await scopedCommunityRequest(scope, () => query);
  assertCommunityScope(scope);
  if (error) throw error;
  const fetched = rows ?? [];
  const oldestRaw = fetched[fetched.length - 1];
  const pageMeta = {
    hasMore: fetched.length === CHAT_NEWEST_PAGE_SIZE,
    olderCursor: oldestRaw ? { created_at: oldestRaw.created_at, id: oldestRaw.id } : null,
  };
  if (fetched.length === 0) return { messages: [], ...pageMeta };

  // Privacy and display metadata both depend on the fetched page, not on
  // each other. Start them together, but never return a row before the mutual
  // block check succeeds. Metadata is read only for the fetched page.
  const privacy = scopedCommunityRequest(scope, () => getBlockedWith(viewerId, fetched.map((b) => b.sender_id)));
  const ids = fetched.map((b) => b.id);
  const senderIds = Array.from(new Set(fetched.map((b) => b.sender_id).filter(Boolean))) as string[];
  const enrichment = scopedCommunityRequest(scope, () => Promise.all([
    supabase.from('community_broadcast_reactions').select('broadcast_id, emoji, user_id').in('broadcast_id', ids),
    supabase.from('community_broadcast_replies').select('broadcast_id').in('broadcast_id', ids),
    senderIds.length > 0
      ? supabase.from('profiles_public').select('id, first_name_display, profile_photo_url').in('id', senderIds)
      : Promise.resolve({ data: [] } as any),
  ])).then(data => ({ data }), error => ({ error }));
  // Attach the rejection handler immediately: a fast metadata failure must
  // not become unhandled while privacy is pending (or after an empty return).
  const blocked = await privacy;
  assertCommunityScope(scope);
  const broadcasts = fetched.filter((b) => !b.sender_id || !blocked.has(b.sender_id));
  if (broadcasts.length === 0) return { messages: [], ...pageMeta };

  const metadata = await enrichment;
  assertCommunityScope(scope);
  if ('error' in metadata) throw metadata.error;
  const [{ data: reactions, error: reactionsError }, { data: replies, error: repliesError }, { data: profiles, error: profilesError }] = metadata.data;

  if (options?.strictEnrichment && (reactionsError || repliesError || profilesError)) throw reactionsError || repliesError || profilesError;

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
    if (viewerId && r.user_id === viewerId) entry.mine = true;
    perBroadcast.set(r.emoji, entry);
    reactionMap.set(r.broadcast_id, perBroadcast);
  });

  return { messages: broadcasts.map((b) => ({
    ...b,
    sender_name: b.sender_id ? (nameById.get(b.sender_id) ?? null) : null,
    sender_photo: b.sender_id ? (photoById.get(b.sender_id) ?? null) : null,
    reactions: Array.from((reactionMap.get(b.id) ?? new Map()).entries()).map(
      ([emoji, e]: [string, { count: number; mine: boolean }]) => ({ emoji, count: e.count, mine: e.mine }),
    ),
    reply_count: replyCounts.get(b.id) ?? 0,
  })), ...pageMeta };
}

/**
 * The open composer (batch 21): any active member speaks in the main chat.
 * kind='message' rides the same stream as broadcasts and intro cards, so
 * ordering, unreads, previews, and realtime all inherit.
 */
export async function sendCommunityMessage(communityId: string, body: string, imageUrl?: string, sendIdOverride?: string, scope?: CommunityOperationScope, mentions?: ChatMentionDocument | null): Promise<void> {
  const user = await requestWithDeadline(communityOperationUser(scope), 8_000);
  if (!user) throw new Error('Not signed in');
  const senderId = user.id;
  const trimmed = body.trim();
  if (!trimmed && !imageUrl) throw new Error('Write a message before sending.');
  if (mentions !== undefined && (trimmed.length > 4000 || !validOptionalMentionDocument(body, mentions))) throw Error('Your mentions could not be confirmed. Your message is kept.');
  const mentionData = mentions ? trimChatMentionDocument(body, mentions) : null;
  const savedBody = trimmed.slice(0, 4000);
  const media = !!imageUrl || !!parseCommunityLocation(savedBody);
  const columns = media ? `id, created_at, body, image_url${mentions !== undefined ? ', mention_data' : ''}` : mentions !== undefined ? 'id, created_at, body, mention_data' : 'id, created_at';
  const sendId = sendIdOverride ?? Crypto.randomUUID();
  const checkedReceipt = (result: any) => result.data &&
    ((media && (result.data.id !== sendId || result.data.body !== savedBody || result.data.image_url !== (imageUrl ?? null))) ||
      (mentions !== undefined && (result.data.body !== savedBody || !sameChatMentionIdentity(savedBody, mentionData, result.data.mention_data))))
      ? { data: null, error: Error(media ? 'The saved message differs. Your original is kept.' : 'The saved mention identity differs. Your message is kept.') } : result;
  const { receipt, failure } = await resolveChatSendReceipt(
    async () => checkedReceipt(await requestWithDeadline(scopedCommunityRequest(scope, () => supabase.from('community_broadcasts').insert({
      id: sendId,
      community_id: communityId,
      sender_id: senderId,
      body: savedBody,
      ...(mentions !== undefined ? { mention_data: mentionData } : {}),
      image_url: imageUrl ?? null,
      kind: 'message',
    }).select(columns).single()), 12_000)),
    async () => checkedReceipt(await requestWithDeadline(scopedCommunityRequest(scope, () => supabase.from('community_broadcasts')
      .select(columns)
      .eq('id', sendId).eq('community_id', communityId).eq('sender_id', senderId).maybeSingle()), 8_000)),
  );
  // The receipt helper deliberately absorbs failures to recover lost responses.
  // A retired scope must still reject even if it found an old successful receipt.
  assertCommunityScope(scope);
  if (!receipt) throw failure ?? new Error('Delivery could not be confirmed. Check this chat before trying again.');
}

export type CommunityMessageEditContext = { communityId: string; original: TopicDraftEdit; mentions: ChatMentionDocument | null };

export async function editCommunityMessage(messageId: string, body: string, scope?: CommunityOperationScope, context?: CommunityMessageEditContext): Promise<void> {
  const user = await communityOperationUser(scope);
  if (!user) throw new Error('Not signed in');
  if (context) {
    const trimmed = body.trim();
    const original = context.original;
    if (!trimmed || trimmed.length > 4000 || original.id !== messageId || !context.communityId
      || !validOptionalMentionDocument(body, context.mentions) || !validOptionalMentionDocument(original.body, original.mentions))
      throw Error('Your edit could not be confirmed. Your message is kept.');
    const mentionData = context.mentions ? trimChatMentionDocument(body, context.mentions) : null;
    const originalMentions = original.mentions ?? null;
    let query = supabase.from('community_broadcasts')
      .update({ body: trimmed, mention_data: mentionData, edited_at: new Date().toISOString() })
      .eq('id', messageId).eq('community_id', context.communityId).eq('sender_id', user.id).eq('kind', 'message')
      .eq('body', original.body);
    query = original.edited_at === null ? query.is('edited_at', null) : query.eq('edited_at', original.edited_at);
    query = originalMentions === null ? query.is('mention_data', null) : query.eq('mention_data', JSON.stringify(originalMentions));
    const result = await requestWithDeadline(scopedCommunityRequest(scope, () => query.select('id, body, mention_data').maybeSingle()), 12_000);
    assertCommunityScope(scope);
    if (result.error) throw result.error;
    if (!result.data || result.data.id !== messageId || result.data.body !== trimmed
      || !sameChatMentionIdentity(trimmed, mentionData, result.data.mention_data))
      throw Error('The original message changed or your edit could not be confirmed. Your draft is kept.');
    return;
  }
  const { error } = await scopedCommunityRequest(scope, () => supabase
    .from('community_broadcasts')
    .update({ body: body.trim().slice(0, 4000), edited_at: new Date().toISOString() })
    .eq('id', messageId)
    .eq('sender_id', user.id)
    .eq('kind', 'message'));
  assertCommunityScope(scope);
  if (error) throw error;
}

export async function deleteCommunityMessage(messageId: string, scope?: CommunityOperationScope): Promise<void> {
  const user = await communityOperationUser(scope);
  if (!user) throw new Error('Not signed in');
  const { error } = await scopedCommunityRequest(scope, () => supabase
    .from('community_broadcasts')
    .delete()
    .eq('id', messageId)
    .eq('sender_id', user.id)
    .eq('kind', 'message'));
  assertCommunityScope(scope);
  if (error) throw error;
}

export async function toggleBroadcastReaction(broadcastId: string, emoji: string, on: boolean, scope?: CommunityOperationScope): Promise<void> {
  const user = await communityOperationUser(scope);
  if (!user) throw new Error('Not signed in');
  if (on) {
    const { error } = await scopedCommunityRequest(scope, () => supabase
      .from('community_broadcast_reactions')
      .insert({ broadcast_id: broadcastId, user_id: user.id, emoji }));
    assertCommunityScope(scope);
    if (error && (error as { code?: string }).code !== '23505') throw error; // already reacted = fine
  } else {
    const { error } = await scopedCommunityRequest(scope, () => supabase
      .from('community_broadcast_reactions')
      .delete()
      .eq('broadcast_id', broadcastId)
      .eq('user_id', user.id)
      .eq('emoji', emoji));
    assertCommunityScope(scope);
    if (error) throw error;
  }
}

export interface BroadcastReply {
  mention_data?: ChatMentionDocument | null;
  id: string;
  body: string;
  created_at: string;
  sender_id: string;
  sender_name: string | null;
  sender_photo: string | null;
}

export interface BroadcastReplyPage {
  replies: BroadcastReply[];
  hasMore: boolean;
  olderCursor: { created_at: string; id: string } | null;
}

export async function getBroadcastReplies(
  broadcastId: string, scope?: CommunityOperationScope,
  olderThan?: { created_at: string; id: string },
): Promise<BroadcastReplyPage> {
  let query = supabase
    .from('community_broadcast_replies')
    .select('id, body, created_at, sender_id, mention_data')
    .eq('broadcast_id', broadcastId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(CHAT_NEWEST_PAGE_SIZE);
  if (olderThan) query = query.or(olderChatFilter(olderThan));
  const { data, error } = await scopedCommunityRequest(scope, () => query);
  if (error) throw error;
  const raw = data ?? [];
  const oldest = raw[raw.length - 1];
  const replies = await attachSenderProfiles([...raw].reverse(), scope);
  assertCommunityScope(scope);
  // Advance with the raw cursor even when every sender on a page is blocked.
  return { replies, hasMore: raw.length === CHAT_NEWEST_PAGE_SIZE,
    olderCursor: oldest ? { created_at: oldest.created_at, id: oldest.id } : null };
}

/** Resolve reply tagging from the readable parent, never from public discovery. */
export async function getBroadcastReplyMembers(broadcastId: string, scope?: CommunityOperationScope): Promise<CommunityChatMember[]> {
  const user = await communityOperationUser(scope);
  if (!user) throw Error('Not signed in');
  const {data: parent, error} = await scopedCommunityRequest(scope, () => supabase.from('community_broadcasts')
    .select('id,community_id,sender_id').eq('id',broadcastId).maybeSingle());
  if (error) throw error;
  if (!parent) throw Error('The original message is unavailable.');
  const members = await getCommunityChatMembers(parent.community_id,scope);
  const blocked = await scopedCommunityRequest(scope, () => getBlockedWith(user.id,[...members.map(member=>member.id),...(parent.sender_id?[parent.sender_id]:[])]));
  if (parent.sender_id && blocked.has(parent.sender_id)) throw Error('The original message is unavailable.');
  return members.filter(member=>!blocked.has(member.id));
}

export async function sendBroadcastReply(broadcastId: string, body: string, scope?: CommunityOperationScope, sendId?: string, mentions?: ChatMentionDocument | null): Promise<void> {
  const user = await communityOperationUser(scope);
  if (!user) throw new Error('Not signed in');
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > 4000) throw Error('Write a reply of up to 4,000 characters.');
  if (!validOptionalMentionDocument(body, mentions)) throw Error('Your mentions could not be confirmed. Your reply is kept.');
  const mentionData = mentions ? trimChatMentionDocument(body, mentions) : null;
  const payload = { broadcast_id: broadcastId, sender_id: user.id, body: trimmed,
    ...(sendId ? {id: sendId} : {}), ...(mentions !== undefined ? {mention_data: mentionData} : {}) };
  // Existing callers keep their original contract until their durable composer is connected.
  if (!sendId) {
    const {error} = await scopedCommunityRequest(scope, () => supabase.from('community_broadcast_replies').insert(payload));
    if (error) throw error;
    return;
  }
  const columns = 'id,created_at,body,sender_id,broadcast_id' + (mentions !== undefined ? ',mention_data' : '');
  const checkedReceipt = (result: any) => result.data && (result.data.id !== sendId || result.data.body !== trimmed ||
    result.data.sender_id !== user.id || result.data.broadcast_id !== broadcastId ||
    mentions !== undefined && !sameChatMentionIdentity(trimmed, mentionData, result.data.mention_data))
      ? {data:null,error:Error('Your original reply could not be confirmed. Your draft is kept.')} : result;
  const {receipt, failure} = await resolveChatSendReceipt(
    async () => checkedReceipt(await scopedCommunityRequest(scope, () => supabase.from('community_broadcast_replies')
      .insert(payload).select(columns).single())),
    async () => checkedReceipt(await scopedCommunityRequest(scope, () => supabase.from('community_broadcast_replies')
      .select(columns).eq('id',sendId).eq('broadcast_id',broadcastId).eq('sender_id',user.id).maybeSingle())),
  );
  assertCommunityScope(scope);
  if (!receipt) throw failure ?? Error('Delivery could not be confirmed. Your reply is kept.');
}

// -- topics (the rooms) ----------------------------------------------------------

export interface TopicMessage {
  mention_data?: ChatMentionDocument | null;
  id: string;
  body: string;
  created_at: string;
  sender_id: string;
  sender_name: string | null;
  sender_photo: string | null;
  image_url: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  /** Local-only send status; server rows have no delivery_state column. */
  delivery_state?: 'sending';
  reply_to_message_id: string | null;
  edited_at: string | null;
  reply_to: TopicReply | null;
  reactions: TopicMessageReaction[];
}

export interface TopicMessageReaction {
  user_id: string;
  reaction: string;
}

export interface TopicReply {
  id: string;
  body: string;
  sender_name: string | null;
}

export interface CommunityChatMember {
  id: string;
  first_name: string | null;
  avatar_url: string | null;
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
   * SC-09/C-24 (2026-08-24): room-level album on/off, creator-controlled
   * (see setTopicAlbumEnabled in lib/topicAlbum.ts). Defaults false.
   */
  album_enabled: boolean;
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
   * end_time added 2026-08-24 so computeEventRoomExpiry can match the real
   * cron calculation (event_end+48h) instead of the old start-time-only one.
   */
  explore_events: {
    title: string | null;
    status: string | null;
    host_user_id: string | null;
    event_date: string | null;
    start_time: string | null;
    end_time: string | null;
    venue: string | null;
  } | null;
}

export async function getTopicMeta(topicId: string): Promise<TopicMeta | null> {
  const { data, error } = await supabase
    .from('community_topics')
    .select(
      'id, name, archived, album_enabled, community_id, explore_event_id, explore_events(title, status, host_user_id, event_date, start_time, end_time, venue)',
    )
    .eq('id', topicId)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as TopicMeta;
}

/**
 * SC-08: the room's real close time. Matches the live cron's calculation
 * (id 29, archive-community-event-topics) as of the 2026-08-19 fix applying
 * 2026-08-23: coalesce(end_time, start_time, event_date) + 48h, keyed off
 * the event's real END, not its start -- a multi-day event's room no longer
 * locks itself while the event is still happening. Null when there is
 * nothing to key off (persistent room, or a linked event with none of the
 * three fields set).
 */
export function computeEventRoomExpiry(meta: Pick<TopicMeta, 'explore_events'>): Date | null {
  const ev = meta.explore_events;
  if (!ev) return null;
  const base = ev.end_time ?? ev.start_time ?? (ev.event_date ? `${ev.event_date}T00:00:00` : null);
  if (!base) return null;
  const d = new Date(base);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 48 * 60 * 60 * 1000);
}

export function isEventRoomClosed(
  meta: Pick<TopicMeta, 'archived' | 'explore_events'>,
  nowMs = Date.now(),
): boolean {
  if (meta.archived) return true;
  const expiry = computeEventRoomExpiry(meta);
  return expiry !== null && nowMs >= expiry.getTime();
}

/**
 * SC-09/C-24: true during the T-24h save-notice window -- after the room's
 * real expiry minus 24h, before the expiry itself. Once `archived` flips
 * true (the actual hard stop), this returns false; archived is the
 * authoritative state at that point, not the client's own clock.
 */
export function isInSaveNoticeWindow(meta: Pick<TopicMeta, 'archived' | 'explore_events'>): boolean {
  if (meta.archived) return false;
  const expiry = computeEventRoomExpiry(meta);
  if (!expiry) return false;
  const now = Date.now();
  return now >= expiry.getTime() - 24 * 60 * 60 * 1000 && now < expiry.getTime();
}

export const TOPIC_MESSAGE_PAGE_SIZE = 60;
export interface TopicMessagePage {
  messages: TopicMessage[];
  hasMore: boolean;
  olderCursor: { created_at: string; id: string } | null;
}

export async function getTopicMessages(
  topicId: string,
  olderThan?: { created_at: string; id: string },
  scope?: CommunityOperationScope,
  options?: CommunityMessageReadOptions,
): Promise<TopicMessagePage> {
  if (scope) await communityOperationUser(scope);
  if (options?.messageIds?.length === 0) return { messages: [], hasMore: false, olderCursor: null };
  let query = supabase
    .from('community_topic_messages')
    .select('id, body, created_at, sender_id, image_url, reply_to_message_id, edited_at, location_lat, location_lng, mention_data')
    .eq('topic_id', topicId)
    .order('created_at', { ascending: !!options?.after })
    .order('id', { ascending: !!options?.after })
    .limit(TOPIC_MESSAGE_PAGE_SIZE);
  if (options?.messageIds) query = query.in('id', [...options.messageIds]);
  if (options?.after) {
    if (olderThan) throw Error('Choose one history direction.');
    const { cursor, sameTime } = options.after;
    if (!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(cursor.id) ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(cursor.created_at) ||
      !Number.isFinite(Date.parse(cursor.created_at))) throw Error('This history cursor could not be checked.');
    if (sameTime === 'all') query = query.gte('created_at', cursor.created_at);
    else if (sameTime === 'none') query = query.gt('created_at', cursor.created_at);
    else query = query.or(`created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`);
  }

  if (olderThan) {
    query = query.or(olderChatFilter(olderThan));
  }
  const { data, error } = await scopedCommunityRequest(scope, () => query);
  if (error) throw error;
  const raw = data ?? [];
  const oldestRaw = raw[raw.length - 1];
  const pageMeta = {
    hasMore: raw.length === TOPIC_MESSAGE_PAGE_SIZE,
    olderCursor: oldestRaw ? { created_at: oldestRaw.created_at, id: oldestRaw.id } : null,
  };
  const enriched = await attachSenderProfiles([...raw].reverse(), scope, options?.strictEnrichment);
  if (enriched.length === 0) return { messages: [], ...pageMeta };
  const messageIds = enriched.map((message) => message.id);
  const { data: reactionRows, error: reactionError } = await scopedCommunityRequest(scope, () => supabase
    .from('community_topic_message_reactions')
    .select('message_id, user_id, reaction')
    .in('message_id', messageIds));
  if (reactionError) throw reactionError;
  const reactionsByMessage = new Map<string, TopicMessageReaction[]>();
  (reactionRows ?? []).forEach((row: any) => {
    const current = reactionsByMessage.get(row.message_id) ?? [];
    current.push({ user_id: row.user_id, reaction: row.reaction });
    reactionsByMessage.set(row.message_id, current);
  });
  const byId = new Map(enriched.map((message) => [message.id, message]));
  if (options?.resolveReplyParents) {
    const missingParents = [...new Set(enriched.flatMap(message => message.reply_to_message_id && !byId.has(message.reply_to_message_id) ? [message.reply_to_message_id] : []))];
    if (missingParents.length) {
      const { data: parents, error: parentError } = await scopedCommunityRequest(scope, () => supabase
        .from('community_topic_messages')
        .select('id, body, created_at, sender_id, image_url, reply_to_message_id, edited_at, location_lat, location_lng, mention_data')
        .eq('topic_id', topicId)
        .in('id', missingParents));
      if (parentError) throw parentError;
      const visibleParents = await attachSenderProfiles(parents ?? [], scope, options.strictEnrichment);
      visibleParents.forEach(parent => byId.set(parent.id, parent));
    }
  }
  return { messages: enriched.map((message) => {
    const parent = message.reply_to_message_id ? byId.get(message.reply_to_message_id) : null;
    return {
      ...message,
      image_url: message.image_url ?? null,
      location_lat: message.location_lat ?? null,
      location_lng: message.location_lng ?? null,
      reply_to_message_id: message.reply_to_message_id ?? null,
      edited_at: message.edited_at ?? null,
      reply_to: parent
        ? { id: parent.id, body: parent.body, sender_name: parent.sender_name }
        : null,
      reactions: reactionsByMessage.get(message.id) ?? [],
    };
  }), ...pageMeta };
}

/** The first message remains available as a welcome candidate after the main
 * chat switches to a newest-first page. No message body is exposed beyond the
 * topic's existing membership RLS. */
export async function getTopicFirstMessage(topicId: string): Promise<{ id: string; body: string; sender_id: string; hidden: boolean } | null> {
  const { data, error } = await supabase
    .from('community_topic_messages')
    .select('id, body, sender_id')
    .eq('topic_id', topicId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: { user } } = await supabase.auth.getUser();
  const blocked = await getBlockedWith(user?.id, [data.sender_id]);
  return { ...data, body: blocked.has(data.sender_id) ? '' : data.body, hidden: blocked.has(data.sender_id) };
}

export async function sendTopicMessage(topicId: string, body: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase
    .from('community_topic_messages')
    .insert({ topic_id: topicId, sender_id: user.id, body: body.trim() });
  if (error) throw error;
}

async function profilesForUserIds(userIds: string[]): Promise<CommunityChatMember[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await supabase
    .from('profiles_public')
    .select('id, first_name_display, profile_photo_url')
    .in('id', Array.from(new Set(userIds)));
  if (error) throw error;
  return (data ?? []).map((profile: any) => ({
    id: profile.id,
    first_name: profile.first_name_display ?? null,
    avatar_url: profile.profile_photo_url ?? null,
  }));
}

export async function getTopicChatMembers(topicId: string): Promise<CommunityChatMember[]> {
  const { data, error } = await supabase
    .from('community_topic_members')
    .select('user_id')
    .eq('topic_id', topicId);
  if (error) throw error;
  return profilesForUserIds((data ?? []).map((row: any) => row.user_id));
}

export async function getCommunityChatMembers(communityId: string, scope?: CommunityOperationScope): Promise<CommunityChatMember[]> {
  const { data, error } = await scopedCommunityRequest(scope, () => supabase
    .from('community_members')
    .select('user_id')
    .eq('community_id', communityId)
    .eq('status', 'active'));
  assertCommunityScope(scope);
  if (error) throw error;
  const members = await scopedCommunityRequest(scope, () => profilesForUserIds((data ?? []).map((row: any) => row.user_id)));
  assertCommunityScope(scope);
  return members;
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
export async function joinTopic(topicId: string, scope?: CommunityOperationScope): Promise<void> {
  const user = await communityOperationUser(scope);
  if (!user) throw new Error('Not signed in');
  const { error } = await scopedCommunityRequest(scope, () => supabase
    .from('community_topic_members')
    .upsert({ topic_id: topicId, user_id: user.id }, { onConflict: 'topic_id,user_id' }));
  if (error) throw error;
}

export async function setTopicNotifications(topicId: string, on: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('community_topic_members')
    .update({ notifications_on: on })
    .eq('topic_id', topicId)
    .eq('user_id', user.id)
    .select('topic_id, user_id, notifications_on')
    .single();
  if (error) throw error;
  if (data?.topic_id !== topicId || data?.user_id !== user.id || data?.notifications_on !== on) {
    throw new Error('Could not confirm this chat notification setting.');
  }
}

/**
 * RETIRED (founder product policy, 2026-09-01): general-purpose room
 * creation is off going forward. This was leaders-only creation (RLS
 * enforced; member-created topics stayed a Liz call), wired to the "open
 * the room" action on the creator community screen (app/(creator)/
 * community.tsx). That UI entry point is removed; this function is kept as
 * the single choke point for the community_topics insert it used to do, so
 * it now refuses outright instead of being deleted -- any other caller gets
 * the same clear failure rather than a silent resurrection of the feature.
 * Existing rooms are untouched: they stay listed, reachable, and usable
 * exactly as before (see getCommunityRooms below). Event-scoped topics are
 * a separate path, created automatically at event-publish time by the
 * operator_create_explore_event / operator_update_explore_event RPCs, and
 * are unaffected by this.
 */
export async function createTopic(_communityId: string, _name: string): Promise<void> {
  throw new Error('Creating new rooms is no longer available.');
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

export async function getMyBroadcastMute(communityId: string, expectedUserId?: string): Promise<boolean> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user || expectedUserId && user.id !== expectedUserId) throw new Error('Sign in again to check this setting.');
  const { data, error } = await supabase
    .from('community_members')
    .select('broadcasts_muted')
    .eq('community_id', communityId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  if (typeof data?.broadcasts_muted !== 'boolean') throw new Error('Could not check this chat notification setting.');
  return data.broadcasts_muted;
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
export async function getPinnedCommunityEvent(communityId: string, scope?: CommunityOperationScope): Promise<PinnedCommunityEvent | null> {
  const { y, m, d } = getTodayInLA();
  const todayStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const { data, error } = await scopedCommunityRequest(scope, () => supabase
    .from('explore_events')
    .select('id, title, event_date, start_time, venue, image_url')
    .eq('community_id', communityId)
    .eq('status', 'Live')
    .eq('pin_to_chat', true)
    .gte('event_date', todayStr)
    .order('event_date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: false })
    .limit(1));
  assertCommunityScope(scope);
  if (error) throw error;
  return (data?.[0] as PinnedCommunityEvent | undefined) ?? null;
}

// -- shared ----------------------------------------------------------------------

async function attachSenderProfiles<T extends { sender_id: string }>(
  rows: T[],
  scope?: CommunityOperationScope,
  strictEnrichment = false,
): Promise<(T & { sender_name: string | null; sender_photo: string | null })[]> {
  assertCommunityScope(scope);
  if (rows.length === 0) return [];
  // drop messages from anyone blocked (either direction) before doing anything
  // else. Covers topic messages and broadcast replies (both flow through here).
  const user = await communityOperationUser(scope);
  const blocked = await scopedCommunityRequest(scope, () => getBlockedWith(user?.id, rows.map((r) => r.sender_id)));
  assertCommunityScope(scope);
  const shown = blocked.size > 0 ? rows.filter((r) => !blocked.has(r.sender_id)) : rows;
  if (shown.length === 0) return [];
  rows = shown;
  const ids = Array.from(new Set(rows.map((r) => r.sender_id)));
  const { data: profiles, error: profilesError } = await scopedCommunityRequest(scope, () => supabase
    .from('profiles_public')
    .select('id, first_name_display, profile_photo_url')
    .in('id', ids));
  assertCommunityScope(scope);
  if (strictEnrichment && profilesError) throw profilesError;
  const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]));
  return rows.map((r) => ({
    ...r,
    sender_name: byId.get(r.sender_id)?.first_name_display ?? null,
    sender_photo: byId.get(r.sender_id)?.profile_photo_url ?? null,
  }));
}
