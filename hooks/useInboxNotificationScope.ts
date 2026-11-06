import { useLayoutEffect, useMemo, useRef } from 'react';
import { useObservedUser } from './useObservedUser';

/** The existing inbox stays mounted between openings; every visible visit owns its callbacks. */
export function useInboxNotificationScope(userId: string | null, visible: boolean) {
  const viewer = useObservedUser();
  const visit = useMemo(() => ({}), [userId, visible, viewer.epoch, viewer.isCurrent]);
  const committed = useRef<object | null>(null);
  useLayoutEffect(() => {
    committed.current = visit;
    return () => { if (committed.current === visit) committed.current = null; };
  }, [visit]);
  const ready = !!userId && viewer.viewerId === userId && !viewer.isLoading && !viewer.error;
  const readOwner = useMemo(() => ({
    userId,
    isCurrent: () => ready && viewer.isCurrent(),
  }), [userId, ready, viewer.isCurrent]);
  const identityUnavailable = !viewer.isLoading && !ready;
  return useMemo(() => ({
    userId, epoch: viewer.epoch, ready, readOwner, identityUnavailable, retryIdentity: viewer.retry,
    isCurrent: () => committed.current === visit && visible && readOwner.isCurrent(),
  }), [userId, viewer.epoch, ready, readOwner, identityUnavailable, viewer.retry, visit, visible]);
}
