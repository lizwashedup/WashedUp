import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface CirclePlanContext {
  is_circle_plan: boolean;
  circle_id?: string | null;
  circle_name?: string | null;
  circle_visibility?: 'circle_only' | 'open' | null;
  stranger_cap?: number | null;
  has_own_chat?: boolean;
  viewer_is_member?: boolean;
  viewer_stranger_spots_left?: number | null;
}

export interface CirclePlanContextOptions {
  viewerId: string | null | undefined;
  epoch: number;
  /** Stable current-account/visit predicate from the owning detail route. */
  isCurrent: () => boolean;
  /** The matching, loaded event row. Missing circle_id must stay undefined. */
  event?: { id: string; circle_id: string | null | undefined };
}

export class CirclePlanContextUnavailableError extends Error {
  constructor(message = 'Could not confirm this plan’s Circle details. Please try again.') {
    super(message);
    this.name = 'CirclePlanContextUnavailableError';
  }
}

const isUuid = (value: unknown): value is string => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

export function parseCirclePlanContextReceipt(value: unknown, circleId: string): CirclePlanContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CirclePlanContextUnavailableError();
  const row = value as Record<string, unknown>;
  // Saved get_circle_plan_context returns false for BOTH normal and absent
  // events. It cannot override a loaded event row that identifies a Circle.
  if (row.is_circle_plan !== true || !isUuid(row.circle_id) || row.circle_id.toLowerCase() !== circleId.toLowerCase() ||
      (row.circle_name !== null && typeof row.circle_name !== 'string') ||
      typeof row.has_own_chat !== 'boolean' || typeof row.viewer_is_member !== 'boolean') {
    throw new CirclePlanContextUnavailableError();
  }
  if (row.circle_visibility === 'open') {
    if (!isCount(row.stranger_cap) || row.stranger_cap < 2 || row.stranger_cap > 7 ||
        !isCount(row.viewer_stranger_spots_left) || row.viewer_stranger_spots_left > row.stranger_cap) {
      throw new CirclePlanContextUnavailableError();
    }
  } else if (row.circle_visibility !== 'circle_only' || row.stranger_cap !== null || row.viewer_stranger_spots_left !== null) {
    throw new CirclePlanContextUnavailableError();
  }
  return row as unknown as CirclePlanContext;
}

/**
 * The matching event row establishes Circle provenance. An explicit null
 * circle_id confirms an ordinary plan without requiring the optional Circle
 * RPC. Known Circles require its full current-viewer receipt; errors or absent
 * RPCs never become normal-plan context. Callers gate actions on isContextReady.
 */
export function useCirclePlanContext(eventId: string | null | undefined, options?: CirclePlanContextOptions) {
  const viewerId = options?.viewerId;
  const epoch = options?.epoch;
  const provenanceId = options?.event?.id;
  const circleId = options?.event?.circle_id;
  const owner = useMemo(() => ({ eventId, viewerId, epoch, provenanceId, circleId, isCurrent: options?.isCurrent }),
    [eventId, viewerId, epoch, provenanceId, circleId, options?.isCurrent]);
  const currentOwner = useRef(owner); currentOwner.current = owner;
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const ownerIsCurrent = () => mounted.current && currentOwner.current === owner && !!owner.isCurrent?.();
  const enabled = !!eventId && !!viewerId && !!options && provenanceId === eventId && options.isCurrent();

  const query = useQuery({
    // Keep the existing invalidation prefix while separating membership,
    // account generations and explicit ordinary versus unknown provenance.
    queryKey: ['circle-plan-context', eventId ?? '', viewerId ?? '', epoch ?? null, provenanceId ?? '', circleId === undefined ? 'unknown' : circleId],
    enabled,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<CirclePlanContext> => {
      const requireCurrent = () => {
        if (signal.aborted || !ownerIsCurrent()) throw new CirclePlanContextUnavailableError('This plan check is no longer current.');
      };
      requireCurrent();
      if (!eventId || !viewerId || provenanceId !== eventId || (circleId !== null && !isUuid(circleId))) {
        throw new CirclePlanContextUnavailableError();
      }
      const { data: auth, error: authError } = await supabase.auth.getUser();
      requireCurrent();
      if (authError) throw authError;
      if (auth.user?.id !== viewerId) throw new CirclePlanContextUnavailableError('This account changed. Please try again.');
      if (circleId === null) return { is_circle_plan: false };
      const { data, error } = await supabase.rpc('get_circle_plan_context', { p_event_id: eventId }).abortSignal(signal);
      requireCurrent();
      if (error) throw error;
      return parseCirclePlanContextReceipt(data, circleId);
    },
  });

  const refetch = useCallback(async (refetchOptions?: Parameters<typeof query.refetch>[0]) => {
    if (!ownerIsCurrent()) throw new CirclePlanContextUnavailableError('This plan check is no longer current.');
    const result = await query.refetch(refetchOptions);
    if (!ownerIsCurrent()) throw new CirclePlanContextUnavailableError('This plan check is no longer current.');
    return result;
  }, [owner, query.refetch]);
  const isContextReady = enabled && ownerIsCurrent() && query.isSuccess && !query.isFetching;
  return { ...query, data: isContextReady ? query.data : undefined, refetch, isContextReady };
}
