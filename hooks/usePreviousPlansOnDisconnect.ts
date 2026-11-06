import { useLayoutEffect, useRef } from 'react';
import type { QueryStatus } from '@tanstack/react-query';
import type { Plan } from '../lib/fetchPlans';
import { isTransportErrorMessage } from '../lib/friendlyError';

/** A failed refresh can keep the list already shown for this account and area. */
export function usePreviousPlansOnDisconnect(
  status: QueryStatus,
  rows: Plan[] | undefined,
  error: unknown,
  isCurrentAccount: () => boolean,
  area: string,
) {
  const confirmed = useRef<{ account: () => boolean; area: string; rows: Plan[] } | null>(null);
  const interrupted = status === 'error' && error instanceof Error && (
    isTransportErrorMessage(error.message) || /^feed timed out after \d+ms$/.test(error.message)
  );
  useLayoutEffect(() => {
    if (status === 'success' && rows && isCurrentAccount()) {
      confirmed.current = { account: isCurrentAccount, area, rows };
    } else if (!interrupted || confirmed.current?.account !== isCurrentAccount || confirmed.current.area !== area) {
      confirmed.current = null;
    }
  }, [status, rows, interrupted, isCurrentAccount, area]);
  return interrupted && !!rows?.length && isCurrentAccount()
    && confirmed.current?.account === isCurrentAccount && confirmed.current.area === area
    && confirmed.current.rows === rows;
}
