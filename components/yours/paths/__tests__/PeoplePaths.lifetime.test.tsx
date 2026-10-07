import React from 'react';
import { Text, TextInput, FlatList, ScrollView } from 'react-native';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HandleLookupView from '../HandleLookupView';
import PlanHistoryBacklog from '../PlanHistoryBacklog';
import PersonRow from '../PersonRow';
import { AfterglowFonts } from '../../../../constants/Typography';
import { yoursKeys } from '../../../../lib/yours/keys';
import type { SearchPerson, BacklogPerson } from '../../../../lib/yours/types';

const mockRpc = jest.fn(), mockGetUser = jest.fn();
let mockViewer: string | null = 'alice';
const mockListeners = new Set<(event: string, session: { user: { id: string } } | null) => void>();
jest.mock('../../../../lib/supabase', () => ({ supabase: {
  rpc: (...args: unknown[]) => mockRpc(...args),
  auth: { getUser: () => mockGetUser(), onAuthStateChange: (fn: typeof mockListeners extends Set<infer T> ? T : never) => {
    mockListeners.add(fn); return { data: { subscription: { unsubscribe: () => mockListeners.delete(fn) } } };
  } },
} }));
jest.mock('expo-image', () => ({ Image: (props: any) => require('react').createElement('Photo', props) }));
jest.mock('lucide-react-native', () => ({ AtSign: () => null, Search: () => null }));
const remote = (id: string, connection_state: SearchPerson['connection_state'] = 'none'): SearchPerson => ({ user_id: id, first_name_display: id, profile_photo_url: null, handle: id.toLowerCase(), shared_count: 1, connection_state });
const backlogPerson = (id: string, state: BacklogPerson['state'] = 'none'): BacklogPerson => ({ user_id: id, first_name_display: id, profile_photo_url: null, handle: id.toLowerCase(), shared_count: 1, state });
const cleanup: Array<() => void> = [];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function flush() { for (let i = 0; i < 4; i++) { await act(async () => { for (let j = 0; j < 8; j++) await Promise.resolve(); }); act(() => jest.advanceTimersByTime(0)); } }
async function settle() { act(() => jest.advanceTimersByTime(300)); await flush(); }
const writes = () => mockRpc.mock.calls.filter(([name]) => name === 'add_or_accept_person');
function mount(kind: 'handle' | 'backlog') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  let userId = 'alice', live = true, mounted = true; const open = jest.fn();
  const scope = { userId, isCurrent: () => live };
  const render = () => <QueryClientProvider client={client}>{kind === 'handle' ? <HandleLookupView userId={userId} onPressPerson={open} appearance={{ fonts: AfterglowFonts }} operationScope={scope} /> : <PlanHistoryBacklog userId={userId} onPressPerson={open} appearance={{ fonts: AfterglowFonts }} operationScope={scope} />}</QueryClientProvider>;
  let tree!: ReturnType<typeof create>; act(() => { tree = create(render()); });
  const unmount = () => { if (mounted) act(() => tree.unmount()); mounted = false; }; cleanup.push(() => { unmount(); client.clear(); });
  const update = (id = userId) => { userId = id; scope.userId = id; act(() => tree.update(render())); };
  const input = () => tree.root.findByType(TextInput);
  const button = (label: string) => tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
  return { tree, client, open, update, unmount, button, input, rows: () => tree.root.findAllByType(PersonRow),
    type: (value: string) => act(() => input().props.onChangeText(value)),
    text: () => tree.root.findAllByType(Text).flatMap(n => n.props.children).join(' '),
    tap: async (label: string) => { act(() => button(label).props.onPress()); await flush(); },
    retire: () => { live = false; },
    auth: (id: string | null, changeProp = true) => { mockViewer = id; act(() => { for (const fn of mockListeners) fn(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null); }); if (changeProp) update(id ?? ''); },
  };
}
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); mockViewer = 'alice'; mockListeners.clear();
  mockGetUser.mockReset().mockImplementation(async () => ({ data: { user: mockViewer ? { id: mockViewer } : null }, error: null }));
  mockRpc.mockReset().mockImplementation(async (name, args) => name === 'search_people' ? { data: [remote(args.p_query === 'zoe' ? 'Zoe' : 'Bea')], error: null } : name === 'get_plan_history_backlog' ? { data: [backlogPerson('Bea'), backlogPerson('Zoe')], error: null } : { data: 'requested', error: null });
});
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); jest.clearAllTimers(); jest.useRealTimers(); });

it('keeps exact-handle minimum, @ normalization and 300ms debounce without directory lookup', async () => {
  const f = mount('handle'); await flush(); expect(mockRpc).not.toHaveBeenCalled();
  f.type('@b'); await settle(); expect(mockRpc).not.toHaveBeenCalled();
  f.type('  @@BEA  '); act(() => jest.advanceTimersByTime(299)); await flush(); expect(mockRpc).not.toHaveBeenCalled(); await settle();
  expect(mockRpc).toHaveBeenCalledWith('search_people', { p_user_id: 'alice', p_query: 'bea' }); expect(f.rows()).toHaveLength(1);
});
it('keeps the same handle input mounted while query, loading and result change', async () => {
  const f = mount('handle'), input = f.input(); f.type('bea'); await settle(); expect(f.input()).toBe(input);
  f.type('zoe'); expect(f.input()).toBe(input); expect(f.rows()).toHaveLength(0); await settle(); expect(f.input()).toBe(input); expect(f.rows()[0].props.name).toBe('Zoe');
  expect(f.tree.root.findByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
});
it('does not display or act on the old person during a different handle debounce', async () => {
  const f = mount('handle'); f.type('bea'); await settle(); const add = f.rows()[0].props.onAdd, open = f.rows()[0].props.onPressPerson;
  f.type('zoe'); act(() => { add(); open(); }); await flush(); expect(writes()).toHaveLength(0); expect(f.open).not.toHaveBeenCalled(); expect(f.rows()).toHaveLength(0);
});
it('a mismatched remote handle is not shown as a fuzzy suggestion', async () => {
  const f = mount('handle'); f.type('unrelated'); await settle(); expect(f.rows()).toHaveLength(0); expect(f.text()).toContain('No one with that handle');
});
it('distinguishes handle lookup failure from no match and retries the same stored query', async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: new Error('offline') }); const f = mount('handle'); f.type('bea'); await settle();
  expect(f.text()).toContain('Couldn’t look up'); expect(f.text()).not.toContain('No one with'); expect(f.input().props.value).toBe('bea');
  await f.tap('Try again to look up this handle'); expect(f.rows()).toHaveLength(1);
});
it('shows pending separately until the request resolves, then Requested', async () => {
  const write = deferred<any>(); const original = mockRpc.getMockImplementation()!; mockRpc.mockImplementation((name, args) => name === 'add_or_accept_person' ? write.promise : original(name, args));
  const f = mount('handle'); f.type('bea'); await settle(); await f.tap('Add Bea'); expect(f.rows()[0].props.state).toBe('none'); expect(f.rows()[0].props.isAdding).toBe(true); expect(f.text()).not.toContain('Requested');
  await act(async () => write.resolve({ data: 'requested', error: null })); await flush(); expect(f.rows()[0].props.state).toBe('requested');
});
it.each(['now_connected', 'already_connected'])('renders %s as connected rather than Requested', async outcome => {
  const original = mockRpc.getMockImplementation()!; mockRpc.mockImplementation(async (name, args) => name === 'add_or_accept_person' ? { data: outcome, error: null } : original(name, args));
  const f = mount('handle'); f.type('bea'); await settle(); await f.tap('Add Bea'); expect(f.rows()[0].props.state).toBe('connected'); expect(f.text()).toContain('You’re connected');
});
it('incoming handle requests still require explicit Add before the handshake accepts', async () => {
  mockRpc.mockImplementation(async name => name === 'search_people' ? { data: [remote('Bea', 'incoming')], error: null } : { data: 'now_connected', error: null });
  const f = mount('handle'); f.type('bea'); await settle(); expect(writes()).toHaveLength(0); expect(f.button('Add Bea')).toBeDefined();
  await f.tap('Add Bea'); expect(writes()).toHaveLength(1); expect(f.rows()[0].props.state).toBe('connected');
});
it('failed Add retains handle and displays explicit retry without claiming Requested', async () => {
  const original = mockRpc.getMockImplementation()!; let failed = false; mockRpc.mockImplementation(async (name, args) => { if (name === 'add_or_accept_person' && !failed) { failed = true; return { error: new Error('offline') }; } return original(name, args); });
  const f = mount('handle'); f.type('bea'); await settle(); await f.tap('Add Bea'); expect(f.input().props.value).toBe('bea'); expect(f.rows()[0].props.state).toBe('none');
  await f.tap('Try again to add Bea'); expect(f.rows()[0].props.state).toBe('requested');
});

it.each([
  ['handle', null], ['handle', 'some_future_outcome'],
  ['backlog', null], ['backlog', 'some_future_outcome'],
] as const)('%s retains the person and retry after raw unconfirmed Add receipt %p', async (kind, data) => {
  const original = mockRpc.getMockImplementation()!; let first = true;
  mockRpc.mockImplementation(async (name, args) => {
    if (name === 'add_or_accept_person' && first) { first = false; return { data, error: null }; }
    return original(name, args);
  });
  const f = mount(kind); if (kind === 'handle') { f.type('bea'); await settle(); } else await flush();
  await f.tap('Add Bea');
  expect(f.rows()[0].props.name).toBe('Bea'); expect(f.rows()[0].props.state).toBe('none');
  expect(f.text()).toContain('We couldn’t confirm your request'); expect(f.text()).not.toContain('Requested');
  expect(f.open).not.toHaveBeenCalled(); expect(writes()).toHaveLength(1);
  await f.tap('Try again to add Bea'); expect(f.rows()[0].props.state).toBe('requested');
  expect(writes()[0]).toEqual(writes()[1]);
});
it.each(['handle', 'backlog'] as const)('%s serializes rapid duplicate Add before pending paints', async kind => {
  const auth = deferred<any>(); mockGetUser.mockReturnValueOnce(auth.promise); const f = mount(kind); if (kind === 'handle') { f.type('bea'); await settle(); } else await flush();
  const add = f.rows()[0].props.onAdd; act(() => { add(); add(); }); await flush(); expect(mockGetUser).toHaveBeenCalledTimes(1);
  await act(async () => auth.resolve({ data: { user: { id: 'alice' } }, error: null })); await flush(); expect(writes()).toHaveLength(1);
});
it.each(['query', 'account', 'roundtrip', 'parent', 'unmount'])('retires a scoped handle Add before dispatch after %s change', async change => {
  const auth = deferred<any>(); mockGetUser.mockReturnValueOnce(auth.promise); const f = mount('handle'); f.type('bea'); await settle(); await f.tap('Add Bea');
  if (change === 'query') f.type('zoe'); if (change === 'account') f.auth('bob'); if (change === 'roundtrip') { f.auth('bob', false); f.auth('alice', false); } if (change === 'parent') f.retire(); if (change === 'unmount') f.unmount();
  await act(async () => auth.resolve({ data: { user: { id: 'alice' } }, error: null })); await flush(); expect(writes()).toHaveLength(0);
});
it('late handle failure cannot attach to the next query', async () => {
  const write = deferred<any>(), original = mockRpc.getMockImplementation()!; mockRpc.mockImplementation((name, args) => name === 'add_or_accept_person' ? write.promise : original(name, args));
  const f = mount('handle'); f.type('bea'); await settle(); await f.tap('Add Bea'); f.type('zoe'); await settle();
  await act(async () => write.resolve({ error: new Error('blocked') })); await flush(); expect(f.rows()[0].props.name).toBe('Zoe'); expect(f.text()).not.toContain("You can't add"); expect(f.rows()[0].props.isAdding).toBe(false);
});
it('changing away and back cannot revive old Add or person callbacks', async () => {
  const f = mount('handle'); f.type('bea'); await settle(); const old = f.rows()[0].props;
  f.type('zoe'); await settle(); f.type('bea'); await settle(); act(() => { old.onAdd(); old.onPressPerson(); }); await flush(); expect(writes()).toHaveLength(0); expect(f.open).not.toHaveBeenCalled();
});
it('backlog filters only received completed-plan names locally without remote lookup', async () => {
  const f = mount('backlog'); await flush(); const input = f.input(); f.type('zo'); await flush();
  expect(f.input()).toBe(input); expect(f.rows().map(r => r.props.name)).toEqual(['Zoe']); expect(mockRpc.mock.calls.filter(([n]) => n === 'search_people')).toHaveLength(0);
  expect(f.tree.root.findByType(FlatList).props.keyboardShouldPersistTaps).toBe('handled');
});
it('backlog differentiates read loading, failure/retry, no name match and no past people', async () => {
  const read = deferred<any>(); mockRpc.mockReturnValueOnce(read.promise); const f = mount('backlog'); await flush(); expect(f.text()).toContain('Loading people');
  await act(async () => read.resolve({ data: null, error: new Error('offline') })); await flush(); expect(f.text()).toContain('Couldn’t load'); expect(f.text()).not.toContain('completed plans will appear');
  await f.tap('Try again to load people from your plans'); expect(f.rows()).toHaveLength(2); f.type('missing'); await flush(); expect(f.text()).toContain('No matches');
  await f.tap('Clear name search'); expect(f.rows()).toHaveLength(2);
  act(() => { f.client.setQueryData(yoursKeys.backlog('alice'), []); }); await flush(); expect(f.text()).toContain('People from completed plans will appear');
});
it('backlog pending is not Requested; confirmed mutual outcome becomes Connected', async () => {
  const write = deferred<any>(), original = mockRpc.getMockImplementation()!; mockRpc.mockImplementation((name, args) => name === 'add_or_accept_person' ? write.promise : original(name, args));
  const f = mount('backlog'); await flush(); await f.tap('Add Bea'); expect(f.rows()[0].props.isAdding).toBe(true); expect(f.rows()[0].props.state).toBe('none');
  await act(async () => write.resolve({ data: 'now_connected', error: null })); await flush(); expect(f.rows()[0].props.state).toBe('connected');
});
it('backlog existing requested rows never dispatch an Add', async () => {
  mockRpc.mockResolvedValue({ data: [backlogPerson('Bea', 'requested')], error: null }); const f = mount('backlog'); await flush(); const row = f.rows()[0];
  expect(row.props.state).toBe('requested'); act(() => row.props.onAdd()); await flush(); expect(writes()).toHaveLength(0);
});
it('backlog eligibility changes during preflight cancel dispatch without false error on the confirmed row', async () => {
  const auth = deferred<any>(); mockGetUser.mockReturnValueOnce(auth.promise); const f = mount('backlog'); await flush(); await f.tap('Add Bea');
  act(() => { f.client.setQueryData(yoursKeys.backlog('alice'), [backlogPerson('Bea', 'requested')]); }); await flush();
  await act(async () => auth.resolve({ data: { user: { id: 'alice' } }, error: null })); await flush(); expect(writes()).toHaveLength(0); expect(f.rows()[0].props.state).toBe('requested'); expect(f.rows()[0].props.isAdding).toBe(false);
});
it('backlog late result cannot replace another filtered person or new account state', async () => {
  const write = deferred<any>(), original = mockRpc.getMockImplementation()!; mockRpc.mockImplementation((name, args) => name === 'add_or_accept_person' ? write.promise : original(name, args));
  const f = mount('backlog'); await flush(); await f.tap('Add Bea'); f.type('zo'); await flush();
  await act(async () => write.resolve({ error: new Error('blocked') })); await flush(); expect(f.rows().map(r => r.props.name)).toEqual(['Zoe']); expect(f.text()).not.toContain("You can't add");
  f.auth('bob'); await flush(); expect(f.input().props.value).toBe(''); expect(f.rows().every(r => !r.props.isAdding)).toBe(true);
});
it('guarded profile tap opens exactly the displayed person', async () => {
  const f = mount('backlog'); await flush(); act(() => f.rows()[1].props.onPressPerson()); expect(f.open).toHaveBeenCalledWith('Zoe');
});
