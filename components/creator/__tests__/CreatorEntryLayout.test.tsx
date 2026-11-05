import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
let mockPagesEnabled = true;
let mockQuery: any, mockWorkspace = 'community', mockScreen = 'today';
const mockRetry = jest.fn();
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('expo-router', () => ({
  Stack: (props: any) => require('react').createElement('ManagementStack', props),
  Redirect: (props: any) => require('react').createElement('RouteRedirect', props),
  useSegments: () => ['(tabs)', 'friends', 'manage', '(tools)', mockScreen],
  useGlobalSearchParams: () => ({}), router: { replace: jest.fn() },
}));
jest.mock('../../../hooks/useCreatorAccessRead', () => ({ useCreatorAccessRead: () => mockQuery }));
jest.mock('../../../hooks/useCreatorPageScope', () => ({ useCreatorPageScope: () => ({ scope: null }) }));
jest.mock('../../../hooks/useCreatorPageRead', () => ({ useCreatorPageRead: () => ({ data: undefined }) }));
jest.mock('../CreatorScreenHeader', () => ({ CreatorScreenHeader: () => null }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock('../../../constants/FeatureFlags', () => ({ COMMUNITIES_ENABLED: true, get CREATOR_PAGES_ENABLED() { return mockPagesEnabled; } }));
jest.mock('../../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../../lib/selectedCommunity', () => ({ hydrateSelectedCommunity: jest.fn(), useLedCommunity: (value: any) => value?.ledCommunities?.[0] ?? null }));
jest.mock('../../../lib/workspaceContext', () => ({ hydrateWorkspace: jest.fn(), useWorkspace: () => mockWorkspace }));
jest.mock('../../../lib/viewAs', () => ({ useViewAsEventHost: () => false, setViewAsEventHost: jest.fn() }));
import Layout from '../ManagementLayout';
import LegacyRedirect from '../../../app/(creator)/_layout';
let tree: ReactTestRenderer;
const access = (extra = {}) => ({ ledCommunities: [], hasLeaderGrant: false, hasEventHostGrant: false, isRevoked: false, ...extra });
function mount() { act(() => { tree = create(<Layout />); }); }
const stacks = () => tree.root.findAllByType('ManagementStack' as any);
const redirects = () => tree.root.findAllByType('RouteRedirect' as any);
beforeEach(() => {
  mockPagesEnabled = true; mockWorkspace = 'community'; mockScreen = 'today'; mockRetry.mockReset();
  mockQuery = { data: access(), isLoading: false, isError: false, isFetching: false, refetch: mockRetry };
});
afterEach(() => act(() => tree?.unmount()));
it('waits for entitlement instead of redirecting an unknown account', () => {
  mockQuery = { ...mockQuery, data: undefined, isLoading: true }; mount();
  expect(redirects()).toHaveLength(0); expect(stacks()).toHaveLength(0);
});
it('allows an existing live community creator through without a redirect loop', () => {
  mockQuery.data = access({ ledCommunities: [{ id: 'live', role: 'leader', status: 'active' }] }); mount();
  expect(redirects()).toHaveLength(0); expect(stacks()).toHaveLength(1);
  mockScreen = 'community'; act(() => tree.update(<Layout />));
  expect(redirects()).toHaveLength(0); expect(stacks()).toHaveLength(1);
});
it('retains approved organization access while rejecting community-only destinations', () => {
  mockQuery.data = access({ hasEventHostGrant: true }); mockWorkspace = 'organization'; mockScreen = 'organizer-home'; mount();
  expect(redirects()).toHaveLength(0); expect(stacks()).toHaveLength(1);
  mockScreen = 'community'; act(() => tree.update(<Layout />));
  expect(stacks()).toHaveLength(0); expect(redirects()[0].props.href).toBe('/(tabs)/friends/manage/(tools)/organizer-home');
});
it('does not grant management tools to new-page-only or unapproved users', () => {
  mount(); expect(redirects()[0].props.href).toBe('/(tabs)/friends/manage'); expect(stacks()).toHaveLength(0);
});
it('keeps failed access separate from denial and exposes retry', () => {
  mockQuery = { ...mockQuery, data: undefined, isError: true }; mount();
  expect(redirects()).toHaveLength(0); expect(stacks()).toHaveLength(0);
  const retry = tree.root.findAll(p => p.props.accessibilityLabel === 'Retry creator access' && typeof p.props.onPress === 'function')[0];
  act(() => retry.props.onPress()); expect(mockRetry).toHaveBeenCalledTimes(1);
});
it('keeps revocation visible instead of treating it as a new applicant', () => {
  mockQuery.data = access({ isRevoked: true }); mount();
  expect(redirects()).toHaveLength(0); expect(stacks()).toHaveLength(0); expect(JSON.stringify(tree.toJSON())).toMatch(/paused|revoked/i);
});
it('keeps the same safe management directory for unapproved accounts when new pages are disabled', () => {
  mockPagesEnabled = false; mount(); expect(redirects()[0].props.href).toBe('/(tabs)/friends/manage'); expect(stacks()).toHaveLength(0);
});
it('keeps old creator links as redirects rather than a second privileged shell', () => {
  mockScreen = 'events'; act(() => { tree = create(<LegacyRedirect />); });
  expect(redirects()[0].props.href).toEqual({ pathname: '/(tabs)/friends/manage/(tools)/events', params: {} });
  expect(stacks()).toHaveLength(0);
});
