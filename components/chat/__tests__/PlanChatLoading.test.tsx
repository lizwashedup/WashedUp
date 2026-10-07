import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PlanChatScreen from '../../../app/(tabs)/chats/[id]';
let mockViewer = 'alice', mockEpoch = 1;
let mockThreadProps: any;
let mockEvent: () => Promise<any>, mockMembers: () => Promise<any>, mockProfiles: () => Promise<any>;
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => {
  const viewerId = mockViewer, epoch = mockEpoch;
  const isCurrent = require('react').useCallback(() => viewerId === mockViewer && epoch === mockEpoch, [viewerId, epoch]);
  return { viewerId, epoch, isCurrent, isLoading: false, error: null, retry: jest.fn() };
} }));
jest.mock('../ChatThread', () => ({ __esModule: true, default: (props: any) => {
  mockThreadProps = props;
  return require('react').createElement(require('react-native').View, { testID: 'thread-open' }, props.renderHeaderBanner?.());
} }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'plan-a' }), useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('../../../lib/supabase', () => ({ supabase: { from: (table: string) => {
  const result = () => table === 'events' ? mockEvent() : table === 'event_members' ? mockMembers() : mockProfiles();
  const read: any = { select: () => read, eq: () => read, limit: () => read, in: () => read, maybeSingle: () => read,
    then: (yes: any, no: any) => result().then(yes, no) };
  return read;
} } }));
jest.mock('../../../lib/addToCalendar', () => ({ showAddToCalendar: jest.fn() }));
jest.mock('../../../lib/url', () => ({ openUrl: jest.fn() }));
jest.mock('../../../constants/FeatureFlags', () => ({ COMMUNITY_CHAT_GROUPING_ENABLED: true }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const event = { id: 'plan-a', title: 'Synthetic plan', start_time: '2099-01-01T12:00:00Z', end_time: null, status: 'active', member_count: 2, explore_event_id: null };
const ok = (data: any) => ({ data, error: null });
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; };
let client: QueryClient, tree: ReactTestRenderer;
const screen = () => <QueryClientProvider client={client}><PlanChatScreen /></QueryClientProvider>;
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await jest.advanceTimersByTimeAsync(1); }); };
const mount = async () => { await act(async () => { tree = create(screen()); }); await flush(); };
const open = () => tree.root.findAllByProps({ testID: 'thread-open' }).length > 0;
beforeEach(() => {
  jest.useFakeTimers(); mockViewer = 'alice'; mockEpoch = 1; mockThreadProps = undefined;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mockEvent = async () => ok(event); mockMembers = async () => ok([{ user_id: 'peer' }]);
  mockProfiles = async () => ok([{ id: 'peer', first_name_display: 'Peer', profile_photo_url: null }]);
});
afterEach(() => { act(() => tree?.unmount()); client.clear(); jest.useRealTimers(); });
it.each(['members', 'profiles'])('opens the plan thread while optional %s remain pending', async stage => {
  const pending = deferred();
  if (stage === 'members') mockMembers = () => pending.promise; else mockProfiles = () => pending.promise;
  await mount(); expect(open()).toBe(true); expect(mockThreadProps.title).toBe(event.title); expect(mockThreadProps.members).toEqual([]);
  await act(async () => pending.resolve(stage === 'members' ? ok([{ user_id: 'peer' }]) : ok([{ id: 'peer', first_name_display: 'Peer', profile_photo_url: null }]))); await flush();
  expect(mockThreadProps.members).toEqual([{ id: 'peer', first_name: 'Peer', avatar_url: null }]);
});
it('keeps essential metadata failure blocking the conversation', async () => {
  mockEvent = async () => ({ data: null, error: new Error('Event unavailable') });
  await mount(); await act(async () => { await jest.advanceTimersByTimeAsync(5000); }); await flush();
  expect(open()).toBe(false); expect(tree.root.findAllByType(Text).map(n => n.props.children)).toContain('Chat couldn’t load');
});
it('keeps the conversation open on an optional deadline and offers member recovery', async () => {
  mockProfiles = () => new Promise(() => {});
  await mount(); await act(async () => { await jest.advanceTimersByTimeAsync(12000); }); await flush();
  expect(open()).toBe(true);
  const retry = tree.root.findAllByType(TouchableOpacity).find(n => n.props.accessibilityLabel === 'Retry member photos'); expect(retry).toBeDefined();
  mockProfiles = async () => ok([{ id: 'peer', first_name_display: 'Peer' }]);
  await act(async () => retry!.props.onPress()); await flush();
  expect(mockThreadProps.members).toEqual([{ id: 'peer', first_name: 'Peer', avatar_url: null }]);
});
it('does not display retired owner member results in the next account', async () => {
  const pending = deferred(); mockProfiles = () => pending.promise;
  await mount(); expect(open()).toBe(true);
  mockViewer = 'bob'; mockEpoch++; mockMembers = async () => ok([]);
  await act(async () => tree.update(screen())); await flush();
  expect(open()).toBe(true); expect(mockThreadProps.members).toEqual([]);
  await act(async () => pending.resolve(ok([{ id: 'old-private-peer', first_name_display: 'Old peer' }]))); await flush(); expect(mockThreadProps.members).toEqual([]);
});
