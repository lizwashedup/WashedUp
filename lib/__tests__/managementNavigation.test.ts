import { legacyManagementDestination, managementAccess, managementRoute, MANAGEMENT_HOME } from '../managementNavigation';
import type { CreatorAccess, LedCommunity } from '../creatorMode';

const community = (role: LedCommunity['role']): LedCommunity => ({ id: 'selected', name: 'Sunset Club', handle: 'sunset', status: 'active', role });
const access = (overrides: Partial<CreatorAccess> = {}): CreatorAccess => ({ ledCommunities: [], hasLeaderGrant: false, hasEventHostGrant: false, isRevoked: false, ...overrides });

it('preserves an old event link’s draft filter while moving it under Yours', () => {
  expect(legacyManagementDestination(['(creator)', 'events'], { section: 'drafts' })).toEqual({ pathname: managementRoute('events'), params: { section: 'drafts' } });
});
it('returns an unknown old management destination to the directory', () => {
  expect(legacyManagementDestination(['(creator)', 'unknown'], {}).pathname).toBe(MANAGEMENT_HOME);
});
it.each(['leader', 'co_leader', 'admin'] as const)('keeps all existing daily tools for a selected %s', role => {
  const selected = community(role);
  expect(managementAccess(access({ ledCommunities: [selected] }), 'community', selected).screens).toEqual(expect.arrayContaining(['today', 'members', 'events', 'community', 'updates', 'menu']));
});
it.each([
  ['events', 'events', ['events', 'menu']],
  ['member_care', 'members', ['members', 'menu']],
  ['finance', 'menu', ['menu']],
] as const)('keeps a %s collaborator’s tools scoped even with admin access elsewhere', (role, home, screens) => {
  const selected = community(role);
  const result = managementAccess(access({ ledCommunities: [selected, { ...community('leader'), id: 'other' }], hasLeaderGrant: true, hasEventHostGrant: true }), 'community', selected);
  expect(result.home).toBe(managementRoute(home)); expect(result.screens).toEqual(screens);
});
it('keeps organization tools separate from community membership', () => {
  const selected = community('leader');
  const result = managementAccess(access({ hasEventHostGrant: true, ledCommunities: [selected] }), 'organization', selected);
  expect(result.home).toBe(managementRoute('organizer-home'));
  expect(result.screens).toEqual(['organizer-home', 'events', 'menu', 'organizer-broadcast']);
});
it('does not admit community approval to organization tools', () => {
  expect(managementAccess(access({ hasLeaderGrant: true }), 'organization', null).screens).toEqual([]);
});
it('keeps approved first-community setup reachable without inventing a community', () => {
  expect(managementAccess(access({ hasLeaderGrant: true }), 'community', null)).toEqual({ home: managementRoute('today'), screens: ['today'] });
});
