import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ObservedUser } from './useObservedUser';
import type { CommunityOperationScope } from '../lib/communityChat';
import { getCommunityChatPreference, setCommunityChatPreference, type CommunityChatPreference } from '../lib/communityChatPreference';
import { requestWithDeadline, RequestDeadlineError } from '../lib/requestWithDeadline';

type Pending = { observed: CommunityChatPreference; desired: boolean; retryReady: boolean };
/** Parent override only. Reads reconcile uncertain saves; only an explicit
 * action submits a desired state with its freshly observed version. */
export function useCommunityChatPreference(communityId: string, viewer: ObservedUser, enabled: boolean) {
  const client = useQueryClient(), mounted = useRef(false), active = useRef(enabled);
  const visit = useRef(0);
  if (active.current !== enabled) visit.current++;
  active.current = enabled;
  const foreground = useRef(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const owner = useMemo(() => ({ busy: false, pending: null as Pending | null, notice: null as string | null }), [communityId, viewer.viewerId, viewer.epoch]);
  const currentOwner = useRef(owner); currentOwner.current = owner;
  const [, render] = useState(0);
  const same = () => mounted.current && currentOwner.current === owner && viewer.isCurrent();
  const current = () => same() && active.current && foreground.current;
  const scope = useMemo(() => ({ userId: viewer.viewerId ?? '', isCurrent: current }), [owner]);
  // Bound authentication and the request together. A departed visit or expired
  // attempt cannot become current again merely because the screen reopens.
  const request = async <T,>(work: (attempt: CommunityOperationScope) => Promise<T>, milliseconds: number, eligible = current): Promise<T> => {
    let pending = true;
    const startedVisit = visit.current;
    const attempt = { userId: scope.userId, isCurrent: () => pending && visit.current === startedVisit && eligible() };
    try {
      const value = await requestWithDeadline(work(attempt), milliseconds);
      if (!attempt.isCurrent()) throw Error('This community visit has ended.');
      return value;
    } finally { pending = false; }
  };
  const key = useMemo(() => ['community-chat-preference', communityId, viewer.viewerId, viewer.epoch], [owner]);
  const update = () => { if (same()) render(n => n + 1); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => () => { void client.cancelQueries({ queryKey: key, exact: true }).catch(() => {}); }, [owner, client]);
  const query = useQuery({ queryKey: key, enabled: enabled && !!viewer.viewerId && !viewer.error && !viewer.isLoading && !owner.busy && !owner.pending,
    queryFn: ({ signal }) => request(attempt => getCommunityChatPreference(communityId, attempt), 12_000,
      () => current() && !signal.aborted && !owner.busy && !owner.pending),
    retry: (count, error) => !(error instanceof RequestDeadlineError) && current() && !owner.busy && !owner.pending && count < 1, staleTime: 30_000,
  });
  const confirm = (value: CommunityChatPreference) => {
    // A confirmed account/page receipt also updates other mounted visits. This
    // seeds pending queries before invalidation so their older in-flight reads
    // are cancelled rather than replacing the saved setting after it arrives.
    client.setQueriesData({ queryKey: ['community-chat-preference', communityId, viewer.viewerId] }, value);
    client.setQueryData(key, value); owner.pending = null;
    void client.invalidateQueries({ queryKey: ['community-chat-preference', communityId, viewer.viewerId], exact: false }).catch(() => {});
    void client.invalidateQueries({ queryKey: ['community-chat-rows'] }).catch(() => {});
    owner.notice = value.muted ? 'All community chats muted. Unread messages stay here.' : 'Community chats unmuted. Your individual chat choices are unchanged.';
  };
  const check = async () => {
    if (!current() || owner.busy || !owner.pending) return;
    const pending = owner.pending; owner.busy = true; update();
    try {
      const latest = await request(async attempt => {
        await client.cancelQueries({ queryKey: key, exact: true }, { revert: false });
        if (!attempt.isCurrent()) throw Error('This community visit has ended.');
        return getCommunityChatPreference(communityId, attempt);
      }, 12_000); if (!current()) return;
      client.setQueryData(key, latest);
      if (latest.muted === pending.desired) confirm(latest);
      else owner.pending = { ...pending, observed: latest, retryReady: true };
    } catch { if (same()) owner.pending = { ...pending, retryReady: false }; }
    finally { owner.busy = false; update(); }
  };
  const refresh = async () => {
    if (!current() || owner.busy) return;
    if (viewer.error || !viewer.viewerId) { await viewer.retry(); return; }
    if (owner.pending) return check();
    return query.refetch();
  };
  useEffect(() => { if (enabled) void refresh(); }, [enabled, owner]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') visit.current++;
      foreground.current = state === 'active'; update();
      if (foreground.current) void refresh();
    });
    return () => subscription.remove();
  }, [owner]);
  const perform = async (pending: Pending) => {
    if (!current() || owner.busy || !viewer.viewerId) return;
    owner.busy = true; owner.pending = { ...pending, retryReady: false }; owner.notice = null; update();
    try {
      const value = await request(async attempt => {
        await client.cancelQueries({ queryKey: key, exact: true }, { revert: false });
        if (!attempt.isCurrent()) throw Error('This community visit has ended.');
        return setCommunityChatPreference(pending.observed, pending.desired, attempt);
      }, 25_000);
      if (current()) confirm(value);
    } catch { /* Preserve exact intent; checking is read-only and retry explicit. */ }
    finally { owner.busy = false; update(); }
  };
  const change = (desired: boolean) => {
    if (!current() || owner.busy || owner.pending || query.isFetching || query.isError || !query.data) return;
    return perform({ observed: query.data, desired, retryReady: false });
  };
  const retry = () => { if (owner.pending?.retryReady) return perform(owner.pending); };
  return { data: same() ? query.data : undefined, error: viewer.error ?? query.error,
    loading: viewer.isLoading || query.isLoading, fetching: query.isFetching, busy: owner.busy,
    pending: owner.pending, notice: owner.notice, change, check, retry, refresh,
    ready: enabled && !!viewer.viewerId && !viewer.error && !viewer.isLoading && query.isSuccess && !query.isFetching && !owner.busy && current() };
}
