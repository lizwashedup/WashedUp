import React from 'react';
import { Alert, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import PeopleSearchResults from '../PeopleSearchResults';
import { AfterglowFallbackFonts } from '../../../../constants/Typography';
import type { SearchPerson, YoursGridPerson } from '../../../../lib/yours/types';

const mockSearch = jest.fn(), mockSend = jest.fn(), mockRefetch = jest.fn();
jest.mock('../../../../hooks/usePeopleSearch', () => ({ usePeopleSearch: (...args: unknown[]) => mockSearch(...args) }));
jest.mock('../../../../hooks/usePeopleConnectionMutations', () => ({
  usePeopleConnectionMutations: () => ({ sendRequest: { mutateAsync: mockSend } }),
  friendlyConnectionError: () => 'Request failed. Try again.',
}));
jest.mock('../../paths/PersonRow', () => ({ __esModule: true, default: (props: unknown) => require('react').createElement('PersonRow', props) }));
const remote = (id = 'new', handle = 'amelia', state: SearchPerson['connection_state'] = 'none'): SearchPerson => ({ user_id: id, first_name_display: handle, handle, profile_photo_url: null, shared_count: 0, connection_state: state });
const local = (id = 'local', name = 'Amelia', handle = 'amelia'): YoursGridPerson => ({ user_id: id, first_name_display: name, handle, profile_photo_url: null, shared_count: 2, ring_bucket: 'none', milestone: null, upcoming_event_id: null, upcoming_title: null, upcoming_start: null, upcoming_neighborhood: null, connected_at: '' });
let result: { data: SearchPerson[]; isFetching: boolean; isError: boolean; refetch: typeof mockRefetch };
const cleanup: Array<() => void> = [];
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function mount(extra: Partial<React.ComponentProps<typeof PeopleSearchResults>> = {}) {
  let props = { userId: 'alice', query: 'amelia', people: [] as YoursGridPerson[], onOpenPerson: jest.fn(), onOpenMinimal: jest.fn(), appearance: { fonts: AfterglowFallbackFonts }, ...extra };
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<PeopleSearchResults {...props} />); });
  let closed = false; const unmount = () => { if (!closed) act(() => tree.unmount()); closed = true; }; cleanup.push(unmount);
  return { tree, unmount, props,
    update: (next: Partial<typeof props> = {}) => { props = { ...props, ...next }; act(() => tree.update(<PeopleSearchResults {...props} />)); },
    settle: () => act(() => jest.advanceTimersByTime(300)),
    rows: () => tree.root.findAllByType('PersonRow' as any),
    text: () => tree.root.findAllByType(Text).map(n => n.props.children).flat().join(' '),
    retry: () => tree.root.findAll(n => n.props.accessibilityLabel === 'Retry handle lookup' && typeof n.props.onPress === 'function')[0],
  };
}
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  result = { data: [remote()], isFetching: false, isError: false, refetch: mockRefetch };
  mockSearch.mockImplementation(() => result); mockSend.mockResolvedValue('requested'); mockRefetch.mockResolvedValue({});
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); jest.restoreAllMocks(); jest.useRealTimers(); });

it('preserves local substring names, optional @ handles and relationship-page routing', () => {
  const f = mount({ query: '@AME', people: [local(), local('other', 'Luca', 'lucas')] });
  expect(mockSearch).toHaveBeenCalledWith('alice', '@AME'); expect(f.rows()).toHaveLength(1);
  act(() => f.rows()[0].props.onPressPerson()); expect(f.props.onOpenPerson).toHaveBeenCalledWith('local'); expect(f.props.onOpenMinimal).not.toHaveBeenCalled();
  expect(f.rows()[0].props.state).toBe('connected');
});
it('retains exact remote lookup, normalization, local dedup and minimal-profile destination', () => {
  result.data = [remote('local'), remote('new'), remote('wrong', 'ameliabelle')];
  const f = mount({ query: ' @@AMELIA ', people: [local()] }); f.settle();
  expect(f.rows().map(n => n.props.name)).toEqual(['Amelia', 'amelia']);
  act(() => f.rows()[1].props.onPressPerson()); expect(f.props.onOpenMinimal).toHaveBeenCalledWith('new');
});
it('does not expose a remote old-handle row during the current query debounce', () => {
  const f = mount(); expect(f.rows()).toHaveLength(0); expect(f.text()).toContain('Looking up handle'); f.settle(); expect(f.rows()).toHaveLength(1);
  const oldAdd = f.rows()[0].props.onAdd; f.update({ query: 'luca' }); expect(f.rows()).toHaveLength(0);
  act(() => oldAdd()); expect(mockSend).not.toHaveBeenCalled(); f.settle(); expect(f.rows()).toHaveLength(0);
});
it('does not query or display remote rows below two normalized characters', () => {
  result.data = [remote('short', 'a')]; const f = mount({ query: '@a' }); f.settle();
  expect(f.rows()).toHaveLength(0); expect(f.text()).not.toContain('Looking up');
});
it('shows current loading with local matches still present', () => {
  result.isFetching = true; result.data = []; const f = mount({ people: [local()] }); f.settle();
  expect(f.rows()).toHaveLength(1); expect(f.text()).toContain('Looking up handle'); expect(f.text()).not.toContain('Try a name');
});
it('offers explicit retry for remote error without discarding query or accepted local people', async () => {
  result.isError = true; result.data = []; const f = mount({ people: [local()] }); f.settle();
  expect(f.rows()).toHaveLength(1); expect(f.text()).toContain('Couldn’t look up that handle');
  expect(f.text()).not.toContain('No one by that name'); await act(async () => f.retry().props.onPress()); expect(mockRefetch).toHaveBeenCalledTimes(1);
  expect(mockSearch).toHaveBeenLastCalledWith('alice', 'amelia');
});
it('shows empty match feedback only after current lookup settles', () => {
  result.data = []; const f = mount(); expect(f.text()).not.toContain('Try a name'); f.settle(); expect(f.text()).toContain('Try a name or handle');
});
it('prevents an old retry control from refetching a new query', () => {
  result.isError = true; result.data = []; const f = mount(); f.settle(); const retry = f.retry().props.onPress;
  f.update({ query: 'luca' }); act(() => retry()); expect(mockRefetch).not.toHaveBeenCalled();
});
it('locks rapid Add taps immediately and uses the existing handshake context', async () => {
  const pending = deferred<string>(); mockSend.mockReturnValue(pending.promise); const f = mount(); f.settle(); const add = f.rows()[0].props.onAdd;
  act(() => { add(); add(); }); expect(mockSend).toHaveBeenCalledTimes(1); expect(mockSend).toHaveBeenCalledWith({ recipientId: 'new', context: 'handle_lookup' });
  expect(f.rows()[0].props.isAdding).toBe(true); expect(f.rows()[0].props.state).toBe('none');
  await act(async () => pending.resolve('requested')); expect(f.rows()[0].props.isAdding).toBe(false); expect(f.rows()[0].props.state).toBe('requested');
});
it.each(['now_connected', 'already_connected'])('renders %s as connected instead of a permanent Requested label', async (outcome) => {
  mockSend.mockResolvedValue(outcome); const f = mount(); f.settle(); await act(async () => f.rows()[0].props.onAdd());
  expect(f.rows()[0].props.state).toBe('connected'); expect(mockRefetch).toHaveBeenCalledTimes(1);
});
it('failed Add restores the action and supports retry', async () => {
  mockSend.mockRejectedValueOnce(new Error('offline')); const f = mount(); f.settle(); await act(async () => f.rows()[0].props.onAdd());
  expect(f.rows()[0].props.state).toBe('none'); expect(f.rows()[0].props.isAdding).toBe(false); expect(Alert.alert).toHaveBeenCalledTimes(1);
  await act(async () => f.rows()[0].props.onAdd()); expect(mockSend).toHaveBeenCalledTimes(2); expect(f.rows()[0].props.state).toBe('requested');
});
it('does not show failed request alerts after leaving its query', async () => {
  const pending = deferred<string>(); mockSend.mockReturnValue(pending.promise); const f = mount(); f.settle(); act(() => f.rows()[0].props.onAdd());
  f.update({ query: 'luca' }); await act(async () => pending.reject(new Error('offline'))); expect(Alert.alert).not.toHaveBeenCalled();
});
it('does not leak requested state or late outcomes across accounts, including A to B to A', async () => {
  const pending = deferred<string>(); mockSend.mockReturnValue(pending.promise); const f = mount(); f.settle(); const oldAdd = f.rows()[0].props.onAdd; act(() => oldAdd());
  f.update({ userId: 'bob' }); f.settle(); expect(f.rows()[0].props.isAdding).toBe(false);
  f.update({ userId: 'alice' }); f.settle(); act(() => oldAdd()); expect(mockSend).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve('requested')); expect(f.rows()[0].props.state).toBe('none'); expect(mockRefetch).not.toHaveBeenCalled();
});
it('keeps a successful request by person while querying another handle, without refetching that new handle', async () => {
  const pending = deferred<string>(); mockSend.mockReturnValue(pending.promise); const f = mount(); f.settle(); act(() => f.rows()[0].props.onAdd());
  f.update({ query: 'luca' }); await act(async () => pending.resolve('requested')); expect(mockRefetch).not.toHaveBeenCalled();
  f.update({ query: 'amelia' }); f.settle(); expect(f.rows()[0].props.state).toBe('requested');
});
it.each(['incoming', 'connected', 'requested'] as const)('preserves %s server state and refuses an Add callback', (state) => {
  result.data = [remote('new', 'amelia', 'none')]; const f = mount(); f.settle(); const oldAdd = f.rows()[0].props.onAdd;
  result.data = [remote('new', 'amelia', state)]; f.update(); expect(f.rows()[0].props.state).toBe(state); act(() => oldAdd()); expect(mockSend).not.toHaveBeenCalled();
});
it('ignores a rejected operation after unmount', async () => {
  const pending = deferred<string>(); mockSend.mockReturnValue(pending.promise); const f = mount(); f.settle(); act(() => f.rows()[0].props.onAdd()); f.unmount();
  await act(async () => pending.reject(new Error('offline'))); expect(Alert.alert).not.toHaveBeenCalled(); expect(mockRefetch).not.toHaveBeenCalled();
});
