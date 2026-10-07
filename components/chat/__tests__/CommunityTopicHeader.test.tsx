jest.mock('../../ProfileButton', () => ({ __esModule: true, default: () => require('react').createElement(require('react-native').TouchableOpacity, { accessibilityRole: 'button', accessibilityLabel: 'Profile' }) }));
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FlatList, Modal, Text, TextInput, TouchableOpacity } from 'react-native';
import CommunityTopicScreen from '../../../app/community-topic/[id]';
import { ChatOptionsButton } from '../ChatOptionsButton';
import { ChatContextHeader } from '../ChatContextHeader';
import { showAddToCalendar } from '../../../lib/addToCalendar';
import { formatEventDateLA, formatTimestampLA } from '../../../lib/laDate';

let mockParentNotifications: any;
jest.mock('../../../hooks/useCommunityChatPreference', () => ({ useCommunityChatPreference: () => mockParentNotifications }));
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
jest.mock('expo-router', () => ({ useFocusEffect: (callback: any) => require('react').useEffect(callback, [callback]), useRouter: () => ({ back: mockBack, push: mockPush }), useLocalSearchParams: () => ({ id: 'topic-a' }), Stack: { Screen: () => null } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../../constants/FeatureFlags', () => ({ COMMUNITY_CHAT_GROUPING_ENABLED: true }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').AfterglowFallbackFonts }) }));
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => ({ viewerId: 'attendee-a', epoch: 1, isCurrent: require('react').useCallback(() => true, []), isLoading: false, error: null, retry: async () => {} }) }));
jest.mock('../../../hooks/useCommunityTopicMute', () => ({ useCommunityTopicMute: () => mockMute }));
jest.mock('../../../hooks/useTopicChat', () => ({ isObsoleteTopicOperation: () => false, useTopicChat: () => ({ isCurrent: require('react').useCallback(() => true, []), messages: [], loading: false, currentUserId: 'attendee-a', currentUserName: 'Alice', refresh: jest.fn() }) }));
jest.mock('../../../hooks/useTypingIndicator', () => ({ useTypingIndicator: () => ({ typingUsers: [], stopTyping: jest.fn(), broadcastTyping: jest.fn() }) }));
jest.mock('../../../hooks/useBlock', () => ({ useBlock: () => ({ blockUser: jest.fn() }) }));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn().mockResolvedValue(undefined), cancelQueries: jest.fn().mockResolvedValue(undefined) }),
  useQuery: ({ queryKey }: any) => {
    const dataByKey: Record<string, unknown> = {
      'topic-meta': mockMeta,
      'community-notification-context': { kind: mockMeta?.explore_event_id ? 'event' : 'persistent', communityId: 'community-a' },
      'topic-my-membership': mockMembership ? { status: mockMembership } : null,
      'creator-access': null,
      // This fixture deliberately models an attendee who is not a community member.
      'community-chat-cards': { cards: mockCards, attendee_topics: mockTopic ? [mockTopic] : [] },
      'topic-first-message': mockFirstMessage,
      'topic-said-hi': mockSaidHi,
      'topic-chat-members': [],
    };
    return { data: dataByKey[queryKey[0]], isSuccess: true };
  },
}));
jest.mock('../../../lib/communityChat', () => ({
  computeEventRoomExpiry: () => mockMeta?.explore_event_id ? mockExpiry : null,
  isEventRoomClosed: () => mockClosed, markTopicRead: async () => {},
}));
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
function button(label: string) { return buttons().find(node => node.props.accessibilityLabel === label)!; }
function openOptions() { act(() => button('Chat options').props.onPress()); }
function dismissOptions() { act(() => tree.root.findByType(ChatOptionsButton).findByType(Modal).props.onDismiss()); }
function copy() { return tree.root.findAllByType(Text).map(node => React.Children.toArray(node.props.children).join('')); }
beforeEach(() => {
  jest.requireMock('../../../constants/FeatureFlags').CREATOR_PAGES_ENABLED = false;
  mockParentNotifications = { data: { muted: true, version: 1 }, ready: true, busy: false, loading: false, fetching: false, pending: null, error: null, notice: null, change: jest.fn(), check: jest.fn(), refresh: jest.fn() };
  jest.clearAllMocks();
  jest.requireMock('../../../constants/FeatureFlags').COMMUNITY_CHAT_GROUPING_ENABLED = true;
  mockTopic = { id: 'topic-a', name: 'Event room', explore_event_id: 'event-a' };
  mockMeta = { id: 'topic-a', community_id: 'community-a', explore_event_id: 'event-a', archived: false, explore_events: event };
  mockSaidHi = true; mockMembership = ''; mockFirstMessage = null; mockClosed = false;
  mockCards = [];
  mockMute = { muted: false, ready: true, isChecking: false, toggle: mockToggle, isCurrent: () => true };
  mockToggle.mockResolvedValue(null);
});
afterEach(() => { act(() => tree?.unmount()); });

it('keeps an attendee event identity, back, album and actual calendar values without adding community navigation', () => {
  mount();
  const header = tree.root.findByType(ChatContextHeader);
  expect(header.props.title).toBe(event.title);
  expect(header.props.subtitle).toBe(formatEventDateLA(event.start_time));
  expect(header.props.location).toBe(event.venue);
  expect(copy().filter(text => text === event.title)).toHaveLength(1);
  expect(copy()).toContain(`Chat closes ${formatTimestampLA(mockExpiry.toISOString())}`);
  expect(buttons().some(node => /community/i.test(node.props.accessibilityLabel ?? ''))).toBe(false);
  expect(button('View event details')).toBeUndefined();
  act(() => {
    button(`View event: ${event.title}`).props.onPress();
    button('Back').props.onPress();
    button('Photos').props.onPress();
    button('Add event to calendar').props.onPress();
  });
  expect(mockPush.mock.calls).toEqual([['/event/event-a'], ['/event-album/topic-a']]);
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(showAddToCalendar).toHaveBeenCalledWith(event.title, event.start_time, event.end_time, event.venue);
});

it('opens the existing community route from a confirmed persistent topic without event utilities', () => {
  mockTopic = { ...mockTopic, name: 'After Glow', explore_event_id: null };
  mockMeta = { ...mockMeta, explore_event_id: null, explore_events: null };
  mockMembership = 'active';
  mockCards = [{ community_id: 'community-a', name: 'Sunset Club LA', topics: [mockTopic] }];
  mount();
  expect(tree.root.findByType(ChatContextHeader).props.title).toBe('After Glow');
  expect(tree.root.findByType(ChatContextHeader).props.subtitle).toBe('Sunset Club LA');
  expect(button('Photos')).toBeUndefined();
  expect(button('Add event to calendar')).toBeUndefined();
  act(() => button('View community: After Glow').props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/community/community-a');
});

it('keeps the audience fallback when the available card belongs to a different community', () => {
  mockTopic = { ...mockTopic, explore_event_id: null };
  mockMeta = { ...mockMeta, explore_event_id: null, explore_events: null };
  mockCards = [{ community_id: 'community-b', name: 'Another community', topics: [] }];
  mount();
  expect(tree.root.findByType(ChatContextHeader).props.subtitle).toBe('members who joined this chat space');
  expect(copy()).not.toContain('Another community');
});

it.each([undefined, 'event-a'])('does not invent a community action before room provenance is known (%s)', eventId => {
  mockTopic = null;
  mockMeta = { ...mockMeta, explore_event_id: eventId };
  mount();
  expect(tree.root.findByType(ChatContextHeader).props.onViewContext).toBeUndefined();
  expect(buttons().map(node => node.props.accessibilityLabel)).not.toEqual(expect.arrayContaining([expect.stringContaining('View community')]));
  expect(mockPush).not.toHaveBeenCalled();
});

it('retains cancelled status and the closed composer gate while withholding calendar', () => {
  mockMeta = { ...mockMeta, explore_events: { ...event, status: 'Cancelled' } };
  mockClosed = true;
  mount();
  expect(copy()).toContain('cancelled');
  expect(copy()).toContain('this chat space is closed. the event was cancelled.');
  expect(copy()).toContain(`Chat closes ${formatTimestampLA(mockExpiry.toISOString())}`);
  expect(button('Add event to calendar')).toBeUndefined();
  expect(button('Photos')).toBeDefined();
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
});

it('preserves the say-hi veil and creator welcome while event navigation remains available', () => {
  mockSaidHi = false;
  mockFirstMessage = { id: 'welcome-a', sender_id: 'creator-a', body: 'Meet near the courts.', hidden: false };
  mount();
  expect(copy()).toContain('Meet near the courts.');
  expect(copy()).toContain('say hi first');
  expect(tree.root.findAllByType(FlatList)).toHaveLength(0);
  expect(button(`View event: ${event.title}`)).toBeDefined();
  expect(button('Photos')).toBeDefined();
});

it.each([
  [{ muted: false, ready: false, isChecking: true }, 'Checking notifications…', true],
  [{ muted: undefined, ready: false, isChecking: false }, 'Check notification setting', false],
  [{ muted: true, ready: true, isChecking: false }, 'Unmute chat', false],
] as const)('preserves the notification controller state in compact chrome (%s)', (state, label, disabled) => {
  mockMute = { ...mockMute, ...state };
  mount();
  openOptions();
  expect(button(label).props.disabled).toBe(disabled);
  expect(button(label).props.accessibilityState).toEqual({ disabled, busy: disabled });
  expect(button(label).props.hitSlop).toBeUndefined();
  if (!disabled) { act(() => { void button(label).props.onPress(); }); expect(mockToggle).not.toHaveBeenCalled(); dismissOptions(); }
  expect(mockToggle).toHaveBeenCalledTimes(disabled ? 0 : 1);
});

it('retains the legacy title, context card, calendar, album and notification slot with the flag off', () => {
  jest.requireMock('../../../constants/FeatureFlags').COMMUNITY_CHAT_GROUPING_ENABLED = false;
  mount();
  expect(tree.root.findAllByType(ChatContextHeader)).toHaveLength(0);
  expect(copy()).toEqual(expect.arrayContaining(['Event room', 'COMMUNITY EVENT', event.title, 'Add to calendar']));
  expect(button('Mute chat')).toBeDefined();
  expect(button('Mute chat').props.hitSlop).toBe(12);
  act(() => {
    button('View event details').props.onPress();
    button('Photos').props.onPress();
    button('Add event to calendar').props.onPress();
  });
  expect(mockPush.mock.calls).toEqual([['/event/event-a'], ['/event-album/topic-a']]);
  expect(showAddToCalendar).toHaveBeenCalledWith(event.title, event.start_time, event.end_time, event.venue);
});

it('uses parent mute in a persistent topic header and keeps event-attendee notification controls independent', async () => {
  jest.requireMock('../../../constants/FeatureFlags').CREATOR_PAGES_ENABLED = true;
  mockTopic={...mockTopic,explore_event_id:null};mockMeta={...mockMeta,explore_event_id:null};mockMembership='active';mount();openOptions();
  expect(button('Unmute all community chats')).toBeDefined();await act(async()=>{await button('Unmute all community chats').props.onPress();});dismissOptions();
  expect(mockParentNotifications.change).toHaveBeenCalledWith(false);expect(mockToggle).not.toHaveBeenCalled();
});
it('does not show a parent-unmute action in an attendee event header with staged creator features enabled',()=>{
  jest.requireMock('../../../constants/FeatureFlags').CREATOR_PAGES_ENABLED=true;mount();openOptions();expect(button('Unmute all community chats')).toBeUndefined();expect(button('Mute chat')).toBeDefined();
});
