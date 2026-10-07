import { supabase } from './supabase';
import { getBlockedWith } from './blocking';
import { reactionEmoji } from './communityReactionChips';
import { requestWithDeadline } from './requestWithDeadline';

export type ReactionSource = 'chat' | 'broadcast' | 'topic';
export interface ReactionDetailsScope { userId: string; isCurrent: () => boolean }
export interface ReactionPerson {
  userId: string;
  storageKey: string;
  emoji: string;
  name: string | null;
  photo: string | null;
  mine: boolean;
}
export interface ReactionDetailsTarget { source: ReactionSource; messageId: string }
export const REACTION_DETAILS_PAGE_SIZE = 40;
const stores = {
  chat: { table: 'message_reactions', parent: 'message_id', emoji: 'reaction', messages: 'messages' },
  broadcast: { table: 'community_broadcast_reactions', parent: 'broadcast_id', emoji: 'emoji', messages: 'community_broadcasts' },
  topic: { table: 'community_topic_message_reactions', parent: 'message_id', emoji: 'reaction', messages: 'community_topic_messages' },
} as const;

function assertCurrent(scope: ReactionDetailsScope) {
  if (!scope.userId || !scope.isCurrent()) throw Error('This conversation changed.');
}
async function read<T>(scope: ReactionDetailsScope, work: () => PromiseLike<T>): Promise<T> {
  assertCurrent(scope);
  try { return await requestWithDeadline(work(), 10_000); } finally { assertCurrent(scope); }
}
async function verifyViewer(scope: ReactionDetailsScope) {
  const { data, error } = await read(scope, () => supabase.auth.getUser());
  if (error) throw error;
  if (data.user?.id !== scope.userId) throw Error('This conversation changed.');
}
async function verifyMessage(target: ReactionDetailsTarget, scope: ReactionDetailsScope) {
  const { data, error } = await read(scope, () => supabase.from(stores[target.source].messages)
    .select('id').eq('id', target.messageId).maybeSingle());
  if (error) throw error;
  if (!data) throw Error('This message is no longer available.');
}

/** Only identities attached to an RLS-readable message reaction are enriched.
 * No handles, contact fields, or independent profile navigation are exposed. */
export async function loadMessageReactionDetails(target: ReactionDetailsTarget, scope: ReactionDetailsScope, offset = 0) {
  await verifyViewer(scope);
  await verifyMessage(target, scope);
  const store = stores[target.source];
  const { data, error } = await read(scope, () => supabase.from(store.table)
    .select(`user_id, ${store.emoji}`).eq(store.parent, target.messageId)
    .order('user_id').order(store.emoji).range(offset, offset + REACTION_DETAILS_PAGE_SIZE));
  if (error) throw error;
  const rows = (data ?? []) as unknown as Record<string, string>[];
  const page = rows.slice(0, REACTION_DETAILS_PAGE_SIZE);
  const ids = [...new Set(page.map(row => row.user_id))];
  const blocked = await read(scope, () => getBlockedWith(scope.userId, ids));
  const visibleIds = ids.filter(id => !blocked.has(id));
  const profiles = visibleIds.length ? await read(scope, () => supabase.from('profiles_public')
    .select('id, first_name_display, profile_photo_url').in('id', visibleIds)) : { data: [], error: null };
  if (profiles.error) throw profiles.error;
  const byId = new Map((profiles.data ?? []).map(profile => [profile.id, profile]));
  return {
    people: page.map(row => {
      const profile = byId.get(row.user_id);
      return { userId: row.user_id, storageKey: row[store.emoji], emoji: reactionEmoji(row[store.emoji]),
        name: profile?.first_name_display ?? null, photo: profile?.profile_photo_url ?? null, mine: row.user_id === scope.userId };
    }) as ReactionPerson[],
    nextOffset: rows.length > REACTION_DETAILS_PAGE_SIZE ? offset + REACTION_DETAILS_PAGE_SIZE : null,
  };
}

/** Exact-key removal is idempotent: a concurrent change cannot become a toggle
 * that accidentally adds the old reaction back. Server policies still apply. */
export async function removeMessageReaction(target: ReactionDetailsTarget, storageKey: string, scope: ReactionDetailsScope) {
  await verifyViewer(scope);
  await verifyMessage(target, scope);
  const store = stores[target.source];
  const { error } = await read(scope, () => supabase.from(store.table).delete()
    .eq(store.parent, target.messageId).eq('user_id', scope.userId).eq(store.emoji, storageKey).select('user_id'));
  if (error) throw error;
  if (!await isMessageReactionRemoved(target, storageKey, scope)) throw Error('The reaction is still here.');
}

/** Reconcile an uncertain delete without sending it again. */
export async function isMessageReactionRemoved(target: ReactionDetailsTarget, storageKey: string, scope: ReactionDetailsScope) {
  await verifyViewer(scope);
  await verifyMessage(target, scope);
  const store = stores[target.source];
  const { data, error } = await read(scope, () => supabase.from(store.table).select('user_id')
    .eq(store.parent, target.messageId).eq('user_id', scope.userId).eq(store.emoji, storageKey).limit(1));
  if (error) throw error;
  return !data?.length;
}
