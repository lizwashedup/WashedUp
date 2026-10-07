import { useCallback } from 'react';
import { useCreatorPageScope } from './useCreatorPageScope';
import { useCreatorPageRead } from './useCreatorPageRead';
import { fetchMyGrants } from '../lib/operatorApplications';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import type { CreatorPageScope } from '../lib/creatorPageReview';

/** Application decisions belong to the current account and focused visit, never a global cache. */
export function useCreatorApplicationStatus() {
  const { scope, account } = useCreatorPageScope('creator-applications');
  const read = useCallback((owner: CreatorPageScope) => requestWithDeadline(fetchMyGrants(owner.userId), 12_000), []);
  const status = useCreatorPageRead(account.error || account.isLoading ? null : scope, read);
  return { grants: status.data ?? [], isLoading: account.isLoading || status.loading,
    error: account.error || status.error, signedOut: !account.isLoading && !account.error && account.viewerId === null,
    refresh: account.error ? account.retry : status.refresh, current: () => !!scope?.isCurrent() && !account.error && !account.isLoading };
}
