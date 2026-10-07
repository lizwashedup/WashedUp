import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useMutation, useQueryClient, type MutateOptions } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { yoursKeys } from '../lib/yours/keys';
import { INBOX_COUNT_KEY } from '../constants/QueryKeys';
import { sendOrAcceptPeopleRequest, UnconfirmedPeopleConnectionError } from '../lib/yours/connectionRequests';

/** Map a raised Postgres exception to a warm, user-facing message. */
export function friendlyConnectionError(err: unknown): string {
  if (err instanceof UnconfirmedPeopleConnectionError) return err.message;
  const msg = (err as { message?: string })?.message ?? '';
  if (msg.includes('cannot_re_request')) {
    return "They're not taking requests right now.";
  }
  if (msg.includes('already_connected')) {
    return "You're already people.";
  }
  if (msg.includes('blocked')) {
    return "You can't add this person.";
  }
  if (msg.includes('no_pending_request')) {
    return 'That request is no longer here.';
  }
  return 'Something went sideways. Try again in a sec.';
}

/** Optional per-call lifetime; legacy callers keep their variables/options. */
export interface PeopleConnectionScope {
  userId: string; isCurrent: () => boolean;
  /** Optional received-request check. Completion is still owned if a query
   * refresh removes the row after the RPC starts. */
  canDispatch?: () => boolean;
}
export class ObsoletePeopleConnectionError extends Error {
  constructor() { super('This people action is no longer current.'); this.name = 'ObsoletePeopleConnectionError'; }
}
export function isObsoletePeopleConnection(error: unknown): error is ObsoletePeopleConnectionError {
  return error instanceof Error && error.name === 'ObsoletePeopleConnectionError';
}
type Owner = { userId: string | null | undefined };
type CapturedCall<V> = { value: V; owner: Owner; epoch: number; scope?: PeopleConnectionScope };
export type ScopedPeopleOptions<R, V> = MutateOptions<R, Error, V> & { scope?: PeopleConnectionScope };
type Runtime = {
  capture: <V>(value: V, scope?: PeopleConnectionScope) => CapturedCall<V>;
  current: (call: CapturedCall<unknown>) => boolean;
  requireCurrent: (call: CapturedCall<unknown>) => void;
  invalidate: (call: CapturedCall<unknown>) => void;
};

/** Capture before React Query can pause/defer execution. Validate at the
 * actual mutation boundary, including resumed offline work and auth epochs. */
function useConnectionMutation<R, V>(write: (value: V) => Promise<R>, runtime: Runtime) {
  const mutation = useMutation<R, Error, CapturedCall<V>>({
    mutationFn: async call => {
      runtime.requireCurrent(call);
      if (call.scope) {
        const { data: { user }, error } = await supabase.auth.getUser();
        runtime.requireCurrent(call);
        if (error) throw error;
        if (!user || user.id !== call.scope.userId) throw new ObsoletePeopleConnectionError();
      }
      runtime.requireCurrent(call);
      if (call.scope?.canDispatch && !call.scope.canDispatch()) throw new Error('no_pending_request');
      const result = await write(call.value);
      runtime.requireCurrent(call);
      return result;
    },
    onSuccess: (_result, call) => { if (runtime.current(call)) runtime.invalidate(call); },
  });
  const callbacks = (options?: ScopedPeopleOptions<R, V>): MutateOptions<R, Error, CapturedCall<V>> => ({
    onSuccess: (result, call, context, mutationContext) => { if (runtime.current(call)) options?.onSuccess?.(result, call.value, context, mutationContext); },
    onError: (error, call, context, mutationContext) => { if (runtime.current(call) && !isObsoletePeopleConnection(error)) options?.onError?.(error, call.value, context, mutationContext); },
    onSettled: (result, error, call, context, mutationContext) => { if (runtime.current(call) && !isObsoletePeopleConnection(error)) options?.onSettled?.(result, error, call.value, context, mutationContext); },
  });
  const mutateAsync = async (value: V, options?: ScopedPeopleOptions<R, V>): Promise<R> => {
    const call = runtime.capture(value, options?.scope);
    runtime.requireCurrent(call);
    try {
      const result = await mutation.mutateAsync(call, callbacks(options));
      runtime.requireCurrent(call); return result;
    } catch (error) { runtime.requireCurrent(call); throw error; }
  };
  const mutate = (value: V, options?: ScopedPeopleOptions<R, V>) => {
    const call = runtime.capture(value, options?.scope);
    if (runtime.current(call)) mutation.mutate(call, callbacks(options));
  };
  const belongs = !mutation.variables || runtime.current(mutation.variables);
  return { ...mutation, mutate, mutateAsync,
    variables: belongs ? mutation.variables?.value : undefined,
    data: belongs ? mutation.data : undefined, error: belongs ? mutation.error : null,
    failureReason: belongs ? mutation.failureReason : null, failureCount: belongs ? mutation.failureCount : 0,
    isPending: belongs && mutation.isPending, isSuccess: belongs && mutation.isSuccess,
    isError: belongs && mutation.isError, isIdle: !belongs || mutation.isIdle,
    status: belongs ? mutation.status : 'idle' as const,
  };
}

/** All writes retain the existing RPCs, arguments and query destinations.
 * Only callers supplying scope opt into lifetime checks and auth preflight. */
export function usePeopleConnectionMutations(userId: string | null | undefined) {
  const qc = useQueryClient();
  const owner = useMemo<Owner>(() => ({ userId }), [userId]);
  const active = useRef<Owner | null>(null);
  const latest = useRef(owner); latest.current = owner;
  const mounted = useRef(false), epoch = useRef(0);
  const authUser = useRef<string | null | undefined>(undefined);
  const unsubscribe = useRef<(() => void) | null>(null);
  useLayoutEffect(() => { active.current = owner; mounted.current = true;
    return () => { if (active.current === owner) active.current = null; };
  }, [owner]);
  useEffect(() => () => { mounted.current = false; unsubscribe.current?.(); unsubscribe.current = null; }, []);
  const ensureAuthListener = (scope: PeopleConnectionScope) => {
    if (unsubscribe.current || !mounted.current) return;
    if (authUser.current === undefined) authUser.current = scope.userId;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted.current) return;
      const next = session?.user.id ?? null;
      if (authUser.current !== next) { epoch.current++; authUser.current = next; }
    });
    unsubscribe.current = () => subscription.unsubscribe();
  };
  const current = (call: CapturedCall<unknown>) => !call.scope || (
    mounted.current && active.current === call.owner && latest.current === call.owner &&
    call.epoch === epoch.current && call.owner.userId === call.scope.userId &&
    authUser.current === call.scope.userId && call.scope.isCurrent()
  );
  const runtime: Runtime = {
    capture: (value, scope) => {
      if (scope) ensureAuthListener(scope);
      return { value, owner, epoch: epoch.current, scope };
    },
    current,
    requireCurrent: call => { if (!current(call)) throw new ObsoletePeopleConnectionError(); },
    invalidate: call => {
      const capturedUser = call.owner.userId;
      if (!capturedUser || !current(call)) return;
      const keys = [yoursKeys.grid(capturedUser), yoursKeys.backlog(capturedUser), yoursKeys.requests(capturedUser), INBOX_COUNT_KEY,
        ['yours', 'profile-card'], ['yours', 'person-profile']];
      for (const queryKey of keys) {
        if (!current(call)) return;
        void qc.invalidateQueries({ queryKey }).catch(() => {});
      }
    },
  };
  // Preserve THE HANDSHAKE helper and its exact outcome mapping.
  const sendRequest = useConnectionMutation(sendOrAcceptPeopleRequest, runtime);
  const accept = useConnectionMutation(async (requesterId: string) => {
    const { error } = await supabase.rpc('accept_people_request', { p_requester: requesterId });
    if (error) throw error;
  }, runtime);
  const decline = useConnectionMutation(async (args: { requesterId: string; block?: boolean }) => {
    const { error } = await supabase.rpc('decline_people_request', { p_requester: args.requesterId, p_block: args.block ?? false });
    if (error) throw error;
  }, runtime);
  const remove = useConnectionMutation(async (otherId: string) => {
    const { error } = await supabase.rpc('remove_connection', { p_other: otherId });
    if (error) throw error;
  }, runtime);
  const setVisibility = useConnectionMutation(async (args: { global?: boolean | null; personId?: string | null; hidden?: boolean | null }) => {
      const { error } = await supabase.rpc('set_plan_visibility', {
        p_global: args.global ?? null, p_person: args.personId ?? null, p_hidden: args.hidden ?? null,
      });
      if (error) throw error;
  }, runtime);
  const ping = useMutation({
    mutationFn: async (args: { recipientId: string; eventId: string }) => {
      const { error } = await supabase.rpc('ping_person', { p_recipient: args.recipientId, p_event_id: args.eventId });
      if (error) throw error;
    },
  });
  return { sendRequest, accept, decline, remove, setVisibility, ping };
}
