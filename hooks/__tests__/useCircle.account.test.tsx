import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCircle } from '../useCircle';
import { removeBlockedPrivateChatPreviews } from '../../lib/chatListCache';
import { circleKeys } from '../../lib/circles/keys';

const mockAuthListeners = new Set<(event: string, session: any) => void>();
const mockGetUser = jest.fn(), mockRpc = jest.fn();
jest.mock('../../lib/supabase', () => ({ supabase: {
  auth: { getUser: () => mockGetUser(), onAuthStateChange: (callback: any) => {
    mockAuthListeners.add(callback);
    return { data: { subscription: { unsubscribe: () => mockAuthListeners.delete(callback) } } };
  } },
  rpc: (...args: any[]) => {
    const result = mockRpc(...args);
    return Object.assign(result, { abortSignal: () => result });
  },
} }));
type Result = ReturnType<typeof useCircle>;
const auth = (id: string | null) => ({ data: { user: id ? { id } : null }, error: null });
const payload = (name: string) => ({ circle: { id: 'circle-one', name }, members: [] });
const answer = (name: string) => ({ data: payload(name), error: null });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

let tree: ReactTestRenderer | undefined, client: QueryClient, current: Result;
let activeId: string | null = 'circle-one';
function Harness({ id, capture }: { id: string | null; capture?: (r: Result) => void }) {
  const result = useCircle(id); (capture ?? (r => { current = r; }))(result); return null;
}
const render = () => <QueryClientProvider client={client}><Harness id={activeId} /></QueryClientProvider>;
async function flush() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function mount() { act(() => { tree = create(render()); }); await flush(); }
function emit(id: string | null, event = 'SIGNED_IN') {
  for (const listener of [...mockAuthListeners]) listener(event, id ? { user: { id } } : null);
}
async function changeAccount(id: string | null) { mockGetUser.mockResolvedValue(auth(id)); act(() => emit(id)); await flush(); }
beforeEach(() => {
  jest.clearAllMocks(); mockAuthListeners.clear(); activeId = 'circle-one';
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mockGetUser.mockResolvedValue(auth('account-a')); mockRpc.mockImplementation(() => Promise.resolve(answer('A circle')));
});
afterEach(async () => { act(() => tree?.unmount()); tree = undefined; client.clear(); await flush(); });

it('waits for identity and never manually fetches while signed out or disabled', async () => {
  const initial = deferred<ReturnType<typeof auth>>(); mockGetUser.mockReturnValue(initial.promise);
  await mount(); expect(current.isLoading).toBe(true); await current.refetch(); expect(mockRpc).not.toHaveBeenCalled();
  initial.resolve(auth(null)); await flush(); expect(current.isLoading).toBe(false); expect(current.data).toBeUndefined();
  await current.refetch(); expect(mockRpc).not.toHaveBeenCalled();
  activeId = null; act(() => tree!.update(render())); await changeAccount('account-a'); await current.refetch();
  expect(mockRpc).not.toHaveBeenCalled(); expect(current.isLoading).toBe(false);
});

it('ignores the old unscoped warm cache and keeps the existing RPC arguments', async () => {
  client.setQueryData(circleKeys.detail('circle-one'), payload('Old unscoped private data'));
  await mount(); expect(current.data?.circle.name).toBe('A circle');
  expect(mockRpc).toHaveBeenCalledWith('get_circle', { p_circle_id: 'circle-one' });
  expect(client.getQueryData([...circleKeys.detail('circle-one'), 'account-a', 1])).toEqual(payload('A circle'));
});

it('does not expose account A cached data while B is loading', async () => {
  await mount(); const b = deferred<ReturnType<typeof answer>>(); mockRpc.mockReturnValue(b.promise);
  await changeAccount('account-b'); expect(current.data).toBeUndefined(); expect(current.viewerId).toBe('account-b');
  b.resolve(answer('B circle')); await flush(); expect(current.data?.circle.name).toBe('B circle');
});

it('rejects an old response even if account A returns before it resolves', async () => {
  const old = deferred<ReturnType<typeof answer>>(); mockRpc.mockReturnValueOnce(old.promise);
  await mount(); act(() => { emit('account-b'); emit('account-a'); }); await flush();
  expect(current.viewerEpoch).toBe(3); expect(current.data?.circle.name).toBe('A circle');
  old.resolve(answer('Old A response')); await flush(); expect(current.data?.circle.name).toBe('A circle');
  expect(client.getQueryData([...circleKeys.detail('circle-one'), 'account-a', 1])).toBeUndefined();
});

it('keeps same-account token refresh warm without refetching or changing epoch', async () => {
  await mount(); const before = current.viewerEpoch;
  act(() => emit('account-a', 'TOKEN_REFRESHED')); await flush();
  expect(current.viewerEpoch).toBe(before); expect(mockRpc).toHaveBeenCalledTimes(1); expect(current.data?.circle.name).toBe('A circle');
});

it('keeps prefix invalidations compatible with existing Circle mutations', async () => {
  await mount(); mockRpc.mockResolvedValue(answer('Updated circle'));
  await act(async () => { await client.invalidateQueries({ queryKey: circleKeys.detail('circle-one') }); }); await flush();
  expect(mockRpc).toHaveBeenCalledTimes(2); expect(current.data?.circle.name).toBe('Updated circle');
});

it('blocks retained manual refetch after circle or account changes', async () => {
  await mount(); const old = current.refetch; activeId = 'circle-two'; act(() => tree!.update(render())); await flush();
  const second = current.refetch; await changeAccount('account-b'); mockRpc.mockClear();
  await old(); await second(); expect(mockRpc).not.toHaveBeenCalled();
});

it('hides cached details when a current refresh denies access', async () => {
  await mount(); mockRpc.mockResolvedValue({ data: null, error: new Error('Not a member') });
  await act(async () => { await current.refetch(); }); await flush();
  expect(current.isError).toBe(true); expect(current.data).toBeUndefined();
  mockRpc.mockResolvedValue(answer('Restored circle')); await act(async () => { await current.refetch(); }); await flush();
  expect(current.isError).toBe(false); expect(current.data?.circle.name).toBe('Restored circle');
});

it('allows retry after the initial identity check fails', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('Temporary identity failure') });
  await mount(); expect(current.isError).toBe(true); expect(mockRpc).not.toHaveBeenCalled();
  mockGetUser.mockResolvedValue(auth('account-a')); await act(async () => { await current.refetch(); }); await flush();
  expect(current.isError).toBe(false); expect(current.data?.circle.name).toBe('A circle');
});

it('does not dispatch when the pre-RPC account check disagrees with the observed viewer', async () => {
  mockGetUser.mockResolvedValueOnce(auth('account-a')).mockResolvedValue(auth('account-b'));
  await mount(); expect(mockRpc).not.toHaveBeenCalled(); expect(current.data).toBeUndefined(); expect(current.isError).toBe(true);
});

it('shares a pending query across same-account observers when its first component unmounts', async () => {
  const pending = deferred<ReturnType<typeof answer>>(); mockRpc.mockReturnValue(pending.promise);
  let second!: Result;
  const pair = (showFirst: boolean) => <QueryClientProvider client={client}>
    {showFirst && <Harness key="first" id="circle-one" />}
    <Harness key="second" id="circle-one" capture={result => { second = result; }} />
  </QueryClientProvider>;
  act(() => { tree = create(pair(true)); }); await flush(); expect(mockRpc).toHaveBeenCalledTimes(1);
  act(() => tree!.update(pair(false))); pending.resolve(answer('Shared circle')); await flush();
  expect(second.data?.circle.name).toBe('Shared circle'); expect(second.isError).toBe(false);
});

it('aborts a query with no remaining observers without caching its late response', async () => {
  const pending = deferred<ReturnType<typeof answer>>(); mockRpc.mockReturnValue(pending.promise);
  await mount(); const key = [...circleKeys.detail('circle-one'), 'account-a', 1];
  act(() => tree!.unmount()); tree = undefined; pending.resolve(answer('Late private payload')); await flush();
  expect(client.getQueryData(key)).toBeUndefined(); expect(mockAuthListeners.size).toBe(0);
});

it('does not read auth or subscribe for disabled circle-card details', async () => {
  activeId = null; await mount();
  expect(mockGetUser).not.toHaveBeenCalled(); expect(mockAuthListeners.size).toBe(0);
  expect(current.data).toBeUndefined(); expect(current.isLoading).toBe(false);
});

it('shares the same generation and warm query with a staggered observer after an account change', async () => {
  let second!: Result;
  const pair = (showSecond: boolean) => <QueryClientProvider client={client}>
    <Harness key="first" id="circle-one" />
    {showSecond && <Harness key="second" id="circle-one" capture={result => { second = result; }} />}
  </QueryClientProvider>;
  act(() => { tree = create(pair(false)); }); await flush(); await changeAccount('account-b');
  const epoch = current.viewerEpoch; const reads = mockRpc.mock.calls.length; const authReads = mockGetUser.mock.calls.length;
  act(() => tree!.update(pair(true))); await flush();
  expect(second.viewerEpoch).toBe(epoch); expect(mockRpc).toHaveBeenCalledTimes(reads);
  expect(mockGetUser).toHaveBeenCalledTimes(authReads); expect(mockAuthListeners.size).toBe(1);
  expect(second.data?.circle.name).toBe('A circle');
});

it('revalidates after all observers leave rather than reusing pre-transition warm cache', async () => {
  await mount(); const epoch = current.viewerEpoch;
  act(() => tree!.unmount()); tree = undefined;
  emit('account-b'); emit('account-a'); // No observer can establish what happened during this gap.
  const pending = deferred<ReturnType<typeof answer>>(); mockRpc.mockReturnValueOnce(pending.promise);
  await mount();
  expect(current.viewerEpoch).toBeGreaterThan(epoch); expect(current.data).toBeUndefined(); expect(mockRpc).toHaveBeenCalledTimes(2);
  pending.resolve(answer('Revalidated circle')); await flush(); expect(current.data?.circle.name).toBe('Revalidated circle');
});

it('renders a warm room when returning without requiring another query notification', async () => {
  await mount();
  activeId = 'circle-two'; act(() => tree!.update(render())); await flush();
  const reads = mockRpc.mock.calls.length;
  activeId = 'circle-one'; act(() => tree!.update(render())); await flush();
  expect(mockRpc).toHaveBeenCalledTimes(reads); expect(current.data?.circle.name).toBe('A circle');
});

it('shares one initial auth read and listener across enabled observers', async () => {
  const initial = deferred<ReturnType<typeof auth>>(); mockGetUser.mockReturnValueOnce(initial.promise);
  let second!: Result;
  act(() => { tree = create(<QueryClientProvider client={client}>
    <Harness id="circle-one" /><Harness id="circle-one" capture={result => { second = result; }} />
  </QueryClientProvider>); }); await flush();
  expect(mockGetUser).toHaveBeenCalledTimes(1); expect(mockAuthListeners.size).toBe(1);
  initial.resolve(auth('account-a')); await flush();
  expect(mockGetUser).toHaveBeenCalledTimes(2); // One shared identity read plus one pre-RPC check.
  expect(mockRpc).toHaveBeenCalledTimes(1); expect(second.data?.circle.name).toBe('A circle');
});

it('retires a last-observer initial read and its listener before a new observation cycle', async () => {
  const old = deferred<ReturnType<typeof auth>>(); mockGetUser.mockReturnValueOnce(old.promise);
  await mount(); const oldListener = [...mockAuthListeners][0];
  act(() => tree!.unmount()); tree = undefined; expect(mockAuthListeners.size).toBe(0);
  await mount(); const epoch = current.viewerEpoch;
  act(() => oldListener('SIGNED_IN', { user: { id: 'account-b' } }));
  old.resolve(auth('account-b')); await flush();
  expect(current.viewerId).toBe('account-a'); expect(current.viewerEpoch).toBe(epoch);
  expect(current.data?.circle.name).toBe('A circle'); expect(mockRpc).toHaveBeenCalledTimes(1);
});

it('cleans up when the only enabled observer becomes a disabled card', async () => {
  const old = deferred<ReturnType<typeof auth>>(); mockGetUser.mockReturnValueOnce(old.promise);
  await mount(); activeId = null; act(() => tree!.update(render())); await flush();
  expect(mockAuthListeners.size).toBe(0);
  old.resolve(auth('account-a')); await flush(); await current.refetch();
  expect(mockRpc).not.toHaveBeenCalled(); expect(current.viewerId).toBeUndefined();
  activeId = 'circle-one'; act(() => tree!.update(render())); await flush();
  expect(mockAuthListeners.size).toBe(1); expect(mockRpc).toHaveBeenCalledTimes(1);
});

it('does not revive retained room callbacks after returning to the same cached room', async () => {
  await mount(); const oldRefetch = current.refetch; const oldViewer = current.isCurrentViewer;
  activeId = 'circle-two'; act(() => tree!.update(render())); await flush();
  activeId = 'circle-one'; act(() => tree!.update(render())); await flush();
  const reads = mockRpc.mock.calls.length; await oldRefetch();
  expect(mockRpc).toHaveBeenCalledTimes(reads); expect(oldViewer()).toBe(false); expect(current.isCurrentViewer()).toBe(true);
});

it('bounds a stalled identity read and recovers through the existing retry', async () => {
  jest.useFakeTimers();
  try {
    mockGetUser.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => { tree = create(render()); });
    await act(async () => { jest.advanceTimersByTime(12_000); });
    expect(current.isLoading).toBe(false); expect(current.error?.name).toBe('RequestDeadlineError');
    await act(async () => { await current.refetch(); });
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(current.viewerId).toBe('account-a');
  } finally { jest.useRealTimers(); }
});
it('bounds a stalled Circle RPC without retrying the same timeout automatically', async () => {
  jest.useFakeTimers();
  try {
    mockRpc.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => { tree = create(render()); });
    await act(async () => { jest.advanceTimersByTime(12_000); });
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(current.isLoading).toBe(false); expect(current.error?.name).toBe('RequestDeadlineError');
    expect(mockRpc).toHaveBeenCalledTimes(1);
    await act(async () => { await current.refetch(); });
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(current.data?.circle.name).toBe('A circle');
  } finally { jest.useRealTimers(); }
});

const dm = () => ({ circle: { id: 'circle-one', name: '' }, members: [
  { user_id: 'account-a', first_name_display: 'Viewer', profile_photo_url: null },
  { user_id: 'peer', first_name_display: 'Peer', profile_photo_url: 'private-photo' },
] });
it.each([true, null, undefined, 'false'])('does not expose a private header or conversation when mutual block check is %j', async blocked => {
  mockRpc.mockImplementation(async name => ({ data: name === 'get_circle' ? dm() : blocked, error: null }));
  await mount(); expect(current.data).toBeNull(); expect(current.isLoading).toBe(false);
  expect(mockRpc).toHaveBeenCalledWith('yours_is_blocked_between', { p_a: 'account-a', p_b: 'peer' });
});
it('waits for explicit unblocked status before exposing a private conversation', async () => {
  const privacy = deferred<any>();
  mockRpc.mockImplementation(name => name === 'get_circle' ? Promise.resolve({ data: dm(), error: null }) : privacy.promise);
  await mount(); expect(current.data).toBeUndefined(); expect(current.isLoading).toBe(true);
  privacy.resolve({ data: false, error: null }); await flush(); expect(current.data?.members[1].first_name_display).toBe('Peer');
});
it('retires warm private data immediately after a local block, including another mounted observer', async () => {
  let blocked = false, second!: Result;
  mockRpc.mockImplementation(async name => ({ data: name === 'get_circle' ? dm() : blocked, error: null }));
  await mount();
  act(() => tree!.update(<QueryClientProvider client={client}><Harness id="circle-one" />
    <Harness id="circle-one" capture={r => { second = r; }} /></QueryClientProvider>)); await flush();
  expect(second.data).toBeTruthy(); const old = current.isCurrentViewer; blocked = true;
  act(() => removeBlockedPrivateChatPreviews('account-a', 'peer'));
  expect(current.data).toBeUndefined(); expect(second.data).toBeUndefined(); expect(old()).toBe(false);
  await flush(); expect(current.data).toBeNull(); expect(second.data).toBeNull();
});
it('cannot restore a private room with an unblocked read that finishes after block confirmation', async () => {
  const stale = deferred<any>(); let reads = 0;
  mockRpc.mockImplementation(name => name === 'get_circle' ? Promise.resolve({ data: dm(), error: null }) :
    ++reads === 1 ? stale.promise : Promise.resolve({ data: true, error: null }));
  await mount(); act(() => removeBlockedPrivateChatPreviews('account-a', 'peer')); await flush();
  expect(current.data).toBeNull(); stale.resolve({ data: false, error: null }); await flush(); expect(current.data).toBeNull();
});
it('leaves a named two-person circle available and ignores another account block signal', async () => {
  mockRpc.mockImplementation(async () => ({ data: { ...dm(), circle: { id: 'circle-one', name: 'Named circle' } }, error: null }));
  await mount(); const epoch = current.viewerEpoch;
  act(() => removeBlockedPrivateChatPreviews('someone-else', 'peer')); await flush();
  expect(current.data?.circle.name).toBe('Named circle'); expect(current.viewerEpoch).toBe(epoch);
  expect(mockRpc).toHaveBeenCalledTimes(1);
});
