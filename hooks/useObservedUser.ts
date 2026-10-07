import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { readObservedUser, retireObservedUserRead } from '../lib/observedUserRead';

type Identity = { viewerId: string | null | undefined; epoch: number };

/** Read-only identity observer for account-scoped UI. Never changes a session. */
export function useObservedUser({ allowSignedOut = false }: { allowSignedOut?: boolean } = {}) {
  const current = useRef<Identity>({ viewerId: undefined, epoch: 0 });
  const mounted = useRef(false);
  const retryRead = useRef<(() => Promise<void>) | null>(null);
  const [identity, setIdentity] = useState(current.current);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let revision = 0;
    mounted.current = true;
    const publish = (viewerId: string | null) => {
      if (current.current.viewerId !== viewerId) {
        current.current = { viewerId, epoch: current.current.epoch + 1 };
        setIdentity(current.current);
      }
      setError(null);
      setIsLoading(false);
    };
    // Subscribe first. A late initial read must not replace a newer auth event.
    // Keep the event callback synchronous to avoid taking Supabase's auth lock.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      retireObservedUserRead();
      revision++;
      publish(session?.user.id ?? null);
    });
    const read = async () => {
      const readRevision = ++revision;
      setError(null);
      setIsLoading(true);
      try {
        const result = await requestWithDeadline(readObservedUser(), 12_000);
        if (!active || revision !== readRevision) return;
        if (result.error) {
          if (allowSignedOut && result.error.name === 'AuthSessionMissingError' && !result.data.user) { publish(null); return; }
          throw result.error;
        }
        publish(result.data.user?.id ?? null);
      } catch (failure) {
        if (!active || revision !== readRevision) return;
        setError(failure instanceof Error ? failure : new Error('Could not check this account.'));
        setIsLoading(false);
      }
    };
    retryRead.current = read;
    void read();
    return () => {
      active = false;
      retireObservedUserRead();
      mounted.current = false;
      if (retryRead.current === read) retryRead.current = null;
      subscription.unsubscribe();
    };
  }, [allowSignedOut]);

  const isCurrent = useCallback(() => mounted.current && current.current === identity, [identity]);
  const retry = useCallback(async () => { await retryRead.current?.(); }, []);
  return { ...identity, error, isLoading, isCurrent, retry };
}

export type ObservedUser = ReturnType<typeof useObservedUser>;
