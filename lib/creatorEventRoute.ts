import type { CreatorAccess, LedCommunity } from './creatorMode';

// Matches the existing community event writer. Page-team events have their own authorization.
export function canCreateLegacyCommunityEvent(
  access: CreatorAccess | null | undefined,
  community: LedCommunity | null | undefined,
): boolean {
  if (!access || !community || community.status !== 'active') return false;
  const leadsCommunity = community.role === 'leader' || community.role === 'co_leader';
  return leadsCommunity && (access.hasLeaderGrant || access.hasEventHostGrant);
}

export function newCreatorEventRoute(workspace: 'community' | 'organization', communityId?: string) {
  return workspace === 'community' ? '/creator/event-form?workspace=community&communityId=' + encodeURIComponent(communityId ?? '')
    : '/creator/event-form?workspace=organization';
}
