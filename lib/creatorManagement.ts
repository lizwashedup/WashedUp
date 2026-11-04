import { loadCreatorSpaceEntry, loadLegacyCreatorSpaces, type CreatorSpaceLink, type CreatorSpaceEntry } from './creatorSpaceEntry';
import { getMyOrganizerProfile } from './organizerProfile';
import { fetchMyGrants } from './operatorApplications';
import { requestWithDeadline } from './requestWithDeadline';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';
import { setWorkspace } from './workspaceContext';
import { setSelectedCommunityId } from './selectedCommunity';

const current = (scope: CreatorPageScope) => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };

/** Optional identity text must belong to the same account as its management tools. */
export async function loadManagedOrganizationName(scope: CreatorPageScope): Promise<string | null> {
  current(scope);
  try {
    const profile = await requestWithDeadline(getMyOrganizerProfile(), 3_000);
    current(scope);
    return profile?.user_id === scope.userId && profile.display_name.trim() ? profile.display_name.trim() : null;
  } catch { current(scope); return null; }
}

/** Existing creators do not need the new page backend to find their tools. */
export async function loadManagedSpaces(scope: CreatorPageScope, pagesEnabled: boolean) {
  current(scope);
  const entry = await requestWithDeadline<Pick<CreatorSpaceEntry, 'spaces' | 'invitations'>>(pagesEnabled ? loadCreatorSpaceEntry(scope)
    : loadLegacyCreatorSpaces(scope).then(spaces => ({ spaces, invitations: [] })), 12_000);
  current(scope);
  if (entry.spaces.some(space => space.legacy?.workspace === 'organization')) {
    // A missing optional display name must not hide confirmed management access.
    const name = await loadManagedOrganizationName(scope);
    if (name) entry.spaces = entry.spaces.map(space => space.legacy?.workspace === 'organization' ? { ...space, name } : space);
  }
  return entry;
}

export async function loadManagedApplications(scope: CreatorPageScope) {
  current(scope);
  const grants = await requestWithDeadline(fetchMyGrants(scope.userId), 12_000);
  current(scope);
  return grants.filter(grant => grant.status !== 'approved' && grant.status !== 'withdrawn');
}

export function managedSpaceStatus(space: CreatorSpaceLink): string {
  const kind = space.kind === 'community' ? 'Community' : 'Organization';
  if (!space.legacy) return `${kind} · ${space.detail ?? 'Manage'}`;
  if (space.legacy.status === 'archived') return `${kind} · Archived`;
  if (space.legacy.status === 'draft') return `${kind} · Continue setup`;
  if (space.kind === 'community' && !space.legacy.communityId) return 'Approved · Set up your community';
  return `${kind} · Manage`;
}

/** Call only with a freshly authorized destination; clear the other identity. */
export function prepareCreatorSpace(space: CreatorSpaceLink, scope: CreatorPageScope) {
  current(scope);
  if (space.legacy) {
    setWorkspace(space.legacy.workspace);
    setSelectedCommunityId(space.legacy.communityId ?? null);
  }
}
