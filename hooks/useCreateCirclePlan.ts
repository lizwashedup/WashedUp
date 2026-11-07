/**
 * useCreateCirclePlan - create a circle-aware plan through an exact request receipt.
 * The held create_circle_plan_once wrapper delegates to create_circle_plan in
 * the same transaction, preserving its audience, membership and message rules. Gated upstream by GROUPS_ENABLED.
 *
 * Returns { event_id, has_own_chat } so the caller can route straight to the
 * plan's own chat or back to the circle chat without a refetch.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { beginPlanPost, readPlanPost, clearPlanPost, planPostKey, claimPlanPost, releasePlanPost, planPostRunning, type PlanPostAttempt } from '../lib/circles/planPostAttempt';
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
    super('We’re still checking whether your plan was posted. Check its status before posting another.');
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

export function useCreateCirclePlan(recoveryOwner?: { circleId: string; scope: CirclePlanOperationScope | null }) {
  const queryClient = useQueryClient();
  const mounted = useRef(false);
  const auth = useRef<{ userId: string | null | undefined; revision: number }>({ userId: undefined, revision: 0 });
  const calls = useRef(new WeakMap<CreateCirclePlanArgs, { revision: number; userId: string | null | undefined }>());
  const pending = useRef<{ isCurrent: () => boolean } | null>(null);
  const [recovery, setRecovery] = useState<{ key: string; attempt: PlanPostAttempt | null; error?: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const recoveryKey = recoveryOwner?.scope ? planPostKey(recoveryOwner.scope.userId, recoveryOwner.circleId) : null;
  const refreshRecovery = async () => {
    if (!recoveryKey || !recoveryOwner?.scope?.isCurrent()) return;
    try { const attempt = await readPlanPost(recoveryKey);
      if (mounted.current && recoveryOwner.scope.isCurrent()) setRecovery({ key: recoveryKey, attempt });
    } catch { if (mounted.current && recoveryOwner.scope.isCurrent()) setRecovery({key: recoveryKey, attempt: null, error: true}); }
  };
  useEffect(() => { void refreshRecovery(); }, [recoveryKey, recoveryOwner?.scope]);
  const resumeRequests = useRef(new WeakMap<CreateCirclePlanArgs, PlanPostAttempt>());
  const invalidatePlan = (circleId: string, check: () => void) => {
    for (const queryKey of [circleKeys.detail(circleId), ['circle-plans', circleId],
      ['events', 'feed'], ['my-plans'], ['feed-member-ids']]) {
      check(); void queryClient.invalidateQueries({ queryKey }).catch(() => {});
    }
  };
  useEffect(() => {
    mounted.current = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted.current) return;
      const userId = session?.user.id ?? null;
      if (auth.current.userId !== undefined && auth.current.userId !== userId) auth.current.revision++;
      auth.current.userId = userId;
    });
    return () => { mounted.current = false; subscription.unsubscribe(); };
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
      let key: string | null = null, stored: PlanPostAttempt | null = null, token: object | null = null;
      try {
        const verified = await requestWithDeadline(supabase.auth.getUser(), 12_000);
        check();
        if (verified.error) throw verified.error;
        const verifiedId = verified.data.user?.id;
        if (!verifiedId || (userId !== undefined && verifiedId !== userId)) throw new ObsoleteCirclePlanOperationError();
        userId = verifiedId;
        check();
        key = planPostKey(verifiedId, args.circleId);
        const resume = resumeRequests.current.get(args);
        const payload = {
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
        };
        stored = resume ?? await beginPlanPost(key, payload, check);
        check();
        if (!stored) throw new UnconfirmedCirclePlanCreationError();
        if (resume && (await readPlanPost(key))?.requestId !== resume.requestId) throw new UnconfirmedCirclePlanCreationError();
        check();
        token = claimPlanPost(key);
        if (!token) throw new UnconfirmedCirclePlanCreationError();
        let result;
        try {
          const heldKey = key, heldToken = token;
          // Deadline stops waiting, not the transport. Retain the process lock
          // until it settles; restart recovery uses the same server receipt ID.
          const original = stored;
          const transport = Promise.resolve().then(() => {
            check(); dispatched = true;
            return supabase.rpc('create_circle_plan_once', { ...original.payload, p_request_id: original.requestId });
          }).finally(() => releasePlanPost(heldKey, heldToken));
          result = await requestWithDeadline(transport, 12_000);
        } catch {
          check(); throw new UnconfirmedCirclePlanCreationError();
        }
        check();
        if (result?.error) {
          // A definite initial refusal permits a fresh attempt. A refusal of
          // a replay cannot erase the earlier unknown transaction.
          if (result.status >= 400 && result.status < 500 && result.status !== 408 && !resume) {
            await clearPlanPost(key, stored.requestId); check(); throw result.error;
          }
          throw new UnconfirmedCirclePlanCreationError();
        }
        const receipt = parseReceipt(result?.data);
        if (!receipt) throw new UnconfirmedCirclePlanCreationError();
        await clearPlanPost(key, stored.requestId);
        check();
        invalidatePlan(args.circleId, check);
        return receipt;
      } catch (error) {
        check();
        throw error;
      } finally {
        if (!dispatched && token && key) releasePlanPost(key, token);
        if (pending.current === attempt) pending.current = null;
        if (isCurrent()) void refreshRecovery();
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
  const recoveryAction = useRef(false);
  const checkedOwner = async () => {
    const owner = recoveryOwner, revision = auth.current.revision;
    const check = () => {
      if (!mounted.current || !owner?.scope?.isCurrent() || auth.current.revision !== revision ||
        (auth.current.userId !== undefined && auth.current.userId !== owner.scope.userId)) throw new ObsoleteCirclePlanOperationError();
    };
    check();
    const verified = await requestWithDeadline(supabase.auth.getUser(), 12_000); check();
    if (verified.error || verified.data.user?.id !== owner!.scope!.userId) throw new ObsoleteCirclePlanOperationError();
    return { owner: owner!, check, key: planPostKey(owner!.scope!.userId, owner!.circleId) };
  };
  const checkPost = async (): Promise<CreateCirclePlanResult | null> => {
    if (recoveryAction.current) throw new UnconfirmedCirclePlanCreationError();
    recoveryAction.current = true; setChecking(true);
    try {
      const { owner, check, key } = await checkedOwner();
      const stored = await readPlanPost(key); check();
      if (!stored) { await refreshRecovery(); return null; }
      const response = await requestWithDeadline(supabase.rpc('circle_plan_post_status', {
        p_circle_id: owner.circleId, p_request_id: stored.requestId,
      }), 12_000); check();
      if (response?.error) throw response.error;
      const receipt = parseReceipt(response?.data);
      if (!receipt) { await refreshRecovery(); return null; }
      await clearPlanPost(key, stored.requestId); check();
      releasePlanPost(key); invalidatePlan(owner.circleId, check);
      await refreshRecovery(); return receipt;
    } finally { recoveryAction.current = false; if (mounted.current) setChecking(false); }
  };
  const retryPost = async (): Promise<CreateCirclePlanResult> => {
    if (recoveryAction.current) throw new UnconfirmedCirclePlanCreationError();
    recoveryAction.current = true; setChecking(true);
    try {
      const { owner, check, key } = await checkedOwner();
      const stored = await readPlanPost(key); check();
      if (!stored || planPostRunning(key)) throw new UnconfirmedCirclePlanCreationError();
      const p = stored.payload;
      const original = capture({ circleId: owner.circleId, scope: owner.scope,
        title: p.p_title as string, creatorMessage: p.p_host_message as string,
        startTime: p.p_start_time as string, visibility: p.p_visibility as CirclePlanVisibility,
      });
      resumeRequests.current.set(original, stored);
      return await mutation.mutateAsync(original);
    } finally { recoveryAction.current = false; if (mounted.current) setChecking(false); }
  };
  return {
    ...mutation, checkPost, retryPost,
    recovery: recovery?.key === recoveryKey ? recovery.attempt : null,
    recoveryError: recovery?.key === recoveryKey && !!recovery.error,
    recoveryLoading: !!recoveryKey && recovery?.key !== recoveryKey,
    isCheckingPost: checking,
    postStillRunning: !!recoveryKey && planPostRunning(recoveryKey),
    mutate: (...[args, options]: Parameters<typeof mutation.mutate>) => mutation.mutate(capture(args), options),
    mutateAsync: (...[args, options]: Parameters<typeof mutation.mutateAsync>) => mutation.mutateAsync(capture(args), options),
  };
}
