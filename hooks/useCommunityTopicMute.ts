import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMyTopicMute, setMyTopicMute, type TopicNotificationScope } from '../lib/topicNotificationPreference';
import { confirmChatMuteChange } from '../lib/confirmChatMuteChange';
import type { ObservedUser } from './useObservedUser';

type Scope = { key: string; generation: number; busy: boolean; preferenceRevision: number };
type Attempt = { scope: Scope; unknown: boolean; busy: boolean };
type ChangeResult = { matched: boolean; value: boolean | null } | undefined;

/** Persistent and event topics both retain their existing independent row.
 * Reading or muting never joins a topic or changes its history/read markers. */
export function useCommunityTopicMute(topicId: string | undefined, viewer: ObservedUser) {
  const queryClient = useQueryClient();
  const mounted = useRef(false);
  const scopeKey = JSON.stringify([topicId, viewer.viewerId, viewer.epoch]);
  const scopeRef = useRef<Scope>({ key: scopeKey, generation: 0, busy: false, preferenceRevision: 0 });
  if (scopeRef.current.key !== scopeKey) {
    scopeRef.current = { key: scopeKey, generation: scopeRef.current.generation + 1, busy: false, preferenceRevision: 0 };
  }
  const scope = scopeRef.current;
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const unknown = attempt?.scope === scope && attempt.unknown;
  const busy = attempt?.scope === scope && attempt.busy;
  const current = () => mounted.current && scopeRef.current === scope && viewer.isCurrent();
  const canRead = !!topicId && !!viewer.viewerId && !viewer.error && !viewer.isLoading;
  const queryKey = ['topic-mute', topicId, viewer.viewerId, viewer.epoch, scope.generation] as const;
  const binding: TopicNotificationScope = { topicId: topicId ?? '', userId: viewer.viewerId ?? '', isCurrent: current };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => () => {
    void queryClient.cancelQueries({ queryKey, exact: true }).catch(() => {});
  // Room/account A → B → A owns a fresh query key and attempt identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, queryClient]);

  const query = useQuery({
    queryKey,
    enabled: canRead && !busy,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const revision = scope.preferenceRevision;
      if (!current() || signal.aborted || scope.busy) throw new Error('This setting is being checked.');
      const value = await getMyTopicMute(binding);
      if (!current() || signal.aborted || revision !== scope.preferenceRevision) throw new Error('This setting changed.');
      return value;
    },
    retry: failureCount => current() && !scope.busy && failureCount < 1,
  });
  const ready = canRead && query.isSuccess && typeof query.data === 'boolean' && !unknown;
  const isChecking = viewer.isLoading || busy || (canRead && (query.isLoading || query.isFetching));
  const muted = ready ? query.data : undefined;

  const toggle = async (): Promise<ChangeResult> => {
    if (!topicId || !current() || scope.busy || isChecking) return;
    scope.busy = true;
    setAttempt({ scope, busy: true, unknown: !!unknown });
    try {
      if (!viewer.viewerId || viewer.error) {
        await viewer.retry();
        return;
      }
      if (!ready) {
        // Retry from unknown reads only. Never guess the inverse of a cached
        // value when the previous write may already have committed.
        const value = await getMyTopicMute(binding);
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
      const result = await confirmChatMuteChange(!muted,
        desired => setMyTopicMute(binding, desired),
        () => getMyTopicMute(binding),
      );
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
      void queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] }).catch(() => {});
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

  return { muted, ready, isChecking: !!isChecking, toggle, isCurrent: current };
}
