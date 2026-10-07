/**
 * useUpdateCircle - edit a circle's identity (name / description).
 *
 * Wraps update_circle(p_circle_id, p_name, p_description), which is admin-gated
 * (the SECURITY DEFINER RPC raises if the caller isn't a circle admin). The one
 * caller today is the "Name this circle" front door for an unnamed circle (a DM
 * grown to 3+ people); the DM's original pair are both admins, so either can
 * name it. Passing a blank name is a no-op server-side (COALESCE(NULLIF(...))),
 * so the sheet enforces a non-empty name before calling.
 *
 * Invalidates the circle detail (hero re-renders with the new name) and the
 * directory (the row stops showing the member-name fallback).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient, type MutateOptions } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { circleKeys } from '../lib/circles/keys';

export interface UpdateCircleIdentity {
  name: string;
  description: string | null;
  /** Optional cover (already uploaded to circle-covers); points cover_upload_id. */
  coverUploadId?: string | null;
  /**
   * Clear the manual cover. update_circle COALESCEs p_cover_upload_id, so a null
   * can't clear it; p_clear_cover is the only path. Ignored when a new cover is
   * also supplied (the new cover wins).
   */
  clearCover?: boolean;
}

export interface UpdateCircleScope { userId: string; isCurrent: () => boolean }
export class ObsoleteCircleUpdateError extends Error {
  constructor() { super('This circle update is no longer current.'); this.name = 'ObsoleteCircleUpdateError'; }
}
export function isObsoleteCircleUpdate(error: unknown): error is ObsoleteCircleUpdateError {
  return error instanceof Error && error.name === 'ObsoleteCircleUpdateError';
}
type Owner = { circleId: string; userId: string | null | undefined; scope: UpdateCircleScope | null | undefined; revision: number };
type Attempt = { owner: Owner; identity: UpdateCircleIdentity };
type Options = MutateOptions<void, Error, UpdateCircleIdentity>;

export function useUpdateCircle(circleId: string, userId: string | null | undefined, scope?: UpdateCircleScope | null) {
  const qc = useQueryClient();
  const revisionRef = useRef(0);
  const [revision, setRevision] = useState(0);
  const authUser = useRef<string | null | undefined>(undefined);
  const owner = useMemo<Owner>(() => ({ circleId, userId, scope, revision }), [circleId, userId, scope, revision]);
  const active = useRef<Owner | null>(null);
  const pending = useRef<Attempt | null>(null);
  useLayoutEffect(() => {
    active.current = owner; pending.current = null;
    return () => { if (active.current === owner) active.current = null; };
  }, [owner]);
  useEffect(() => {
    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const next = session?.user.id ?? null;
      const previous = authUser.current === undefined ? active.current?.userId : authUser.current;
      authUser.current = next;
      // Retire synchronously, including A -> B -> A before React rerenders.
      if (previous !== next) { revisionRef.current++; setRevision(revisionRef.current); }
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);
  const current = useCallback((captured: Owner) => active.current === captured &&
    revisionRef.current === captured.revision && !!captured.circleId && !!captured.userId &&
    (authUser.current === undefined || authUser.current === captured.userId) && captured.scope !== null &&
    (!captured.scope || (captured.scope.userId === captured.userId && captured.scope.isCurrent())), []);
  const requireCurrent = (captured: Owner) => { if (!current(captured)) throw new ObsoleteCircleUpdateError(); };

  const mutation = useMutation<void, Error, Attempt>({
    retry: false,
    mutationFn: async attempt => {
      const captured = attempt.owner;
      try {
        requireCurrent(captured);
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        requireCurrent(captured);
        if (authError) throw authError;
        if (!user || user.id !== captured.userId) throw new ObsoleteCircleUpdateError();
        if (authUser.current === undefined) authUser.current = user.id;
        const { name, description, coverUploadId, clearCover } = attempt.identity;
        const { error } = await supabase.rpc('update_circle', {
          p_circle_id: captured.circleId,
          p_name: name,
          p_description: description,
          p_cover_upload_id: coverUploadId ?? null,
          p_clear_cover: clearCover === true && !coverUploadId,
        });
        requireCurrent(captured);
        if (error) throw error;
      } catch (error) {
        requireCurrent(captured);
        throw error;
      }
    },
    onSuccess: (_data, attempt) => {
      if (!current(attempt.owner)) return;
      void qc.invalidateQueries({ queryKey: circleKeys.detail(attempt.owner.circleId) });
      if (current(attempt.owner)) void qc.invalidateQueries({ queryKey: circleKeys.mine(attempt.owner.userId!) });
    },
    onSettled: (_data, _error, attempt) => {
      if (pending.current === attempt) pending.current = null;
    },
  });

  // Capture the initiating values before React Query schedules mutationFn.
  const begin = (identity: UpdateCircleIdentity): Attempt => {
    requireCurrent(owner);
    if (pending.current?.owner === owner) throw new Error('A circle update is already pending.');
    const attempt = { owner, identity: { ...identity } };
    pending.current = attempt;
    return attempt;
  };
  const callbacks = (options?: Options): MutateOptions<void, Error, Attempt> => ({
    onSuccess: (data, attempt, result, context) => { if (current(attempt.owner)) options?.onSuccess?.(data, attempt.identity, result, context); },
    onError: (error, attempt, result, context) => { if (current(attempt.owner) && !isObsoleteCircleUpdate(error)) options?.onError?.(error, attempt.identity, result, context); },
    onSettled: (data, error, attempt, result, context) => { if (current(attempt.owner) && !isObsoleteCircleUpdate(error)) options?.onSettled?.(data, error, attempt.identity, result, context); },
  });
  const mutate = (identity: UpdateCircleIdentity, options?: Options) => {
    if (!current(owner) || pending.current?.owner === owner) return;
    mutation.mutate(begin(identity), callbacks(options));
  };
  const mutateAsync = async (identity: UpdateCircleIdentity, options?: Options) => mutation.mutateAsync(begin(identity), callbacks(options));
  const belongs = mutation.variables?.owner === owner && current(owner);
  return {
    ...mutation, mutate, mutateAsync, variables: belongs ? mutation.variables?.identity : undefined,
    data: belongs ? mutation.data : undefined, error: belongs ? mutation.error : null,
    failureReason: belongs ? mutation.failureReason : null, failureCount: belongs ? mutation.failureCount : 0,
    isPending: belongs && mutation.isPending, isSuccess: belongs && mutation.isSuccess,
    isError: belongs && mutation.isError, isIdle: !belongs || mutation.isIdle,
    status: belongs ? mutation.status : 'idle' as const,
  };
}
