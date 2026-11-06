import { useQuery } from '@tanstack/react-query';
import { getFollowState, type FollowTarget } from '../lib/organizerFollows';
import { requestWithDeadline } from '../lib/requestWithDeadline';

/** Existing organizer follow state; independent of page follows or membership. */
export function useOrganizerFollowState(target: FollowTarget | null, userId: string | null, enabled: boolean, epoch = 0) {
  return useQuery({
    queryKey: ['organizer-follow', target?.kind, target?.id, userId, epoch],
    queryFn: () => requestWithDeadline(getFollowState(target!, userId!), 12_000),
    enabled: enabled && !!target && !!userId,
    staleTime: 30_000,
    retry: false,
  });
}
