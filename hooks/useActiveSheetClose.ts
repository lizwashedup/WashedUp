import { useCallback, useRef } from 'react';

export type RegisterSheetClose = (close: () => void) => () => void;

/** A stable native sheet delegates dismissal to its current account contents.
 * Retired cleanup cannot remove a replacement visit's handler. */
export function useActiveSheetClose(visitId: string | number) {
  const currentVisit = useRef(visitId); currentVisit.current = visitId;
  const active = useRef<{ visitId: string | number; close: () => void } | null>(null);
  const registerClose = useCallback<RegisterSheetClose>(close => {
    const owner = { visitId, close }; active.current = owner;
    return () => { if (active.current === owner) active.current = null; };
  }, [visitId]);
  const closeCurrent = useCallback(() => {
    const owner = active.current;
    if (owner?.visitId === currentVisit.current) owner.close();
  }, []);
  return { registerClose, closeCurrent };
}
