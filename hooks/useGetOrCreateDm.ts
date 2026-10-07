/** Open the existing 1:1 DM or create it with the unchanged, server-gated RPC. */
import { useEffect, useRef, useState } from 'react';
import { useMutation, type MutateOptions } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { markChatListDirty } from '../lib/chatListSignal';

type Owner = { userId: string | null | undefined };
/** Optional caller visit ownership; existing callers retain account/mount checks. */
export interface DmOperationScope { userId: string; isCurrent: () => boolean; }
type Attempt = { owner: Owner; otherUserId: string; scope?: DmOperationScope };
type Options = MutateOptions<string, Error, string> & { scope?: DmOperationScope };

export class ObsoleteDmOperationError extends Error {
  constructor() { super('This chat request is no longer current.'); this.name = 'ObsoleteDmOperationError'; }
}
export function isObsoleteDmOperation(error: unknown): error is ObsoleteDmOperationError {
  return error instanceof Error && error.name === 'ObsoleteDmOperationError';
}

export function useGetOrCreateDm() {
  const ownerRef = useRef<Owner>({ userId: undefined });
  const owner = ownerRef.current;
  const mounted = useRef(false);
  const initialRead = useRef<Promise<void> | null>(null);
  const [, repaint] = useState(0);

  useEffect(() => {
    let active = true;
    let revision = 0;
    let receivedEvent = false;
    mounted.current = true;
    let settle!: () => void;
    const ready = new Promise<void>(resolve => { settle = resolve; });
    initialRead.current = ready;
    repaint(n => n + 1);
    const publish = (userId: string | null, transition = false) => {
      const previous = ownerRef.current;
      if (transition || (previous.userId !== undefined && previous.userId !== userId)) {
        // Identity is an object, not just an id: an A → B → A round trip must
        // never revive an old mutation or a retained callback.
        ownerRef.current = { userId };
      } else {
        // An initial session identifies the existing mount; it is not a new
        // sign-in. Calls waiting on this same cold-start read may continue.
        previous.userId = userId;
      }
      settle();
      repaint(n => n + 1);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      const next = session?.user.id ?? null;
      if (event === 'INITIAL_SESSION' && (receivedEvent || ownerRef.current.userId !== undefined)) return;
      receivedEvent = true;
      revision++;
      const explicitTransition = event === 'SIGNED_OUT' || event === 'PASSWORD_RECOVERY'
        || (ownerRef.current.userId === undefined && event === 'SIGNED_IN');
      publish(next, explicitTransition);
    });
    // Subscribe before reading. Never let an old cached read replace a newer
    // auth event; callbacks stay synchronous to avoid Supabase auth-lock waits.
    const readRevision = revision;
    void (async () => {
      try {
        const result = await supabase.auth.getSession();
        if (!active || revision !== readRevision) return;
        if (result.error) throw result.error;
        publish(result.data.session?.user.id ?? null);
      } catch {
        // The next deliberate action can retry the initial account read.
      } finally {
        settle();
      }
    })();
    return () => {
      active = false;
      mounted.current = false;
      ownerRef.current = { userId: undefined };
      settle();
      if (initialRead.current === ready) initialRead.current = null;
      subscription.unsubscribe();
    };
  }, []);

  const current = (captured: Owner) => mounted.current && ownerRef.current === captured;
  const requireCurrent = (captured: Owner) => { if (!current(captured)) throw new ObsoleteDmOperationError(); };
  const verifyId = (captured: Owner, actual: string | null) => {
    requireCurrent(captured);
    if (captured.userId !== actual) {
      // Also retire work if a session read detects a change before its event.
      ownerRef.current = { userId: actual };
      repaint(n => n + 1);
      throw new ObsoleteDmOperationError();
    }
  };
  const currentAttempt = (attempt: Attempt) => current(attempt.owner) && (!attempt.scope || (
    attempt.scope.isCurrent() && (attempt.owner.userId === undefined || attempt.owner.userId === attempt.scope.userId)
  ));
  const requireAttempt = (attempt: Attempt) => { if (!currentAttempt(attempt)) throw new ObsoleteDmOperationError(); };
  const mutation = useMutation<string, Error, Attempt>({
    retry: false,
    mutationFn: async attempt => {
      const captured = attempt.owner;
      try {
        requireAttempt(attempt);
        if (!attempt.otherUserId.trim()) throw new Error('Choose someone to message.');
        if (captured.userId === undefined) {
          await initialRead.current;
          requireAttempt(attempt);
          if (captured.userId === undefined) {
            // A failed cold-start read is retryable by this explicit action.
            const session = await supabase.auth.getSession();
            requireAttempt(attempt);
            if (session.error) throw session.error;
            const next = session.data.session?.user.id ?? null;
            if (captured.userId === undefined) captured.userId = next;
            else verifyId(captured, next);
          }
        }
        requireAttempt(attempt);
        if (!captured.userId) throw new Error('Sign in to open this chat.');
        const verified = await supabase.auth.getUser();
        requireAttempt(attempt);
        if (verified.error) throw verified.error;
        verifyId(captured, verified.data.user?.id ?? null);
        requireAttempt(attempt);
        const { data, error } = await supabase.rpc('get_or_create_dm', { p_other: attempt.otherUserId });
        requireAttempt(attempt);
        const session = await supabase.auth.getSession();
        requireAttempt(attempt);
        if (session.error) throw session.error;
        verifyId(captured, session.data.session?.user.id ?? null);
        if (error) throw error;
        if (typeof data !== 'string' || !data.trim()) throw new Error('Could not confirm this chat. Try again.');
        requireAttempt(attempt);
        return data;
      } catch (error) {
        requireAttempt(attempt);
        throw error;
      }
    },
    onSuccess: (_data, attempt) => { if (currentAttempt(attempt)) markChatListDirty(); },
  });

  const begin = (otherUserId: string, scope?: DmOperationScope): Attempt => {
    // Capture the caller scope before React Query schedules dispatch. Copy its
    // values so changing an options object cannot retarget an in-flight request.
    const attempt = { owner, otherUserId, scope: scope ? { ...scope } : undefined };
    requireAttempt(attempt);
    return attempt;
  };
  const callbacks = (options?: Options): MutateOptions<string, Error, Attempt> => ({
    onSuccess: (data, attempt, result, context) => { if (currentAttempt(attempt)) options?.onSuccess?.(data, attempt.otherUserId, result, context); },
    onError: (error, attempt, result, context) => { if (currentAttempt(attempt) && !isObsoleteDmOperation(error)) options?.onError?.(error, attempt.otherUserId, result, context); },
    onSettled: (data, error, attempt, result, context) => { if (currentAttempt(attempt) && !isObsoleteDmOperation(error)) options?.onSettled?.(data, error, attempt.otherUserId, result, context); },
  });
  const mutate = (otherUserId: string, options?: Options) => {
    if (!current(owner) || (options?.scope && !currentAttempt({ owner, otherUserId, scope: options.scope }))) return;
    mutation.mutate(begin(otherUserId, options?.scope), callbacks(options));
  };
  const mutateAsync = async (otherUserId: string, options?: Options) => {
    const attempt = begin(otherUserId, options?.scope);
    try {
      const result = await mutation.mutateAsync(attempt, callbacks(options));
      requireAttempt(attempt);
      return result;
    } catch (error) {
      requireAttempt(attempt);
      throw error;
    }
  };
  const belongs = !!mutation.variables && mutation.variables.owner === owner && currentAttempt(mutation.variables);
  return {
    ...mutation, mutate, mutateAsync, variables: belongs ? mutation.variables?.otherUserId : undefined,
    data: belongs ? mutation.data : undefined, error: belongs ? mutation.error : null,
    failureReason: belongs ? mutation.failureReason : null, failureCount: belongs ? mutation.failureCount : 0,
    isPending: belongs && mutation.isPending, isSuccess: belongs && mutation.isSuccess,
    isError: belongs && mutation.isError, isIdle: !belongs || mutation.isIdle,
    status: belongs ? mutation.status : 'idle' as const,
  };
}
