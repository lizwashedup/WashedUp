// Account lifecycle has dedicated tests; provide a settled signed-in reader here.
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => ({ viewerId: 'creator', epoch: 1, isLoading: false, error: null, isCurrent: () => true, retry: jest.fn() }) }));
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput, TouchableOpacity } from 'react-native';
const mockCreate = jest.fn(), mockAccess = jest.fn(), mockFind = jest.fn(), mockSelect = jest.fn();
const mockPush = jest.fn(), mockReplace = jest.fn(), mockDismissTo = jest.fn();
const mockInvalidate = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a), dismissTo: (...a: unknown[]) => mockDismissTo(...a), back: jest.fn() }, Stack: { Screen: () => null } }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ isFetchedAfterMount: true, data: { ledCommunities: [{ id: 'older-community' }] } }), useQueryClient: () => ({ invalidateQueries: (...a: unknown[]) => mockInvalidate(...a) }) }));
jest.mock('../../../lib/creatorMode', () => ({ getCreatorAccess: (...a: unknown[]) => mockAccess(...a), isLeaderAccess: () => true, createCommunity: (...a: unknown[]) => mockCreate(...a), suggestHandle: () => 'new-community', findLedCommunityByHandle: (...a: unknown[]) => mockFind(...a), HANDLE_SHAPE: /^[a-z-]{3,40}$/ }));
jest.mock('../../../lib/selectedCommunity', () => ({ setSelectedCommunityId: (...a: unknown[]) => mockSelect(...a) }));
jest.mock('../../../lib/houseCommunity', () => ({ isHouseCommunity: () => false }));
jest.mock('../../../lib/haptics', () => ({ hapticSuccess: jest.fn(), hapticError: jest.fn() }));
jest.mock('../../../lib/supabase', () => ({ supabase: { rpc: async () => ({ data: true, error: null }) } }));
jest.mock('../../../constants/FeatureFlags', () => ({ GENDER_RESTRICTED_COMMUNITIES_ENABLED: false, COMMUNITY_JOIN_POLICY_AT_CREATION_ENABLED: false }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
import SetupCommunityScreen from '../setup-community';

let tree: ReactTestRenderer;
const button = (label: string) => tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label));
async function press(label: string) { await act(async () => { expect(button(label)).toBeDefined(); button(label)!.props.onPress(); }); }
async function fillAndCreate() {
  await act(async () => { tree = create(<SetupCommunityScreen />); });
  await act(async () => tree.root.findAllByType(TextInput)[0].props.onChangeText('New community'));
  await act(async () => tree.root.findAllByType(TextInput)[1].props.onChangeText('Los Angeles'));
  await act(async () => tree.root.findAllByType(TextInput)[2].props.onChangeText('Bring our neighborhood together'));
  await press('start your community');
}
beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); mockCreate.mockReset().mockResolvedValue('new-community-id'); mockAccess.mockResolvedValue({ ledCommunities: [] }); mockFind.mockReset().mockReturnValue(null); mockInvalidate.mockResolvedValue(undefined); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); jest.useRealTimers(); });

it.each([
  ['view community', '/(creator)/today', 'dismiss'],
  ['edit page', '/creator/edit-page', 'push'],
  ['invite members', '/creator/member-invites', 'push'],
])('selects the returned community identity before %s', async (label, route, method) => {
  await fillAndCreate(); expect(mockSelect).not.toHaveBeenCalled(); await press(label);
  const navigation = method === 'dismiss' ? mockDismissTo : mockPush;
  expect(mockSelect).toHaveBeenCalledWith('new-community-id'); expect(navigation).toHaveBeenCalledWith(route);
  expect(mockSelect.mock.invocationCallOrder[0]).toBeLessThan(navigation.mock.invocationCallOrder[0]);
  expect(mockReplace).not.toHaveBeenCalled(); expect(mockCreate).toHaveBeenCalledTimes(1);
});
it('uses the exact recovered identity after a lost creation response without creating again', async () => {
  mockCreate.mockRejectedValueOnce(Error('response lost')); mockFind.mockReturnValue({ id: 'recovered-id', handle: 'new-community', name: 'New community' });
  await fillAndCreate(); await press('view community');
  expect(mockSelect).toHaveBeenCalledWith('recovered-id'); expect(mockDismissTo).toHaveBeenCalledWith('/(creator)/today'); expect(mockCreate).toHaveBeenCalledTimes(1);
});
it('unconfirmed creation cannot navigate or change the selected community', async () => {
  mockCreate.mockRejectedValueOnce(Error('offline')); await fillAndCreate();
  expect(button('view community')).toBeUndefined(); expect(mockSelect).not.toHaveBeenCalled(); expect(mockDismissTo).not.toHaveBeenCalled(); expect(mockPush).not.toHaveBeenCalled();
});
