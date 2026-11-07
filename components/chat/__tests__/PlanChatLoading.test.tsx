import React from 'react';
import { AppState, Text, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PlanChatScreen from '../../../app/(tabs)/chats/[id]';
let mockFocused = true;
let mockViewer = 'alice', mockEpoch = 1;
let mockMembership: () => Promise<any>;
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
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'plan-a' }), useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('../../../lib/supabase', () => ({ supabase: { from: (table: string) => {
  let single = false;
  const result = () => table === 'events' ? mockEvent() : table === 'event_members' ? (single ? mockMembership() : mockMembers()) : mockProfiles();
  const read: any = { select: () => read, eq: () => read, limit: () => read, in: () => read, maybeSingle: () => { single = true; return read; },
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
  jest.useFakeTimers(); mockFocused = true; mockViewer = 'alice'; mockEpoch = 1; mockThreadProps = undefined;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mockMembership = async () => ok({user_id: mockViewer, event_id: event.id, status: 'joined'});
  mockEvent = async () => ok(event); mockMembers = async () => ok([{ user_id: 'peer' }]);
  mockProfiles = async () => ok([{ id: 'peer', first_name_display: 'Peer', profile_photo_url: null }]);
});
afterEach(() => { act(() => tree?.unmount()); client.clear(); jest.restoreAllMocks(); jest.useRealTimers(); });
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


it('closes a departed chat, then admits the same member after a confirmed rejoin', async () => {
  await mount(); expect(open()).toBe(true);
  mockMembership = async () => ok(null);
  await act(async () => { await client.invalidateQueries({queryKey: ['events', 'members', event.id]}); });
  await flush(); expect(open()).toBe(false);
  expect(tree.root.findAllByType(Text).map(node => node.props.children)).toContain('Chat unavailable');
  mockMembership = async () => ok({event_id: event.id, user_id: mockViewer, status: 'joined'});
  await act(async () => { await client.invalidateQueries({queryKey: ['events', 'members', event.id]}); });
  await flush(); expect(open()).toBe(true);
});

it('requires the next account’s own admission, and offers Retry on a failed read', async () => {
  await mount(); expect(open()).toBe(true);
  mockViewer = 'bob'; mockEpoch++;
  mockMembership = async () => ({data: null, error: new Error('Offline')});
  await act(async () => tree.update(screen())); await flush();
  expect(open()).toBe(false);
  const retry = tree.root.findByProps({accessibilityLabel: 'Retry opening chat'});
  mockMembership = async () => ok(null);
  await act(async () => retry.props.onPress()); await flush();
  expect(open()).toBe(false);
  expect(tree.root.findAllByType(Text).map(node => node.props.children)).toContain('Chat unavailable');
});

it.each(['creator','member'])('preserves read-only history for a cancelled plan’s %s', async role => {
  mockEvent = async () => ok({...event, status: 'cancelled', creator_user_id: role === 'creator' ? mockViewer : 'peer'});
  if (role === 'creator') mockMembership = async () => ok(null);
  await mount(); expect(open()).toBe(true); expect(mockThreadProps.readOnly.text).toContain('read-only');
});

it('rechecks a still-mounted notification destination on return after a rejoin elsewhere', async () => {
  mockMembership = async () => ok(null);
  await mount(); expect(open()).toBe(false);
  mockFocused = false; await act(async () => tree.update(screen())); await flush();
  mockMembership = async () => ok({event_id: event.id, user_id: mockViewer, status: 'joined'});
  mockFocused = true; await act(async () => tree.update(screen())); await flush();
  expect(open()).toBe(true);
});

it.each([true, false])('makes the mounted conversation read-only at its 48-hour cutoff (explicit end: %s)', async explicit => {
  const expires = Date.now() + 1400;
  const base = expires - 48 * 3600000;
  mockEvent = async () => ok({ ...event, start_time: new Date(base - (explicit ? 3600000 : 0)).toISOString(),
    end_time: explicit ? new Date(base).toISOString() : null, status: 'completed' });
  await mount();
  expect(mockThreadProps.readOnly).toBeNull();
  act(() => jest.advanceTimersByTime(expires - Date.now() - 1));
  expect(mockThreadProps.readOnly).toBeNull();
  act(() => jest.advanceTimersByTime(1));
  expect(mockThreadProps.readOnly?.text).toContain('read-only');
  expect(open()).toBe(true);
});


it.each(['creator', 'member'])('refreshes cancellation on returning to a mounted %s thread', async role => {
  let current = {...event, creator_user_id: role === 'creator' ? mockViewer : 'peer'};
  mockEvent = jest.fn(async () => ok({...current}));
  await mount(); expect(mockThreadProps.readOnly).toBeNull();
  const thread = tree.root.findByProps({testID: 'thread-open'});
  mockFocused = false; await act(async () => tree.update(screen())); await flush();
  current = {...current, status: 'cancelled'};
  mockFocused = true; await act(async () => tree.update(screen())); await flush();
  expect(mockThreadProps.readOnly?.text).toContain('read-only');
  expect(tree.root.findByProps({testID: 'thread-open'})).toBe(thread);
});

it('refreshes changed title and time on return without replacing the conversation', async () => {
  await mount(); const thread = tree.root.findByProps({testID:'thread-open'});
  mockFocused = false; await act(async () => tree.update(screen())); await flush();
  mockEvent = async () => ok({...event, title: 'A later picnic', start_time: '2099-02-02T16:00:00Z'});
  mockFocused = true; await act(async () => tree.update(screen())); await flush();
  expect(mockThreadProps.title).toBe('A later picnic');
  expect(mockThreadProps.subtitle).toContain('Feb');
  expect(mockThreadProps.readOnly).toBeNull();
  expect(tree.root.findByProps({testID:'thread-open'})).toBe(thread);
});

it('recovers failed metadata on return without removing available history', async () => {
  await mount(); const thread = tree.root.findByProps({testID:'thread-open'});
  mockFocused = false; await act(async () => tree.update(screen())); await flush();
  mockEvent = async () => ({data:null,error:new Error('Offline')});
  mockFocused = true; await act(async () => tree.update(screen())); await flush();
  await act(async () => {await jest.advanceTimersByTimeAsync(5000);}); await flush();
  expect(tree.root.findByProps({testID:'thread-open'})).toBe(thread);
  const retry = tree.root.findByProps({accessibilityLabel:'Retry Plan details'});
  mockEvent = async () => ok({...event,status:'cancelled'});
  await act(async () => retry.props.onPress()); await flush();
  expect(mockThreadProps.readOnly?.text).toContain('read-only');
});

it('refreshes changed metadata once on foreground and coalesces a still-running read', async () => {
  const listeners = new Set<(state:any)=>void>();
  jest.spyOn(AppState,'addEventListener').mockImplementation((_name,fn)=>{listeners.add(fn);return {remove:()=>listeners.delete(fn)};});
  const state = (value:string) => {Object.defineProperty(AppState,'currentState',{configurable:true,value});for(const fn of listeners)fn(value);};
  state('active');
  let calls=0; const pending=deferred();
  mockEvent=async()=>{calls++;return calls===1?ok(event):pending.promise;};
  await mount(); expect(calls).toBe(1);
  await act(async()=>{state('background');state('active');});await flush();
  await act(async()=>{state('background');state('active');});await flush();
  expect(calls).toBe(2);
  await act(async()=>pending.resolve(ok({...event,status:'cancelled'})));await flush();
  expect(mockThreadProps.readOnly?.text).toContain('read-only');
  mockFocused=false;await act(async()=>tree.update(screen()));await flush();
  await act(async()=>{state('background');state('active');});await flush();
  expect(calls).toBe(2);
});

it('rechecks ordinary membership on foreground before retaining the mounted conversation', async () => {
  const listeners = new Set<(state:any)=>void>();
  jest.spyOn(AppState,'addEventListener').mockImplementation((_name,fn)=>{listeners.add(fn);return {remove:()=>listeners.delete(fn)};});
  const state = (value:string) => {Object.defineProperty(AppState,'currentState',{configurable:true,value});for(const fn of listeners)fn(value);};
  state('active'); await mount(); expect(open()).toBe(true);
  mockMembership = async () => ok(null);
  await act(async()=>{state('background');state('active');});await flush();
  expect(open()).toBe(false);
  expect(tree.root.findAllByType(Text).map(node=>node.props.children)).toContain('Chat unavailable');
});

function foregroundControls() {
  const listeners = new Set<(state:any)=>void>();
  jest.spyOn(AppState,'addEventListener').mockImplementation((_name,fn)=>{listeners.add(fn);return {remove:()=>listeners.delete(fn)};});
  const state = (value:string) => {Object.defineProperty(AppState,'currentState',{configurable:true,value});for(const fn of listeners)fn(value);};
  state('active');
  return async () => {await act(async()=>{state('background');state('active');});await flush();};
}

it.each(['missing', 'error', 'deadline'])('offers recovery rather than claiming departure for an %s foreground membership read', async failure => {
  const resume=foregroundControls(); await mount();
  mockMembership = failure==='missing'?async()=>ok(undefined):failure==='error'?async()=>({data:null,error:Error('Offline')}):()=>new Promise(()=>{});
  await resume();
  if(failure==='deadline'){await act(async()=>{await jest.advanceTimersByTimeAsync(12000);});await flush();}
  expect(open()).toBe(false);
  expect(tree.root.findAllByType(Text).map(node=>node.props.children)).toContain('Chat couldn’t load');
  mockMembership=async()=>ok({user_id:mockViewer,event_id:event.id,status:'joined'});
  await act(async()=>tree.root.findByProps({accessibilityLabel:'Retry opening chat'}).props.onPress());await flush();
  expect(open()).toBe(true);
});

it('does not require a creator membership row on foreground', async () => {
  const resume=foregroundControls();mockEvent=async()=>ok({...event,creator_user_id:mockViewer});
  await mount();mockMembership=jest.fn(async()=>ok(null));
  await resume();expect(open()).toBe(true);expect(mockMembership).not.toHaveBeenCalled();
});

it('keeps confirmed joined archived history available on foreground', async () => {
  const resume=foregroundControls();mockEvent=async()=>ok({...event,status:'cancelled'});
  await mount();await resume();expect(open()).toBe(true);expect(mockThreadProps.readOnly.text).toContain('read-only');
});

it('shares an outstanding admission read across repeated foreground returns', async () => {
  const resume=foregroundControls();await mount();const pending=deferred();
  mockMembership=jest.fn(()=>pending.promise);
  await resume();await resume();expect(mockMembership).toHaveBeenCalledTimes(1);
  await act(async()=>pending.resolve(ok(null)));await flush();expect(open()).toBe(false);
});

it('does not let a departed account’s delayed admission result close the new account’s thread', async () => {
  const resume=foregroundControls();await mount();const pending=deferred();mockMembership=()=>pending.promise;await resume();
  mockViewer='bob';mockEpoch++;
  mockMembership=async()=>ok({user_id:mockViewer,event_id:event.id,status:'joined'});
  await act(async()=>tree.update(screen()));await flush();expect(open()).toBe(true);
  await act(async()=>pending.resolve(ok(null)));await flush();expect(open()).toBe(true);
});

it('keeps a hidden thread from issuing foreground admission reads', async () => {
  const resume=foregroundControls();await mount();mockFocused=false;await act(async()=>tree.update(screen()));await flush();
  mockMembership=jest.fn(async()=>ok(null));await resume();expect(mockMembership).not.toHaveBeenCalled();
  mockFocused=true;await act(async()=>tree.update(screen()));await flush();expect(open()).toBe(false);
});
