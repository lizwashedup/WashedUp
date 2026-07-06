/**
 * Thin runtime shape guard for the Yours read RPCs.
 *
 * Every Yours read hook casts an untyped `supabase.rpc()` return to a typed
 * row array. With no validation, a server/client column drift surfaces as a
 * render crash deep in a component, not a clear error at the boundary.
 *
 * This guard checks key PRESENCE (not value/truthiness) on the first row in
 * __DEV__ only: legitimately null columns still pass, a renamed/missing column
 * throws immediately at the hook with the offending RPC + missing keys named.
 * In production it is a pass-through cast (no new throw path that could
 * white-screen users) — its job is to catch drift during dev/sim before the
 * flag is flipped, which is the accepted v1 stance.
 *
 * No dependencies (no zod).
 */
export function assertRpcShape<T>(
  data: unknown,
  requiredKeys: readonly string[],
  rpcName: string,
): T[] {
  const rows = (data ?? []) as T[];
  if (__DEV__ && rows.length > 0) {
    const first = rows[0];
    if (typeof first !== 'object' || first === null) {
      throw new Error(
        `[yours] ${rpcName} returned a non-object row (got ${typeof first}). ` +
          `RPC contract drift?`,
      );
    }
    const missing = requiredKeys.filter((k) => !(k in (first as object)));
    if (missing.length > 0) {
      throw new Error(
        `[yours] ${rpcName} row is missing expected key(s): ` +
          `${missing.join(', ')}. The RPC return columns drifted from ` +
          `lib/yours/types.ts — reconcile before relying on this data.`,
      );
    }
  }
  return rows;
}

/** Required keys per Yours RPC, mirroring lib/yours/types.ts exactly. */
export const YOURS_GRID_KEYS = [
  'user_id', 'first_name_display', 'profile_photo_url', 'handle',
  'ring_bucket', 'shared_count', 'milestone', 'upcoming_event_id',
  'upcoming_title', 'upcoming_start', 'upcoming_neighborhood', 'connected_at',
] as const;

export const BACKLOG_KEYS = [
  'user_id', 'first_name_display', 'profile_photo_url', 'handle',
  'shared_count', 'state',
] as const;

export const SEARCH_PERSON_KEYS = [
  'user_id', 'first_name_display', 'profile_photo_url', 'handle',
  'shared_count', 'connection_state',
] as const;

export const INCOMING_REQUEST_KEYS = [
  'connection_id', 'requester_user_id', 'first_name_display',
  'profile_photo_url', 'handle', 'context', 'context_event_id',
  'context_event_title', 'context_line', 'requested_at',
] as const;

export const PROFILE_CARD_KEYS = [
  'kind', 'user_id', 'first_name_display', 'profile_photo_url', 'handle',
  'shared_count', 'milestone', 'since_date', 'upcoming', 'adventures',
] as const;
