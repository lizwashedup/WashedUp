import { supabase } from './supabase';
import {
  getCommunityBroadcasts, getTopicMessages, ObsoleteCommunityOperationError,
  type CommunityBroadcast, type CommunityOperationScope, type TopicMessage,
} from './communityChat';
import { CHAT_NEWEST_PAGE_SIZE } from './chatPaging';

export type CommunityCoreRoomRole = 'intros' | 'main';
export interface CommunityRoomIdentity {
  id: string; role: CommunityCoreRoomRole | 'optional'; name: string;
  storage: 'broadcast' | 'topic'; included: boolean; joined: boolean;
  notifications_on: boolean | null;
}
export interface CommunityRoomIdentities { communityId: string; name: string; rooms: CommunityRoomIdentity[] }
export interface CommunityRoomCursor {
  communityId: string; role: CommunityCoreRoomRole;
  source: 'broadcast' | 'topic'; id: string; created_at: string;
}
export type CommunityRoomMessage =
  | { key: string; source: 'broadcast'; message: CommunityBroadcast }
  | { key: string; source: 'topic'; message: TopicMessage };
export interface CommunityRoomHistoryPage {
  /** Newest first, in the authoritative server reference order. */
  messages: CommunityRoomMessage[];
  hasMore: boolean;
  olderCursor: CommunityRoomCursor | null;
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const timestamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
function current(scope: CommunityOperationScope): void {
  if (!scope.userId || !scope.isCurrent()) throw new ObsoleteCommunityOperationError();
}
async function account(scope: CommunityOperationScope): Promise<void> {
  current(scope);
  const result = await supabase.auth.getUser();
  current(scope);
  if (result.error) throw result.error;
  if (result.data.user?.id !== scope.userId) throw new ObsoleteCommunityOperationError();
}
async function read<T>(scope: CommunityOperationScope, operation: () => PromiseLike<T>): Promise<T> {
  await account(scope);
  let result: T;
  try { result = await operation(); } catch (error) { current(scope); throw error; }
  await account(scope);
  return result;
}
function target(communityId: string, role?: CommunityCoreRoomRole): void {
  if (!uuid(communityId) || (role !== undefined && role !== 'intros' && role !== 'main')) throw Error('This community chat is unavailable.');
}

export async function getCommunityRoomIdentities(communityId: string, scope: CommunityOperationScope): Promise<CommunityRoomIdentities | null> {
  target(communityId);
  const { data, error } = await read(scope, () => supabase.rpc('get_community_room_identities', { p_community_id: communityId }));
  if (error) throw error;
  if (data === null) return null; // Not provisioned; do not invent rooms or write on a read.
  const v = data as Record<string, unknown>;
  if (!v || v.community_id !== communityId || typeof v.name !== 'string' || !Array.isArray(v.rooms) || v.rooms.length < 2) throw Error('These community chats could not be confirmed.');
  const ids = new Set<string>();
  const rooms = v.rooms.map((raw: unknown, index: number): CommunityRoomIdentity => {
    const r = raw as CommunityRoomIdentity;
    if (!r || !uuid(r.id) || ids.has(`${r.storage}:${r.id}`) || typeof r.name !== 'string' || !r.name.trim()
      || typeof r.joined !== 'boolean' || typeof r.included !== 'boolean'
      || !(r.notifications_on === null || typeof r.notifications_on === 'boolean')
      || (index === 0 ? r.role !== 'intros' || r.storage !== 'topic' || !r.included || !r.joined
        : index === 1 ? r.role !== 'main' || r.storage !== 'broadcast' || !r.included || !r.joined || r.id !== communityId
          : r.role !== 'optional' || r.storage !== 'topic' || r.included)
      || (r.joined && r.notifications_on === null)) throw Error('These community chats could not be confirmed.');
    ids.add(`${r.storage}:${r.id}`);
    return { id: r.id, role: r.role, name: r.name, storage: r.storage, included: r.included, joined: r.joined, notifications_on: r.notifications_on };
  });
  return { communityId, name: v.name as string, rooms };
}

/** Resolve only an accessible, explicitly mapped Intros topic. Event and
 * unmapped topic routes remain on their original reader. No provisioning writes. */
export async function getCommunityIntroRoom(topicId: string, scope: CommunityOperationScope): Promise<CommunityRoomIdentities | null> {
  target(topicId);
  const { data, error } = await read(scope, () => supabase.from('community_chat_layouts')
    .select('community_id').eq('intro_topic_id', topicId).maybeSingle());
  if (error) throw error;
  if (!data) return null;
  if (!uuid(data.community_id)) throw Error('This introduction room could not be confirmed.');
  const layout = await getCommunityRoomIdentities(data.community_id, scope);
  if (!layout || layout.rooms[0].id !== topicId) throw Error('This introduction room could not be confirmed.');
  return layout;
}

/** Read through original source adapters. This never marks either room read. */
export async function getCommunityRoomHistory(
  communityId: string, role: CommunityCoreRoomRole, scope: CommunityOperationScope, cursor?: CommunityRoomCursor,
  options?: { onBasicPage?: (page: CommunityRoomHistoryPage) => void },
): Promise<CommunityRoomHistoryPage> {
  target(communityId, role);
  if (cursor && (cursor.communityId !== communityId || cursor.role !== role || !uuid(cursor.id) || !timestamp(cursor.created_at)
    || !['broadcast', 'topic'].includes(cursor.source) || (role === 'main' && cursor.source !== 'broadcast'))) throw Error('This history cursor belongs to another chat.');
  const layout = await getCommunityRoomIdentities(communityId, scope);
  if (!layout) throw Error('These community chats are not ready yet.');
  const { data, error } = await read(scope, () => supabase.rpc('get_community_room_message_refs', {
    p_community_id: communityId, p_role: role, p_limit: CHAT_NEWEST_PAGE_SIZE,
    p_before_created_at: cursor?.created_at ?? null, p_before_source: cursor?.source ?? null, p_before_id: cursor?.id ?? null,
  }));
  if (error) throw error;
  if (!Array.isArray(data) || data.length > CHAT_NEWEST_PAGE_SIZE) throw Error('This chat history could not be confirmed.');
  const keys = new Set<string>();
  const refs = data.map((r: { source: string; id: string; created_at: string }) => {
    if (!r || !['broadcast', 'topic'].includes(r.source) || !uuid(r.id) || !timestamp(r.created_at) || (role === 'main' && r.source !== 'broadcast')) throw Error('This chat history could not be confirmed.');
    const key = `${r.source}:${r.id}`;
    if (keys.has(key)) throw Error('This chat history could not be confirmed.');
    keys.add(key);
    return { ...r, key };
  });
  const broadcastIds = refs.filter(r => r.source === 'broadcast').map(r => r.id);
  const topicIds = refs.filter(r => r.source === 'topic').map(r => r.id);
  const broadcasts = broadcastIds.length ? await read(scope, () => getCommunityBroadcasts(communityId, undefined, scope, { messageIds: broadcastIds, strictEnrichment: true,
    onBasicPage: role === 'main' && options?.onBasicPage ? async page => {
      // Validate the mapped source and recheck identity before any early paint.
      await account(scope);
      const byId = new Map(page.messages.map(message => [message.id, message]));
      const messages: CommunityRoomMessage[] = refs.flatMap(ref => {
        const message = byId.get(ref.id);
        if (!message) return [];
        if (ref.source !== 'broadcast' || message.kind === 'intro') throw Error('This message no longer belongs to this room.');
        return [{ key: ref.key, source: 'broadcast' as const, message }];
      });
      const oldest = refs[refs.length - 1];
      options.onBasicPage!({ messages, hasMore: refs.length === CHAT_NEWEST_PAGE_SIZE,
        olderCursor: oldest ? { communityId, role, source: 'broadcast', id: oldest.id, created_at: oldest.created_at } : null });
    } : undefined,
  })) : null;
  const topics = topicIds.length ? await read(scope, () => getTopicMessages(layout.rooms[0].id, undefined, scope, { messageIds: topicIds, strictEnrichment: true, resolveReplyParents: true })) : null;
  const broadcastById = new Map(broadcasts?.messages.map(m => [m.id, m]));
  const topicById = new Map(topics?.messages.map(m => [m.id, m]));
  const messages: CommunityRoomMessage[] = [];
  for (const ref of refs) {
    if (ref.source === 'broadcast') {
      const message = broadcastById.get(ref.id);
      if (message) {
        if ((role === 'intros') !== (message.kind === 'intro')) throw Error('This message no longer belongs to this room.');
        messages.push({ key: ref.key, source: 'broadcast', message });
      }
    } else {
      const message = topicById.get(ref.id);
      if (message) messages.push({ key: ref.key, source: 'topic', message });
    }
  }
  current(scope);
  const oldest = refs[refs.length - 1];
  return {
    messages, hasMore: refs.length === CHAT_NEWEST_PAGE_SIZE,
    // Blocked or concurrently deleted rows still advance the raw page cursor.
    olderCursor: oldest ? { communityId, role, source: oldest.source as 'broadcast' | 'topic', id: oldest.id, created_at: oldest.created_at } : null,
  };
}

export interface CommunitySourceRead {
  through_at: string | null;
  through_id: string | null;
  legacy_read_at: string | null;
}
export interface CommunityCoreReadState {
  communityId: string;
  role: CommunityCoreRoomRole;
  unread: number;
  broadcast: CommunitySourceRead;
  topic: CommunitySourceRead | null;
}
export interface CommunityReadTargets {
  broadcast?: { id: string; created_at: string };
  topic?: { id: string; created_at: string };
}
function sourceRead(raw: unknown): CommunitySourceRead {
  const r = raw as CommunitySourceRead;
  if (!r || !((r.through_at === null && r.through_id === null) || (timestamp(r.through_at) && uuid(r.through_id)))
    || !(r.legacy_read_at === null || timestamp(r.legacy_read_at))) throw Error('This read position could not be confirmed.');
  return { through_at: r.through_at, through_id: r.through_id, legacy_read_at: r.legacy_read_at };
}
function readState(raw: unknown, communityId: string, role: CommunityCoreRoomRole): CommunityCoreReadState {
  const v = raw as Record<string, unknown>;
  if (!v || v.community_id !== communityId || v.role !== role || !Number.isSafeInteger(v.unread) || (v.unread as number) < 0
    || (role === 'main' && v.topic !== null)) throw Error('This chat’s unread state could not be confirmed.');
  return { communityId, role, unread: v.unread as number, broadcast: sourceRead(v.broadcast), topic: role === 'intros' ? sourceRead(v.topic) : null };
}
function validateReadTargets(role: CommunityCoreRoomRole, targets: CommunityReadTargets): void {
  if (role === 'main' && targets.topic) throw Error('A topic read position does not belong to main.');
  for (const point of [targets.broadcast, targets.topic]) {
    if (point && (!uuid(point.id) || !timestamp(point.created_at))) throw Error('Read an available message before marking this chat read.');
  }
}
// Keep PostgreSQL microseconds even though Date.parse retains only milliseconds.
function compareTimestamp(a: string, b: string): number {
  const remainder = (value: string) => Number((value.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? '').padEnd(6, '0').slice(3, 6));
  return Date.parse(a) - Date.parse(b) || remainder(a) - remainder(b);
}
function covers(read: CommunitySourceRead | null, point: { id: string; created_at: string } | undefined): boolean {
  if (!point) return true;
  if (!read) return false;
  if (read.legacy_read_at && compareTimestamp(read.legacy_read_at, point.created_at) >= 0) return true;
  if (!read.through_at || !read.through_id) return false;
  const difference = compareTimestamp(read.through_at, point.created_at);
  return difference > 0 || (difference === 0 && read.through_id.toLowerCase() >= point.id.toLowerCase());
}
/** Also usable after an unknown response; a later confirmed read covers the older target. */
export function communityCoreReadCovers(state: CommunityCoreReadState, targets: CommunityReadTargets): boolean {
  validateReadTargets(state.role, targets);
  return covers(state.broadcast, targets.broadcast) && covers(state.topic, targets.topic);
}
export async function getCommunityCoreReadState(communityId: string, role: CommunityCoreRoomRole, scope: CommunityOperationScope): Promise<CommunityCoreReadState> {
  target(communityId, role);
  const { data, error } = await read(scope, () => supabase.rpc('get_community_core_read_state', { p_community_id: communityId, p_role: role }));
  if (error) throw error;
  return readState(data, communityId, role);
}
/** Explicit acknowledgment only. Unknown responses are recovered with the read-only getter. */
export async function markCommunityCoreRoomRead(
  communityId: string, role: CommunityCoreRoomRole, targets: CommunityReadTargets, scope: CommunityOperationScope,
): Promise<CommunityCoreReadState> {
  target(communityId, role);
  validateReadTargets(role, targets);
  const { data, error } = await read(scope, () => supabase.rpc('mark_community_core_room_read', {
    p_community_id: communityId, p_role: role,
    p_broadcast_id: targets.broadcast?.id ?? null, p_topic_id: targets.topic?.id ?? null,
  }));
  if (error) throw error;
  const state = readState(data, communityId, role);
  if (!communityCoreReadCovers(state, targets)) throw Error('This read position could not be confirmed.');
  return state;
}
