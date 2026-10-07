import { useQuery } from '@tanstack/react-query';
import { CREATOR_PAGES_ENABLED } from '../constants/FeatureFlags';
import { getDiscoverableCommunities } from '../lib/sceneDiscovery';
import { usePublicPageScope } from './usePublicPageScope';
export function useSceneCommunities() {
  const { scope, account } = usePublicPageScope('scene-communities');
  const identity = CREATOR_PAGES_ENABLED ? [account.epoch, account.viewerId] : [];
  const read = useQuery({
    queryKey: ['scene-communities', ...identity],
    queryFn: () => getDiscoverableCommunities(CREATOR_PAGES_ENABLED ? scope! : undefined),
    enabled: !CREATOR_PAGES_ENABLED || !!scope && scope.isCurrent(),
  });
  return {
    ...read, identity,
    data: CREATOR_PAGES_ENABLED && (!scope || !scope.isCurrent()) ? [] : read.data ?? [],
    isPending: CREATOR_PAGES_ENABLED && account.error ? false : read.isPending,
    isError: read.isError || (CREATOR_PAGES_ENABLED && !!account.error),
    error: CREATOR_PAGES_ENABLED && account.error ? account.error : read.error,
    refetch: () => CREATOR_PAGES_ENABLED && account.error ? account.retry() : read.refetch(),
  };
}
