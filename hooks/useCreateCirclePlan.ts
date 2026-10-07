/**
 * useCreateCirclePlan - create a circle-aware plan via the create_circle_plan
 * RPC (held migration 20260609140200). A circle plan is a real events row; this
 * is the only write path for it. Gated upstream by GROUPS_ENABLED.
 *
 * Returns { event_id, has_own_chat } so the caller can route straight to the
 * plan's own chat or back to the circle chat without a refetch.
 */
import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { circleKeys } from '../lib/circles/keys';

export type CirclePlanVisibility = 'circle_only' | 'open';

export interface CirclePlanOperationScope {
  readonly userId: string;
  readonly isCurrent: () => boolean;
}

export class ObsoleteCirclePlanOperationError extends Error {
  constructor() { super('This plan entry is no longer current.'); this.name = 'ObsoleteCirclePlanOperationError'; }
}
export function isObsoleteCirclePlanOperation(error: unknown): boolean {
  return error instanceof ObsoleteCirclePlanOperationError;
}

export class UnconfirmedCirclePlanCreationError extends Error {
  constructor() {
    super('We couldn’t confirm whether your plan was posted. Check your plans before posting again.');
    this.name = 'UnconfirmedCirclePlanCreationError';
  }
}
export function isUnconfirmedCirclePlanCreation(error: unknown): boolean {
  return error instanceof Error && error.name === 'UnconfirmedCirclePlanCreationError';
}

export interface CreateCirclePlanArgs {
  /** Omitted callers remain supported; null explicitly means unavailable. */
  scope?: CirclePlanOperationScope | null;
  circleId: string;
  title: string;
  /** Required creator note, matching ordinary Post (10..150 trimmed characters). */
  creatorMessage: string;
  /** Confirmed remote image; local picker URIs must never reach the RPC. */
  imageUrl?: string | null;
  /** ISO timestamp. */
  startTime: string;
  visibility: CirclePlanVisibility;
  /** Required (2..7) when visibility === 'open'; ignored for circle_only. */
  strangerCap?: number | null;
  /** Carries over the existing single-gender rule; defaults 'mixed'. */
  genderRule?: string | null;
  /** null/empty = the whole circle; a subset = picked members get their own chat. */
  memberUserIds?: string[] | null;
  locationText?: string | null;
  description?: string | null;
  /** Category, lowercased -> events.primary_vibe (RPC param already exists). */
  primaryVibe?: string | null;
}

export interface CreateCirclePlanResult {
  event_id: string;
  has_own_chat: boolean;
}

function parseReceipt(data: unknown): CreateCirclePlanResult | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const receipt = data as Record<string, unknown>;
  // Saved create_circle_plan returns a JSON object with a UUID and a boolean.
  // Never infer chat ownership from the submitted audience or coerce the flag.
  if (typeof receipt.event_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receipt.event_id) ||
      typeof receipt.has_own_chat !== 'boolean') return null;
  return { event_id: receipt.event_id, has_own_chat: receipt.has_own_chat };
}

type UnconfirmedEntry = {
  circleId: string;
  userId: string;
  revision: number;
  entry: CirclePlanOperationScope['isCurrent'] | undefined;
  isCurrent: () => boolean;
};

export function useCreateCirclePlan() {
  const queryClient = useQueryClient();
  const mounted = useRef(false);
  const auth = useRef<{ userId: string | null | undefined; revision: number }>({ userId: undefined, revision: 0 });
  const calls = useRef(new WeakMap<CreateCirclePlanArgs, { revision: number; userId: string | null | undefined }>());
  const pending = useRef<{ isCurrent: () => boolean } | null>(null);
  const unconfirmed = useRef<UnconfirmedEntry[]>([]);
  useEffect(() => {
    mounted.current = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted.current) return;
      const userId = session?.user.id ?? null;
      if (auth.current.userId !== undefined && auth.current.userId !== userId) auth.current.revision++;
      auth.current.userId = userId;
    });
    return () => { mounted.current = false; unconfirmed.current = []; subscription.unsubscribe(); };
  }, []);

  const mutation = useMutation<CreateCirclePlanResult, Error, CreateCirclePlanArgs>({
    retry: false,
    mutationFn: async (args): Promise<CreateCirclePlanResult> => {
      const initiated = calls.current.get(args) ?? { ...auth.current };
      const scope = args.scope;
      let userId = scope?.userId ?? initiated.userId;
      const isCurrent = () => mounted.current && scope !== null &&
        (scope === undefined || scope.isCurrent()) && auth.current.revision === initiated.revision &&
        (auth.current.userId === undefined || userId === undefined || auth.current.userId === userId);
      const check = () => { if (!isCurrent()) throw new ObsoleteCirclePlanOperationError(); };
      check();
      const creatorMessage = args.creatorMessage?.trim() ?? '';
      if (creatorMessage.length < 10 || creatorMessage.length > 150) {
        throw new Error('Add a message with 10 to 150 characters.');
      }
      if (args.imageUrl && !/^https?:\/\/[^\s/]+(?:\/|$)/i.test(args.imageUrl)) {
        throw new Error('Finish adding your photo before posting.');
      }
      if (pending.current?.isCurrent()) throw new Error('This plan is already being posted.');
      const attempt = { isCurrent };
      pending.current = attempt;
      let dispatched = false;
      try {
        const verified = await supabase.auth.getUser();
        check();
        if (verified.error) throw verified.error;
        const verifiedId = verified.data.user?.id;
        if (!verifiedId || (userId !== undefined && verifiedId !== userId)) throw new ObsoleteCirclePlanOperationError();
        userId = verifiedId;
        check();
        unconfirmed.current = unconfirmed.current.filter(entry => entry.isCurrent());
        if (unconfirmed.current.some(entry => entry.userId === verifiedId &&
            entry.revision === initiated.revision && entry.circleId === args.circleId &&
            entry.entry === scope?.isCurrent)) throw new UnconfirmedCirclePlanCreationError();
        let result;
        try {
          dispatched = true;
          result = await supabase.rpc('create_circle_plan', {
            p_circle_id: args.circleId,
            p_title: args.title,
            p_start_time: args.startTime,
            p_visibility: args.visibility,
            p_stranger_cap: args.visibility === 'open' ? (args.strangerCap ?? 4) : null,
            p_gender_rule: args.genderRule ?? 'mixed',
            p_member_user_ids: args.memberUserIds && args.memberUserIds.length > 0 ? args.memberUserIds : null,
            p_location_text: args.locationText ?? null,
            p_description: args.description ?? null,
            p_primary_vibe: args.primaryVibe ?? null,
            p_host_message: creatorMessage,
            p_image_url: args.imageUrl ?? null,
          });
        } catch (error) {
          check();
          // Dispatch may have committed before the response was lost.
          throw new UnconfirmedCirclePlanCreationError();
        }
        check();
        if (result?.error) {
          // A returned rejection can be retried; a timeout or unknown server
          // outcome cannot safely repeat this non-idempotent create operation.
          if (result.status >= 400 && result.status < 500 && result.status !== 408) throw result.error;
          throw new UnconfirmedCirclePlanCreationError();
        }
        const receipt = parseReceipt(result?.data);
        if (!receipt) throw new UnconfirmedCirclePlanCreationError();
        // Prefixes deliberately still match account-scoped detail queries.
        for (const queryKey of [circleKeys.detail(args.circleId), ['circle-plans', args.circleId],
          ['events', 'feed'], ['my-plans'], ['feed-member-ids']]) {
          check();
          void queryClient.invalidateQueries({ queryKey }).catch(() => {});
        }
        check();
        return receipt;
      } catch (error) {
        check();
        if (dispatched && isUnconfirmedCirclePlanCreation(error) && userId) {
          unconfirmed.current.push({ circleId: args.circleId, userId, revision: initiated.revision,
            entry: scope?.isCurrent, isCurrent });
        }
        throw error;
      } finally {
        if (pending.current === attempt) pending.current = null;
      }
    },
  });
  // React Query starts mutationFn asynchronously. Capture the initiating account
  // and recipient choices at the public call, before that first microtask.
  const capture = (args: CreateCirclePlanArgs) => {
    const snapshot = { ...args, memberUserIds: args.memberUserIds ? [...args.memberUserIds] : args.memberUserIds,
      scope: args.scope ? { userId: args.scope.userId, isCurrent: args.scope.isCurrent } : args.scope };
    calls.current.set(snapshot, { ...auth.current });
    return snapshot;
  };
  return {
    ...mutation,
    mutate: (...[args, options]: Parameters<typeof mutation.mutate>) => mutation.mutate(capture(args), options),
    mutateAsync: (...[args, options]: Parameters<typeof mutation.mutateAsync>) => mutation.mutateAsync(capture(args), options),
  };
}
