import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text, View } from 'react-native';
import { CreationStartScreen } from '../start';
import { PageAction } from '../../../components/creator/pages/PageFrame';

const mockPush = jest.fn(), mockWorkspace = jest.fn(), mockCommunity = jest.fn(), mockRefresh = jest.fn();
let mockCurrent = true, mockLoading = false, mockError: string | undefined, mockPages = false;
const mockScope = { userId: 'creator', isCurrent: () => mockCurrent };
const mockEmpty = { ledCommunities: [], hasLeaderGrant: false, hasEventHostGrant: false, isRevoked: false };
let mockData: any;
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) }, Redirect: () => null, useLocalSearchParams: () => ({}) }));
jest.mock('../../../components/creator/pages/PageFrame', () => ({
  PageFrame: ({ children }: any) => require('react').createElement(require('react-native').View, {}, children),
  PageAction: () => null,
}));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').CreatorFonts }) }));
jest.mock('../../../hooks/useCreatorPageScope', () => ({ useCreatorPageScope: () => ({ scope: mockScope, account: { viewerId: 'creator', isLoading: false, error: null } }) }));
jest.mock('../../../hooks/useCreatorPageRead', () => ({ useCreatorPageRead: () => ({ data: mockData, loading: mockLoading, error: mockError, refresh: mockRefresh }) }));
jest.mock('../../../lib/creatorMode', () => ({ getCreatorAccess: jest.fn(), isAdminTierRole: (role: string) => ['leader', 'co_leader', 'admin'].includes(role) }));
jest.mock('../../../lib/operatorApplications', () => ({ fetchMyGrants: jest.fn() }));
jest.mock('../../../lib/workspaceContext', () => ({ setWorkspace: (...args: unknown[]) => mockWorkspace(...args) }));
jest.mock('../../../lib/selectedCommunity', () => ({ setSelectedCommunityId: (...args: unknown[]) => mockCommunity(...args) }));
jest.mock('../../../constants/FeatureFlags', () => ({ get CREATOR_PAGES_ENABLED() { return mockPages; } }));

let tree: ReactTestRenderer;
const mount = (kind: 'event' | 'community' = 'event') => act(() => { tree = create(<CreationStartScreen kind={kind} />); });
const actions = () => tree.root.findAllByType(PageAction);
const action = (title: string) => actions().find(node => node.props.title === title)!;
const text = () => tree.root.findAllByType(Text).map(node => node.props.children).join(' ');
beforeEach(() => { jest.clearAllMocks(); mockCurrent = true; mockLoading = false; mockError = undefined; mockPages = false; mockData = { access: mockEmpty, grants: [] }; mockRefresh.mockResolvedValue(undefined); });
afterEach(() => act(() => tree?.unmount()));

it.each([['event', '/creator/apply-events'], ['community', '/creator/apply-community']] as const)('takes an unapproved %s creator to the correct existing application', (kind, route) => {
  mount(kind); expect(text()).toContain('We’ll review new applications when the refreshed Scene is ready.');
  act(() => action('Apply').props.onPress());
  expect(mockPush).toHaveBeenCalledWith(route);
});
it.each(['applied', 'in_review', 'revoked'])('shows existing application status for %s without starting another application', status => {
  mockData.grants = [{ track: 'event_host', status }]; mount();
  expect(action('Apply')).toBeUndefined();
  act(() => action('View application').props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/creator/apply');
});
it('retains existing community identity and uses its guarded event workspace', () => {
  mockData.access = { ...mockEmpty, ledCommunities: [{ id: 'sunset', name: 'Sunset Club', role: 'leader', status: 'active' }] }; mount();
  act(() => action('Sunset Club').props.onPress());
  expect(mockWorkspace).toHaveBeenCalledWith('community');
  expect(mockCommunity).toHaveBeenCalledWith('sunset');
  expect(mockPush).toHaveBeenCalledWith('/creator/event-form?workspace=community&communityId=sunset');
});
it('clears a previous community selection before opening organization tools', () => {
  mockData.access = { ...mockEmpty, hasEventHostGrant: true }; mount();
  const press = action('Your organization').props.onPress;
  act(() => { press(); press(); });
  expect(mockWorkspace).toHaveBeenCalledWith('organization');
  expect(mockCommunity).toHaveBeenCalledWith(null);
  expect(mockPush).toHaveBeenCalledTimes(1);
});
it('continues an existing draft community instead of suggesting a duplicate setup', () => {
  mockData.access = { ...mockEmpty, hasLeaderGrant: true, ledCommunities: [{ id: 'sunset', name: 'Sunset Club', role: 'leader', status: 'draft' }] }; mount();
  expect(text()).toContain('Finish community setup');
  expect(text()).not.toContain('Creating events requires creator approval.');
  expect(action('Set up community')).toBeUndefined();
  act(() => action('Sunset Club').props.onPress());
  expect(mockWorkspace).toHaveBeenCalledWith('community');
  expect(mockCommunity).toHaveBeenCalledWith('sunset');
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/friends/manage/(tools)/community');
});
it('explains the admin step without giving an events-only collaborator setup access', () => {
  mockData.access = { ...mockEmpty, hasLeaderGrant: true, ledCommunities: [{ id: 'sunset', name: 'Sunset Club', role: 'events', status: 'draft' }] }; mount();
  expect(text()).toContain('A community admin needs to finish and publish');
  expect(action('Sunset Club')).toBeUndefined();
  expect(action('Set up community')).toBeUndefined();
});
it('still offers first-community setup when an approved creator has no community', () => {
  mockData.access = { ...mockEmpty, hasLeaderGrant: true }; mount();
  act(() => action('Set up community').props.onPress());
  expect(mockWorkspace).toHaveBeenCalledWith('community');
  expect(mockPush).toHaveBeenCalledWith('/creator/setup-community');
});
it('does not navigate through a callback retained after account or visit retirement', () => {
  mount(); const press = action('Apply').props.onPress;
  mockCurrent = false;
  act(() => press());
  expect(mockPush).not.toHaveBeenCalled();
});
it.each(['loading', 'failed'])('does not treat %s permissions as a missing approval', state => {
  mockLoading = state === 'loading'; mockError = state === 'failed' ? 'offline' : undefined; mount();
  expect(action('Apply')).toBeUndefined();
  if (state === 'failed') { act(() => action('Try again').props.onPress()); expect(mockRefresh).toHaveBeenCalled(); }
});
it('keeps the enabled page workflow available without creating a page as a side effect', () => {
  mockPages = true; mount('community');
  expect(action('Apply')).toBeUndefined();
  expect(mockPush).not.toHaveBeenCalled();
  act(() => action('Continue setup').props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/creator/pages?create=community');
});
