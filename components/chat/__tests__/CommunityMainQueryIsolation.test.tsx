import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FlatList, AppState } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CommunityThreadScreen from '../../../app/community-thread/[id]';
import { ChatContextHeader } from '../ChatContextHeader';

let mockBlur: (() => void) | undefined, mockFocus: (() => void) | undefined, mockRealtime: (() => void) | undefined;
const mockSubscriptions: { event: string; filter: any; callback: (payload?: any) => void }[] = [];
let mockViewerId: string | null, mockEpoch: number, mockRoomId: string;
const mockReadIdentity = jest.fn(), mockReadCore = jest.fn(), mockMarkCore = jest.fn();
const mockReadCards = jest.fn(), mockReadMessages = jest.fn(), mockReadMembership = jest.fn(), mockReadMarker = jest.fn().mockResolvedValue(undefined);
jest.mock('expo-router', () => ({ useFocusEffect: (callback: any) => require('react').useEffect(() => { mockFocus = callback; const cleanup = callback(); mockBlur = cleanup; return cleanup; }, [callback]), useRouter: () => ({ push: jest.fn(), back: jest.fn() }), useLocalSearchParams: () => ({ id: mockRoomId }), Stack: { Screen: () => null } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('../../../constants/FeatureFlags', () => ({ COMMUNITY_CHAT_GROUPING_ENABLED: true }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').AfterglowFallbackFonts }) }));
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => {
  const id = mockViewerId, epoch = mockEpoch;
  const isCurrent = require('react').useCallback(() => id === mockViewerId && epoch === mockEpoch, [id, epoch]);
  return { viewerId: id, epoch, isCurrent, isLoading: false, error: null };
} }));
jest.mock('../../../hooks/useCommunityBroadcastMute', () => ({ useCommunityBroadcastMute: () => ({ muted: false, ready: true, isChecking: false, toggle: jest.fn() }) }));
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ online: true }) }));
jest.mock('../../../hooks/useBlock', () => ({ useBlock: () => ({ blockUser: jest.fn() }) }));
jest.mock('../../../lib/communityChat', () => ({
  getCommunityBroadcasts: (...args: any[]) => mockReadMessages(...args),
  getCommunityChatPayload: (...args: any[]) => mockReadCards(...args),
  getCommunityChatMembers: () => Promise.resolve([]), getPinnedCommunityEvent: () => Promise.resolve(null),
  markBroadcastsRead: (...args: any[]) => mockReadMarker(...args),
  ObsoleteCommunityOperationError: class extends Error {},
  isObsoleteCommunityOperation: () => false,
}));
jest.mock('../../../lib/communityRoomHistory', () => ({ ...jest.requireActual('../../../lib/communityRoomHistory'), getCommunityRoomIdentities: (...args: any[]) => mockReadIdentity(...args), getCommunityRoomHistory: (...args: any[]) => mockReadCore(...args), markCommunityCoreRoomRead: (...args: any[]) => mockMarkCore(...args) }));
jest.mock('../../../lib/communityJoin', () => ({ getMyMembership: () => mockReadMembership(mockViewerId), getJoinGate: () => Promise.resolve(null) }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn() }));
jest.mock('../../../lib/uploadPhoto', () => ({}));
jest.mock('../../../lib/supabase', () => ({ supabase: { realtime: { isDisconnecting: () => false }, channel: () => {
  const channel = { on: (event: string, filter: any, callback: any) => {
    mockSubscriptions.push({ event, filter, callback });
    if (event === 'postgres_changes' && filter.table === 'community_broadcasts' && filter.filter) mockRealtime = callback;
    return channel;
  }, subscribe: () => channel }; return channel;
}, removeChannel: jest.fn() } }));
jest.mock('../../BrandedAlert', () => ({ BrandedAlert: () => null }));
jest.mock('../../modals/ReportModal', () => ({ ReportModal: () => null }));
jest.mock('../../MiniProfileCard', () => () => null);
jest.mock('../../communities/BroadcastCard', () => ({ BroadcastCard: () => null }));
jest.mock('../../communities/CommunityMessageActions', () => ({ CommunityMessageActions: () => null }));
jest.mock('../PhotoPreviewModal', () => () => null);
jest.mock('../LocationPickerModal', () => () => null);
jest.mock('../ReactionEmojiPicker', () => () => null);
jest.mock('../ChatPhotoAttachment', () => ({ ChatPhotoAttachment: () => null }));
jest.mock('../ChatPhotoViewer', () => ({ ...jest.requireActual('../ChatPhotoViewer'), ChatPhotoViewer: () => null }));

let tree: ReactTestRenderer, client: QueryClient;
function page(id: string) { return { messages: [{ id, sender_id: 'alice', sender_name: 'Alice', kind: 'message', body: id, image_url: null, created_at: '2026-09-13T12:00:00Z', reactions: [{ emoji: '❤️', mine: true, count: 1 }] }], hasMore: false, olderCursor: null }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const screen = () => <QueryClientProvider client={client}><CommunityThreadScreen /></QueryClientProvider>;
const rows = () => tree.root.findAllByType(FlatList)[0]?.props.data ?? [];
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function mount() { await act(async () => { tree = create(screen()); }); await flush(); }
async function update() { await act(async () => tree.update(screen())); await flush(); }
beforeEach(() => {
  jest.clearAllMocks(); mockSubscriptions.length = 0; jest.requireMock('../../../constants/FeatureFlags').CREATOR_PAGES_ENABLED = false; mockViewerId = 'alice'; mockEpoch = 1; mockRoomId = 'community-a';
  mockReadCards.mockImplementation((scope: any) => Promise.resolve({ cards: [{ community_id: mockRoomId, name: `${scope.userId} community`, main_chat_name: `${scope.userId} room` }] }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mockReadMessages.mockImplementation((_id: string, _older: any, scope: any) => Promise.resolve(page(`${scope.userId}-${mockEpoch}`)));
  mockReadMembership.mockResolvedValue({ status: 'active' });
});
afterEach(async () => { await act(async () => tree?.unmount()); client.clear(); });

it('does not display the previous account page or mine-reaction state while the next account loads', async () => {
  await mount(); expect(rows().map((row: any) => row.id)).toEqual(['alice-1']);
  expect(tree.root.findByType(ChatContextHeader).props.title).toBe('alice room');
  const bob = deferred<ReturnType<typeof page>>(); mockReadMessages.mockReturnValueOnce(bob.promise);
  mockViewerId = 'bob'; mockEpoch = 2; await update();
  expect(rows()).toEqual([]);
  expect(tree.root.findByType(ChatContextHeader).props.title).toBe('bob room');
  expect(client.getQueryData(['community-my-membership', 'community-a', 'bob', 2])).toEqual({ status: 'active' });
  const result = page('bob-private'); result.messages[0].reactions[0].mine = false;
  await act(async () => bob.resolve(result)); await flush();
  expect(rows()[0].id).toBe('bob-private'); expect(rows()[0].reactions[0].mine).toBe(false);
  expect(client.getQueryData(['community-broadcasts', 'community-a', 'alice', 1])).toBeDefined();
});

it('a retired account read cannot populate a new A visit after A to B to A', async () => {
  const old = deferred<ReturnType<typeof page>>(); mockReadMessages.mockReturnValueOnce(old.promise);
  await mount(); expect(rows()).toEqual([]);
  mockViewerId = 'bob'; mockEpoch = 2; await update();
  mockViewerId = 'alice'; mockEpoch = 3; await update(); expect(rows()[0].id).toBe('alice-3');
  await act(async () => old.resolve(page('retired-alice-1'))); await flush();
  expect(rows().map((row: any) => row.id)).toEqual(['alice-3']);
  expect(client.getQueryData(['community-broadcasts', 'community-a', 'alice', 1])).toBeUndefined();
});

it('does not start message or read-marker operations without a known account', async () => {
  mockViewerId = null; await mount();
  expect(mockReadMessages).not.toHaveBeenCalled(); expect(mockReadMembership).not.toHaveBeenCalled(); expect(mockReadMarker).not.toHaveBeenCalled();
  expect(rows()).toEqual([]);
});


it('loads the next room header when the previous room card read is still pending', async () => {
  const old = deferred<any>(); mockReadCards.mockReturnValueOnce(old.promise);
  await mount(); expect(tree.root.findByType(ChatContextHeader).props.title).toBe('Community chat');
  mockRoomId = 'community-b'; await update();
  expect(tree.root.findByType(ChatContextHeader).props.title).toBe('alice room');
  await act(async () => old.resolve({ cards: [{ community_id: 'community-a', main_chat_name: 'Retired room' }] })); await flush();
  expect(tree.root.findByType(ChatContextHeader).props.title).toBe('alice room');
});

const coreLayout = () => ({ communityId: mockRoomId, name: 'Current community', rooms: [{ id: 'intro-topic', role: 'intros', name: 'Introductions', storage: 'topic', included: true, joined: true, notifications_on: false }, { id: mockRoomId, role: 'main', name: 'Main conversation', storage: 'broadcast', included: true, joined: true, notifications_on: true }] });
function enableCore() {
  jest.requireMock('../../../constants/FeatureFlags').CREATOR_PAGES_ENABLED = true;
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  mockReadIdentity.mockResolvedValue(coreLayout());
  mockReadCore.mockImplementation(async () => ({ ...page('core-main'), messages: page('core-main').messages.map(message => ({ key: `broadcast:${message.id}`, source: 'broadcast', message })) }));
  mockMarkCore.mockImplementation(async (_id: string, _role: string, targets: any) => ({ communityId: mockRoomId, role: 'main', unread: 0, topic: null, broadcast: { through_at: targets.broadcast.created_at, through_id: targets.broadcast.id, legacy_read_at: null } }));
}
it('mapped main uses its original renderer with independent history and visible-only read acknowledgement', async () => {
  enableCore(); await mount(); await flush();
  expect(rows().map((r: any) => r.id)).toEqual(['core-main']); expect(mockReadMessages).not.toHaveBeenCalled(); expect(mockReadMarker).not.toHaveBeenCalled(); expect(mockMarkCore).not.toHaveBeenCalled();
  expect(tree.root.findByType(ChatContextHeader).props.title).toBe('Main conversation');
  await act(async () => tree.root.findByType(FlatList).props.onViewableItemsChanged({ viewableItems: [{ isViewable: true, item: rows()[0] }] }));
  expect(mockMarkCore).toHaveBeenCalledTimes(1); expect(mockMarkCore.mock.calls[0][1]).toBe('main'); expect(mockReadMarker).not.toHaveBeenCalled();
});
it('identity failure never falls back to legacy history or marks introductions read', async () => {
  enableCore(); mockReadIdentity.mockRejectedValueOnce(Error('Offline')); await mount(); await flush();
  expect(rows()).toEqual([]); expect(mockReadMessages).not.toHaveBeenCalled(); expect(mockReadCore).not.toHaveBeenCalled(); expect(mockReadMarker).not.toHaveBeenCalled();
});
it('confirmed unmapped communities retain the existing stream and marker', async () => {
  enableCore(); mockReadIdentity.mockResolvedValue(null); await mount(); await flush();
  expect(rows().map((r: any) => r.id)).toEqual(['alice-1']); expect(mockReadCore).not.toHaveBeenCalled(); expect(mockReadMarker).toHaveBeenCalled();
});
it('background visibility callbacks do not acknowledge main', async () => {
  enableCore(); await mount(); await flush(); Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background' });
  await act(async () => tree.root.findByType(FlatList).props.onViewableItemsChanged({ viewableItems: [{ isViewable: true, item: rows()[0] }] })); expect(mockMarkCore).not.toHaveBeenCalled();
});
it('an old account visibility callback cannot acknowledge the new account', async () => {
  enableCore(); await mount(); await flush(); const callback = tree.root.findByType(FlatList).props.onViewableItemsChanged; const oldRow = rows()[0];
  mockViewerId = 'bob'; mockEpoch = 2; await update(); await flush();
  await act(async () => callback({ viewableItems: [{ isViewable: true, item: oldRow }] })); expect(mockMarkCore).not.toHaveBeenCalled();
});

it('realtime refreshes the mapped stream without marking newly arrived messages read', async () => {
  enableCore(); await mount(); await flush(); const before = mockReadCore.mock.calls.length;
  await act(async () => mockRealtime?.()); await flush(); expect(mockReadCore.mock.calls.length).toBeGreaterThan(before); expect(mockMarkCore).not.toHaveBeenCalled(); expect(mockReadMarker).not.toHaveBeenCalled();
});
it('blurred main ignores visibility and can acknowledge after focused return', async () => {
  enableCore(); await mount(); await flush(); const visible = () => tree.root.findByType(FlatList).props.onViewableItemsChanged({ viewableItems: [{ isViewable: true, item: rows()[0] }] });
  act(() => mockBlur?.()); await act(async () => visible()); expect(mockMarkCore).not.toHaveBeenCalled();
  await act(async () => mockFocus?.()); await flush(); await act(async () => visible()); expect(mockMarkCore).toHaveBeenCalledTimes(1);
});


it.each([false, true])('updates remote reactions in the actual main query (mapped=%s)', async mapped => {
  if (mapped) enableCore(); await mount(); await flush();
  const reader = mapped ? mockReadCore : mockReadMessages, before = reader.mock.calls.length;
  const reaction = mockSubscriptions.find(item => item.filter.table === 'community_broadcast_reactions');
  expect(reaction).toBeDefined();
  await act(async () => reaction!.callback({ eventType: 'INSERT', new: { broadcast_id: rows()[0].id } }));
  await flush(); expect(reader.mock.calls.length).toBeGreaterThan(before);
});
