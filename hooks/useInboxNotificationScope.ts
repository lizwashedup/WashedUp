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
  return useMemo(() => ({ userId, isCurrent: () => committed.current === visit && visible && !!userId && viewer.viewerId === userId && !viewer.isLoading && !viewer.error && viewer.isCurrent() }),
    [userId, visible, visit, viewer.viewerId, viewer.isLoading, viewer.error, viewer.isCurrent]);
}
