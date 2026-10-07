import { getCreatorAccess, creatorLandingRoute, type CreatorAccess } from './creatorMode';
import { requestWithDeadline } from './requestWithDeadline';
import { listCreatorPages } from './creatorPageWorkspace';
import { listLocalPageEditors } from './creatorPageEditor';
import { listMyPageTeamInvitations, type PageTeamInvitation } from './creatorPageTeam';
import { CreatorPageScopeExpired, type CreatorPageScope, type CreatorPageKind } from './creatorPageReview';

export interface CreatorSpaceLink { id: string; kind: CreatorPageKind; name: string; route: string; legacy?: { workspace: 'community' | 'organization'; communityId?: string; status: string }; }
export interface CreatorSpaceEntry { title: string; subtitle: string; route: string; spaces: CreatorSpaceLink[]; invitations: PageTeamInvitation[]; }
export function creatorSpaceTitle(kinds: CreatorPageKind[]): string {
  if (!kinds.length || new Set(kinds).size > 1) return 'Creator space';
  return kinds[0] === 'community' ? kinds.length === 1 ? 'Your community' : 'Your communities'
    : kinds.length === 1 ? 'Your organization' : 'Your organizations';
}
export const activePageTeam = (invitation: PageTeamInvitation) => invitation.status === 'accepted'
  && !invitation.accessRevokedAt && !!invitation.currentPermissions?.length;
const name = (value: unknown, kind: CreatorPageKind) => typeof value === 'string' && value.trim() ? value.trim() : kind === 'community' ? 'Community draft' : 'Organization draft';


/** Retain existing approvals and memberships without importing or publishing page records. */
export function legacyCreatorSpaceLinks(access: CreatorAccess): CreatorSpaceLink[] {
  const spaces: CreatorSpaceLink[] = access.ledCommunities.map(community => ({
    id: community.id, kind: 'community', name: community.name,
    // Route by this community’s actual tier, not a stronger role held elsewhere.
    route: creatorLandingRoute({ ...access, ledCommunities: [community], hasLeaderGrant: false, hasEventHostGrant: false }),
    legacy: { workspace: 'community', communityId: community.id, status: community.status },
  }));
  if (access.hasLeaderGrant && !access.ledCommunities.length) spaces.push({
    id: 'legacy-community-approval', kind: 'community', name: 'Your community', route: '/(creator)/today',
    legacy: { workspace: 'community', status: 'approved' },
  });
  if (access.hasEventHostGrant) spaces.push({
    id: 'legacy-organizer-approval', kind: 'organization', name: 'Your events', route: '/(creator)/organizer-home',
    legacy: { workspace: 'organization', status: 'approved' },
  });
  return spaces;
}
export async function loadLegacyCreatorSpaces(scope: CreatorPageScope): Promise<CreatorSpaceLink[]> {
  if (!scope.isCurrent()) throw new CreatorPageScopeExpired();
  const access = await requestWithDeadline(getCreatorAccess(scope.userId), 12_000);
  if (!scope.isCurrent()) throw new CreatorPageScopeExpired();
  return legacyCreatorSpaceLinks(access);
}

/** Read existing records only. This shortcut never grants access; each destination rechecks it. */
export async function loadCreatorSpaceEntry(scope: CreatorPageScope): Promise<CreatorSpaceEntry> {
  if (!scope.isCurrent()) throw new CreatorPageScopeExpired();
  const [saved, local, invitations, legacy] = await Promise.all([
    listCreatorPages(scope), listLocalPageEditors(scope), listMyPageTeamInvitations(scope), loadLegacyCreatorSpaces(scope),
  ]);
  if (!scope.isCurrent()) throw new CreatorPageScopeExpired();
  const spaces: CreatorSpaceLink[] = saved.map(p => ({ id:p.id, kind:p.page_kind, name:name(p.page_data.name,p.page_kind), route:`/creator/page?id=${p.id}` }));
  const seen=new Set(spaces.map(p=>p.id));
  for (const p of invitations) {
    if (!activePageTeam(p) || seen.has(p.pageId)) continue;
    seen.add(p.pageId);spaces.push({id:p.pageId,kind:p.pageKind,name:p.pageName,route:`/creator/page-team?id=${p.pageId}`});
  }
  for (const p of local) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);spaces.push({id:p.id,kind:p.kind,name:name(p.pageData.name,p.kind),route:`/creator/page-edit?id=${p.id}`});
  }
  for (const space of legacy) {
    if (seen.has(space.id)) continue;
    seen.add(space.id);spaces.push(space);
  }
  const pending=invitations.filter(p=>p.status==='pending' && Date.parse(p.expiresAt)>Date.now());
  return { spaces, invitations:pending, title:creatorSpaceTitle(spaces.map(p=>p.kind)),
    subtitle:spaces.length===1?spaces[0].name:spaces.length>1?spaces.slice(0,2).map(p=>p.name).join(' · ')+(spaces.length>2?` +${spaces.length-2} more`:''):'Communities, organizations and invitations',
    route:spaces.length===1&&!spaces[0].legacy?spaces[0].route:'/creator/pages',
  };
}
