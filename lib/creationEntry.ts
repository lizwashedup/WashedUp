import { newCreatorEventRoute } from './creatorEventRoute';
import { getCreatorAccess, isAdminTierRole, type CreatorAccess } from './creatorMode';
import { fetchMyGrants, type OperatorGrant } from './operatorApplications';
import { requestWithDeadline } from './requestWithDeadline';
import type { CreatorPageScope } from './creatorPageReview';
import { managementRoute } from './managementNavigation';

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

/** Resume the existing page; a draft is not yet an event-creation identity. */
export function communitySetupDestinations(access: CreatorAccess): CreationDestination[] {
  return access.ledCommunities
    .filter(community => community.status === 'draft' && isAdminTierRole(community.role))
    .map(community => ({
      id: community.id, title: community.name,
      description: 'Finish and publish this community’s page before creating its first event.',
      route: managementRoute('community'), workspace: 'community', communityId: community.id,
    }));
}

/** Every event choice uses that community's own role, never privileges from another. */
export function creationDestinations(kind: SceneCreationKind, access: CreatorAccess): CreationDestination[] {
  const destinations: CreationDestination[] = [];
  if (kind === 'event') {
    if (access.hasEventHostGrant) destinations.push({ id: 'organization', title: 'Your organization',
      description: 'Create an event under your public name or organization.', route: newCreatorEventRoute('organization'), workspace: 'organization' });
    for (const community of access.ledCommunities) {
      if (community.status !== 'active' || !(isAdminTierRole(community.role) || community.role === 'events')) continue;
      destinations.push({ id: community.id, title: community.name, description: 'Create an event for this community.',
        route: newCreatorEventRoute('community', community.id), workspace: 'community', communityId: community.id });
    }
  } else {
    if (access.hasLeaderGrant) destinations.push({ id: 'new-community', title: 'Start a community',
      description: 'Add its name, what brings people together, and how to join.', route: '/creator/setup-community', workspace: 'community' });
    for (const community of access.ledCommunities) {
      if (community.status === 'archived' || !isAdminTierRole(community.role)) continue;
      destinations.push({ id: community.id, title: community.name,
        description: community.status === 'draft' ? 'Continue setting up your community.' : 'Manage your community, its events and members.',
        route: managementRoute(community.status === 'draft' ? 'community' : 'today'), workspace: 'community', communityId: community.id });
    }
  }
  return destinations;
}
