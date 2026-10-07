import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ChatsScreen from '../../../app/(tabs)/chats/index';
import { useChatList, type ChatPreview } from '../../../hooks/useChatList';
import type { ObservedUser } from '../../../hooks/useObservedUser';

const mockGetUser = jest.fn();
const mockAuthListeners = new Set<(event: string, session: any) => void>();
const mockRefetch = jest.fn();
const mockOldRefetch = jest.fn();
let mockObserved: ObservedUser;
const mockClient = { invalidateQueries: jest.fn(), cancelQueries: jest.fn().mockResolvedValue(undefined) };

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-notifications', () => ({ setBadgeCountAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: jest.fn() }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => mockClient }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('../../../lib/supabase', () => ({ supabase: { auth: {
  getUser: () => mockGetUser(),
  onAuthStateChange: (callback: any) => {
    mockAuthListeners.add(callback);
    return { data: { subscription: { unsubscribe: () => mockAuthListeners.delete(callback) } } };
  },
} } }));
jest.mock('../../../hooks/useChatList', () => ({ useChatList: jest.fn() }));
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => {
  mockObserved = jest.requireActual('../../../hooks/useObservedUser').useObservedUser();
  return mockObserved;
} }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: jest.requireActual('../../../constants/Typography').AfterglowFonts }) }));
jest.mock('../../../hooks/useCommunityChatRows', () => ({ useCommunityChatRows: () => ({ data: [], viewerId: null, isLoading: false, error: null, refetch: jest.fn() }) }));
jest.mock('../../../hooks/useCommunityChatPreference', () => ({ useCommunityChatPreference: () => ({}) }));
jest.mock('../../../hooks/useLeaveCircle', () => ({ useLeaveCircle: () => ({ isPending: false }), isObsoleteCircleLeave: () => false }));
jest.mock('../../../constants/FeatureFlags', () => ({ COMMUNITIES_ENABLED: false, GROUPS_ENABLED: true, COMMUNITY_CHAT_GROUPING_ENABLED: true, CHAT_DELETE_ENABLED: false, YOURS_PAGE_ENABLED: true, CREATOR_PAGES_ENABLED: false }));
jest.mock('../../../lib/chatListSignal', () => ({ consumeChatListDirty: () => false }));
jest.mock('../../../lib/haptics', () => ({ hapticSelection: jest.fn() }));
jest.mock('../../../lib/communityChatInbox', () => ({ projectCommunityChatInbox: () => ({ communities: [], eventRooms: [], unclassifiedRooms: [] }) }));
jest.mock('../../ProfileButton', () => () => null);
jest.mock('../../creator/CreatorActionFill', () => ({ CreatorActionFill: () => null }));
jest.mock('../../BrandedAlert', () => ({ BrandedAlert: () => null }));
jest.mock('../../SkeletonCard', () => ({ SkeletonChatList: () => {
  const { View } = require('react-native'); return <View testID="chat-skeleton" />;
} }));
jest.mock('../../yours/circles/CircleCover', () => () => null);
jest.mock('../CommunityChatRow', () => ({ CommunityChatRow: () => null }));
jest.mock('../CommunityChatHub', () => ({ CommunityChatHub: () => null }));
jest.mock('../ChatInboxRow', () => ({ ChatInboxRow: ({ title }: { title: string }) => {
  const { Text } = require('react-native'); return <Text>{title}</Text>;
} }));
jest.mock('../ChatInboxHeading', () => ({ ChatInboxHeading: ({ children }: { children: React.ReactNode }) => children, ChatInboxFilters: () => null }));

const planFor = (viewer: string): ChatPreview => ({ kind: 'event', conversationId: `plan-${viewer}`,
  title: `Plan for ${viewer}`, category: null, image_url: null, start_time: '2026-09-25T20:00:00Z',
  member_count: 2, last_message: 'Synthetic chat preview', last_message_at: null, unread_count: 0,
  is_past: false, ticket_url: null, member_avatars: [],
});
const user = (id: string) => ({ data: { user: { id } }, error: null });
const deferred = () => { let resolve!: (result: any) => void; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let tree: ReactTestRenderer;
const texts = () => tree.root.findAllByType(Text).map(node => node.props.children).filter(value => typeof value === 'string');
const retry = () => tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Retry loading chats');
const mount = async () => { await act(async () => { tree = create(<ChatsScreen />); }); };
const emit = async (id: string | null) => { await act(async () => {
  for (const callback of mockAuthListeners) callback(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null);
}); };
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers(); mockAuthListeners.clear();
  mockGetUser.mockReset().mockResolvedValue(user('alice'));
  mockRefetch.mockResolvedValue(undefined); mockOldRefetch.mockResolvedValue(undefined);
  jest.mocked(useChatList).mockImplementation(viewer => ({ chats: viewer ? [planFor(viewer)] : [],
    loading: viewer === undefined, loadError: false, refetch: viewer === 'alice' ? mockOldRefetch : mockRefetch, removeChat: jest.fn(),
  }));
});
afterEach(async () => { await act(async () => { tree?.unmount(); await jest.runOnlyPendingTimersAsync(); }); jest.useRealTimers(); });

it('passes the bounded observer account to the actual list and follows account events', async () => {
  await mount();
  expect(useChatList).toHaveBeenLastCalledWith('alice');
  expect(texts()).toContain('Plan for alice');
  await emit('bob');
  expect(useChatList).toHaveBeenLastCalledWith('bob');
  expect(texts()).toContain('Plan for bob');
  expect(texts()).not.toContain('Plan for alice');
  await emit(null);
  expect(useChatList).toHaveBeenLastCalledWith(null);
  expect(texts()).not.toContain('Plan for bob');
});

it('replaces a stalled identity skeleton with the existing error and retry controls after the deadline', async () => {
  mockGetUser.mockImplementation(() => new Promise(() => {}));
  await mount();
  expect(tree.root.findAllByProps({ testID: 'chat-skeleton' }).length).toBeGreaterThan(0);
  await act(async () => { jest.advanceTimersByTime(12_000); });
  expect(tree.root.findAllByProps({ testID: 'chat-skeleton' })).toHaveLength(0);
  expect(texts()).toContain('Your chats couldn’t load');
  expect(texts()).not.toContain('Join a plan to start chatting');
  expect(retry()).toBeDefined();
});

it('renders returned auth read errors as retryable errors rather than successful empty inboxes', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('Synthetic auth offline') });
  await mount();
  expect(tree.root.findAllByProps({ testID: 'chat-skeleton' })).toHaveLength(0);
  expect(texts()).toContain('Your chats couldn’t load');
  expect(texts()).not.toContain('Join a plan to start chatting');
  expect(retry()).toBeDefined();
});

it('retries unresolved identity through the rendered button and lets the new account trigger its own list read', async () => {
  mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('Synthetic auth offline') });
  await mount();
  mockGetUser.mockResolvedValue(user('recovered'));
  await act(async () => { await retry()!.props.onPress(); });
  expect(useChatList).toHaveBeenLastCalledWith('recovered');
  expect(texts()).toContain('Plan for recovered');
  expect(texts()).not.toContain('Your chats couldn’t load');
  expect(mockRefetch).not.toHaveBeenCalled();
  expect(mockOldRefetch).not.toHaveBeenCalled();
});

it('preserves current-account cached rows during identity retry and refreshes after that same account recovers', async () => {
  await mount();
  mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('Synthetic auth offline') });
  await act(async () => { await mockObserved.retry(); });
  expect(texts()).toContain('Plan for alice');
  expect(texts()).toContain('Some chats may be out of date. Check your connection and try again.');
  mockGetUser.mockResolvedValue(user('alice'));
  await act(async () => { await retry()!.props.onPress(); });
  expect(mockOldRefetch).toHaveBeenCalledWith(true);
  expect(texts()).toContain('Plan for alice');
});

it('does not invoke the old-account refetch when auth changes while the rendered retry is pending', async () => {
  await mount();
  mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('Synthetic auth offline') });
  await act(async () => { await mockObserved.retry(); });
  const pending = deferred(); mockGetUser.mockReturnValueOnce(pending.promise);
  let operation!: Promise<void>;
  act(() => { operation = retry()!.props.onPress(); });
  await emit('bob');
  await act(async () => { pending.resolve(user('alice')); await operation; });
  expect(useChatList).toHaveBeenLastCalledWith('bob');
  expect(texts()).toContain('Plan for bob');
  expect(mockOldRefetch).not.toHaveBeenCalled();
  expect(mockRefetch).not.toHaveBeenCalled();
});
