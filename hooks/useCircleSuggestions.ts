/**
 * useCircleSuggestions - the caller's pending co-attendance suggestions
 * ("people you keep showing up with could be a circle"). Wraps
 * get_circle_suggestions (jsonb, names pre-resolved). Empty until the detection
 * job has run; the directory treats this optional query independently of its list.
 *
 * useSetSuggestionStatus - dismiss ('not now') or mark converted (started a
 * circle from it), via set_circle_suggestion_status.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type MutateOptions } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { CirclePlansScope } from './useCirclePlans';
import { circleKeys } from '../lib/circles/keys';
import type { CircleSuggestion } from '../lib/circles/types';

export function useCircleSuggestions(userId: string | null | undefined, scope?: CirclePlansScope) {
  return useQuery({
    queryKey: scope ? [...circleKeys.suggestions(userId ?? ''), scope.epoch] : circleKeys.suggestions(userId ?? ''),
    enabled: !!userId,
    queryFn: async ({ signal }): Promise<CircleSuggestion[]> => {
      const requireCurrent = () => {
        if (signal.aborted || (scope && (!scope.userId || scope.userId !== userId || !scope.isCurrent()))) {
          throw new Error('This circle directory request is no longer current.');
        }
      };
      requireCurrent();
      if (scope) {
        const { data: auth, error: authError } = await supabase.auth.getUser();
        requireCurrent();
        if (authError) throw authError;
        if (auth.user?.id !== scope.userId) throw new Error('This account changed. Please try again.');
      }
      requireCurrent();
      const request = supabase.rpc('get_circle_suggestions');
      const { data, error } = await (scope ? request.abortSignal(signal) : request);
      requireCurrent();
      if (error) throw error;
      return (data ?? []) as CircleSuggestion[];
    },
  });
}

export interface CircleSuggestionScope {
  userId: string;
  isCurrent: () => boolean;
  /** Recheck a still-present suggestion before dispatch, not after completion. */
  canDispatch?: () => boolean;
}
export class ObsoleteCircleSuggestionError extends Error {
  constructor() { super('This circle suggestion action is no longer current.'); this.name = 'ObsoleteCircleSuggestionError'; }
}
export function isObsoleteCircleSuggestion(error: unknown): error is ObsoleteCircleSuggestionError {
  return error instanceof Error && error.name === 'ObsoleteCircleSuggestionError';
}
type SuggestionValue = { id: string; status: 'dismissed' | 'converted' };
type SuggestionOwner = { userId: string | null | undefined };
type SuggestionCall = { value: SuggestionValue; owner: SuggestionOwner; epoch: number; scope?: CircleSuggestionScope };
type SuggestionOptions = MutateOptions<string, Error, SuggestionValue> & { scope?: CircleSuggestionScope };

/** Existing callers remain unscoped. The directory opts into ownership before
 * React Query can defer dispatch and across auth, entry and completion changes. */
export function useSetSuggestionStatus(userId: string | null | undefined) {
  const qc = useQueryClient();
  const owner = useMemo<SuggestionOwner>(() => ({ userId }), [userId]);
  const active = useRef<SuggestionOwner | null>(null);
  const latest = useRef(owner); latest.current = owner;
  const mounted = useRef(false), epoch = useRef(0);
  const authUser = useRef<string | null | undefined>(undefined);
  const receivedAuthEvent = useRef(false);
  const unsubscribe = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    active.current = owner; mounted.current = true;
    return () => { if (active.current === owner) active.current = null; };
  }, [owner]);
  useEffect(() => () => { mounted.current = false; unsubscribe.current?.(); unsubscribe.current = null; }, []);
  const capture = (value: SuggestionValue, scope?: CircleSuggestionScope): SuggestionCall => {
    if (scope && !unsubscribe.current && mounted.current) {
      if (authUser.current === undefined) authUser.current = scope.userId;
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (!mounted.current) return;
        // A delayed initial snapshot must not replace a later auth transition.
        if (event === 'INITIAL_SESSION' && receivedAuthEvent.current) return;
        receivedAuthEvent.current = true;
        const next = session?.user.id ?? null;
        if (authUser.current !== next) { epoch.current++; authUser.current = next; }
      });
      unsubscribe.current = () => subscription.unsubscribe();
    }
    return { value, owner, epoch: epoch.current, scope };
  };
  const current = (call: SuggestionCall) => !call.scope || (
    mounted.current && active.current === call.owner && latest.current === call.owner &&
    call.epoch === epoch.current && call.owner.userId === call.scope.userId &&
    authUser.current === call.scope.userId && call.scope.isCurrent()
  );
  const requireCurrent = (call: SuggestionCall) => { if (!current(call)) throw new ObsoleteCircleSuggestionError(); };
  const mutation = useMutation<string, Error, SuggestionCall>({
    mutationFn: async call => {
      requireCurrent(call);
      if (call.scope) {
        const { data: { user }, error } = await supabase.auth.getUser();
        requireCurrent(call);
        if (error) throw error;
        if (user?.id !== call.scope.userId) throw new ObsoleteCircleSuggestionError();
      }
      requireCurrent(call);
      if (call.scope?.canDispatch && !call.scope.canDispatch()) throw new ObsoleteCircleSuggestionError();
      const { data, error } = await supabase.rpc('set_circle_suggestion_status', {
        p_id: call.value.id,
        p_status: call.value.status,
      });
      requireCurrent(call);
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_data, call) => {
      if (current(call) && call.owner.userId) void qc.invalidateQueries({ queryKey: circleKeys.suggestions(call.owner.userId) }).catch(() => {});
    },
  });
  const callbacks = (options?: SuggestionOptions): MutateOptions<string, Error, SuggestionCall> => ({
    onSuccess: (result, call, context, mutationContext) => { if (current(call)) options?.onSuccess?.(result, call.value, context, mutationContext); },
    onError: (error, call, context, mutationContext) => { if (current(call) && !isObsoleteCircleSuggestion(error)) options?.onError?.(error, call.value, context, mutationContext); },
    onSettled: (result, error, call, context, mutationContext) => { if (current(call) && !isObsoleteCircleSuggestion(error)) options?.onSettled?.(result, error, call.value, context, mutationContext); },
  });
  const mutateAsync = async (value: SuggestionValue, options?: SuggestionOptions): Promise<string> => {
    const call = capture(value, options?.scope);
    requireCurrent(call);
    try {
      const result = await mutation.mutateAsync(call, callbacks(options));
      requireCurrent(call); return result;
    } catch (error) { requireCurrent(call); throw error; }
  };
  const mutate = (value: SuggestionValue, options?: SuggestionOptions) => {
    const call = capture(value, options?.scope);
    if (current(call)) mutation.mutate(call, callbacks(options));
  };
  const belongs = !mutation.variables || current(mutation.variables);
  return { ...mutation, mutate, mutateAsync,
    variables: belongs ? mutation.variables?.value : undefined,
    data: belongs ? mutation.data : undefined, error: belongs ? mutation.error : null,
    failureReason: belongs ? mutation.failureReason : null, failureCount: belongs ? mutation.failureCount : 0,
    isPending: belongs && mutation.isPending, isSuccess: belongs && mutation.isSuccess,
    isError: belongs && mutation.isError, isIdle: !belongs || mutation.isIdle,
    status: belongs ? mutation.status : 'idle' as const,
  };
}
