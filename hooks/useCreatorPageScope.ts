import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { useObservedUser } from './useObservedUser';
import type { CreatorPageScope } from '../lib/creatorPageReview';

/** Reuses the account observer; retires callbacks on blur, account or page change. */
export function useCreatorPageScope(pageId: string) {
  const account = useObservedUser();
  const focused = useIsFocused();
  const mounted = useRef(false);
  const visit = useMemo(() => ({}), [pageId, account.epoch, focused]);
  const latest = useRef(visit);
  // A speculative page render must not retire the still-visible visit.
  // account.isCurrent() independently invalidates auth changes synchronously.
  useLayoutEffect(() => { latest.current = visit; }, [visit]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const scope = useMemo<CreatorPageScope | null>(() => account.viewerId ? {
    userId: account.viewerId,
    isCurrent: () => mounted.current && focused && latest.current === visit && account.isCurrent(),
  } : null, [account.viewerId, account.isCurrent, focused, visit]);
  return { scope, account, focused };
}
