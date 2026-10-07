/**
 * useLeaveCircle - leave a circle (spec section 3). Plan history is untouched;
 * the row just flips to status 'left'. Invalidates the directory so the circle
 * drops out of Yours > Circles on success.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient, type MutateOptions } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { circleKeys } from '../lib/circles/keys';
import { markChatListDirty } from '../lib/chatListSignal';
import { UNREAD_CHATS_KEY } from '../constants/QueryKeys';

type LeaveResult = 'left' | 'not_member';
export interface LeaveCircleScope { userId: string; isCurrent: () => boolean }
type Owner = { userId: string | null | undefined; revision: number; scope: LeaveCircleScope | null | undefined };
type Attempt = { owner: Owner; circleId: string };
type Options = MutateOptions<LeaveResult, Error, string>;

export class ObsoleteCircleLeaveError extends Error {
  constructor() { super('This circle leave request is no longer current.'); this.name = 'ObsoleteCircleLeaveError'; }
}
export function isObsoleteCircleLeave(error: unknown): error is ObsoleteCircleLeaveError {
  return error instanceof Error && error.name === 'ObsoleteCircleLeaveError';
}

export function useLeaveCircle(userId: string | null | undefined, scope?: LeaveCircleScope | null) {
  const qc = useQueryClient();
  const revisionRef = useRef(0);
  const [revision, setRevision] = useState(0);
  const authUser = useRef<string | null | undefined>(undefined);
  const owner = useMemo<Owner>(() => ({ userId, revision, scope }), [userId, revision, scope]);
  const active = useRef<Owner | null>(null);
  const pending = useRef<Attempt | null>(null);
  useLayoutEffect(() => {
    active.current = owner;
    pending.current = null;
    return () => { if (active.current === owner) active.current = null; };
  }, [owner]);
  useEffect(() => {
    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const next = session?.user.id ?? null;
      const previous = authUser.current === undefined ? active.current?.userId : authUser.current;
      authUser.current = next;
      // A -> B -> A must retire a pending request even if React batches both
      // events into one render. A token refresh for A keeps the request valid.
      if (previous !== next) { revisionRef.current++; setRevision(revisionRef.current); }
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);
  const current = useCallback((captured: Owner) => active.current === captured &&
    revisionRef.current === captured.revision && !!captured.userId &&
    (authUser.current === undefined || authUser.current === captured.userId) && captured.scope !== null &&
    (!captured.scope || (captured.scope.userId === captured.userId && captured.scope.isCurrent())), []);
  const requireCurrent = (captured: Owner) => { if (!current(captured)) throw new ObsoleteCircleLeaveError(); };

  const mutation = useMutation<LeaveResult, Error, Attempt>({
    retry: false,
    mutationFn: async attempt => {
      const captured = attempt.owner;
      try {
        requireCurrent(captured);
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        requireCurrent(captured);
        if (authError) throw authError;
        if (!user || user.id !== captured.userId) throw new ObsoleteCircleLeaveError();
        if (authUser.current === undefined) authUser.current = user.id;
        const { data, error } = await supabase.rpc('leave_circle', { p_circle_id: attempt.circleId });
        requireCurrent(captured);
        if (error) throw error;
        // Both outcomes confirm there is no joined membership. Unknown data
        // must not remove the chat or be presented as a successful leave.
        if (data !== 'left' && data !== 'not_member') throw new Error('Could not confirm you left. Check the circle before trying again.');
        return data;
      } catch (error) {
        requireCurrent(captured);
        throw error;
      } finally {
        if (pending.current === attempt) pending.current = null;
      }
    },
    onSuccess: (_result, attempt) => {
      if (!current(attempt.owner)) return;
      void qc.invalidateQueries({ queryKey: circleKeys.mine(attempt.owner.userId!) }).catch(() => {});
      // The Chats list is not a react-query cache and its focus refetch is
      // throttled ~30s; the dirty flag makes the left chat drop on the next
      // focus instead of lingering. The unread badge rides a query key.
      if (!current(attempt.owner)) return;
      markChatListDirty();
      if (current(attempt.owner)) void qc.invalidateQueries({ queryKey: UNREAD_CHATS_KEY }).catch(() => {});
    },
  });

  // Capture before React Query schedules mutationFn. Its observer may adopt
  // newer hook options; a retained public callback still belongs to its owner.
  const begin = (circleId: string): Attempt => {
    requireCurrent(owner);
    if (!circleId.trim()) throw new Error('Choose a circle to leave.');
    if (pending.current?.owner === owner) throw new Error('A circle leave request is already pending.');
    const attempt = { owner, circleId };
    pending.current = attempt;
    return attempt;
  };
  const callbacks = (options?: Options): MutateOptions<LeaveResult, Error, Attempt> => ({
    onSuccess: (data, attempt, result, context) => { if (current(attempt.owner)) options?.onSuccess?.(data, attempt.circleId, result, context); },
    onError: (error, attempt, result, context) => { if (current(attempt.owner) && !isObsoleteCircleLeave(error)) options?.onError?.(error, attempt.circleId, result, context); },
    onSettled: (data, error, attempt, result, context) => { if (current(attempt.owner) && !isObsoleteCircleLeave(error)) options?.onSettled?.(data, error, attempt.circleId, result, context); },
  });
  const mutate = (circleId: string, options?: Options) => {
    if (!current(owner) || pending.current?.owner === owner || !circleId.trim()) return;
    mutation.mutate(begin(circleId), callbacks(options));
  };
  const mutateAsync = async (circleId: string, options?: Options) => {
    const attempt = begin(circleId);
    try {
      const result = await mutation.mutateAsync(attempt, callbacks(options));
      requireCurrent(attempt.owner);
      return result;
    } catch (error) {
      requireCurrent(attempt.owner);
      throw error;
    }
  };
  const belongs = mutation.variables?.owner === owner && current(owner);
  return {
    ...mutation, mutate, mutateAsync, variables: belongs ? mutation.variables?.circleId : undefined,
    data: belongs ? mutation.data : undefined, error: belongs ? mutation.error : null,
    failureReason: belongs ? mutation.failureReason : null, failureCount: belongs ? mutation.failureCount : 0,
    isPending: belongs && mutation.isPending, isSuccess: belongs && mutation.isSuccess,
    isError: belongs && mutation.isError, isIdle: !belongs || mutation.isIdle,
    status: belongs ? mutation.status : 'idle' as const,
  };
}
