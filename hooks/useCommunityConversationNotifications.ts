import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ObservedUser } from './useObservedUser';
import { useCommunityChatPreference } from './useCommunityChatPreference';
import { getCommunityTopicNotificationContext } from '../lib/communityChatNotificationState';

type Selection = { kind: 'legacy' } | { kind: 'persistent'; communityId: string } | { kind: 'topic'; topicId: string };
type Individual = { muted: boolean | null | undefined; ready: boolean; isChecking: boolean; toggle: () => Promise<{ matched: boolean; value: boolean | null } | undefined>; isCurrent?: () => boolean };
/** Keep the existing individual controller. A parent override changes the
 * effective bell and routes Unmute all to the separate saved preference. */
export function useCommunityConversationNotifications(selection: Selection, viewer: ObservedUser, individual: Individual) {
  const active = useRef(false), [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { active.current = true; setFocused(true); return () => { active.current = false; setFocused(false); }; }, []));
  const queryClient = useQueryClient();
  const topicId = selection.kind === 'topic' ? selection.topicId : '';
  const communityId = selection.kind === 'persistent' ? selection.communityId : '';
  const owner = useMemo(() => ({}), [selection.kind, communityId, topicId, viewer.viewerId, viewer.epoch]);
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const current = () => active.current && AppState.currentState !== 'background' && AppState.currentState !== 'inactive' && ownerRef.current === owner && viewer.isCurrent();
  const contextKey = useMemo(() => ['community-notification-context', topicId, viewer.viewerId, viewer.epoch], [owner]);
  useEffect(() => () => { void queryClient.cancelQueries({ queryKey: contextKey, exact: true }).catch(() => {}); }, [owner, queryClient]);
  const context = useQuery({
    queryKey: contextKey,
    enabled: !!topicId && focused && !!viewer.viewerId && !viewer.error && !viewer.isLoading,
    queryFn: ({ signal }) => getCommunityTopicNotificationContext(topicId, { userId: viewer.viewerId!, isCurrent: () => current() && !signal.aborted }),
    retry: false, staleTime: 30_000,
  });
  const resolved = selection.kind === 'persistent' ? selection : selection.kind === 'topic' && context.isSuccess ? context.data : null;
  const parent = useCommunityChatPreference(resolved?.communityId ?? '', viewer, focused && resolved?.kind === 'persistent');
  if (selection.kind === 'legacy' || resolved?.kind === 'event') return { ...individual, label: undefined, parent: null, isCurrent: individual.isCurrent ?? viewer.isCurrent };
  const parentKnown = resolved?.kind === 'persistent' && !!parent.data && !parent.error && !parent.pending;
  const allMuted = parentKnown && parent.data!.muted;
  const ready = !!parentKnown && parent.ready && (allMuted || individual.ready);
  const checking = resolved ? parent.busy || parent.fetching || (!parent.data && parent.loading) || (!allMuted && individual.isChecking) : context.isLoading || context.isFetching;
  const toggle = async () => {
    if (!current() || checking) return;
    if (!resolved) { await context.refetch(); return; }
    if (parent.pending) { await parent.check(); return; }
    if (!parentKnown) { await parent.refresh(); return; }
    if (allMuted) { await parent.change(false); return; }
    return individual.toggle();
  };
  return { muted: ready ? allMuted || individual.muted === true : undefined, ready, isChecking: !!checking,
    toggle, isCurrent: current, parent: resolved?.kind === 'persistent' ? parent : null,
    label: checking ? 'Checking chat notifications' : !ready ? 'Check chat notification setting' : allMuted ? 'Unmute all community chats' : individual.muted ? 'Unmute chat' : 'Mute chat' };
}
