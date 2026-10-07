jest.mock('react-native-keyboard-controller', () => ({
  ...require('react-native-keyboard-controller/jest'),
  useAnimatedKeyboard: () => require('react').useRef({ height: { value: 0 }, state: { value: 4 } }).current,
}));
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import CommunityThreadScreen from '../../../app/community-thread/[id]';
import CommunityTopicScreen from '../../../app/community-topic/[id]';
import { ChatPhotoAttachment } from '../ChatPhotoAttachment';
import { ChatLocationPreview } from '../ChatLocationPreview';
import { encodeCommunityLocation } from '../../../lib/communityLocationMessage';
import { openUrl } from '../../../lib/url';
import { ChatPhotoViewer, type ChatPhoto } from '../ChatPhotoViewer';
import LinkifiedText from '../../LinkifiedText';
import { MessageActionsMenu } from '../MessageActionsMenu';
import { BrandedAlert } from '../../BrandedAlert';
import { ReportModal } from '../../modals/ReportModal';
import { BroadcastCard } from '../../communities/BroadcastCard';
import { deleteTopicMessage } from '../../../lib/communityChat';

type Room = 'main' | 'topic';
let mockRoomId: string, mockViewerId: string, mockMembership: string;
let mockBroadcasts: any[], mockMessages: any[], mockFirstMessage: any;
let mockSaidHi: boolean | undefined, mockLedCommunities: { id: string }[];
const mockPush = jest.fn(), mockInvalidate = jest.fn().mockResolvedValue(undefined);
const mockQueryClient = { invalidateQueries: mockInvalidate, cancelQueries: jest.fn().mockResolvedValue(undefined) };
const mockRefresh = jest.fn().mockResolvedValue(undefined);
const mockCurrent = () => true;
const mockSend = jest.fn(), mockDeleteOwn = jest.fn(), mockBlock = jest.fn();

jest.mock('expo-router', () => ({ useFocusEffect: (callback: any) => require('react').useEffect(callback, [callback]), useRouter: () => ({ push: mockPush, back: jest.fn() }), useLocalSearchParams: () => ({ id: mockRoomId }), Stack: { Screen: () => null } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../../constants/FeatureFlags', () => ({ COMMUNITY_CHAT_GROUPING_ENABLED: true }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').AfterglowFallbackFonts }) }));
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => {
  const id = mockViewerId;
  const isCurrent = require('react').useCallback(() => id === mockViewerId, [id]);
  return { viewerId: id, epoch: 1, isCurrent, isLoading: false, error: null };
} }));
jest.mock('../../../hooks/useCommunityBroadcastMute', () => ({ useCommunityBroadcastMute: () => ({ muted: false, ready: true, isChecking: false, toggle: jest.fn() }) }));
jest.mock('../../../hooks/useCommunityTopicMute', () => ({ useCommunityTopicMute: () => ({ muted: false, ready: true, isChecking: false, toggle: jest.fn(), isCurrent: mockCurrent }) }));
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ online: true }) }));
jest.mock('../../../hooks/useBlock', () => ({ useBlock: () => ({ blockUser: mockBlock }) }));
jest.mock('../../../lib/url', () => ({ ...jest.requireActual('../../../lib/url'), openUrl: jest.fn() }));
jest.mock('../../../hooks/useTypingIndicator', () => ({ useTypingIndicator: () => ({ typingUsers: [], stopTyping: jest.fn(), broadcastTyping: jest.fn() }) }));
jest.mock('../../../hooks/useTopicChat', () => ({ isObsoleteTopicOperation: () => false, useTopicChat: () => ({ isCurrent: mockCurrent, messages: mockMessages, loading: false, currentUserId: mockViewerId, currentUserName: 'Alice', refresh: mockRefresh, sendMessage: mockSend, deleteMessage: mockDeleteOwn }) }));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mockQueryClient,
  useInfiniteQuery: () => ({ data: { pages: [{ messages: mockBroadcasts }] }, isLoading: false, isError: false, refetch: jest.fn().mockResolvedValue(undefined) }),
  useQuery: ({ queryKey }: any) => {
    const data: Record<string, unknown> = {
      'community-my-membership': { status: mockMembership },
      'topic-my-membership': { status: mockMembership },
      'community-chat-cards': {
        cards: [{ community_id: '11111111-1111-4111-8111-111111111111', name: 'Sunset Club LA', main_chat_name: 'After Glow', topics: [] }],
        attendee_topics: [{ id: mockRoomId, name: 'Event room', explore_event_id: 'event-a' }],
      },
      'topic-meta': { id: mockRoomId, community_id: '11111111-1111-4111-8111-111111111111', explore_event_id: 'event-a', archived: false, explore_events: { title: 'Sunset volleyball', host_user_id: 'creator-a' } },
      'topic-first-message': mockFirstMessage,
      'topic-said-hi': mockSaidHi,
      'creator-access': { ledCommunities: mockLedCommunities },
      'community-chat-members': [], 'topic-chat-members': [],
    };
    return { data: data[queryKey[0]], isSuccess: true };
  },
}));
jest.mock('../../../lib/communityChat', () => ({
  markBroadcastsRead: jest.fn().mockResolvedValue(undefined), markTopicRead: jest.fn().mockResolvedValue(undefined),
  computeEventRoomExpiry: () => null, isEventRoomClosed: () => false,
  deleteTopicMessage: jest.fn().mockResolvedValue(undefined),
  sendCommunityMessage: jest.fn(), editCommunityMessage: jest.fn(), deleteCommunityMessage: jest.fn(),
}));
jest.mock('../../../lib/communityJoin', () => ({}));
jest.mock('../../../lib/creatorMode', () => ({ isLeaderAccess: () => mockLedCommunities.length > 0 }));
jest.mock('../../../lib/creatorEvents', () => ({}));
jest.mock('../../../lib/uploadPhoto', () => ({}));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn() }));
jest.mock('../../../lib/logger', () => ({ logError: jest.fn() }));
jest.mock('../../../lib/addToCalendar', () => ({}));
jest.mock('../../../lib/supabase', () => ({ supabase: { realtime: { isDisconnecting: () => false }, channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; }, removeChannel: jest.fn() } }));
jest.mock('../../BrandedAlert', () => ({ BrandedAlert: () => null }));
jest.mock('../../modals/ReportModal', () => ({ ReportModal: () => null }));
jest.mock('../../communities/BroadcastCard', () => ({ BroadcastCard: () => null }));
jest.mock('../../communities/CommunityMessageActions', () => ({ CommunityMessageActions: () => null }));
jest.mock('../../MiniProfileCard', () => () => null);
jest.mock('../LocationPickerModal', () => () => null);
jest.mock('../PhotoPreviewModal', () => () => null);
jest.mock('../ReactionEmojiPicker', () => () => null);
// Only display/gestures are replaced. Actual screen callbacks and the real
// selection hook own message identity, room visits and revoked visibility.
jest.mock('../ChatPhotoAttachment', () => ({ ChatPhotoAttachment: () => null }));
jest.mock('../ChatPhotoViewer', () => ({
  ...jest.requireActual('../ChatPhotoViewer'),
  ChatPhotoViewer: ({ photos, selectedId }: { photos: ChatPhoto[]; selectedId: string | null }) => {
    const selected = photos.find(photo => photo.id === selectedId);
    return selected ? require('react').createElement(require('react-native').View, { testID: 'visible-photo', selected }) : null;
  },
}));

let tree: ReactTestRenderer | undefined;
let room: Room;
const photoIds: Record<string, string> = { 'old-photo': '33333333-3333-4333-8333-333333333333', 'new-photo': '44444444-4444-4444-8444-444444444444' };
function message(id: string, senderId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', extra: Record<string, unknown> = {}) {
  return { id: photoIds[id] ?? id, sender_id: senderId, sender_name: senderId === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' ? 'Alice' : 'Bob', body: `${id} caption`,
    image_url: 'https://example.test/shared-photo.jpg', created_at: '2026-09-13T10:00:00Z',
    kind: 'message', reactions: [], ...extra };
}
function screen() { return room === 'main' ? <CommunityThreadScreen /> : <CommunityTopicScreen />; }
async function mount(next: Room) {
  room = next; mockRoomId = room === 'main' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222';
  await act(async () => { tree = create(screen()); });
}
async function update() { await act(async () => { tree!.update(screen()); }); }
function attachments() { return tree!.root.findAllByType(ChatPhotoAttachment); }
function viewer() { return tree!.root.findByType(ChatPhotoViewer).props; }
function visible() { return tree!.root.findAllByType(View).find(node => node.props.testID === 'visible-photo')?.props.selected; }
function alert() { return tree!.root.findByType(MessageActionsMenu).props.menu; }
function menuLabels() { return alert().buttons.map((button: any) => button.text); }
function bubbles() { return tree!.root.findAllByType(TouchableOpacity).filter(node => node.props.accessibilityHint === 'hold for message actions'); }
function text() { return tree!.root.findAllByType(Text).map(node => React.Children.toArray(node.props.children).join('')); }

beforeEach(() => {
  jest.clearAllMocks();
  jest.requireMock('../../../constants/FeatureFlags').COMMUNITY_CHAT_GROUPING_ENABLED = true;
  mockViewerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; mockMembership = 'active'; mockSaidHi = true;
  mockLedCommunities = []; mockFirstMessage = null;
  mockMessages = [message('old-photo'), message('new-photo', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')];
  mockBroadcasts = [...mockMessages].reverse();
});
afterEach(() => { act(() => tree?.unmount()); tree = undefined; });

it.each(['main', 'topic'] as const)('%s uses the shared pin presentation without changing its stored coordinates or map route', async next => {
  const pin = { latitude: 34.0123, longitude: -118.4951, address: 'Ocean Park' };
  const source = message('meeting-pin', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { image_url: null,
    body: next === 'main' ? encodeCommunityLocation(pin) : pin.address,
    location_lat: pin.latitude, location_lng: pin.longitude });
  mockMessages = [source]; mockBroadcasts = [source];
  await mount(next);
  expect(tree!.root.findByType(ChatLocationPreview).props.location).toEqual(pin);
  const target = tree!.root.findAll(node => node.props.accessibilityLabel === 'Open map for Ocean Park' && typeof node.props.onPress === 'function')[0];
  act(() => target.props.onPress());
  expect(openUrl).toHaveBeenCalledWith('https://www.google.com/maps/search/?api=1&query=34.0123,-118.4951');
});

it('main opens the original message ID, preserves chronological photos and excludes non-message broadcasts', async () => {
  const announcement = message('intro-card', 'creator-a', { kind: 'intro', body: 'Original introduction payload' });
  mockBroadcasts.splice(1, 0, announcement, message('text-only', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { image_url: null }));
  await mount('main');
  expect(viewer().photos.map((photo: ChatPhoto) => photo.id)).toEqual([photoIds['old-photo'], photoIds['new-photo']]);
  expect(tree!.root.findByType(BroadcastCard).props.broadcast).toBe(announcement);
  expect(attachments()).toHaveLength(2);
  act(() => attachments().find(node => node.props.senderName === 'Alice')!.props.onOpen());
  expect(visible()).toEqual({ id: photoIds['new-photo'], uri: mockMessages[1].image_url, senderName: 'Alice', caption: 'new-photo caption' });
  // The same URI belongs to two distinct message IDs; the bubble opens its own.
  act(() => bubbles().find(node => node.findAllByType(LinkifiedText).some(text => text.props.text === 'old-photo caption'))!.props.onPress());
  expect(visible().id).toBe(photoIds['old-photo']);
});

it('topic uses the original visible messages while keeping the creator welcome outside the gallery', async () => {
  mockFirstMessage = message('welcome', 'creator-a', { body: 'Meet by the courts.', hidden: false });
  mockMessages = [mockFirstMessage, ...mockMessages, message('text-only', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { image_url: null })];
  await mount('topic');
  expect(viewer().photos.map((photo: ChatPhoto) => photo.id)).toEqual([photoIds['old-photo'], photoIds['new-photo']]);
  expect(text()).toContain('Meet by the courts.');
  expect(attachments()).toHaveLength(2);
  act(() => attachments().find(node => node.props.senderName === 'Alice')!.props.onOpen());
  expect(visible().id).toBe(photoIds['new-photo']);
  act(() => bubbles().find(node => node.findAllByType(LinkifiedText).some(text => text.props.text === 'old-photo caption'))!.props.onPress());
  expect(visible().id).toBe(photoIds['old-photo']);
});

it('main photo long-press keeps member report/block and own edit/delete actions without opening the viewer', async () => {
  await mount('main');
  act(() => attachments().find(node => node.props.senderName === 'Bob')!.props.onLongPress());
  expect(alert().title).toBe('Bob');
  expect(menuLabels()).toEqual(['react', 'reply', 'report', 'block', 'cancel']);
  act(() => alert().buttons.find((button: any) => button.text === 'report').onPress());
  expect(tree!.root.findByType(ReportModal).props).toMatchObject({ visible: true, reportedUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
  act(() => attachments().find(node => node.props.senderName === 'Alice')!.props.onLongPress());
  expect(menuLabels()).toEqual(['react', 'reply', 'edit', 'delete this message', 'cancel']);
  act(() => alert().buttons.find((button: any) => button.text === 'edit').onPress());
  expect(tree!.root.findByType(TextInput).props.value).toBe('new-photo caption');
  expect(visible()).toBeUndefined();
});

it('topic photo long-press keeps reply and applies moderation only to its owning community', async () => {
  mockLedCommunities = [{ id: 'other-community' }];
  await mount('topic');
  act(() => attachments().find(node => node.props.senderName === 'Bob')!.props.onLongPress());
  expect(menuLabels()).toEqual(['react', 'reply', 'report', 'block', 'cancel']);
  act(() => alert().buttons.find((button: any) => button.text === 'reply').onPress());
  expect(text()).toContain('Reply to Bob');
  expect(text()).toContain('old-photo caption');
  mockLedCommunities = [{ id: '11111111-1111-4111-8111-111111111111' }];
  await update();
  act(() => attachments().find(node => node.props.senderName === 'Bob')!.props.onLongPress());
  expect(menuLabels()).toContain('remove this message');
  await act(async () => { await alert().buttons.find((button: any) => button.text === 'remove this message').onPress(); });
  expect(deleteTopicMessage).toHaveBeenCalledWith(photoIds['old-photo']);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(mockDeleteOwn).not.toHaveBeenCalled();
  expect(mockSend).not.toHaveBeenCalled();
  expect(visible()).toBeUndefined();
});

it.each<Room>(['main', 'topic'])('%s closes removed content and does not resurrect it when the same row returns', async kind => {
  await mount(kind);
  const open = attachments().find(node => node.props.senderName === 'Bob')!.props.onOpen;
  act(() => open());
  expect(visible().id).toBe(photoIds['old-photo']);
  mockMessages = mockMessages.slice(1); mockBroadcasts = [...mockMessages].reverse();
  await update();
  expect(viewer().selectedId).toBeNull();
  act(() => open());
  expect(visible()).toBeUndefined();
  mockMessages = [message('old-photo'), ...mockMessages]; mockBroadcasts = [...mockMessages].reverse();
  await update();
  expect(visible()).toBeUndefined();
});

it.each<Room>(['main', 'topic'])('%s revokes the open viewer for removed/banned membership and rejects retained open callbacks', async kind => {
  await mount(kind);
  const open = attachments().find(node => node.props.senderName === 'Bob')!.props.onOpen;
  act(() => open());
  mockMembership = 'removed'; await update();
  expect(viewer().selectedId).toBeNull();
  expect(tree!.root.findAllByType(TextInput)).toHaveLength(0);
  act(() => open());
  expect(visible()).toBeUndefined();
  mockMembership = 'banned'; await update();
  act(() => open());
  expect(visible()).toBeUndefined();
});

it.each<Room>(['main', 'topic'])('%s scopes photo selection to the room and account and retires old callbacks', async kind => {
  await mount(kind);
  const oldOpen = attachments().find(node => node.props.senderName === 'Bob')!.props.onOpen;
  const oldClose = viewer().onClose;
  act(() => oldOpen());
  mockRoomId = `${mockRoomId}-b`; await update();
  expect(visible()).toBeUndefined();
  act(() => attachments().find(node => node.props.senderName === 'Alice')!.props.onOpen());
  act(() => { oldOpen(); oldClose(); });
  expect(visible().id).toBe(photoIds['new-photo']);
  mockViewerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; await update();
  expect(viewer().selectedId).toBeNull();
});

it.each<Room>(['main', 'topic'])('%s retains the original cover image and long-press path when the development flag is off', async kind => {
  jest.requireMock('../../../constants/FeatureFlags').COMMUNITY_CHAT_GROUPING_ENABLED = false;
  await mount(kind);
  expect(attachments()).toHaveLength(0);
  expect(tree!.root.findAllByType(ChatPhotoViewer)).toHaveLength(0);
  const images = tree!.root.findAllByType(Image).filter(node => node.props.source?.uri === mockMessages[0].image_url);
  expect(images).toHaveLength(2);
  expect(images.every(node => node.props.contentFit === 'cover')).toBe(true);
  act(() => bubbles().find(node => node.findAllByType(LinkifiedText).some(text => text.props.text === 'old-photo caption'))!.props.onLongPress());
  expect(alert().title).toBe('Bob');
  expect(menuLabels()).toContain('report');
});

it.each([false, undefined])('topic keeps its viewer closed while the say-hi gate is %s, including after visibility changes', async saidHi => {
  mockSaidHi = saidHi;
  await mount('topic');
  expect(tree!.root.findAllByType(FlatList)).toHaveLength(0);
  expect(attachments()).toHaveLength(0);
  expect(visible()).toBeUndefined();
  mockSaidHi = true; await update();
  const open = attachments().find(node => node.props.senderName === 'Bob')!.props.onOpen;
  act(() => open());
  expect(visible().id).toBe(photoIds['old-photo']);
  mockSaidHi = saidHi; await update();
  expect(tree!.root.findAllByType(FlatList)).toHaveLength(0);
  expect(viewer().selectedId).toBeNull();
  act(() => open());
  expect(visible()).toBeUndefined();
});
