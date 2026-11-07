/**
 * useUpdateCircle - edit a circle's identity (name / description).
 *
 * Uses an exact request receipt and expected revision around the existing
 * admin-gated update_circle operation. Unknown replies retain the original
 * request across visits; only explicit recovery resends that same request. The one
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
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { circleKeys } from '../lib/circles/keys';
import * as Crypto from 'expo-crypto';
import { beginIdentitySave, readIdentitySave, clearIdentitySave, identitySaveKey, claimIdentitySave, releaseIdentitySave,
  identitySaveRunning, type IdentitySaveAttempt } from '../lib/circles/identitySaveAttempt';

export class UnconfirmedCircleSaveError extends Error {
  constructor() { super('Your earlier save is still being checked.'); this.name = 'UnconfirmedCircleSaveError'; }
}
export class ConflictingCircleSaveError extends Error {
  constructor() { super('The circle changed while you were saving. Close this sheet and review its latest details.'); this.name = 'ConflictingCircleSaveError'; }
}
function statusResult(result: any): { status: 'saved' | 'conflict' | 'missing'; revision?: string | null } {
  if (result?.error) throw result.error;
  const value = result?.data;
  if (value?.status === 'saved' || value?.status === 'conflict') return value;
  if (value?.status === 'missing' && (value.revision === null || typeof value.revision === 'string')) return value;
  throw new UnconfirmedCircleSaveError();
}
const refused = (result: any) => !!result?.error && Number(result.status) >= 400 && Number(result.status) < 500 && Number(result.status) !== 408;


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
type Attempt = { owner: Owner; identity: UpdateCircleIdentity; resume?: IdentitySaveAttempt };
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

  const [recovery, setRecovery] = useState<{ owner: Owner; attempt: IdentitySaveAttempt | null; error?: boolean } | null>(null);
  const [checking, setChecking] = useState<Owner | null>(null);
  useEffect(() => {
    if (!current(owner)) return;
    readIdentitySave(identitySaveKey(owner.userId!, owner.circleId)).then(attempt => {
      if (current(owner)) setRecovery({ owner, attempt });
    }, () => { if (current(owner)) setRecovery({ owner, attempt: null, error: true }); });
  }, [owner, current]);
  const refreshRecovery = async (captured: Owner) => {
    try {
      const attempt = await readIdentitySave(identitySaveKey(captured.userId!, captured.circleId));
      if (current(captured)) setRecovery({ owner: captured, attempt });
    } catch { if (current(captured)) setRecovery({ owner: captured, attempt: null, error: true }); }
  };

  const mutation = useMutation<void, Error, Attempt>({
    retry: false, networkMode: 'always',
    mutationFn: async attempt => {
      const captured = attempt.owner;
      try {
        requireCurrent(captured);
        const { data: { user }, error: authError } = await requestWithDeadline(supabase.auth.getUser(), 12_000);
        requireCurrent(captured);
        if (authError) throw authError;
        if (!user || user.id !== captured.userId) throw new ObsoleteCircleUpdateError();
        if (authUser.current === undefined) authUser.current = user.id;
        const key = identitySaveKey(captured.userId!, captured.circleId);
        const lock = claimIdentitySave(key);
        if (!lock) throw new UnconfirmedCircleSaveError();
        let dispatched = false;
        try {
          let saved = await readIdentitySave(key);
          requireCurrent(captured);
          if (attempt.resume) {
            if (!saved || saved.requestId !== attempt.resume.requestId) throw new UnconfirmedCircleSaveError();
          } else {
            if (saved) throw new UnconfirmedCircleSaveError();
            const before = statusResult(await requestWithDeadline(supabase.rpc('circle_identity_save_status', {
              p_circle_id: captured.circleId, p_request_id: Crypto.randomUUID(),
            }), 12_000));
            requireCurrent(captured);
            if (before.status !== 'missing') throw new UnconfirmedCircleSaveError();
            saved = await beginIdentitySave(key, before.revision!, attempt.identity, () => requireCurrent(captured));
            if (!saved) throw new UnconfirmedCircleSaveError();
          }
          const stored = saved;
          try { requireCurrent(captured); }
          catch (error) { if (!attempt.resume) await clearIdentitySave(key, stored.requestId); throw error; }
          const { name, description, coverUploadId, clearCover } = stored.identity;
          // Keep the underlying request alive. Its eventual receipt belongs to
          // this exact operation, even after the UI's bounded wait ends.
          const write = Promise.resolve(supabase.rpc('save_circle_identity_once', {
            p_circle_id: captured.circleId, p_request_id: stored.requestId, p_expected_revision: stored.revision,
            p_name: name, p_description: description, p_cover_upload_id: coverUploadId ?? null,
            p_clear_cover: clearCover === true && !coverUploadId,
          })).then(async result => {
            // A definitive first refusal is safe to retry. A resumed request
            // cannot use another request's failure to erase its original marker.
            if (!attempt.resume && refused(result)) await clearIdentitySave(key, stored.requestId);
            return statusResult(result);
          }).finally(() => releaseIdentitySave(key, lock));
          dispatched = true;
          if (current(captured)) setRecovery({ owner: captured, attempt: stored });
          const result = await requestWithDeadline(write, 12_000);
          requireCurrent(captured);
          if (result.status === 'missing') throw new UnconfirmedCircleSaveError();
          await clearIdentitySave(key, stored.requestId);
          requireCurrent(captured);
          if (result.status === 'conflict') throw new ConflictingCircleSaveError();
        } finally {
          if (!dispatched) releaseIdentitySave(key, lock);
          await refreshRecovery(captured);
        }
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
  const refreshCircle = () => {
    if (!current(owner)) return;
    void qc.invalidateQueries({ queryKey: circleKeys.detail(owner.circleId) });
    if (current(owner)) void qc.invalidateQueries({ queryKey: circleKeys.mine(owner.userId!) });
  };
  const checkSave = async (): Promise<'saved' | 'conflict' | 'missing' | 'idle'> => {
    requireCurrent(owner);
    if (checking === owner || pending.current?.owner === owner) throw new UnconfirmedCircleSaveError();
    setChecking(owner);
    try {
      const key = identitySaveKey(owner.userId!, owner.circleId);
      const account = await requestWithDeadline(supabase.auth.getUser(), 12_000);
      requireCurrent(owner);
      if (account.error || account.data.user?.id !== owner.userId) throw new ObsoleteCircleUpdateError();
      const stored = await readIdentitySave(key);
      requireCurrent(owner);
      if (!stored) { await refreshRecovery(owner); return 'idle'; }
      const result = statusResult(await requestWithDeadline(supabase.rpc('circle_identity_save_status', {
        p_circle_id: owner.circleId, p_request_id: stored.requestId,
      }), 12_000));
      requireCurrent(owner);
      if (result.status !== 'missing') {
        releaseIdentitySave(key);
        await clearIdentitySave(key, stored.requestId);
        requireCurrent(owner);
        if (result.status === 'saved') refreshCircle();
      }
      await refreshRecovery(owner);
      return result.status;
    } finally { setChecking(value => value === owner ? null : value); }
  };
  const retrySave = async () => {
    requireCurrent(owner);
    const stored = recovery?.owner === owner ? recovery.attempt : null;
    if (!stored || identitySaveRunning(identitySaveKey(owner.userId!, owner.circleId))) throw new UnconfirmedCircleSaveError();
    const attempt = begin(stored.identity); attempt.resume = stored;
    return mutation.mutateAsync(attempt);
  };
  const belongs = mutation.variables?.owner === owner && current(owner);
  return {
    ...mutation, mutate, mutateAsync, checkSave, retrySave, refreshCircle,
    recovery: recovery?.owner === owner ? recovery.attempt : null,
    recoveryError: recovery?.owner === owner && !!recovery.error,
    recoveryLoading: current(owner) && recovery?.owner !== owner,
    isCheckingSave: checking === owner,
    saveStillRunning: !!userId && identitySaveRunning(identitySaveKey(userId, circleId)),
    variables: belongs ? mutation.variables?.identity : undefined,
    data: belongs ? mutation.data : undefined, error: belongs ? mutation.error : null,
    failureReason: belongs ? mutation.failureReason : null, failureCount: belongs ? mutation.failureCount : 0,
    isPending: belongs && mutation.isPending, isSuccess: belongs && mutation.isSuccess,
    isError: belongs && mutation.isError, isIdle: !belongs || mutation.isIdle,
    status: belongs ? mutation.status : 'idle' as const,
  };
}
