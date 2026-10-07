import React from 'react';
import { Alert, Modal, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AddPeopleSheet from '../AddPeopleSheet';
import { YOURS_GRID_KEYS } from '../../../lib/yours/shapeGuard';

const mockGrid = jest.fn(), mockAdd = jest.fn(), mockGetUser = jest.fn();
let mockViewer: string | null = 'alice';
const mockListeners = new Set<(event: string, session: { user: { id: string } } | null) => void>();
jest.mock('../../../lib/supabase', () => ({ supabase: {
  rpc: (name: string, args: unknown) => {
    if (name === 'get_yours_grid') return mockGrid(args);
    if (name === 'invite_to_circle') return mockAdd(args);
    throw new Error('Unexpected RPC');
  },
  auth: { getUser: () => mockGetUser(), onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
    mockListeners.add(callback); return { data: { subscription: { unsubscribe: () => mockListeners.delete(callback) } } };
  } },
} }));
jest.mock('../../yours/state/useAuthUserId', () => ({ useAuthUserId: () => ({ data: mockViewer }) }));
jest.mock('../../../lib/haptics', () => ({ hapticSelection: jest.fn() }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('lucide-react-native', () => ({ Check: () => null, X: () => null, Search: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
function person(id = 'bob', name = 'Bob') { return { ...Object.fromEntries(YOURS_GRID_KEYS.map(key => [key, null])), user_id: id, first_name_display: name }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function flush() { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
const cleanup: Array<() => void> = [];
function mount(extra: Partial<React.ComponentProps<typeof AddPeopleSheet>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  const done = jest.fn(), close = jest.fn();
  let props = { visible: true, circleId: 'circle-a', existingMemberIds: ['existing'], onAdded: done, onClose: close, ...extra };
  let tree!: ReturnType<typeof create>; let closed = false;
  const render = () => <QueryClientProvider client={client}><AddPeopleSheet {...props} /></QueryClientProvider>;
  act(() => { tree = create(render()); });
  const unmount = () => { if (!closed) act(() => tree.unmount()); closed = true; };
  cleanup.push(() => { unmount(); client.clear(); });
  const update = (next: Partial<typeof props>) => { props = { ...props, ...next }; act(() => tree.update(render())); };
  const button = (label: string) => tree.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
  return { tree, client, close, done, update, unmount, button,
    confirm: () => tree.root.findAll(node => String(node.props.accessibilityLabel).startsWith('Add ') && typeof node.props.onPressIn === 'function')[0],
    choose: (label = 'Bob') => act(() => button(label)!.props.onPress()),
    text: () => tree.root.findAllByType(Text).map(node => node.props.children).flat().join(' '),
    auth: (id: string | null) => { mockViewer = id; act(() => { for (const listener of mockListeners) listener(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null); }); update({}); },
  };
}
beforeEach(() => {
  jest.clearAllMocks(); mockViewer = 'alice'; mockListeners.clear();
  mockGetUser.mockReset().mockImplementation(async () => ({ data: { user: mockViewer ? { id: mockViewer } : null }, error: null }));
  mockGrid.mockReset().mockResolvedValue({ data: [person(), person('existing', 'Already here')], error: null });
  mockAdd.mockReset().mockResolvedValue({ data: 1, error: null });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); jest.restoreAllMocks(); });

it('preserves accepted-person filtering and direct-add recipients', async () => {
  const f = mount(); await flush(); expect(f.button('Already here')).toBeUndefined(); f.choose();
  act(() => { void f.confirm().props.onPress(); }); await flush();
  expect(mockAdd).toHaveBeenCalledWith({ p_circle_id: 'circle-a', p_user_ids: ['bob'] });
  expect(f.done).toHaveBeenCalledTimes(1); expect(f.close).toHaveBeenCalledTimes(1);
});
it('starts no people read while hidden', async () => {
  mount({ visible: false }); await flush(); expect(mockGrid).not.toHaveBeenCalled();
});
it('clears selection across close and reopen of the same circle', async () => {
  const f = mount(); await flush(); f.choose(); f.update({ visible: false }); f.update({ visible: true }); await flush();
  expect(f.confirm().props.disabled).toBe(true);
});
it('clears selection when the circle changes', async () => {
  const f = mount(); await flush(); f.choose(); f.update({ circleId: 'circle-b' }); await flush();
  expect(f.confirm().props.disabled).toBe(true);
});
it('does not submit a selected person who has since become a member', async () => {
  const f = mount(); await flush(); f.choose(); const submit = f.confirm().props.onPress;
  f.update({ existingMemberIds: ['existing', 'bob'] }); act(() => { void submit(); }); await flush();
  expect(mockAdd).not.toHaveBeenCalled();
});
it('locks rapid submit but allows dismissal during an unfinished network request', async () => {
  const write = deferred<{ data: number; error: null }>(); mockAdd.mockReturnValue(write.promise);
  const f = mount(); await flush(); f.choose(); const submit = f.confirm().props.onPress;
  const close = f.tree.root.findByType(Modal).props.onRequestClose;
  act(() => { submit(); submit(); }); await flush();
  expect(mockAdd).toHaveBeenCalledTimes(1);
  act(() => { close(); close(); }); expect(f.close).toHaveBeenCalledTimes(1);
  f.update({ visible: false }); f.update({ visible: true }); await flush(); f.choose();
  await act(async () => write.resolve({ data: 1, error: null })); await flush();
  expect(f.done).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledTimes(1);
  expect(f.confirm().props.disabled).toBe(false);
});
it('does not dispatch an add when the sheet closes before its auth check begins', async () => {
  const f = mount(); await flush(); f.choose();
  act(() => { void f.confirm().props.onPress(); f.tree.root.findByType(Modal).props.onRequestClose(); });
  await flush();
  expect(f.close).toHaveBeenCalledTimes(1); expect(mockAdd).not.toHaveBeenCalled();
  expect(f.done).not.toHaveBeenCalled(); expect(Alert.alert).not.toHaveBeenCalled();
});
it('does not close or alert into a reopened sheet after an old request fails', async () => {
  const write = deferred<{ data: null; error: Error }>(); mockAdd.mockReturnValue(write.promise);
  const f = mount(); await flush(); f.choose(); act(() => { void f.confirm().props.onPress(); }); await flush();
  f.update({ visible: false }); f.update({ visible: true }); await flush(); f.choose();
  await act(async () => write.resolve({ data: null, error: new Error('late failure') })); await flush();
  expect(Alert.alert).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled(); expect(f.confirm().props.disabled).toBe(false);
});
it('shows a people read error with retry instead of the no-people empty state', async () => {
  mockGrid.mockResolvedValue({ data: null, error: new Error('read failed') }); const f = mount(); await flush();
  expect(f.text()).not.toContain('Everyone you know is already here.');
  expect(f.button('Retry loading your people')).toBeDefined(); expect(f.button('Bob')).toBeUndefined();
});

it('retries a current people error without adding anyone', async () => {
  mockGrid.mockResolvedValueOnce({ data: null, error: new Error('read failed') });
  const f = mount(); await flush();
  await act(async () => { await f.button('Retry loading your people').props.onPress(); }); await flush();
  expect(f.button('Bob')).toBeDefined(); expect(mockAdd).not.toHaveBeenCalled();
});

it('keeps an initial account error retryable without exposing cached people', async () => {
  mockGetUser.mockRejectedValueOnce(new Error('identity failed'));
  const f = mount(); f.client.setQueryData(['yours', 'grid', 'alice'], [person('private', 'Cached person')]); await flush();
  expect(f.button('Cached person')).toBeUndefined(); expect(mockGrid).not.toHaveBeenCalled();
  await act(async () => { await f.button('Retry loading your people').props.onPress(); }); await flush();
  expect(f.button('Bob')).toBeDefined(); expect(mockAdd).not.toHaveBeenCalled();
});

it('does not expose an old A grid after account A to B to A', async () => {
  const old = deferred<{ data: ReturnType<typeof person>[]; error: null }>();
  mockGrid.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ data: [person('b-person', 'B person')], error: null })
    .mockResolvedValueOnce({ data: [person('a-new', 'Current A person')], error: null });
  const f = mount(); await flush(); f.auth('other'); await flush();
  expect(f.button('B person')).toBeDefined(); f.auth('alice'); await flush();
  expect(f.button('Current A person')).toBeDefined();
  await act(async () => old.resolve({ data: [person('private-old', 'Retired A person')], error: null })); await flush();
  expect(f.button('Retired A person')).toBeUndefined(); expect(f.button('B person')).toBeUndefined();
  expect(f.button('Current A person')).toBeDefined();
});

it('rejects a late initial account read after a newer account event', async () => {
  const initial = deferred<{ data: { user: { id: string } }; error: null }>(); mockGetUser.mockReturnValueOnce(initial.promise);
  const f = mount(); await flush(); f.auth('other'); await flush();
  await act(async () => initial.resolve({ data: { user: { id: 'alice' } }, error: null })); await flush();
  expect(mockGrid).toHaveBeenCalledTimes(1); expect(mockGrid).toHaveBeenCalledWith({ p_user_id: 'other' });
});

it('does not restore an old people read into a reopened sheet', async () => {
  const old = deferred<{ data: ReturnType<typeof person>[]; error: null }>();
  mockGrid.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ data: [person('new', 'Current person')], error: null });
  const f = mount(); await flush(); f.update({ visible: false }); f.update({ visible: true }); await flush();
  await act(async () => old.resolve({ data: [person('old', 'Old person')], error: null })); await flush();
  expect(f.button('Old person')).toBeUndefined(); expect(f.button('Current person')).toBeDefined();
});

it('does not publish a late add success after unmount or into a replacement account', async () => {
  const write = deferred<{ data: number; error: null }>(); mockAdd.mockReturnValue(write.promise);
  const f = mount(); await flush(); f.choose(); act(() => { void f.confirm().props.onPress(); }); await flush();
  f.auth('other'); await flush();
  await act(async () => write.resolve({ data: 1, error: null })); await flush();
  expect(f.done).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled(); expect(Alert.alert).not.toHaveBeenCalled();
  f.unmount(); expect(mockListeners.size).toBe(0);
});

it('retains selection and the existing membership after a current add failure for manual retry', async () => {
  mockAdd.mockResolvedValueOnce({ data: null, error: new Error('trust check failed') });
  const f = mount(); await flush(); f.choose(); act(() => { void f.confirm().props.onPress(); }); await flush();
  expect(f.done).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled();
  expect(f.button('Bob').props.accessibilityState.checked).toBe(true);
  expect(f.button('Already here')).toBeUndefined(); expect(f.confirm().props.disabled).toBe(false);
  act(() => { void f.confirm().props.onPress(); }); await flush(); expect(f.done).toHaveBeenCalledTimes(1);
  expect(mockAdd.mock.calls[0]).toEqual(mockAdd.mock.calls[1]);
});

it('holds a missing account or explicit null parent scope without querying people', async () => {
  mockViewer = null; const f = mount(); await flush(); expect(mockGrid).not.toHaveBeenCalled();
  f.auth('alice'); f.update({ scope: null }); await flush(); expect(f.button('Bob')).toBeUndefined();
  const close = f.tree.root.findByType(Modal).props.onRequestClose;
  act(() => close()); expect(f.close).toHaveBeenCalledTimes(1); expect(mockAdd).not.toHaveBeenCalled();
});

it('refuses a retained selection and submit after parent scope retirement', async () => {
  let current = true; const f = mount({ scope: { userId: 'alice', isCurrent: () => current } }); await flush();
  const select = f.button('Bob').props.onPress; f.choose(); const confirm = f.confirm().props.onPress;
  current = false;
  await act(async () => { select(); await confirm(); }); expect(mockAdd).not.toHaveBeenCalled();
});

it('treats an unknown people result as an error, not an empty relationship list', async () => {
  mockGrid.mockResolvedValue({ data: null, error: null }); const f = mount(); await flush();
  expect(f.button('Retry loading your people')).toBeDefined(); expect(f.text()).not.toContain('Everyone you know is already here.');
});
