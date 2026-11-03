import { getCreatorAccess, isAdminTierRole, type CreatorAccess } from './creatorMode';
import { fetchMyGrants, type OperatorGrant } from './operatorApplications';
import { requestWithDeadline } from './requestWithDeadline';
import type { CreatorPageScope } from './creatorPageReview';

export type SceneCreationKind = 'event' | 'community';
export type CreationEntryData = { access: CreatorAccess; grants: OperatorGrant[] };
export type CreationDestination = {
  id: string; title: string; description: string; route: string;
  workspace: 'community' | 'organization'; communityId?: string;
};

export async function loadCreationEntry(scope: CreatorPageScope): Promise<CreationEntryData> {
  if (!scope.isCurrent()) throw new Error('Creation entry changed.');
  const [access, grants] = await requestWithDeadline(Promise.all([
    getCreatorAccess(scope.userId), fetchMyGrants(scope.userId),
  ]), 12_000);
  if (!scope.isCurrent()) throw new Error('Creation entry changed.');
  return { access, grants };
}

/** Every event choice uses that community's own role, never privileges from another. */
export function creationDestinations(kind: SceneCreationKind, access: CreatorAccess): CreationDestination[] {
  const destinations: CreationDestination[] = [];
  if (kind === 'event') {
    if (access.hasEventHostGrant) destinations.push({ id: 'organization', title: 'Your organization',
      description: 'Open your event tools to create an event under your public name or organization.', route: '/(creator)/events', workspace: 'organization' });
    for (const community of access.ledCommunities) {
      if (community.status !== 'active' || !(isAdminTierRole(community.role) || community.role === 'events')) continue;
      destinations.push({ id: community.id, title: community.name, description: 'Open this community’s event tools to create an event.',
        route: '/(creator)/events', workspace: 'community', communityId: community.id });
    }
  } else {
    if (access.hasLeaderGrant) destinations.push({ id: 'new-community', title: 'Start a community',
      description: 'Add its name, what brings people together, and how to join.', route: '/creator/setup-community', workspace: 'community' });
    for (const community of access.ledCommunities) {
      if (community.status === 'archived' || !isAdminTierRole(community.role)) continue;
      destinations.push({ id: community.id, title: community.name,
        description: community.status === 'draft' ? 'Continue setting up your community.' : 'Manage your community, its events and members.',
        route: '/(creator)/community', workspace: 'community', communityId: community.id });
    }
  }
  return destinations;
}
