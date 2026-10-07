import React from 'react';
import { Alert, Modal, StyleSheet, Text, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AddPeopleSheet from '../AddPeopleSheet';
import PeopleSearchBar from '../../yours/search/PeopleSearchBar';
import { AfterglowFonts } from '../../../constants/Typography';
import { AfterglowColors } from '../../../constants/Colors';
import { YOURS_GRID_KEYS } from '../../../lib/yours/shapeGuard';

const mockGrid = jest.fn(), mockAdd = jest.fn(), mockGetUser = jest.fn();
const mockListeners = new Set<(event: string, session: { user: { id: string } } | null) => void>();
let mockViewer: string | null = 'alice';
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
jest.mock('../../../lib/haptics', () => ({ hapticSelection: jest.fn() }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('lucide-react-native', () => ({ Check: () => null, X: () => null, Search: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));

const appearance = { fonts: AfterglowFonts };
function person(id = 'bob', name = 'Bob', photo: string | null = null) {
  return { ...Object.fromEntries(YOURS_GRID_KEYS.map(key => [key, null])), user_id: id,
    first_name_display: name, handle: `@${id}`, profile_photo_url: photo };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function flush() { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
function textOf(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textOf).join('');
  if (React.isValidElement(value)) return textOf((value.props as { children?: unknown }).children);
  return '';
}
const cleanup: Array<() => void> = [];
function mount(extra: Partial<React.ComponentProps<typeof AddPeopleSheet>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  const close = jest.fn(), done = jest.fn();
  let props = { appearance, visible: true, circleId: 'circle-a', existingMemberIds: ['existing'], onAdded: done, onClose: close, ...extra };
  let tree!: ReturnType<typeof create>, closed = false;
  const render = () => <QueryClientProvider client={client}><AddPeopleSheet {...props} /></QueryClientProvider>;
  act(() => { tree = create(render()); });
  const unmount = () => { if (!closed) act(() => tree.unmount()); closed = true; };
  cleanup.push(() => { unmount(); client.clear(); });
  const button = (label: string) => tree.root.findAll(node => (node.props.accessibilityLabel === label || node.props.accessibilityLabel?.startsWith(`${label}, @`)) && typeof node.props.onPress === 'function')[0];
  return { tree, client, close, done, unmount, button,
    update: (next: Partial<typeof props>) => { props = { ...props, ...next }; act(() => tree.update(render())); },
    choose: (name = 'Bob') => act(() => { button(name).props.onPress(); }),
    text: () => tree.root.findAllByType(Text).map(node => textOf(node.props.children)).join(' '),
    changeQuery: (query: string) => act(() => { tree.root.findByType(TextInput).props.onChangeText(query); }),
    data: (people: ReturnType<typeof person>[]) => act(() => { const query = client.getQueryCache().getAll().find(q => q.queryKey.includes('circle-add'))!; client.setQueryData(query.queryKey, people); }),
  };
}
beforeEach(() => {
  jest.clearAllMocks(); mockViewer = 'alice'; mockListeners.clear();
  mockGetUser.mockReset().mockImplementation(async () => ({ data: { user: mockViewer ? { id: mockViewer } : null }, error: null }));
  mockGrid.mockReset().mockResolvedValue({ data: [person('alice', 'Self'), person(), person('existing', 'Already here')], error: null });
  mockAdd.mockReset().mockResolvedValue({ data: 1, error: null });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); jest.restoreAllMocks(); });

it('keeps accepted people and current-member exclusion while showing an explicit selection count', async () => {
  const f = mount(); await flush(); expect(f.button('Self')).toBeUndefined(); expect(f.button('Already here')).toBeUndefined();
  expect(f.text()).toContain('@bob'); expect(f.text()).not.toContain('@@bob');
  expect(f.button('Bob').props.accessibilityLabel).toBe('Bob, @bob');
  expect(f.text()).toContain('0 selected'); expect(f.button('Add people').props.disabled).toBe(true);
  f.choose(); expect(f.text()).toContain('1 selected');
  expect(f.button('Bob').props.accessibilityState).toEqual({ checked: true, disabled: false });
  await act(async () => { await f.button('Add 1 person').props.onPress(); }); await flush();
  expect(mockAdd).toHaveBeenCalledWith({ p_circle_id: 'circle-a', p_user_ids: ['bob'] });
  expect(f.close).toHaveBeenCalledTimes(1); expect(f.done).toHaveBeenCalledTimes(1);
});

it('uses full-color 54px photos with initials on failure and isolates replacement identities', async () => {
  mockGrid.mockResolvedValue({ data: [person('bob', 'Bob', 'https://fixture.invalid/bob.jpg')], error: null });
  const f = mount(); await flush(); const photo = f.tree.root.findByType(Image);
  expect(StyleSheet.flatten(photo.props.style)).toMatchObject({ width: 54, height: 54, opacity: 1 });
  const oldFailure = photo.props.onError;
  act(() => { oldFailure(); }); expect(f.tree.root.findAllByType(Image)).toHaveLength(0); expect(f.text()).toContain('B');
  f.data([person('bob', 'Bob', 'https://fixture.invalid/replacement.jpg')]); await flush();
  expect(f.tree.root.findByType(Image).props.source.uri).toContain('replacement.jpg');
  act(() => { oldFailure(); }); expect(f.tree.root.findAllByType(Image)).toHaveLength(1);
  f.data([person('amelia', 'Amelia', 'https://fixture.invalid/replacement.jpg')]); await flush();
  act(() => { f.tree.root.findByType(Image).props.onError(); }); expect(f.text()).toContain('A');
  expect(f.button('Bob')).toBeUndefined(); expect(f.button('Amelia')).toBeDefined();
});

it('keeps names readable and the staged action and close targets at least 44px', async () => {
  mockGrid.mockResolvedValue({ data: [person('long', 'A very long first name that needs room')], error: null });
  const f = mount(); await flush();
  const name = f.tree.root.findAllByType(Text).find(node => textOf(node.props.children).startsWith('A very long'))!;
  expect(name.props.numberOfLines).toBeUndefined(); expect(StyleSheet.flatten(name.props.style).fontFamily).toBe(AfterglowFonts.semibold);
  const close = f.tree.root.findAll(node => node.props.accessibilityLabel === 'Cancel' && typeof node.props.onPress === 'function')
    .find(node => StyleSheet.flatten(node.props.style)?.width === 44)!;
  expect(StyleSheet.flatten(close.props.style).height).toBe(44);
  expect(StyleSheet.flatten(f.button('Add people').props.style)).toMatchObject({ minHeight: 46, borderRadius: 4, backgroundColor: AfterglowColors.clay });
});

it('distinguishes loading and retryable read failure from an empty accepted-people list', async () => {
  const read = deferred<{ data: null; error: Error }>(); mockGrid.mockReturnValueOnce(read.promise);
  const f = mount(); await flush(); expect(f.text()).toContain('Loading your people…');
  await act(async () => { read.resolve({ data: null, error: new Error('offline') }); }); await flush();
  expect(f.text()).toContain('Couldn’t load your people.'); expect(f.text()).not.toContain('Bring your people along.');
  await act(async () => { await f.button('Try again to load your people').props.onPress(); }); await flush();
  expect(f.button('Bob')).toBeDefined(); expect(mockAdd).not.toHaveBeenCalled();
});

it('makes no accepted people and everyone already in the circle distinct, dismissible states', async () => {
  mockGrid.mockResolvedValueOnce({ data: [], error: null }); const empty = mount(); await flush();
  expect(empty.text()).toContain('Bring your people along.'); expect(empty.text()).not.toContain('already here');
  act(() => { empty.button('Done').props.onPress(); }); expect(empty.close).toHaveBeenCalledTimes(1);
  const included = mount({ existingMemberIds: ['bob', 'existing'] }); await flush();
  expect(included.text()).toContain('Everyone’s already here.'); expect(included.button('Done')).toBeDefined();
});

it('shows no-match feedback and keeps the same input node while local filtering and clearing', async () => {
  const people = Array.from({ length: 11 }, (_, i) => person(`p${i}`, `Person ${i}`));
  mockGrid.mockResolvedValue({ data: people, error: null }); const f = mount(); await flush();
  const input = f.tree.root.findByType(TextInput); f.changeQuery('zzzz');
  expect(f.text()).toContain('No matches in your people.'); expect(f.tree.root.findByType(TextInput)).toBe(input);
  act(() => { f.button('Clear search').props.onPress(); }); expect(input.props.value).toBe('');
  expect(f.button('Person 0')).toBeDefined(); expect(mockGrid).toHaveBeenCalledTimes(1);
});

it('retains selected people outside a name/handle query and never filters behind a hidden field', async () => {
  const people = Array.from({ length: 11 }, (_, i) => person(`p${i}`, `Person ${i}`));
  mockGrid.mockResolvedValue({ data: people, error: null }); const f = mount(); await flush();
  f.choose('Person 0'); f.changeQuery('@P10');
  expect(f.button('Person 0')).toBeDefined(); expect(f.button('Person 10')).toBeDefined(); expect(f.button('Person 1')).toBeUndefined();
  f.update({ existingMemberIds: ['p10'] });
  expect(f.tree.root.findAllByType(TextInput)).toHaveLength(0); expect(f.button('Person 1')).toBeDefined();
  expect(f.button('Person 10')).toBeUndefined(); expect(f.button('Person 0').props.accessibilityState.checked).toBe(true);
});

it('locks immediate duplicate adds, waits for confirmation, and retains selection for current failure retry', async () => {
  const write = deferred<{ data: null; error: Error }>(); mockAdd.mockReturnValueOnce(write.promise);
  const f = mount(); await flush(); f.choose(); const add = f.button('Add 1 person').props.onPress;
  act(() => { void add(); void add(); }); await flush();
  expect(mockAdd).toHaveBeenCalledTimes(1); expect(f.text()).toContain('Adding…');
  expect(f.button('Adding 1 person…').props.accessibilityState).toEqual({ disabled: true, busy: true });
  expect(f.close).not.toHaveBeenCalled(); expect(f.done).not.toHaveBeenCalled();
  await act(async () => { write.resolve({ data: null, error: new Error('network interrupted') }); }); await flush();
  expect(f.text()).toContain('Couldn’t confirm the add. Your selection is still here.');
  expect(f.button('Bob').props.accessibilityState.checked).toBe(true); expect(Alert.alert).not.toHaveBeenCalled();
  await act(async () => { await f.button('Try again to add 1 person').props.onPress(); }); await flush();
  expect(mockAdd.mock.calls[0]).toEqual(mockAdd.mock.calls[1]); expect(f.done).toHaveBeenCalledTimes(1);
});

it('retires staged error feedback after closing and reopening during a request', async () => {
  const write = deferred<{ data: null; error: Error }>(); mockAdd.mockReturnValueOnce(write.promise);
  const f = mount(); await flush(); f.choose(); act(() => { void f.button('Add 1 person').props.onPress(); }); await flush();
  act(() => { f.tree.root.findByType(Modal).props.onRequestClose(); }); f.update({ visible: false }); f.update({ visible: true }); await flush();
  await act(async () => { write.resolve({ data: null, error: new Error('old failure') }); }); await flush();
  expect(f.text()).not.toContain('Couldn’t confirm the add.'); expect(f.text()).toContain('0 selected');
  expect(f.close).toHaveBeenCalledTimes(1); expect(f.done).not.toHaveBeenCalled();
});

it('does not offer a misleading retry for a retired parent circle', async () => {
  const f = mount({ scope: null }); await flush(); expect(mockGrid).not.toHaveBeenCalled();
  expect(f.text()).toContain('This circle isn’t available.'); expect(f.button('Try again to load your people')).toBeUndefined();
  act(() => { f.button('Close').props.onPress(); }); expect(f.close).toHaveBeenCalledTimes(1);
});

it('leaves default callers on their existing typography and pill action', async () => {
  const f = mount({ appearance: undefined }); await flush();
  expect(StyleSheet.flatten(f.button('Add 0 people').props.style).borderRadius).toBe(999);
  expect(f.text()).not.toContain('0 selected'); expect(f.text()).toContain('They join the moment you add them.');
});

it('keeps shared search controlled, preserves its input, and clears once from a 44px staged target', () => {
  const changed = jest.fn(); let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<PeopleSearchBar value="Amelia" onChange={changed} appearance={appearance} />); });
  cleanup.push(() => { act(() => tree.unmount()); }); const input = tree.root.findByType(TextInput);
  const clear = tree.root.findAll(node => node.props.accessibilityLabel === 'Clear search' && typeof node.props.onPress === 'function')[0];
  expect(StyleSheet.flatten(clear.props.style)).toMatchObject({ minWidth: 44, minHeight: 44 });
  act(() => { clear.props.onPress(); }); expect(changed).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledWith('');
  act(() => { tree.update(<PeopleSearchBar value="" onChange={changed} appearance={appearance} />); });
  expect(tree.root.findByType(TextInput)).toBe(input); expect(input.props.value).toBe('');
  act(() => { input.props.onChangeText('@bob'); }); expect(changed).toHaveBeenLastCalledWith('@bob');
});
