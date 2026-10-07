import { useEffect, useMemo, useRef } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { useObservedUser } from './useObservedUser';
import type { PageImageScope } from '../lib/publishedPageCover';
/** Public browsing supports confirmed signed-out sessions, with the same account/visit retirement. */
export function usePublicPageScope(pageId: string) {
  const account = useObservedUser({ allowSignedOut: true }), focused = useIsFocused();
  const mounted = useRef(false);
  const visit = useMemo(() => ({}), [pageId, account.epoch, focused]);
  const latest = useRef(visit); latest.current = visit;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const scope = useMemo<PageImageScope | null>(() => account.viewerId !== undefined && !account.error && !account.isLoading ? {
    userId: account.viewerId, isCurrent: () => mounted.current && focused && latest.current === visit && account.isCurrent(),
  } : null, [account.viewerId, account.error, account.isLoading, account.isCurrent, focused, visit]);
  return { scope, account, focused };
}
