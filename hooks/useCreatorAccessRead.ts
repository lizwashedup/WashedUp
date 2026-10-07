import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCreatorAccess } from '../lib/creatorMode';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { useObservedUser } from './useObservedUser';

/** Entry access is fresh and account-owned; a cached denial must not undo a new approval. */
export function useCreatorAccessRead() {
  const account = useObservedUser();
  const reader = useId();
  const ready = !account.isLoading && !account.error && account.viewerId !== undefined;
  const read = useQuery({
    // Separate mounted readers so one reader's retirement cannot invalidate another's request.
    // Keep the existing prefix so creation and view-as invalidation still refresh this read.
    queryKey: ['creator-access', account.viewerId, account.epoch, reader],
    enabled: ready,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      if (!account.isCurrent()) throw new Error('Creator account changed.');
      const access = account.viewerId
        ? await requestWithDeadline(getCreatorAccess(account.viewerId), 12_000)
        : { ledCommunities: [], hasLeaderGrant: false, hasEventHostGrant: false, isRevoked: false };
      if (!account.isCurrent()) throw new Error('Creator account changed.');
      return access;
    },
  });
  const current = ready && account.isCurrent();
  return {
    data: current && read.isFetchedAfterMount ? read.data : undefined,
    isLoading: account.isLoading || (!account.error && (!current || !read.isFetchedAfterMount)),
    isError: !!account.error || (current && read.isError),
    isFetching: account.isLoading || read.isFetching,
    refetch: account.error ? account.retry : read.refetch,
  };
}
