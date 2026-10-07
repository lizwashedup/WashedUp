import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ChatsScreen from '../../../app/(tabs)/chats/index';
import { useCommunityChatRows } from '../../../hooks/useCommunityChatRows';
import type { CommunityChatRowData } from '../../../lib/communityChat';
import { useChatList, type ChatPreview } from '../../../hooks/useChatList';
import { ChatInboxHeading } from '../ChatInboxHeading';
import { AfterglowFonts } from '../../../constants/Typography';

const mockPush = jest.fn();

jest.mock('../../../hooks/useAfterglowFonts', () => ({
  useAfterglowFonts: () => ({ fonts: jest.requireActual('../../../constants/Typography').AfterglowFonts, loaded: true, error: null }),
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('expo-notifications', () => ({ setBadgeCountAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: jest.fn() }));
// The current screen also instantiates the separately tested notification query,
// even with its creator-page feature gate disabled in these grouping/leave tests.
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn(), cancelQueries: jest.fn().mockResolvedValue(undefined) }),
  useQuery: () => ({ data: undefined, error: null, isLoading: false, isFetching: false, isError: false, isSuccess: false }),
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('../../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../../hooks/useChatList', () => ({ useChatList: jest.fn() }));
jest.mock('../../../hooks/useCommunityChatRows', () => ({ useCommunityChatRows: jest.fn() }));
jest.mock('../../yours/state/useAuthUserId', () => ({ useAuthUserId: () => ({ data: 'viewer' }) }));
jest.mock('../../../hooks/useLeaveCircle', () => ({ useLeaveCircle: () => ({ isPending: false }) }));
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => ({ viewerId: 'viewer', epoch: 1, isLoading: false, error: null, isCurrent: () => true }) }));
jest.mock('../../../constants/FeatureFlags', () => ({ COMMUNITIES_ENABLED: true, GROUPS_ENABLED: true, COMMUNITY_CHAT_GROUPING_ENABLED: true, CHAT_DELETE_ENABLED: false, YOURS_PAGE_ENABLED: true }));
jest.mock('../../ProfileButton', () => () => null);
jest.mock('../../BrandedAlert', () => ({ BrandedAlert: () => null }));
jest.mock('../../SkeletonCard', () => ({ SkeletonChatList: () => null }));
jest.mock('../../yours/circles/CircleCover', () => () => null);

const event: CommunityChatRowData = {
  key: 'room-event', kind: 'room', targetId: 'event-topic', communityId: 'sunset',
  title: 'Sunset volleyball', secondary: 'Sunset Club LA', preview: 'See you there', lastAt: null,
  unread: 2, image: null, accent: null, eventId: 'event',
};
const parent: CommunityChatRowData = {
  ...event, key: 'community-sunset', kind: 'community', targetId: 'sunset', title: 'Sunset Club LA',
  secondary: null, roomName: 'Original conversation', unread: 3, eventId: null,
};
const topic: CommunityChatRowData = { ...event, key: 'room-main', targetId: 'main', title: 'After Glow', eventId: null, unread: 4 };
const mockRefetch = jest.fn();
let tree: ReactTestRenderer;
const texts = () => tree.root.findAllByType(Text).map(node => node.props.children).filter(value => typeof value === 'string');
function mount(overrides = {}) {
  (useCommunityChatRows as jest.Mock).mockReturnValue({ data: [], viewerId: 'viewer', isLoading: false, error: null, refetch: mockRefetch, ...overrides });
  act(() => { tree = create(<ChatsScreen />); });
}
function press(label: string) {
  const button = tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label));
  expect(button).toBeDefined();
  act(() => button!.props.onPress());
}
beforeEach(() => {
  (useChatList as jest.Mock).mockReturnValue({ chats: [], loading: false, refetch: jest.fn(), removeChat: jest.fn() });
});
afterEach(() => { act(() => tree?.unmount()); mockRefetch.mockReset(); mockPush.mockReset(); });

it('shows an invitation instead of a blank Communities filter for an event-only attendee', () => {
  mount({ data: [event] });
  press('Communities');
  expect(texts()).toContain('Join a community and its chat lives here.');
  expect(texts()).not.toContain(event.title);
  press('Plans');
  expect(texts()).toContain(event.title);
});

it('opens one parent directory while keeping its joined event in the outer list', () => {
  mount({ data: [parent, topic, event] });
  expect(texts()).toContain(parent.title);
  expect(texts()).toContain(event.title);
  expect(texts()).not.toContain(topic.title);
  press(parent.title);
  expect(texts()).toContain('Your chats');
  expect(texts()).toContain(topic.title);
  expect(texts()).toContain(event.title);
});

it('does not call a pending community fetch an empty inbox', () => {
  mount({ isLoading: true });
  expect(texts()).not.toContain('Join a plan to start chatting');
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Loading community chats' }).length).toBeGreaterThan(0);
});

it('offers retry for an initial community load error', () => {
  mount({ error: new Error('Offline') });
  expect(texts()).not.toContain('Join a plan to start chatting');
  expect(texts()).toContain('Community chats couldn’t load. Check your connection and try again.');
  press('Try again');
  expect(mockRefetch).toHaveBeenCalledTimes(1);
});

const plan: ChatPreview = {
  kind: 'event', conversationId: 'plan-a', title: 'An afternoon at the beach',
  category: null, image_url: 'https://example.test/beach.jpg', start_time: '2026-09-19T21:00:00Z',
  member_count: 4, last_message: 'Riley: See you there!', last_message_at: null,
  unread_count: 1, is_past: false, ticket_url: null, member_avatars: [],
};

it('uses the same row presentation while preserving separate event, circle and community routes', () => {
  const circle: ChatPreview = { ...plan, kind: 'circle', conversationId: 'circle-a', title: 'Amelia', is_dm: true };
  (useChatList as jest.Mock).mockReturnValue({ chats: [plan, circle], loading: false, refetch: jest.fn(), removeChat: jest.fn() });
  mount({ data: [parent, topic, event] });
  expect(tree.root.findAllByType(Text).filter(text => StyleSheet.flatten(text.props.style)?.fontFamily === AfterglowFonts.semibold).map(text => text.props.children)).toEqual(expect.arrayContaining([plan.title, circle.title, parent.title, event.title]));
  press(plan.title);
  expect(mockPush).toHaveBeenLastCalledWith('/(tabs)/chats/plan-a');
  press(circle.title);
  expect(mockPush).toHaveBeenLastCalledWith('/(tabs)/chats/circle/circle-a');
  press(event.title);
  expect(mockPush).toHaveBeenLastCalledWith('/community-topic/event-topic');
  press(parent.title);
  expect(texts()).toContain(topic.title);
  expect(mockPush).toHaveBeenCalledTimes(3);
});

it('keeps the original appearance available with the development grouping switch off', () => {
  const flags = jest.requireMock('../../../constants/FeatureFlags');
  flags.COMMUNITY_CHAT_GROUPING_ENABLED = false;
  try {
    (useChatList as jest.Mock).mockReturnValue({ chats: [plan], loading: false, refetch: jest.fn(), removeChat: jest.fn() });
    mount({ data: [parent, topic, event] });
    // Both appearances now share brand font assets; assert the actual layout selection.
    expect(tree.root.findAllByType(ChatInboxHeading)).toHaveLength(0);
    expect(texts()).toContain(topic.title);
    press(parent.title);
    expect(mockPush).toHaveBeenLastCalledWith('/community-thread/sunset');
  } finally { flags.COMMUNITY_CHAT_GROUPING_ENABLED = true; }
});

it('offers retry after an initial shared-chat failure without claiming the inbox is empty', async () => {
  const retry = jest.fn().mockResolvedValue(undefined);
  (useChatList as jest.Mock).mockReturnValue({ chats: [], loading: false, loadError: true, refetch: retry, removeChat: jest.fn() });
  mount();
  expect(texts()).not.toContain('Join a plan to start chatting');
  await act(async () => tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Retry loading chats')!.props.onPress());
  expect(retry).toHaveBeenCalledWith(true);
});


it('expands a large past history through the virtualized list while preserving navigation and filters', () => {
  const history = Array.from({ length: 90 }, (_, i) => ({ ...plan, conversationId: `old-${i}`, title: `Past conversation ${i}`, is_past: true }));
  (useChatList as jest.Mock).mockReturnValue({ chats: history, loading: false, refetch: jest.fn(), removeChat: jest.fn() });
  mount();
  const list = () => tree.root.findByType(FlatList);
  expect(list().props.data).toHaveLength(1);
  expect(list().props.ListFooterComponent).toBeUndefined();
  const toggle = () => tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Past Plans (90)')!;
  act(() => toggle().props.onPress());
  expect(toggle().props.accessibilityState.expanded).toBe(true);
  expect(list().props.data).toHaveLength(91);
  expect(texts().filter(text => text.startsWith('Past conversation ')).length).toBeLessThan(90);
  press('Past conversation 0');
  expect(mockPush).toHaveBeenLastCalledWith('/(tabs)/chats/old-0');
  act(() => toggle().props.onPress());
  expect(list().props.data).toHaveLength(1);
  press('Circles');
  expect(list().props.data).toHaveLength(0);
});

it('shows ready account-owned community rows while plan and circle reads are pending', () => {
  (useChatList as jest.Mock).mockReturnValue({ chats: [], loading: true, refetch: jest.fn(), removeChat: jest.fn() });
  mount({ data: [parent, topic, event] });
  expect(texts()).toContain(parent.title); expect(texts()).toContain(event.title);
  press(event.title); expect(mockPush).toHaveBeenLastCalledWith('/community-topic/event-topic');
});
it('does not bypass the loading gate with another account community rows', () => {
  (useChatList as jest.Mock).mockReturnValue({ chats: [], loading: true, refetch: jest.fn(), removeChat: jest.fn() });
  mount({ data: [parent, event], viewerId: 'retired-account' });
  expect(texts()).not.toContain(parent.title); expect(texts()).not.toContain(event.title);
});


it('keeps pending Circles honest and filters usable after community rows open the inbox', () => {
  (useChatList as jest.Mock).mockReturnValue({ chats: [], loading: true, refetch: jest.fn(), removeChat: jest.fn() });
  mount({ data: [parent, event] });
  press('Circles');
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Loading circle chats' }).length).toBeGreaterThan(0);
  expect(texts()).not.toContain('Your circles show up here. Make one from your people.');
  press('All'); expect(texts()).toContain(parent.title);
});
it.each([true, false])('shows pending Plans until a visible plan row exists with grouping=%s', grouped => {
  const flags = jest.requireMock('../../../constants/FeatureFlags'); flags.COMMUNITY_CHAT_GROUPING_ENABLED = grouped;
  try {
    (useChatList as jest.Mock).mockReturnValue({ chats: [], loading: true, refetch: jest.fn(), removeChat: jest.fn() });
    mount({ data: [parent] }); press('Plans');
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Loading plan chats' }).length).toBeGreaterThan(0);
    expect(texts()).not.toContain('No active chats yet. Join a plan to start chatting.');
    (useCommunityChatRows as jest.Mock).mockReturnValue({ data: [parent, event], viewerId: 'viewer', isLoading: false, error: null, refetch: mockRefetch });
    act(() => tree.update(<ChatsScreen />));
    if (grouped) { expect(texts()).toContain(event.title); expect(tree.root.findAllByProps({ accessibilityLabel: 'Loading plan chats' })).toHaveLength(0); }
    else { expect(texts()).not.toContain(event.title); expect(tree.root.findAllByProps({ accessibilityLabel: 'Loading plan chats' }).length).toBeGreaterThan(0); }
    press('All'); expect(texts()).toContain(parent.title);
  } finally { flags.COMMUNITY_CHAT_GROUPING_ENABLED = true; }
});
