import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ObservedUser } from './useObservedUser';
import { getCommunityRoomIdentities, type CommunityRoomIdentities } from '../lib/communityRoomHistory';
import { requestWithDeadline, RequestDeadlineError } from '../lib/requestWithDeadline';
import { setOptionalRoomMembership } from '../lib/communityOptionalRoom';

type Change = { topicId: string; joined: boolean; retryReady: boolean };
/** One current-account/page operation at a time. Blur pauses dispatch but keeps
 * uncertain membership changes available for read-only checking on return. */
export function useCommunityRoomDirectory(communityId: string, viewer: ObservedUser, enabled: boolean) {
  const client = useQueryClient(), mounted = useRef(false), active = useRef(enabled);
  active.current = enabled;
  const foreground = useRef(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const owner = useMemo(() => ({ communityId, userId: viewer.viewerId, epoch: viewer.epoch, busy: false, change: null as Change | null, notice: null as string | null }), [communityId, viewer.viewerId, viewer.epoch]);
  const currentOwner = useRef(owner); currentOwner.current = owner;
  const [, render] = useState(0);
  const same = () => mounted.current && currentOwner.current === owner && viewer.isCurrent();
  const current = () => same() && active.current && foreground.current;
  const scope = useMemo(() => ({ userId: viewer.viewerId ?? '', isCurrent: current }), [owner]); // Own viewer closure is retired with this owner.
  const key = useMemo(() => ['community-room-directory', communityId, viewer.viewerId, viewer.epoch], [owner]);
  const update = () => { if (same()) render(n => n + 1); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => () => { void client.cancelQueries({ queryKey: key, exact: true }).catch(() => {}); }, [owner, client]);
  const query = useQuery({ queryKey: key, enabled: enabled && !!viewer.viewerId && !viewer.error && !viewer.isLoading && !owner.busy,
    queryFn: ({ signal }) => requestWithDeadline(getCommunityRoomIdentities(communityId, { ...scope, isCurrent: () => current() && !signal.aborted && !owner.busy }), 12_000),
    retry: (count, error) => !(error instanceof RequestDeadlineError) && current() && !owner.busy && count < 1,
    staleTime: 30_000,
  });
  const refresh = async () => {
    if (!current() || owner.busy) return;
    if (viewer.error || !viewer.viewerId) { await viewer.retry(); return; }
    return query.refetch();
  };
  useEffect(() => { if (enabled) void refresh(); }, [enabled, owner]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      foreground.current = state === 'active'; update();
      if (foreground.current) void refresh();
    });
    return () => subscription.remove();
  }, [owner]);
  const confirmed = (layout: CommunityRoomIdentities) => {
    client.setQueryData(key, layout); owner.change = null;
    void client.invalidateQueries({ queryKey: ['community-chat-rows'] }).catch(() => {});
    void client.invalidateQueries({ queryKey: ['community-chat-cards'] }).catch(() => {});
  };
  const perform = async (change: Change) => {
    if (!current() || owner.busy || !viewer.viewerId) return;
    owner.busy = true; owner.notice = null; owner.change = { ...change, retryReady: false }; update();
    try {
      await client.cancelQueries({ queryKey: key, exact: true }, { revert: false });
      if (!current()) return;
      const result = await setOptionalRoomMembership(communityId, change.topicId, change.joined, scope);
      if (current()) { confirmed(result); return true; }
    } catch { /* Keep exact intended membership; never resubmit automatically. */ }
    finally { owner.busy = false; update(); }
  };
  const change = (topicId: string, joined: boolean) => {
    if (owner.change || owner.busy || !current()) return;
    return perform({ topicId, joined, retryReady: false });
  };
  const check = async () => {
    if (!current() || owner.busy || !owner.change) return;
    const change = owner.change; owner.busy = true; update();
    try {
      await client.cancelQueries({ queryKey: key, exact: true }, { revert: false });
      if (!current()) return;
      const layout = await requestWithDeadline(getCommunityRoomIdentities(communityId, scope), 12_000);
      if (!current()) return;
      if (!layout) throw Error('Community chats unavailable.');
      const room = layout.rooms.find(item => item.id === change.topicId && item.role === 'optional');
      if (!room) { confirmed(layout); owner.notice = 'This group is no longer available.'; return; }
      client.setQueryData(key, layout);
      if (room.joined === change.joined) confirmed(layout!);
      else owner.change = { ...change, retryReady: true };
    } catch { if (same()) owner.change = { ...change, retryReady: false }; }
    finally { owner.busy = false; update(); }
  };
  const retry = () => { if (owner.change?.retryReady) return perform(owner.change); };
  return { data: same() ? query.data : undefined, error: viewer.error ?? query.error, loading: viewer.isLoading || query.isLoading,
    fetching: query.isFetching, notice: owner.notice, busy: owner.busy, pending: owner.change, change, check, retry, refresh,
    ready: enabled && !!viewer.viewerId && !viewer.error && !viewer.isLoading && query.isSuccess && current(), isCurrent: current };
}
