/** Resolve this community's existing creator destination; never infer page
 * ownership from a community role or treat a hidden publication as legacy. */
import { supabase } from './supabase';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';
import { getPageTeam } from './creatorPageTeam';
import { getCreatorAccess, isAdminTierRole } from './creatorMode';
import { mediaUUID } from './creatorPageEventMedia';

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
export async function resolveCommunityManageEntry(id: string, scope: CreatorPageScope, pagesEnabled: boolean): Promise<CommunityManageEntry | null> {
  if (!mediaUUID(id)) throw Error('Check this community link.');
  await authorization(scope);
  if (pagesEnabled) {
    const owned = await request(scope, () => supabase.rpc('creator_page_is_owned', { p_page_id: id }));
    if (owned.error) throw owned.error;
    if (typeof owned.data !== 'boolean') throw Error('Page ownership could not be checked.');
    if (owned.data) return { kind: 'page', route: `/creator/page?id=${id}` };
    try {
      const team = await getPageTeam(id, scope); await authorization(scope);
      if (team.pageId !== id || team.pageKind !== 'community') throw Error('This community’s team could not be confirmed.');
      return { kind: 'page', route: `/creator/page-team?id=${id}` };
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
  const access = await getCreatorAccess(); await authorization(scope);
  const community = access.ledCommunities.find(item => item.id === id);
  if (!community || !isAdminTierRole(community.role)) return null;
  return { kind: 'legacy', communityId: id, route: '/(creator)/community' };
}
