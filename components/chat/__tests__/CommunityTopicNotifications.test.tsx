import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CommunityTopicScreen from '../../../app/community-topic/[id]';
import { BrandedAlert } from '../../BrandedAlert';

let mockTopicId = 'topic-a';
let mockMuted = false;
const mockRead = jest.fn();
const mockWrite = jest.fn();
const mockHaptic = jest.fn();
const mockViewer = { viewerId: 'alice', epoch: 1, isLoading: false, error: null, isCurrent: () => true, retry: jest.fn() };
jest.mock('expo-router', () => ({ useFocusEffect: (callback: any) => require('react').useEffect(callback, [callback]), useRouter: () => ({ back: jest.fn(), push: jest.fn() }), useLocalSearchParams: () => ({ id: mockTopicId }), Stack: { Screen: () => null } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => mockViewer }));
jest.mock('../../../hooks/useTopicChat', () => ({ isObsoleteTopicOperation: () => false, useTopicChat: () => ({ isCurrent: () => true, messages: [], loading: false, currentUserId: 'alice', currentUserName: 'Alice', refresh: jest.fn() }) }));
jest.mock('../../../hooks/useTypingIndicator', () => ({ useTypingIndicator: () => ({ typingUsers: [], stopTyping: jest.fn(), broadcastTyping: jest.fn() }) }));
jest.mock('../../../hooks/useBlock', () => ({ useBlock: () => ({ blockUser: jest.fn() }) }));
jest.mock('../../../lib/topicNotificationPreference', () => ({ getMyTopicMute: (...args: any[]) => mockRead(...args), setMyTopicMute: (...args: any[]) => mockWrite(...args) }));
jest.mock('../../../lib/communityChat', () => ({
  getCommunityChatPayload: async () => ({ cards: [{ topics: [{ id: mockTopicId, name: 'Our chat', notifications_on: !mockMuted, explore_event_id: null }] }], attendee_topics: [] }),
  getTopicMeta: async () => ({ id: mockTopicId, community_id: 'community-a', archived: false, explore_events: null }),
  getTopicChatMembers: async () => [], markTopicRead: async () => {},
  computeEventRoomExpiry: () => null, isEventRoomClosed: () => false,
  setTopicNotifications: (_id: string, on: boolean) => mockWrite({ topicId: _id }, !on),
}));
jest.mock('../../../lib/communityJoin', () => ({ getMyMembership: async () => ({ status: 'active' }) }));
jest.mock('../../../lib/creatorMode', () => ({ getCreatorAccess: async () => null, isLeaderAccess: () => false }));
jest.mock('../../../lib/creatorEvents', () => ({ setEventChatWelcomeMessage: jest.fn() }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: () => mockHaptic() }));
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
let tree: ReactTestRenderer;
let client: QueryClient;
async function flush() {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });
  act(() => { tree = create(<QueryClientProvider client={client}><CommunityTopicScreen /></QueryClientProvider>); });
  await flush();
}
function toggle() {
  return tree.root.findAllByType(TouchableOpacity).find(node => /notifications|notification setting|Mute chat|Unmute chat/.test(node.props.accessibilityLabel ?? ''))!;
}
beforeEach(() => {
  mockTopicId = 'topic-a'; mockMuted = false;
  mockHaptic.mockReset(); mockWrite.mockReset(); mockRead.mockReset().mockImplementation(async () => mockMuted);
  mockWrite.mockImplementation(async (_scope, desired) => { mockMuted = desired; });
});
afterEach(async () => { act(() => tree?.unmount()); client?.clear(); await flush(); });

it('shows checking rather than a cached on/off value while the authoritative preference is pending', async () => {
  const pending = deferred<boolean>();
  mockRead.mockReturnValueOnce(pending.promise);
  await mount();
  expect(toggle().props.accessibilityLabel).toBe('Checking chat notifications');
  expect(toggle().props.disabled).toBe(true);
  await act(async () => { pending.resolve(false); });
  await flush();
  expect(toggle().props.accessibilityLabel).toBe('Mute chat');
});

it('serializes two taps before rendering and does not announce success before readback', async () => {
  await mount();
  const pending = deferred<void>();
  mockWrite.mockReturnValueOnce(pending.promise);
  let first: any, second: any;
  act(() => { first = toggle().props.onPress(); second = toggle().props.onPress(); });
  await flush();
  expect(mockWrite).toHaveBeenCalledTimes(1);
  expect(toggle().props.disabled).toBe(true);
  expect(mockHaptic).not.toHaveBeenCalled();
  const readback = deferred<boolean>();
  mockRead.mockReturnValueOnce(readback.promise);
  act(() => { mockMuted = true; pending.resolve(); });
  await flush();
  expect(mockHaptic).not.toHaveBeenCalled();
  await act(async () => { readback.resolve(true); await Promise.all([first, second]); });
  await flush();
  expect(toggle().props.accessibilityLabel).toBe('Unmute chat');
  expect(mockHaptic).toHaveBeenCalledTimes(1);
});

it('renders a retry control after an unknown preference instead of an enabled-state bell', async () => {
  mockRead.mockRejectedValue(new Error('Offline'));
  await mount();
  expect(toggle().props.accessibilityLabel).toBe('Check chat notification setting');
  expect(toggle().props.disabled).toBe(false);
  mockRead.mockResolvedValue(true);
  await act(async () => { await toggle().props.onPress(); });
  await flush();
  expect(toggle().props.accessibilityLabel).toBe('Unmute chat');
  expect(mockWrite).not.toHaveBeenCalled();
});

it('explains a write mismatch while showing the actual saved setting', async () => {
  await mount();
  mockWrite.mockResolvedValueOnce(undefined);
  await act(async () => { await toggle().props.onPress(); }); await flush();
  const alert = tree.root.findByType(BrandedAlert);
  expect(alert.props.visible).toBe(true);
  expect(alert.props.message).toContain('current saved setting');
  expect(toggle().props.accessibilityLabel).toBe('Mute chat');
  expect(mockHaptic).not.toHaveBeenCalled();
});

it('explains an unconfirmed result and retries the read without another write', async () => {
  await mount();
  mockRead.mockRejectedValueOnce(new Error('Readback unavailable'));
  await act(async () => { await toggle().props.onPress(); }); await flush();
  const alert = tree.root.findByType(BrandedAlert);
  expect(alert.props.visible).toBe(true);
  expect(alert.props.message).toContain('couldn’t confirm');
  expect(toggle().props.accessibilityLabel).toBe('Check chat notification setting');
  expect(mockHaptic).not.toHaveBeenCalled();
  act(() => alert.props.onClose());
  await act(async () => { await toggle().props.onPress(); }); await flush();
  expect(toggle().props.accessibilityLabel).toBe('Unmute chat');
  expect(mockWrite).toHaveBeenCalledTimes(1);
});
