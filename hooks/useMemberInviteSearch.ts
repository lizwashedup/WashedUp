import { useEffect, useMemo, useRef, useState } from 'react';
import { searchProfilesForInvite, type ProfileSearchResult } from '../lib/coCreatorInvites';
import type { CreatorPageScope } from '../lib/creatorPageReview';
import { requestWithDeadline } from '../lib/requestWithDeadline';

/** Intentional handle lookup only. Results belong to one query, account and visit. */
export function useMemberInviteSearch(query: string, scope: CreatorPageScope, enabled: boolean) {
  const [retry, setRetry] = useState(0);
  const sequence = useRef(0);
  const [state, setState] = useState<{ request: object; results: ProfileSearchResult[]; error: boolean }>();
  const trimmed = query.trim();
  const active = enabled && trimmed.length >= 2;
  const request = useMemo(() => ({}), [trimmed, scope, active, retry]);
  useEffect(() => {
    const attempt = ++sequence.current;
    if (!active || !scope.isCurrent()) return;
    let alive = true;
    const timer = setTimeout(async () => {
      if (!alive || !scope.isCurrent()) return;
      try {
        const results = await requestWithDeadline(searchProfilesForInvite(trimmed, scope.userId, { throwOnError: true }), 12_000);
        if (alive && scope.isCurrent() && sequence.current === attempt) setState({ request, results, error: false });
      } catch {
        if (alive && scope.isCurrent() && sequence.current === attempt) setState({ request, results: [], error: true });
      }
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [trimmed, scope, active, request]);
  const current = active && scope.isCurrent() && state?.request === request;
  return { results: current ? state.results : [], error: current && state.error,
    loading: active && !current, retry: () => setRetry(value => value + 1) };
}
