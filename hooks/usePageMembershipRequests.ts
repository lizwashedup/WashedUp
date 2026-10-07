import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { membershipRequests as api, membershipDecisionStore as store } from '../lib/creatorMembershipRequests';
import type { MembershipScope, MembershipDecision, MembershipInbox, MembershipRequest } from '../lib/pageMembershipRequests';
export function usePageMembershipRequests(pageId: string, scope: MembershipScope | null) {
  type State = { scope: MembershipScope; pageId: string; inbox?: MembershipInbox; pending?: MembershipDecision; retry?: boolean; busy?: boolean; error?: string; message?: string };
  type Task = { active: boolean; owned: MembershipScope };
  const [state, setState] = useState<State>();
  const visit = useMemo(() => ({}), [scope, pageId]);
  const latest = useRef(visit); latest.current = visit;
  const mounted = useRef(false), foreground = useRef(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const lock = useRef<Task | null>(null);
  const active = state?.scope === scope && state?.pageId === pageId ? state : undefined;
  const current = () => mounted.current && foreground.current && latest.current === visit && !!scope?.isCurrent();
  const begin = () => {
    if (lock.current) lock.current.active = false;
    const task: Task = { active: true, owned: { userId: scope!.userId, isCurrent: () => current() && task.active && lock.current === task } };
    lock.current = task;
    return task;
  };
  const finish = (task: Task) => { task.active = false; if (lock.current === task) lock.current = null; };
  const load = useCallback(async () => {
    if (!current() || lock.current?.owned.isCurrent()) return;
    const task = begin(), owned = task.owned;
    setState(old => ({ ...(old?.scope === scope && old.pageId === pageId ? old : {}), scope: scope!, pageId, busy: true, error: undefined, retry: false }));
    try {
      await requestWithDeadline((async () => {
        const pending = await store.read(pageId, owned);
        if (!owned.isCurrent()) return;
        let unresolved = pending ?? undefined, retry = false, message: string | undefined, pendingRequest: MembershipRequest | undefined;
        if (pending) {
          setState(old => ({ ...old!, pending }));
          const saved = await api.read(pageId, owned, { memberId: pending.memberId });
          if (!owned.isCurrent()) return;
          const request = saved.requests[0];
          if (!request) message = 'This request is no longer available.';
          else if (request.status !== 'pending') message = request.status === 'active' ? 'This person is now a member.' : request.status === 'declined' ? 'This request is now declined.' : 'This request is no longer awaiting review.';
          else if (request.updatedAt !== pending.updatedAt) message = 'This request changed. Review the current answers before deciding.';
          else { retry = true; pendingRequest = request; message = 'This request is still pending. You can retry your saved decision.'; }
          if (!retry) {
            setState(old => ({ ...old!, message }));
            await store.clear(pending, owned);
            if (!owned.isCurrent()) return;
            unresolved = undefined;
          }
        }
        const inbox = await api.read(pageId, owned);
        if (!owned.isCurrent()) return;
        // An unresolved decision may be beyond the first page after returning.
        if (pendingRequest && !inbox.requests.some(r => r.memberId === pendingRequest!.memberId)) inbox.requests.unshift(pendingRequest);
        setState({ scope: scope!, pageId, inbox, pending: unresolved, retry, message, busy: false });
      })(), 12_000);
    } catch { if (owned.isCurrent()) setState(old => ({ ...old!, scope: scope!, pageId, busy: false, retry: false, error: 'Could not check requests. Your access may have changed. Try again.' })); }
    finally { finish(task); }
  }, [visit]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (lock.current) lock.current.active = false; }; }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', value => {
      foreground.current = value === 'active';
      if (!foreground.current && lock.current) {
        lock.current.active = false; lock.current = null;
        setState(old => old ? { ...old, busy: false, retry: false, error: 'Check requests when you return.' } : old);
      }
      if (foreground.current) void load();
    });
    return () => subscription.remove();
  }, [load]);
  const decide = async (decision: MembershipDecision) => {
    if (!current() || lock.current?.owned.isCurrent() || active?.error || active?.busy || !active?.inbox || decision.pageId !== pageId) return;
    const observed = active.inbox.requests.find(r => r.memberId === decision.memberId);
    if (!observed || observed.status !== 'pending' || observed.updatedAt !== decision.updatedAt) return;
    if (active.pending && (!active.retry || active.pending.memberId !== decision.memberId || active.pending.approve !== decision.approve || active.pending.updatedAt !== decision.updatedAt)) return;
    const task = begin(), owned = task.owned;
    let confirmed = false;
    setState(old => ({ ...old!, busy: true, pending: decision, retry: false, message: undefined }));
    try {
      await requestWithDeadline((async () => {
        await store.prepare(decision, owned);
        if (!owned.isCurrent()) return;
        await api.decide(decision, owned);
        if (!owned.isCurrent()) return;
        confirmed = true;
        setState(old => ({ ...old!, inbox: old?.inbox ? { ...old.inbox, requests: old.inbox.requests.filter(r => r.memberId !== decision.memberId) } : undefined,
          message: decision.approve ? 'This person is now a member.' : 'This request is now declined.' }));
        await store.clear(decision, owned);
        if (owned.isCurrent()) setState(old => ({ ...old!, pending: undefined, retry: false, busy: false }));
      })(), 25_000);
    } catch { if (owned.isCurrent()) setState(old => ({ ...old!, busy: false, pending: decision, retry: false,
      error: confirmed ? 'Your decision is saved. Check status to finish recovery.' : 'Your decision is unconfirmed. Check its status before continuing.' })); }
    finally { finish(task); }
  };
  const more = async () => {
    if (!current() || lock.current?.owned.isCurrent() || active?.busy || active?.error || active?.pending || !active?.inbox?.nextCursor) return;
    const cursor = active.inbox.nextCursor, task = begin(), owned = task.owned;
    setState(old => ({ ...old!, busy: true }));
    try {
      const next = await requestWithDeadline(api.read(pageId, owned, { afterId: cursor }), 12_000);
      if (owned.isCurrent()) setState(old => ({ ...old!, busy: false, inbox: { ...next, requests: [...(old?.inbox?.requests ?? []), ...next.requests].filter((r, i, rows) => rows.findIndex(x => x.memberId === r.memberId) === i) } }));
    } catch { if (owned.isCurrent()) setState(old => ({ ...old!, busy: false, error: 'Could not load more requests. Refresh to check the list.' })); }
    finally { finish(task); }
  };
  const clearMessage = () => {
    if (!current()) return;
    // A completed decision belongs to the previous review. Keep unresolved
    // status/recovery guidance intact when opening another request.
    setState(old => old?.scope === scope && old.pageId === pageId && !old.pending && !old.error && !old.busy
      ? { ...old, message: undefined } : old);
  };
  const choose = (request: MembershipRequest, approve: boolean): MembershipDecision => ({ pageId, memberId: request.memberId, updatedAt: request.updatedAt, approve });
  return { ...active, loading: !!scope && !active, ready: current() && !!active?.inbox && !active.busy && !active.error && !active.pending, load, decide, more, choose, clearMessage };
}
