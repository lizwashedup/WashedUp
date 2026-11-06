import { useQuery } from '@tanstack/react-query';
import type { useCreatorAccessRead } from './useCreatorAccessRead';
import { requestWithDeadline } from '../lib/requestWithDeadline';

/** Keep each dashboard read with the account and mounted reader that authorized it. */
export function useCreatorDashboardRead<T>(
  access: ReturnType<typeof useCreatorAccessRead>,
  key: readonly unknown[],
  read: (viewerId: string) => Promise<T>,
  enabled = true,
  staleTime = 0,
) {
  const { account, reader } = access;
  return useQuery({
    queryKey: [...key, account.viewerId, account.epoch, reader],
    enabled: enabled && !!access.data && !access.isError && !!account.viewerId && account.isCurrent(),
    staleTime,
    queryFn: async () => {
      if (!account.viewerId || !account.isCurrent()) throw new Error('Creator account changed.');
      const result = await requestWithDeadline(read(account.viewerId), 12_000);
      if (!account.isCurrent()) throw new Error('Creator account changed.');
      return result;
    },
  });
}
