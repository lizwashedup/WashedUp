/**
 * useCircle - one circle's noticeboard payload for the circle home.
 *
 * Wraps `get_circle(p_circle_id)` (SECURITY DEFINER; raises if the caller is
 * not a joined member). Returns jsonb, so the payload arrives already parsed.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { readObservedUser, retireObservedUserRead } from '../lib/observedUserRead';
import { requestWithDeadline, RequestDeadlineError } from '../lib/requestWithDeadline';
import { circleKeys } from '../lib/circles/keys';
import type { CirclePayload } from '../lib/circles/types';
import { circleDisplay } from '../lib/circles/display';
import { getBlockedWith } from '../lib/blocking';
import { subscribeChatListPrivacy } from '../lib/chatListCache';

type CircleIdentity = { viewerId: string | null | undefined; epoch: number; error: Error | null; isLoading: boolean };
type IdentityCycle = { revision: number; unsubscribe?: () => void; read?: { revision: number; promise: Promise<void> } };
const DISABLED_IDENTITY: CircleIdentity = { viewerId: undefined, epoch: 0, error: null, isLoading: false };
const disabledSnapshot = () => DISABLED_IDENTITY;
const noSubscription = () => () => {};

/** Circle-only shared identity. No session writes or changes to global auth
 * hooks. The cache generation belongs to a QueryClient, not a component. */
function createCircleIdentityStore() {
  let snapshot: CircleIdentity = { ...DISABLED_IDENTITY, isLoading: true };
  let cycle: IdentityCycle | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: CircleIdentity) => {
    if (snapshot.viewerId === next.viewerId && snapshot.epoch === next.epoch &&
        snapshot.error === next.error && snapshot.isLoading === next.isLoading) return;
    snapshot = next;
    for (const notify of listeners) notify();
  };
  const publishUser = (viewerId: string | null) => publish({
    viewerId, epoch: snapshot.epoch + (snapshot.viewerId !== viewerId ? 1 : 0), error: null, isLoading: false,
  });
  const read = async (owner: IdentityCycle, revision: number) => {
    try {
      const result = await requestWithDeadline(readObservedUser(), 12_000);
      if (cycle !== owner || owner.revision !== revision) return;
      if (result.error) throw result.error;
      publishUser(result.data.user?.id ?? null);
    } catch (error) {
      if (cycle !== owner || owner.revision !== revision) return;
      publish({ ...snapshot, isLoading: false, error: error instanceof Error ? error : new Error('Could not check this account.') });
    } finally {
      if (owner.read?.revision === revision) owner.read = undefined;
    }
  };
  const start = () => {
    const owner: IdentityCycle = { revision: 1 };
    cycle = owner;
    // Capture the initial read before subscribing: even a synchronous auth
    // event takes precedence over that read's eventual result.
    const revision = owner.revision;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cycle !== owner) return;
      retireObservedUserRead();
      owner.revision++;
      publishUser(session?.user.id ?? null);
    });
    const stopPrivacy = subscribeChatListPrivacy(viewerId => {
      if (cycle !== owner || snapshot.viewerId !== viewerId) return;
      // Retire both warm data and reads already in flight before a blocked DM
      // can paint its header or mount a writable conversation again.
      publish({ ...snapshot, epoch: snapshot.epoch + 1 });
    });
    owner.unsubscribe = () => { subscription.unsubscribe(); stopPrivacy(); };
    owner.read = { revision, promise: read(owner, revision) };
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      if (listeners.size === 1) start();
      return () => {
        listeners.delete(notify);
        if (listeners.size !== 0) return;
        const previous = cycle;
        cycle = null;
        retireObservedUserRead();
        previous?.unsubscribe?.();
        // No observer can know whether A -> B -> A occurred while away. Retire
        // the shared generation; a later first observer must revalidate.
        publish({ viewerId: undefined, epoch: snapshot.epoch + 1, error: null, isLoading: true });
      };
    },
    matches: (viewerId: string | null | undefined, epoch: number) => cycle !== null &&
      snapshot.viewerId === viewerId && snapshot.epoch === epoch,
    retry: async () => {
      const owner = cycle;
      if (!owner) return;
      if (snapshot.isLoading && owner.read) return owner.read.promise;
      const revision = ++owner.revision;
      publish({ ...snapshot, error: null, isLoading: true });
      const promise = read(owner, revision);
      owner.read = { revision, promise };
      return promise;
    },
  };
}
const circleIdentityStores = new WeakMap<QueryClient, ReturnType<typeof createCircleIdentityStore>>();
function circleIdentityStore(client: QueryClient) {
  let store = circleIdentityStores.get(client);
  if (!store) { store = createCircleIdentityStore(); circleIdentityStores.set(client, store); }
  return store;
}

export function useCircle(circleId: string | null | undefined) {
  const client = useQueryClient();
  const store = useMemo(() => circleIdentityStore(client), [client]);
  const identity = useSyncExternalStore(circleId ? store.subscribe : noSubscription,
    circleId ? store.getSnapshot : disabledSnapshot, disabledSnapshot);
  const { viewerId, epoch } = identity;
  const visit = useMemo(() => ({}), [store, circleId, viewerId, epoch]);
  const activeVisit = useRef<object | null>(null);
  useLayoutEffect(() => { activeVisit.current = visit; return () => { if (activeVisit.current === visit) activeVisit.current = null; }; }, [visit]);
  const isCurrent = useCallback(() => !!circleId && activeVisit.current === visit && store.matches(viewerId, epoch),
    [circleId, visit, store, viewerId, epoch]);
  const configuredRetry = client.getDefaultOptions().queries?.retry;
  const ready = !!circleId && !!viewerId && !identity.isLoading && !identity.error;
  const query = useQuery({
    // Existing mutation invalidations still match the detail prefix. Never read
    // a legacy unscoped cache or another account's membership/noticeboard.
    queryKey: [...circleKeys.detail(circleId ?? ''), viewerId ?? '', epoch],
    enabled: ready,
    // Warm sharing lasts while a Circle identity observer remains mounted.
    // After all observers leave, a new generation revalidates on reopening.
    staleTime: 60_000,
    retry: (failures, error) => {
      if (error instanceof RequestDeadlineError) return false;
      if (typeof configuredRetry === 'function') return configuredRetry(failures, error);
      return configuredRetry === true || failures < (typeof configuredRetry === 'number' ? configuredRetry : configuredRetry === false ? 0 : 3);
    },
    queryFn: async ({ signal }): Promise<CirclePayload | null> => {
      if (!circleId || !viewerId) throw new Error('This account could not be confirmed.');
      // A shared read can outlive its first component, but never its captured
      // account generation or its final React Query observer.
      const requireCurrent = () => {
        if (!store.matches(viewerId, epoch) || signal.aborted) throw new Error('This circle request is no longer current.');
      };
      requireCurrent();
      const { data: auth, error: authError } = await requestWithDeadline(readObservedUser(), 12_000);
      requireCurrent();
      if (authError) throw authError;
      if (auth.user?.id !== viewerId) throw new Error('This account changed. Please try again.');
      const { data, error } = await requestWithDeadline(Promise.resolve(supabase.rpc('get_circle', {
        p_circle_id: circleId,
      }).abortSignal(signal)), 12_000);
      requireCurrent();
      if (error) throw error;
      const payload = data as CirclePayload | null;
      if (!payload) return null;
      const display = circleDisplay(payload.circle.name,
        payload.members.map(member => ({ user_id: member.user_id, name: member.first_name_display,
          avatar_url: member.profile_photo_url })), viewerId);
      if (display.isDm && display.otherUserId) {
        const blocked = await requestWithDeadline(getBlockedWith(viewerId, [display.otherUserId]), 12_000);
        requireCurrent();
        if (blocked.has(display.otherUserId)) return null;
      }
      return payload;
    },
  });
  const refetch = useCallback(async () => {
    if (!circleId || !isCurrent()) return;
    if (identity.error) { await store.retry(); return; }
    if (!ready) return;
    return query.refetch();
  }, [circleId, isCurrent, identity.error, store, ready, query.refetch]);
  return {
    ...query,
    // Query identity already owns this room's data. A committed-visit ref is
    // only for callbacks; consulting it here would hide a warm cached result
    // on mount until some unrelated later notification forced another render.
    data: ready && store.matches(viewerId, epoch) && !query.isError ? query.data : undefined,
    isLoading: !!circleId && (identity.isLoading || (ready && query.isLoading)),
    isError: !!identity.error || (ready && query.isError),
    error: identity.error ?? query.error,
    refetch,
    viewerId,
    viewerEpoch: epoch,
    isCurrentViewer: isCurrent,
  };
}
