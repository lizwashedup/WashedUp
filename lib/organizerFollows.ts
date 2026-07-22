/**
 * §4c follow mechanic client (doc 69 B1, proposal 68): a follow attaches
 * to a community OR a standalone organizer profile, never both. Follow is
 * NOT membership - no chat, no member count change; joining implies
 * following DB-side (68's trigger), so the client never writes a follow
 * on join.
 *
 * Self-flipping (house canon, the proposal-49 pattern): until proposal 68
 * applies, the table and the count RPC do not exist and every follow
 * surface stays dormant (today's behavior, byte for byte); the moment 68
 * lands the surfaces wake with no client deploy. Reads fail OPEN (a
 * failed read never hides content and never claims "following"); writes
 * fail CLOSED (no follow state without a landed row).
 */

import { supabase } from './supabase';

/** PostgREST "relation/function does not exist": proposal 68 not applied. */
function isMissingSchema(code: string | undefined): boolean {
  return code === '42P01' || code === 'PGRST205' || code === '42883' || code === 'PGRST202';
}

export type FollowTarget = { kind: 'community' | 'organizer'; id: string };

function targetColumn(target: FollowTarget): 'community_id' | 'organizer_user_id' {
  return target.kind === 'community' ? 'community_id' : 'organizer_user_id';
}

export interface FollowState {
  /** false until proposal 68 applies - hide the affordance entirely */
  available: boolean;
  following: boolean;
}

export async function getFollowState(target: FollowTarget, userId: string): Promise<FollowState> {
  const { data, error } = await supabase
    .from('organizer_follows')
    .select('id')
    .eq('follower_user_id', userId)
    .eq(targetColumn(target), target.id)
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error.code)) return { available: false, following: false };
    return { available: true, following: false };
  }
  return { available: true, following: !!data };
}

export async function recordFollow(target: FollowTarget, userId: string): Promise<boolean> {
  const { error } = await supabase.from('organizer_follows').insert({
    follower_user_id: userId,
    [targetColumn(target)]: target.id,
  });
  if (!error) return true;
  // 68's partial unique index makes a repeat follow a no-op, not a failure
  return error.code === '23505';
}

export async function removeFollow(target: FollowTarget, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from('organizer_follows')
    .delete()
    .eq('follower_user_id', userId)
    .eq(targetColumn(target), target.id);
  return !error;
}

/** The public count (68's definer RPC). Null = unavailable: hide the count. */
export async function getFollowerCount(target: FollowTarget): Promise<number | null> {
  const { data, error } = await supabase.rpc('get_follower_count', {
    p_target_type: target.kind,
    p_target_id: target.id,
  });
  if (error) return null;
  return typeof data === 'number' ? data : null;
}
