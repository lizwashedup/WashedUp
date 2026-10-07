import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { usePublicPageScope } from './usePublicPageScope';
import { loadEventMediaSource, type EventMediaKind, type ProtectedEventMediaSource } from '../lib/eventMediaSource';
import type { PageImageScope } from '../lib/publishedPageCover';

/** A private source belongs to one foreground visit/account. Returning always resolves again. */
export function useEventMediaSource(eventId: string, reference: string, kind: EventMediaKind) {
  const { scope: pageScope, account } = usePublicPageScope(`${eventId}:${kind}:${reference}`);
  const [foregroundVisit, setForegroundVisit] = useState({ active: AppState.currentState === 'active' });
  const foreground = foregroundVisit.active;
  const foregroundRef = useRef(foreground);
  const [retryId, setRetryId] = useState(0);
  useEffect(() => {
    const changed = (state: string) => { foregroundRef.current = state === 'active'; setForegroundVisit({ active: state === 'active' }); };
    const listener = AppState.addEventListener('change', changed);
    changed(AppState.currentState);
    return () => { foregroundRef.current = false; listener.remove(); };
  }, []);
  const scope = useMemo<PageImageScope | null>(() => pageScope && foreground ? {
    userId: pageScope.userId, isCurrent: () => foregroundRef.current && pageScope.isCurrent(),
  } : null, [pageScope, foregroundVisit, retryId]);
  const generation = useRef(0);
  const [state, setState] = useState<{ scope: PageImageScope; generation: number; source?: ProtectedEventMediaSource; error?: boolean }>();
  useEffect(() => {
    const request = ++generation.current;
    let alive = true;
    setState(undefined);
    void Promise.resolve().then(async () => {
      if (!alive || !scope?.isCurrent()) return;
      try {
        const source = await loadEventMediaSource(eventId, reference, kind, scope);
        if (alive && scope.isCurrent() && generation.current === request) setState({ scope, generation: request, source });
      } catch {
        if (alive && scope.isCurrent() && generation.current === request) setState({ scope, generation: request, error: true });
      }
    });
    return () => { alive = false; generation.current++; };
  }, [scope, eventId, reference, kind]);
  const visible = state?.scope === scope && scope?.isCurrent() ? state : undefined;
  const current = useCallback(() => !!visible && scope?.isCurrent() && generation.current === visible.generation, [scope, visible]);
  const fail = useCallback(() => {
    if (current() && visible) setState({ ...visible, generation: ++generation.current, source: undefined, error: true });
  }, [current, visible]);
  const retry = useCallback(() => {
    if (account.error) { void account.retry(); return; }
    if (foregroundRef.current && pageScope?.isCurrent()) { generation.current++; setRetryId(value => value + 1); }
  }, [account.error, account.retry, pageScope]);
  return { source: visible?.source, error: !!account.error || !!visible?.error, retry, fail, current, generation: visible?.generation };
}
