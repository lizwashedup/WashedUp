/** Existing direct-add RPC. Current-member, Your People trust, role and
 * moderated-member restoration rules remain authoritative on the server. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient, type MutateOptions } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { addPeopleWithReceipt, pendingCircleAdd } from '../lib/circles/addPeopleReceipt';
import { circleKeys } from '../lib/circles/keys';

export interface InviteToCircleScope { userId: string; isCurrent: () => boolean }
export class ObsoleteCircleInviteError extends Error {
  constructor() { super('This circle invitation is no longer current.'); this.name = 'ObsoleteCircleInviteError'; }
}
export function isObsoleteCircleInvite(error: unknown): error is ObsoleteCircleInviteError {
  return error instanceof Error && error.name === 'ObsoleteCircleInviteError';
}
type Owner = { circleId: string; userId: string | null | undefined; scope: InviteToCircleScope | null | undefined; revision: number };
type Attempt = { owner: Owner; ids: string[]; checkOnly: boolean };
type Options = MutateOptions<number, Error, string[]>;

export function useInviteToCircle(circleId: string, userId: string | null | undefined, scope?: InviteToCircleScope | null) {
  const qc = useQueryClient();
  const revisionRef = useRef(0);
  const [revision, setRevision] = useState(0);
  const authUser = useRef<string | null | undefined>(undefined);
  const owner = useMemo<Owner>(() => ({ circleId, userId, scope, revision }), [circleId, userId, scope, revision]);
  const active = useRef<Owner | null>(null);
  const pending = useRef<Attempt | null>(null);
  useLayoutEffect(() => { active.current = owner; pending.current = null; return () => { if (active.current === owner) active.current = null; }; }, [owner]);
  useEffect(() => {
    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const next = session?.user.id ?? null;
      const previous = authUser.current === undefined ? active.current?.userId : authUser.current;
      authUser.current = next;
      if (previous !== next) { revisionRef.current++; setRevision(revisionRef.current); }
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);
  const current = useCallback((captured: Owner) => active.current === captured &&
    revisionRef.current === captured.revision && !!captured.circleId && !!captured.userId &&
    (authUser.current === undefined || authUser.current === captured.userId) && captured.scope !== null &&
    (!captured.scope || (captured.scope.userId === captured.userId && captured.scope.isCurrent())), []);
  const requireCurrent = (captured: Owner) => { if (!current(captured)) throw new ObsoleteCircleInviteError(); };

  const mutation = useMutation<number, Error, Attempt>({
    retry: false,
    mutationFn: async attempt => {
      const captured = attempt.owner;
      try {
        requireCurrent(captured);
        const { data: { user }, error: authError } = await requestWithDeadline(supabase.auth.getUser(), 12_000);
        requireCurrent(captured);
        if (authError) throw authError;
        if (!user || user.id !== captured.userId) throw new ObsoleteCircleInviteError();
        if (authUser.current === undefined) authUser.current = user.id;
        return await addPeopleWithReceipt(qc, user.id, captured.circleId, attempt.ids,
          () => requireCurrent(captured), attempt.checkOnly);
      } catch (error) {
        requireCurrent(captured);
        throw error;
      } finally {
        if (pending.current === attempt) pending.current = null;
      }
    },
    onSuccess: (_count, attempt) => {
      if (!current(attempt.owner)) return;
      void qc.invalidateQueries({ queryKey: circleKeys.detail(attempt.owner.circleId) });
      if (current(attempt.owner)) void qc.invalidateQueries({ queryKey: circleKeys.mine(attempt.owner.userId!) });
    },
  });

  // Capture invocation ownership before React Query schedules mutationFn. A
  // retained mutate callback must not use a replacement render's options.
  const begin = (ids: string[], checkOnly = false): Attempt => {
    requireCurrent(owner);
    if (pending.current?.owner === owner) throw new Error('A circle invitation is already pending.');
    if (!ids.length) throw new Error('Choose someone to add.');
    const attempt = { owner, ids: [...ids], checkOnly };
    pending.current = attempt;
    return attempt;
  };
  const callbacks = (options?: Options): MutateOptions<number, Error, Attempt> => ({
    onSuccess: (data, attempt, result, context) => { if (current(attempt.owner)) options?.onSuccess?.(data, attempt.ids, result, context); },
    onError: (error, attempt, result, context) => { if (current(attempt.owner) && !isObsoleteCircleInvite(error)) options?.onError?.(error, attempt.ids, result, context); },
    onSettled: (data, error, attempt, result, context) => { if (current(attempt.owner) && !isObsoleteCircleInvite(error)) options?.onSettled?.(data, error, attempt.ids, result, context); },
  });
  const mutate = (ids: string[], options?: Options) => {
    if (!current(owner) || pending.current?.owner === owner || ids.length === 0) return;
    mutation.mutate(begin(ids), callbacks(options));
  };
  const mutateAsync = async (ids: string[], options?: Options) => mutation.mutateAsync(begin(ids), callbacks(options));
  const belongs = mutation.variables?.owner === owner && current(owner);
  return {
    ...mutation, mutate, mutateAsync,
    pendingIds: userId ? pendingCircleAdd(qc, userId, circleId) : undefined,
    checkStatus: (ids: string[]) => mutation.mutateAsync(begin(ids, true)), variables: belongs ? mutation.variables?.ids : undefined,
    data: belongs ? mutation.data : undefined, error: belongs ? mutation.error : null,
    failureReason: belongs ? mutation.failureReason : null, failureCount: belongs ? mutation.failureCount : 0,
    isPending: belongs && mutation.isPending, isSuccess: belongs && mutation.isSuccess,
    isError: belongs && mutation.isError, isIdle: !belongs || mutation.isIdle,
    status: belongs ? mutation.status : 'idle' as const,
  };
}
