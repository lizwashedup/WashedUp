import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatOptionsButton } from '../ChatOptionsButton';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Modal, Text, TextInput, TouchableOpacity } from 'react-native';
import CommunityThreadScreen from '../../../app/community-thread/[id]';
import { ChatContextHeader } from '../ChatContextHeader';

let mockParentNotifications: any;
jest.mock('../../../hooks/useCommunityChatPreference', () => ({ useCommunityChatPreference: () => mockParentNotifications }));
const mockPush = jest.fn(), mockBack = jest.fn(), mockToggle = jest.fn();
const mockInvalidate = jest.fn().mockResolvedValue(undefined);
const mockQueryClient = { invalidateQueries: mockInvalidate, cancelQueries: jest.fn().mockResolvedValue(undefined) };
const mockViewer = { viewerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', epoch: 1, isCurrent: () => true, isLoading: false, error: null };
let mockRemoved = false;
let mockOnline = true;
let mockMute = { muted: false as boolean | null, ready: true, isChecking: false, toggle: mockToggle };
const mockPinned = { id: 'event-a', title: 'Sunset volleyball', event_date: '2026-09-19T23:00:00Z', venue: 'Ocean Park' };
jest.mock('expo-router', () => ({ useFocusEffect: (callback: any) => require('react').useEffect(callback, [callback]), useRouter: () => ({ push: mockPush, back: mockBack }), useLocalSearchParams: () => ({ id: '11111111-1111-4111-8111-111111111111' }), Stack: { Screen: () => null } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../../constants/FeatureFlags', () => ({ COMMUNITY_CHAT_GROUPING_ENABLED: true }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').AfterglowFonts }) }));
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => mockViewer }));
jest.mock('../../../hooks/useCommunityBroadcastMute', () => ({ useCommunityBroadcastMute: () => mockMute }));
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ online: mockOnline }) }));
jest.mock('../../../hooks/useBlock', () => ({ useBlock: () => ({ blockUser: jest.fn() }) }));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mockQueryClient,
  useInfiniteQuery: () => ({ data: { pages: [{ messages: [] }] }, isLoading: false, isError: false, refetch: jest.fn() }),
  useQuery: ({ queryKey }: any) => ({ isSuccess: true, data: queryKey[0] === 'community-chat-cards'
    ? { cards: [{ community_id: '11111111-1111-4111-8111-111111111111', name: 'Sunset Club LA', main_chat_name: 'After Glow' }] }
    : queryKey[0] === 'community-my-membership' ? { status: mockRemoved ? 'removed' : 'active' }
      : queryKey[0] === 'community-pinned-event' ? mockPinned : undefined }),
}));
jest.mock('../../../lib/communityChat', () => ({ markBroadcastsRead: async () => {} }));
jest.mock('../../../lib/communityJoin', () => ({}));
jest.mock('../../../lib/supabase', () => ({ supabase: { realtime: { isDisconnecting: () => false }, channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; }, removeChannel: jest.fn() } }));
jest.mock('../../../lib/uploadPhoto', () => ({}));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn() }));
jest.mock('../../BrandedAlert', () => ({ BrandedAlert: () => null }));
jest.mock('../../modals/ReportModal', () => ({ ReportModal: () => null }));
jest.mock('../../MiniProfileCard', () => () => null);
jest.mock('../LocationPickerModal', () => () => null);
jest.mock('../PhotoPreviewModal', () => () => null);
jest.mock('../ReactionEmojiPicker', () => () => null);

let tree: ReactTestRenderer;
async function mount() { await act(async () => { tree = create(<CommunityThreadScreen />); }); }
function button(label: string) { return tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label)!; }
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.requireMock('../../../constants/FeatureFlags').CREATOR_PAGES_ENABLED = false;
  mockParentNotifications = { data: { muted: true, version: 1 }, ready: true, busy: false, loading: false, fetching: false, pending: null, error: null, notice: null, change: jest.fn(), check: jest.fn(), refresh: jest.fn() };
  mockRemoved = false;
  mockOnline = true;
  mockMute = { muted: false, ready: true, isChecking: false, toggle: mockToggle };
  mockToggle.mockReset().mockResolvedValue(null);
  mockPush.mockReset(); mockBack.mockReset();
});
afterEach(() => { act(() => tree?.unmount()); });

it('opens the original community and pinned event while keeping the independently named main room', async () => {
  await mount();
  const header = tree.root.findByType(ChatContextHeader);
  expect(header.props.title).toBe('After Glow');
  expect(header.props.subtitle).toBe('Sunset Club LA');
  act(() => {
    button('Back').props.onPress();
    button('View community: After Glow').props.onPress();
    button('View upcoming event: Sunset volleyball').props.onPress();
  });
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockPush.mock.calls).toEqual([['/community/11111111-1111-4111-8111-111111111111'], ['/event/event-a']]);
  expect(button('View upcoming event: Sunset volleyball').props.accessibilityHint).toContain('Ocean Park');
});

it('preserves checked, unknown and busy mute states inside chat options', async () => {
  await mount();
  const options=()=>tree.root.findByType(ChatOptionsButton).props;
  expect(options().notificationLabel).toBe('Mute chat');
  await act(async()=>{await options().onNotifications();});expect(mockToggle).toHaveBeenCalledTimes(1);
  mockMute={...mockMute,muted:null,ready:false};act(()=>tree.update(<CommunityThreadScreen/>));
  expect(options().notificationLabel).toBe('Check notification setting');expect(options().notificationBusy).toBe(false);
  mockMute={...mockMute,isChecking:true};act(()=>tree.update(<CommunityThreadScreen/>));expect(options().notificationBusy).toBe(true);
  mockMute={...mockMute,muted:true,ready:true,isChecking:false};act(()=>tree.update(<CommunityThreadScreen/>));
  expect(options().notificationLabel).toBe('Unmute chat');
});

it('keeps the removed-member gate and excludes composer actions', async () => {
  mockRemoved = true;
  await mount();
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  expect(button('Add photo')).toBeUndefined();
  expect(button('Share location')).toBeUndefined();
  expect(tree.root.findAllByType(Text).map(node => node.props.children)).toContain('you were removed from this community.');
});

it('retains the original header and pinned event when the development redesign is off', async () => {
  const flags = jest.requireMock('../../../constants/FeatureFlags');
  flags.COMMUNITY_CHAT_GROUPING_ENABLED = false;
  try {
    await mount();
    expect(tree.root.findAllByType(ChatContextHeader)).toHaveLength(0);
    expect(tree.root.findAllByType(Text).map(node => node.props.children)).toContain('everyone in Sunset Club LA');
    expect(tree.root.findAllByType(Text).map(node => node.props.children)).toContain('up next');
    act(() => button('View upcoming event: Sunset volleyball').props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/event/event-a');
  } finally { flags.COMMUNITY_CHAT_GROUPING_ENABLED = true; }
});

it('keeps an offline draft and explains that an unconfirmed send requires retry', async () => {
  mockOnline = false;
  await mount();
  const input = tree.root.findByType(TextInput);
  act(() => input.props.onChangeText('See you by the courts'));
  expect(tree.root.findByType(TextInput).props.value).toBe('See you by the courts');
  expect(tree.root.findAllByType(Text).map(node => node.props.children)).toContain('You’re offline. Reconnect, then retry any messages that didn’t send.');
});

it('shows the effective parent mute and unmute-all action while retaining the individual room controller', async () => {
  jest.requireMock('../../../constants/FeatureFlags').CREATOR_PAGES_ENABLED = true;await mount();
  act(()=>button('Chat options').props.onPress());
  expect(button('Unmute all community chats')).toBeDefined();await act(async()=>{await button('Unmute all community chats').props.onPress();});
  await act(async()=>tree.root.findByType(ChatOptionsButton).findByType(Modal).props.onDismiss());
  expect(mockParentNotifications.change).toHaveBeenCalledWith(false);expect(mockToggle).not.toHaveBeenCalled();
});
