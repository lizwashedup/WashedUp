import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FlatList, AppState, Text, TextInput, TouchableOpacity } from 'react-native';
import CommunityTopicScreen from '../../../app/community-topic/[id]';
import { ChatContextHeader } from '../ChatContextHeader';
import { showAddToCalendar } from '../../../lib/addToCalendar';
import { formatEventDateLA, formatTimestampLA } from '../../../lib/laDate';

const mockQueryKeys: unknown[][] = [];
const mockRefresh = jest.fn().mockResolvedValue(undefined), mockMark = jest.fn(), mockLegacyMark = jest.fn().mockResolvedValue(undefined), mockInvalidate = jest.fn().mockResolvedValue(undefined), mockRetryIdentity = jest.fn();
const mockCurrent = () => true;
let mockMapping: any, mockMappingError = false, mockMappingSuccess = true, mockItems: any[], mockPending = false, mockBlur: (() => void) | undefined;
const mockPush = jest.fn(), mockBack = jest.fn(), mockToggle = jest.fn();
let mockTopic: any, mockMeta: any, mockSaidHi: boolean | undefined;
let mockCards: any[];
let mockMembership: string, mockFirstMessage: any, mockClosed: boolean;
let mockMute: any;
const mockExpiry = new Date('2026-09-21T23:00:00Z');
const event = {
  title: 'A little sunset volleyball', start_time: '2026-09-19T21:00:00Z',
  end_time: '2026-09-19T23:00:00Z', venue: 'Ocean Park', status: 'Published',
  host_user_id: 'creator-a',
};
jest.mock('expo-router', () => ({ useFocusEffect: (callback: any) => require('react').useEffect(() => { const cleanup = callback(); mockBlur = cleanup; return cleanup; }, [callback]), useRouter: () => ({ back: mockBack, push: mockPush }), useLocalSearchParams: () => ({ id: 'topic-a' }), Stack: { Screen: () => null } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../../constants/FeatureFlags', () => ({ COMMUNITY_CHAT_GROUPING_ENABLED: true, CREATOR_PAGES_ENABLED: true }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').AfterglowFallbackFonts }) }));
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => ({ viewerId: 'attendee-a', epoch: 1, isLoading: false, isCurrent: mockCurrent }) }));
jest.mock('../../../hooks/useCommunityTopicMute', () => ({ useCommunityTopicMute: () => mockMute }));
jest.mock('../../../hooks/useTopicChat', () => ({ isObsoleteTopicOperation: () => false, useTopicChat: (_id: string, context: any) => ({ isCurrent: mockCurrent, messages: mockItems.filter(item => item.source === 'topic').map(item => item.message), roomItems: mockItems, loading: context?.kind === 'waiting' && !context.error, loadError: context?.kind === 'waiting' && context.error, currentUserId: 'attendee-a', currentUserName: 'Alice', refresh: mockRefresh }) }));
jest.mock('../../../hooks/useTypingIndicator', () => ({ useTypingIndicator: () => ({ typingUsers: [], stopTyping: jest.fn(), broadcastTyping: jest.fn() }) }));
jest.mock('../../../hooks/useBlock', () => ({ useBlock: () => ({ blockUser: jest.fn() }) }));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate, cancelQueries: jest.fn().mockResolvedValue(undefined) }),
  useQuery: ({ queryKey }: any) => {
    mockQueryKeys.push(queryKey);
    if (queryKey[0] === 'community-intro-topic') return { data: mockMapping, isSuccess: mockMappingSuccess, isError: mockMappingError, refetch: mockRetryIdentity };
    const dataByKey: Record<string, unknown> = {
      'topic-meta': mockMeta,
      'community-notification-context': { kind: mockMeta?.explore_event_id ? 'event' : 'persistent', communityId: 'community-a' },
      'community-chat-preference': { communityId: 'community-a', userId: 'attendee-a', muted: false, version: 0 },
      'topic-my-membership': mockMembership ? { status: mockMembership } : null,
      'creator-access': null,
      // This fixture deliberately models an attendee who is not a community member.
      'community-chat-cards': { cards: mockCards, attendee_topics: mockTopic ? [mockTopic] : [] },
      'topic-first-message': mockFirstMessage,
      'topic-said-hi': mockSaidHi,
      'topic-chat-members': [],
    };
    return { data: dataByKey[queryKey[0]], isSuccess: true, refetch: jest.fn().mockResolvedValue({}) };
  },
}));
jest.mock('../../../lib/communityChat', () => ({
  computeEventRoomExpiry: () => mockMeta?.explore_event_id ? mockExpiry : null,
  isEventRoomClosed: () => mockClosed, markTopicRead: (...args: any[]) => mockLegacyMark(...args),
}));
jest.mock('../../../lib/communityRoomHistory', () => ({ ...jest.requireActual('../../../lib/communityRoomHistory'), getCommunityIntroRoom: jest.fn(), markCommunityCoreRoomRead: (...args: any[]) => mockMark(...args) }));
jest.mock('../../communities/BroadcastCard', () => ({ BroadcastCard: (props: any) => require('react').createElement(require('react-native').Text, { accessibilityLabel: 'Original broadcast card' }, props.broadcast.body) }));
jest.mock('../../../lib/communityJoin', () => ({ getMyMembership: jest.fn() }));
jest.mock('../../../lib/creatorMode', () => ({ getCreatorAccess: jest.fn(), isLeaderAccess: () => false }));
jest.mock('../../../lib/creatorEvents', () => ({ setEventChatWelcomeMessage: jest.fn() }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn() }));
jest.mock('../../../lib/logger', () => ({ logError: jest.fn() }));
jest.mock('../../../lib/addToCalendar', () => ({ showAddToCalendar: jest.fn() }));
jest.mock('../../../lib/uploadPhoto', () => ({ uploadBase64ToStorage: jest.fn() }));
jest.mock('../../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../BrandedAlert', () => ({ BrandedAlert: () => null }));
jest.mock('../../modals/ReportModal', () => ({ ReportModal: () => null }));
jest.mock('../../MiniProfileCard', () => () => null);
jest.mock('../LocationPickerModal', () => () => null);
jest.mock('../PhotoPreviewModal', () => () => null);
jest.mock('../ReactionEmojiPicker', () => () => null);

let tree: ReactTestRenderer;
function mount() { act(() => { tree = create(<CommunityTopicScreen />); }); }
function buttons() { return tree.root.findAllByType(TouchableOpacity); }
function button(label: string) { return buttons().find(node => node.props.accessibilityLabel === label || label === 'Scroll to latest messages' && node.props.accessibilityLabel?.startsWith(`${label}, `))!; }
function copy() { return tree.root.findAllByType(Text).map(node => React.Children.toArray(node.props.children).join('')); }
beforeEach(() => {
  jest.clearAllMocks(); mockQueryKeys.splice(0); mockMappingError = false; mockMappingSuccess = true;
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  mockMapping = { communityId: 'page-a', name: 'Sunset Club LA', rooms: [{ id: 'topic-a', role: 'intros', name: 'Say hello' }, { id: 'page-a', role: 'main', name: 'Main' }] };
  const original = { id: '0e100000-0000-4000-8000-000000000003', created_at: '2026-09-15T12:00:00.000001Z', sender_id: 'other', sender_name: 'Cedar', body: 'Original topic reply', reactions: [], reply_to: { id: 'parent', body: 'Original parent', sender_name: 'Juniper' } };
  mockItems = [{ source: 'broadcast', key: `broadcast:${original.id}`, message: { ...original, kind: 'intro', body: 'Original standard introduction', reply_count: 2 } }, { source: 'topic', key: `topic:${original.id}`, message: original }];
  mockMark.mockImplementation(async (_page: string, role: string, targets: any) => {
    const position = (point: any) => ({ through_id: point?.id ?? null, through_at: point?.created_at ?? null, legacy_read_at: null });
    return { communityId: 'page-a', role, unread: 0, broadcast: position(targets.broadcast), topic: position(targets.topic) };
  });
  jest.requireMock('../../../constants/FeatureFlags').COMMUNITY_CHAT_GROUPING_ENABLED = true;
  mockTopic = { id: 'topic-a', name: 'Legacy topic name', explore_event_id: null };
  mockMeta = { id: 'topic-a', community_id: 'page-a', explore_event_id: null, archived: false, explore_events: null };
  mockSaidHi = true; mockMembership = 'active'; mockFirstMessage = null; mockClosed = false;
  mockCards = [];
  mockMute = { muted: false, ready: true, isChecking: false, toggle: mockToggle, isCurrent: () => true };
  mockToggle.mockResolvedValue(null);
});
afterEach(() => { act(() => tree?.unmount()); });


it('renders both original source items and independent Intros identity', () => {
  mount(); const list = tree.root.findByType(FlatList); expect(list.props.inverted).toBe(true); expect(list.props.data).toEqual([...mockItems].reverse()); expect(list.props.keyExtractor(mockItems[0])).not.toBe(list.props.keyExtractor(mockItems[1]));
  expect(tree.root.findByType(ChatContextHeader).props.title).toBe('Say hello'); expect(tree.root.findByType(ChatContextHeader).props.subtitle).toBe('Sunset Club LA');
  expect(copy()).toContain('Original standard introduction'); expect(copy()).toContain('Original parent'); expect(mockLegacyMark).not.toHaveBeenCalled(); expect(mockMark).not.toHaveBeenCalled();
});
it('acknowledges only the observed original sources', async () => {
  mount(); await act(async () => tree.root.findByType(FlatList).props.onViewableItemsChanged({ viewableItems: mockItems.map(item => ({ item, isViewable: true })) }));
  expect(mockMark).toHaveBeenCalledTimes(1); expect(mockMark.mock.calls[0][1]).toBe('intros'); expect(mockMark.mock.calls[0][2]).toMatchObject({ broadcast: { id: mockItems[0].message.id }, topic: { id: mockItems[1].message.id } }); expect(mockLegacyMark).not.toHaveBeenCalled();
});
it('does not mark an optimistic topic message read', async () => {
  mockItems[1].message.delivery_state = 'sending'; mount(); await act(async () => tree.root.findByType(FlatList).props.onViewableItemsChanged({ viewableItems: [{ item: mockItems[1], isViewable: true }] })); expect(mockMark).not.toHaveBeenCalled();
});
it('blurred Intros does not acknowledge visibility callbacks', async () => {
  mount(); act(() => mockBlur?.()); await act(async () => tree.root.findByType(FlatList).props.onViewableItemsChanged({ viewableItems: [{ item: mockItems[0], isViewable: true }] })); expect(mockMark).not.toHaveBeenCalled();
});
it('mapping failure remains a retryable error without legacy read writes', async () => {
  mockMappingError = true; mockMappingSuccess = false; mockItems = []; mount(); expect(copy()).toContain("Messages couldn't load"); expect(mockLegacyMark).not.toHaveBeenCalled(); await act(async () => button('Retry loading community messages').props.onPress()); expect(mockRetryIdentity).toHaveBeenCalledTimes(1);
});
it('confirmed unmapped topics preserve their original list data and read marker', () => {
  mockMapping = null; mount(); expect(tree.root.findByType(FlatList).props.data).toEqual([mockItems[1].message]); expect(mockLegacyMark).toHaveBeenCalled(); expect(mockMark).not.toHaveBeenCalled();
});

it('a same-day source transition does not repeat the day separator', () => {
  mount(); const day = require('../../../lib/communityChatUi').formatChatDay(mockItems[0].message.created_at); expect(copy().filter(text => text === day)).toHaveLength(1);
});
it('loading older Intros does not count as new activity while scrolled up', () => {
  mount(); act(() => tree.root.findByType(FlatList).props.onScroll({ nativeEvent: { contentOffset: { y: 200 }, contentSize: { height: 2000 }, layoutMeasurement: { height: 400 } } }));
  const old = { ...mockItems[0], key: 'broadcast:older', message: { ...mockItems[0].message, id: 'older', created_at: '2026-09-14T12:00:00Z' } };
  mockItems = [old, ...mockItems]; act(() => tree.update(<CommunityTopicScreen />));
  expect(button('Scroll to latest messages').findAllByType(Text)).toHaveLength(0);
  mockItems = [...mockItems, { ...mockItems[1], key: 'broadcast:newer', message: { ...mockItems[1].message, id: 'newer', created_at: '2026-09-16T12:00:00Z' } }]; act(() => tree.update(<CommunityTopicScreen />));
  expect(button('Scroll to latest messages').findByType(Text).props.children).toBe(1);
});

it('keeps metadata, membership and companion reads in the current account cache', () => {
  mount(); for (const prefix of ['topic-meta', 'topic-my-membership', 'creator-access', 'community-chat-cards', 'topic-first-message', 'topic-said-hi', 'topic-chat-members']) {
    const keys = mockQueryKeys.filter(key => key[0] === prefix); expect(keys.length).toBeGreaterThan(0); expect(keys.every(key => key.at(-2) === 'attendee-a' && key.at(-1) === 1)).toBe(true);
  }
});
