import { useCallback, useRef } from 'react';

/**
 * Atomic submit-once guard for async handlers.
 *
 * `loading` state alone is not enough: setState is async, so a fast
 * double-tap can fire two handlers in the same tick before the disabled
 * prop ever flips. This hook gives every handler a synchronous ref check.
 *
 * Usage:
 *   const submit = useSubmitGuard();
 *   const handler = async () => {
 *     if (!submit.tryAcquire()) return;
 *     try { ...await work... } finally { submit.release(); }
 *   };
 */
export function useSubmitGuard() {
  const ref = useRef(false);

  const tryAcquire = useCallback(() => {
    if (ref.current) return false;
    ref.current = true;
    return true;
  }, []);

  const release = useCallback(() => {
    ref.current = false;
  }, []);

  return { tryAcquire, release };
}
