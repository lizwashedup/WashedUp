/** Resolve this community's existing creator destination; never infer page
 * ownership from a community role or treat a hidden publication as legacy. */
import { supabase } from './supabase';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';
import { getPageTeam, type PageTeamRoster } from './creatorPageTeam';
import { getCreatorAccess, isAdminTierRole, type LedCommunity } from './creatorMode';
import { mediaUUID } from './creatorPageEventMedia';
import { newCreatorEventRoute } from './creatorEventRoute';
import { managementRoute } from './managementNavigation';

export type CommunityManageEntry = { kind: 'page'; route: string } | { kind: 'legacy'; communityId: string; route: string };
const current = (scope: CreatorPageScope) => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };
async function authorization(scope: CreatorPageScope) {
  current(scope);
  const { data, error } = await supabase.auth.getSession(); current(scope);
  if (error) throw error;
  if (data.session?.user.id !== scope.userId || !data.session.access_token) throw new CreatorPageScopeExpired();
  return `Bearer ${data.session.access_token}`;
}
async function request<T>(scope: CreatorPageScope, make: () => PromiseLike<T> & { setHeader(name: string, value: string): PromiseLike<T> }): Promise<T> {
  const token = await authorization(scope);
  const result = await make().setHeader('Authorization', token); current(scope);
  return result;
}
async function publicationExists(id: string, scope: CreatorPageScope) {
  const result = await request(scope, () => supabase.from('creator_page_publications').select('page_id,page_kind').eq('page_id', id).maybeSingle());
  if (result.error) throw result.error;
  if (result.data && (result.data.page_id !== id || result.data.page_kind !== 'community')) throw Error('This community’s page could not be confirmed.');
  return !!result.data;
}
type CommunityCreatorContext = { kind: 'page'; owner: boolean; team?: PageTeamRoster } | { kind: 'legacy'; community: LedCommunity };
async function resolveContext(id: string, scope: CreatorPageScope, pagesEnabled: boolean): Promise<CommunityCreatorContext | null> {
  if (!mediaUUID(id)) throw Error('Check this community link.');
  await authorization(scope);
  if (pagesEnabled) {
    const owned = await request(scope, () => supabase.rpc('creator_page_is_owned', { p_page_id: id }));
    if (owned.error) throw owned.error;
    if (typeof owned.data !== 'boolean') throw Error('Page ownership could not be checked.');
    if (owned.data) return { kind: 'page', owner: true };
    try {
      const team = await getPageTeam(id, scope); await authorization(scope);
      if (team.pageId !== id || team.pageKind !== 'community') throw Error('This community’s team could not be confirmed.');
      return { kind: 'page', owner: false, team };
    } catch (error) {
      current(scope);
      // Only an explicit server denial is an ordinary non-creator result.
      if ((error as { code?: string })?.code !== '42501') throw error;
    }
    if (await publicationExists(id, scope)) return null;
    const visible = await request(scope, () => supabase.rpc('creator_community_is_visible', { p_community_id: id }));
    if (visible.error) throw visible.error;
    if (visible.data !== true) throw Error('This community’s creator context could not be confirmed.');
    // A publication may have become visible during the check. A known page
    // must not reopen the legacy editing surface after a permission denial.
    if (await publicationExists(id, scope)) return null;
  }
  const access = await getCreatorAccess(scope.userId); await authorization(scope);
  const community = access.ledCommunities.find(item => item.id === id);
  return community ? { kind: 'legacy', community } : null;
}

export async function resolveCommunityManageEntry(id: string, scope: CreatorPageScope, pagesEnabled: boolean): Promise<CommunityManageEntry | null> {
  const context = await resolveContext(id, scope, pagesEnabled);
  if (!context) return null;
  if (context.kind === 'page') return { kind: 'page', route: `/creator/${context.owner ? 'page' : 'page-team'}?id=${id}` };
  return isAdminTierRole(context.community.role) ? { kind: 'legacy', communityId: id, route: `${managementRoute('today')}?fromCommunityId=${id}` } : null;
}

export type CommunityCreatorAction = {
  key: 'event' | 'edit' | 'setup'; title: string; route: string; legacyCommunityId?: string;
};
/** Navigation only. The destination and server still enforce their own permissions.
 * A role on a different community never supplies these capabilities. */
export async function resolveCommunityCreatorActions(id: string, scope: CreatorPageScope, pagesEnabled: boolean): Promise<CommunityCreatorAction[]> {
  const context = await resolveContext(id, scope, pagesEnabled);
  if (!context) return [];
  if (context.kind === 'page') {
    if (!await publicationExists(id, scope)) return context.owner
      ? [{ key: 'setup', title: 'Continue setup', route: `/creator/page?id=${id}` }] : [];
    const permissions = context.team?.assignments.find(person => person.userId === scope.userId && person.available && !person.revokedAt)?.permissions ?? [];
    return [
      ...(context.owner || permissions.includes('page_events') ? [{ key: 'event' as const, title: 'Create event', route: `/creator/page-events?id=${id}&create=1` }] : []),
      ...(context.owner || permissions.includes('page_content') ? [{ key: 'edit' as const, title: 'Edit community', route: `/creator/page-edit?id=${id}&mode=approved&from=community` }] : []),
    ];
  }
  const { community } = context;
  const admin = isAdminTierRole(community.role);
  if (community.status === 'archived') return [];
  const action = (key: CommunityCreatorAction['key'], title: string, route: string): CommunityCreatorAction => ({ key, title, route, legacyCommunityId: id });
  return [
    ...(community.status === 'draft' && admin ? [action('setup', 'Continue setup', `${managementRoute('community')}?fromCommunityId=${id}`)] : []),
    ...(community.status === 'active' && (admin || community.role === 'events') ? [action('event', 'Create event', newCreatorEventRoute('community', id))] : []),
    ...(admin ? [action('edit', 'Edit community', `/creator/edit-page?communityId=${id}`)] : []),
  ];
}
