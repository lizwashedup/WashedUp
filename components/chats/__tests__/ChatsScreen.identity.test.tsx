import React from 'react';
import { AppState, RefreshControl, Text, TouchableOpacity, type AppStateStatus } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useFocusEffect } from '@react-navigation/native';
import { ChatInboxRow } from '../ChatInboxRow';
import ChatsScreen from '../../../app/(tabs)/chats/index';
import { useChatList, type ChatPreview } from '../../../hooks/useChatList';
import type { ObservedUser } from '../../../hooks/useObservedUser';

const mockPush = jest.fn();
const mockGetUser = jest.fn();
const mockAuthListeners = new Set<(event: string, session: any) => void>();
const mockRefetch = jest.fn();
const mockCommunityRefresh = jest.fn();
let mockCommunities = false, mockCommunityViewer: string | null = null;
const mockOldRefetch = jest.fn();
const appListeners = new Set<(state: AppStateStatus) => void>();
function appState(state: AppStateStatus) { Object.defineProperty(AppState, 'currentState', { configurable: true, value: state }); for (const cb of appListeners) cb(state); }
const flushResume = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
function focusInbox() { let blur: any; act(() => { blur = jest.mocked(useFocusEffect).mock.calls[0][0](); }); return blur; }
let mockObserved: ObservedUser;
const mockClient = { invalidateQueries: jest.fn(), cancelQueries: jest.fn().mockResolvedValue(undefined) };

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
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
jest.mock('../../../hooks/useCommunityChatRows', () => ({ useCommunityChatRows: () => ({ data: [], viewerId: mockCommunityViewer, isLoading: false, error: null, refetch: mockCommunityRefresh }) }));
jest.mock('../../../hooks/useCommunityChatPreference', () => ({ useCommunityChatPreference: () => ({}) }));
jest.mock('../../../hooks/useLeaveCircle', () => ({ useLeaveCircle: () => ({ isPending: false }), isObsoleteCircleLeave: () => false }));
jest.mock('../../../constants/FeatureFlags', () => ({ get COMMUNITIES_ENABLED() { return mockCommunities; }, GROUPS_ENABLED: true, COMMUNITY_CHAT_GROUPING_ENABLED: true, CHAT_DELETE_ENABLED: false, YOURS_PAGE_ENABLED: true, CREATOR_PAGES_ENABLED: false }));
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
  jest.clearAllMocks(); jest.useFakeTimers(); mockAuthListeners.clear(); appListeners.clear();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { appListeners.add(callback); return { remove: () => appListeners.delete(callback) }; });
  mockCommunities = false; mockCommunityViewer = null; mockCommunityRefresh.mockReset().mockResolvedValue(undefined);
  mockGetUser.mockReset().mockResolvedValue(user('alice'));
  mockRefetch.mockResolvedValue(undefined); mockOldRefetch.mockResolvedValue(undefined);
  jest.mocked(useChatList).mockImplementation(viewer => ({ chats: viewer ? [planFor(viewer)] : [],
    loading: viewer === undefined, loadError: false, refetch: viewer === 'alice' ? mockOldRefetch : mockRefetch, removeChat: jest.fn(),
  }));
});
afterEach(async () => { await act(async () => { tree?.unmount(); await jest.runOnlyPendingTimersAsync(); }); jest.useRealTimers(); jest.restoreAllMocks(); });

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


it('silently refreshes the visible inbox after backgrounding without needing a tab switch', async () => {
  await mount(); focusInbox();
  expect(mockOldRefetch).not.toHaveBeenCalled();
  appState('background'); appState('active'); await flushResume();
  expect(mockOldRefetch).toHaveBeenCalledTimes(1);
  expect(mockOldRefetch).toHaveBeenCalledWith(true);
  expect(texts()).toContain('Plan for alice');
});

it('does not start an inbox refresh after leaving the tab', async () => {
  await mount(); const blur = focusInbox();
  act(() => blur());
  appState('background'); appState('active'); await flushResume();
  expect(mockOldRefetch).not.toHaveBeenCalled();
});

it('coalesces repeated resumes while the current inbox read is pending', async () => {
  await mount(); focusInbox();
  const pending = deferred(); mockOldRefetch.mockReturnValueOnce(pending.promise);
  appState('background'); appState('active'); await flushResume();
  appState('background'); appState('active'); await flushResume();
  expect(mockOldRefetch).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(undefined));
  appState('background'); appState('active'); await flushResume();
  expect(mockOldRefetch).toHaveBeenCalledTimes(2);
});

it('retires a queued old-account resume when the account changes', async () => {
  await mount(); focusInbox();
  appState('background'); appState('active');
  await emit('bob'); await flushResume();
  expect(mockOldRefetch).not.toHaveBeenCalled();
});


it.each(['plans', 'communities'] as const)('refreshes both inbox sources and recovers after a %s failure', async failure => {
  mockCommunities = true; mockCommunityViewer = 'alice';
  await mount(); focusInbox();
  (failure === 'plans' ? mockOldRefetch : mockCommunityRefresh).mockRejectedValueOnce(new Error('Offline'));
  appState('background'); appState('active'); await flushResume();
  expect(mockOldRefetch).toHaveBeenCalledTimes(1);
  expect(mockCommunityRefresh).toHaveBeenCalledTimes(1);
  appState('background'); appState('active'); await flushResume();
  expect(mockOldRefetch).toHaveBeenCalledTimes(2);
  expect(mockCommunityRefresh).toHaveBeenCalledTimes(2);
});

it('does not refresh stale community rows owned by a different account', async () => {
  mockCommunities = true; mockCommunityViewer = 'another-account';
  await mount(); focusInbox();
  appState('background'); appState('active'); await flushResume();
  expect(mockOldRefetch).toHaveBeenCalledTimes(1);
  expect(mockCommunityRefresh).not.toHaveBeenCalled();
});

it('does not refresh a signed-out account on return', async () => {
  await mount(); focusInbox(); await emit(null);
  appState('background'); appState('active'); await flushResume();
  expect(mockOldRefetch).not.toHaveBeenCalled(); expect(mockRefetch).not.toHaveBeenCalled();
});


const pullControl = () => tree.root.findByType(RefreshControl);
function pull() {
  let request!: Promise<void>;
  act(() => { request = pullControl().props.onRefresh(); });
  return request;
}

it('shares repeated pulls until the displayed inbox finishes refreshing', async () => {
  mockCommunities = true;
  mockCommunityViewer = 'alice';
  const pending = deferred(); mockOldRefetch.mockReturnValue(pending.promise);
  await mount();
  const first = pull(), second = pull();
  expect(pullControl().props.refreshing).toBe(true);
  expect(mockOldRefetch).toHaveBeenCalledTimes(1);
  expect(mockCommunityRefresh).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(undefined); await Promise.all([first, second]); });
  expect(pullControl().props.refreshing).toBe(false);
});

it('keeps the new account’s refresh control independent of an old request', async () => {
  mockCommunities = true;
  mockCommunityViewer = 'alice';
  const old = deferred(), current = deferred();
  mockOldRefetch.mockReturnValueOnce(old.promise);
  mockRefetch.mockReturnValueOnce(current.promise);
  await mount();
  const oldOperation = pull();
  await emit('bob');
  expect(pullControl().props.refreshing).toBe(false);
  const newOperation = pull();
  await act(async () => { old.resolve(undefined); await oldOperation; });
  expect(texts()).toContain('Plan for bob');
  expect(pullControl().props.refreshing).toBe(true);
  expect(mockCommunityRefresh).toHaveBeenCalledTimes(1);
  await act(async () => { current.resolve(undefined); await newOperation; });
  expect(pullControl().props.refreshing).toBe(false);
});

it('shares a pull with the foreground refresh while both target the same account', async () => {
  await mount(); focusInbox();
  const pending = deferred(); mockOldRefetch.mockReturnValueOnce(pending.promise);
  const operation = pull();
  appState('background'); appState('active'); await flushResume();
  expect(mockOldRefetch).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(undefined); await operation; });
  expect(pullControl().props.refreshing).toBe(false);
});


it('drops a queued row tap on account change or blur and opens the current conversation after returning', async () => {
  await mount();
  const blur = focusInbox();
  const press = () => tree.root.findByType(ChatInboxRow).props.onPress;
  const alice = press();
  await emit('bob');
  act(alice);
  expect(mockPush).not.toHaveBeenCalled();
  const bob = press();
  act(() => { blur(); bob(); });
  expect(mockPush).not.toHaveBeenCalled();
  focusInbox();
  act(press());
  expect(mockPush.mock.calls).toEqual([['/(tabs)/chats/plan-bob']]);
});
