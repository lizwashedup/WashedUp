/**
 * Block enforcement helper. yours_is_blocked_between is the canonical MUTUAL
 * check: it reads both user_blocks and profiles.blocked_users, in BOTH
 * directions, as SECURITY DEFINER (so it sees the other side's block, which the
 * client cannot read directly). Community chat had no reference to it, so a
 * blocked pair still saw each other; this resolver is how those surfaces hide
 * each other's content.
 */

import { supabase } from './supabase';

/**
 * The subset of candidateIds that are blocked with currentUserId. One RPC per
 * distinct candidate, in parallel. Fails SAFE per candidate: if a single check
 * errors, that id is treated as blocked, so a hiccup never reveals someone a
 * user blocked. (The message fetch already succeeded before this runs, so the
 * network is up; a per-candidate error is the rare case, not a chat-wide blank.)
 */
export async function getBlockedWith(
  currentUserId: string | null | undefined,
  candidateIds: (string | null | undefined)[],
): Promise<Set<string>> {
  if (!currentUserId) return new Set();
  const unique = Array.from(
    new Set(candidateIds.filter((id): id is string => !!id && id !== currentUserId)),
  );
  if (unique.length === 0) return new Set();
  const flags = await Promise.all(
    unique.map(async (id) => {
      const { data, error } = await supabase.rpc('yours_is_blocked_between', {
        p_a: currentUserId,
        p_b: id,
      });
      return error ? id : data === true ? id : null;
    }),
  );
  return new Set(flags.filter((x): x is string => !!x));
}
