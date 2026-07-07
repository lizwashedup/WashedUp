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

// -- the cards (Chats tab section) ---------------------------------------------

export interface ChatCardTopic {
  id: string;
  name: string;
  is_default: boolean;
  joined: boolean;
  notifications_on: boolean;
  unread: number;
  last_message_at: string | null;
}

export interface CommunityChatCard {
  community_id: string;
  handle: string;
  name: string;
  accent_color: string | null;
  role: 'leader' | 'co_leader' | 'member';
  latest_broadcast: { id: string; body: string; created_at: string; sender_id: string | null } | null;
  unread_broadcasts: number;
  topics: ChatCardTopic[];
  unread_total: number;
  last_activity_at: string | null;
}

export async function getCommunityChatCards(): Promise<CommunityChatCard[]> {
  const { data, error } = await supabase.rpc('get_my_community_chat_cards');
  if (error) throw error;
  return (data ?? []) as CommunityChatCard[];
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

export interface CommunityBroadcast {
  id: string;
  body: string;
  created_at: string;
  sender_id: string | null;
  sender_name: string | null;
  reactions: BroadcastReaction[];
  reply_count: number;
}

export async function getCommunityBroadcasts(communityId: string): Promise<CommunityBroadcast[]> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: rows, error } = await supabase
    .from('community_broadcasts')
    .select('id, body, created_at, sender_id')
    .eq('community_id', communityId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  const broadcasts = rows ?? [];
  if (broadcasts.length === 0) return [];

  const ids = broadcasts.map((b) => b.id);
  const senderIds = Array.from(new Set(broadcasts.map((b) => b.sender_id).filter(Boolean))) as string[];
  const [{ data: reactions }, { data: replies }, { data: profiles }] = await Promise.all([
    supabase.from('community_broadcast_reactions').select('broadcast_id, emoji, user_id').in('broadcast_id', ids),
    supabase.from('community_broadcast_replies').select('broadcast_id').in('broadcast_id', ids),
    senderIds.length > 0
      ? supabase.from('profiles_public').select('id, first_name_display').in('id', senderIds)
      : Promise.resolve({ data: [] } as any),
  ]);

  const nameById = new Map<string, string | null>(
    (profiles ?? []).map((p: any) => [p.id as string, (p.first_name_display ?? null) as string | null]),
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
    reactions: Array.from((reactionMap.get(b.id) ?? new Map()).entries()).map(
      ([emoji, e]: [string, { count: number; mine: boolean }]) => ({ emoji, count: e.count, mine: e.mine }),
    ),
    reply_count: replyCounts.get(b.id) ?? 0,
  }));
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

/** Leaders-only creation (RLS enforced; member-created topics stay a Liz call). */
export async function createTopic(communityId: string, name: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase
    .from('community_topics')
    .insert({ community_id: communityId, name: name.trim(), created_by: user.id });
  if (error) throw error;
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

// -- shared ----------------------------------------------------------------------

async function attachSenderProfiles<T extends { sender_id: string }>(
  rows: T[],
): Promise<(T & { sender_name: string | null; sender_photo: string | null })[]> {
  if (rows.length === 0) return [];
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
