import { getCreatorAccess, isAdminTierRole, type LedCommunity } from './creatorMode';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';
import { requestWithDeadline } from './requestWithDeadline';
import { mediaUUID } from './creatorPageEventMedia';
import { prepareCreatorSpace } from './creatorManagement';

export type LegacyEventCreateContext = { workspace: 'community' | 'organization'; community?: LedCommunity };
export async function resolveLegacyEventCreate(workspace: unknown, communityId: unknown, scope: CreatorPageScope): Promise<LegacyEventCreateContext> {
  if (!scope.isCurrent()) throw new CreatorPageScopeExpired();
  if (workspace !== 'community' && workspace !== 'organization' || workspace === 'community' && !mediaUUID(communityId)
    || workspace === 'organization' && communityId !== undefined) throw Error('Choose the community or organization creating this event.');
  const access = await requestWithDeadline(getCreatorAccess(scope.userId), 12_000);
  if (!scope.isCurrent()) throw new CreatorPageScopeExpired();
  if (workspace === 'organization') {
    if (!access.hasEventHostGrant) throw Error('Your organization’s event access is unavailable.');
    return { workspace };
  }
  const community = access.ledCommunities.find(item => item.id === communityId);
  if (!community || community.status !== 'active' || !(isAdminTierRole(community.role) || community.role === 'events')) {
    throw Error('This community is not available for event creation with your current access.');
  }
  return { workspace, community };
}
export async function prepareLegacyEventCreate(context: LegacyEventCreateContext, scope: CreatorPageScope) {
  const fresh = await resolveLegacyEventCreate(context.workspace, context.community?.id, scope);
  prepareCreatorSpace({ id: fresh.community?.id ?? 'organization', kind: fresh.workspace, name: fresh.community?.name ?? 'Your organization', route: '',
    legacy: { workspace: fresh.workspace, communityId: fresh.community?.id, status: fresh.community?.status ?? 'approved' } }, scope);
  return fresh;
}
