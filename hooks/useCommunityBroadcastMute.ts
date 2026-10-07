import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMyBroadcastMute, setBroadcastMute } from '../lib/communityChat';
import { confirmChatMuteChange } from '../lib/confirmChatMuteChange';
import type { ObservedUser } from './useObservedUser';

type Scope = { key: string; generation: number; busy: boolean; preferenceRevision: number };
type Attempt = { scope: Scope; unknown: boolean; busy: boolean };
type ChangeResult = { matched: boolean; value: boolean | null } | undefined;

/** The existing main-room preference; whole-community and Intros preferences are separate contracts. */
export function useCommunityBroadcastMute(communityId: string | undefined, viewer: ObservedUser) {
  const queryClient = useQueryClient();
  const mounted = useRef(false);
  const scopeKey = JSON.stringify([communityId, viewer.viewerId, viewer.epoch]);
  const scopeRef = useRef<Scope>({ key: scopeKey, generation: 0, busy: false, preferenceRevision: 0 });
  if (scopeRef.current.key !== scopeKey) {
    scopeRef.current = { key: scopeKey, generation: scopeRef.current.generation + 1, busy: false, preferenceRevision: 0 };
  }
  const scope = scopeRef.current;
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const unknown = attempt?.scope === scope && attempt.unknown;
  const busy = attempt?.scope === scope && attempt.busy;
  const current = () => mounted.current && scopeRef.current === scope && viewer.isCurrent();
  const canRead = !!communityId && !!viewer.viewerId && !viewer.error && !viewer.isLoading;
  const queryKey = ['community-mute', communityId, viewer.viewerId, viewer.epoch, scope.generation] as const;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => () => {
    void queryClient.cancelQueries({ queryKey, exact: true }).catch(() => {});
  // Each scope owns a distinct key, including A → B → A transitions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, queryClient]);

  const query = useQuery({
    queryKey,
    enabled: canRead && !busy,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const preferenceRevision = scope.preferenceRevision;
      if (!current() || signal.aborted || scope.busy) throw new Error('This setting is being checked.');
      const value = await getMyBroadcastMute(communityId!, viewer.viewerId!);
      if (!current() || signal.aborted || preferenceRevision !== scope.preferenceRevision) throw new Error('This setting changed.');
      return value;
    },
    retry: (failureCount) => current() && !scope.busy && failureCount < 1,
  });
  const ready = canRead && query.isSuccess && typeof query.data === 'boolean' && !unknown;
  // A disabled query is pending in React Query; that does not mean a request is running.
  const isChecking = viewer.isLoading || busy || (canRead && (query.isLoading || query.isFetching));
  const muted = ready ? query.data : undefined;

  const toggle = async (): Promise<ChangeResult> => {
    if (!communityId || !current() || scope.busy || isChecking) return;
    scope.busy = true;
    setAttempt({ scope, busy: true, unknown: !!unknown });
    try {
      if (!viewer.viewerId || viewer.error) {
        await viewer.retry();
        return;
      }
      if (!ready) {
        const value = await getMyBroadcastMute(communityId, viewer.viewerId);
        if (!current()) return;
        scope.preferenceRevision++;
        await queryClient.cancelQueries({ queryKey, exact: true }, { revert: false });
        if (!current()) return;
        queryClient.setQueryData(queryKey, value);
        setAttempt({ scope, busy: false, unknown: false });
        return;
      }
      scope.preferenceRevision++;
      await queryClient.cancelQueries({ queryKey, exact: true }, { revert: false });
      if (!current()) return;
      const result = await confirmChatMuteChange(!muted, async desired => {
        await getMyBroadcastMute(communityId, viewer.viewerId!);
        if (!current()) throw new Error('This chat changed.');
        await setBroadcastMute(communityId, desired);
      }, async () => {
        if (!current()) throw new Error('This chat changed.');
        return getMyBroadcastMute(communityId, viewer.viewerId!);
      });
      if (!current()) return;
      scope.preferenceRevision++;
      await queryClient.cancelQueries({ queryKey, exact: true }, { revert: false });
      if (!current()) return;
      if (result.value !== null) {
        queryClient.setQueryData(queryKey, result.value);
        void queryClient.invalidateQueries({ queryKey: ['community-chat-rows'] }).catch(() => {});
        void queryClient.invalidateQueries({ queryKey: ['community-room-directory'] }).catch(() => {});
      }
      setAttempt({ scope, busy: false, unknown: result.value === null });
      return result;
    } catch {
      if (!current()) return;
      setAttempt({ scope, busy: false, unknown: true });
      return { matched: false, value: null };
    } finally {
      scope.busy = false;
      if (current()) setAttempt(previous => previous?.scope === scope ? { ...previous, busy: false } : previous);
    }
  };

  return { muted, ready, isChecking: !!isChecking, toggle };
}
