import React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useInviteToCircle } from '../useInviteToCircle';

const mockRpc = jest.fn(), mockGetUser = jest.fn(), mockUnsubscribe = jest.fn();
let mockAuth: ((event: string, session: { user: { id: string } } | null) => void) | undefined;
jest.mock('../../lib/supabase', () => ({ supabase: {
  rpc: (...args: unknown[]) => mockRpc(...args),
  auth: { getUser: () => mockGetUser(), onAuthStateChange: (callback: typeof mockAuth) => { mockAuth = callback; return { data: { subscription: { unsubscribe: mockUnsubscribe } } }; } },
} }));
type Scope = { userId: string; isCurrent: () => boolean };
const invoke = useInviteToCircle as (circleId: string, userId: string | null, scope?: Scope | null) => ReturnType<typeof useInviteToCircle>;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const account = (id: string | null = 'alice') => ({ data: { user: id ? { id } : null }, error: null });
const cleanup: Array<() => void> = [];
function mount(userId: string | null = 'alice') {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: Infinity }, queries: { retry: false, gcTime: Infinity } } });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  let circle = 'circle-a'; let current = true;
  let scope: Scope = { userId: userId ?? '', isCurrent: () => current };
  let hook!: ReturnType<typeof useInviteToCircle>; let tree!: ReturnType<typeof create>; let closed = false;
  function Harness() { hook = invoke(circle, userId, scope); return null; }
  const render = () => <QueryClientProvider client={client}><Harness /></QueryClientProvider>;
  act(() => { tree = create(render()); });
  const unmount = () => { if (!closed) act(() => tree.unmount()); closed = true; };
  cleanup.push(() => { unmount(); client.clear(); });
  return { get hook() { return hook; }, invalidate, unmount, retire: () => { current = false; },
    change: (id: string) => { circle = id; scope = { userId: userId ?? '', isCurrent: () => current }; act(() => tree.update(render())); } };
}
async function flush() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
beforeEach(() => { jest.clearAllMocks(); mockAuth = undefined; mockGetUser.mockReset().mockResolvedValue(account()); mockRpc.mockReset().mockResolvedValue({ data: 1, error: null }); });
afterEach(() => cleanup.splice(0).forEach(fn => fn()));

it('retains direct-add RPC arguments, confirmed zero and prefix invalidation', async () => {
  mockRpc.mockResolvedValueOnce({ data: 0, error: null }); const f = mount();
  await act(async () => { expect(await f.hook.mutateAsync(['bob'])).toBe(0); });
  expect(mockRpc).toHaveBeenCalledWith('invite_to_circle', { p_circle_id: 'circle-a', p_user_ids: ['bob'] });
  expect(f.invalidate).toHaveBeenCalledWith({ queryKey: ['circles', 'detail', 'circle-a'] });
  expect(f.invalidate).toHaveBeenCalledWith({ queryKey: ['circles', 'mine', 'alice'] });
});
it('does not dispatch without an initiating account', async () => {
  const f = mount(null); await act(async () => { await f.hook.mutateAsync(['bob']).catch(() => {}); });
  expect(mockRpc).not.toHaveBeenCalled();
});
it('does not adopt a replacement account returned by auth', async () => {
  mockGetUser.mockResolvedValue(account('other')); const f = mount();
  await act(async () => { await f.hook.mutateAsync(['bob']).catch(() => {}); });
  expect(mockRpc).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
});
it('guards a delayed auth continuation before the RPC', async () => {
  const auth = deferred<ReturnType<typeof account>>(); mockGetUser.mockReturnValue(auth.promise); const f = mount();
  let work!: Promise<unknown>; act(() => { work = f.hook.mutateAsync(['bob']).catch(() => {}); }); await flush();
  f.retire(); await act(async () => { auth.resolve(account()); await work; });
  expect(mockRpc).not.toHaveBeenCalled();
});
it('refuses a retained mutation callback after circle A to B to A', async () => {
  const f = mount(); const submit = f.hook.mutateAsync; f.change('circle-b'); f.change('circle-a');
  await act(async () => { await submit(['bob']).catch(() => {}); }); expect(mockRpc).not.toHaveBeenCalled();
});
it('suppresses old mutation feedback and invalidation after a different circle opens', async () => {
  const write = deferred<{ data: number; error: null }>(); mockRpc.mockReturnValue(write.promise); const f = mount(); const done = jest.fn();
  act(() => f.hook.mutate(['bob'], { onSuccess: done })); await flush();
  f.change('circle-b'); await act(async () => write.resolve({ data: 1, error: null })); await flush();
  expect(done).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled(); expect(f.hook.data).toBeUndefined();
});
it('retires an account A to B to A event before a late result without a parent render', async () => {
  const write = deferred<{ data: number; error: null }>(); mockRpc.mockReturnValue(write.promise); const f = mount(); const done = jest.fn();
  act(() => f.hook.mutate(['bob'], { onSuccess: done })); await flush();
  act(() => { mockAuth?.('SIGNED_IN', { user: { id: 'other' } }); mockAuth?.('SIGNED_IN', { user: { id: 'alice' } }); });
  await act(async () => write.resolve({ data: 1, error: null })); await flush();
  expect(done).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
});
it('serializes rapid direct mutation calls before rerender', async () => {
  const write = deferred<{ data: number; error: null }>(); mockRpc.mockReturnValue(write.promise); const f = mount();
  let first!: Promise<unknown>; let second!: Promise<unknown>;
  act(() => { first = f.hook.mutateAsync(['bob']).catch(() => {}); second = f.hook.mutateAsync(['bob']).catch(() => {}); }); await flush();
  const count = mockRpc.mock.calls.length;
  await act(async () => { write.resolve({ data: 1, error: null }); await Promise.all([first, second]); }); expect(count).toBe(1);
});
it('does not acknowledge unknown result as zero members added', async () => {
  mockRpc.mockResolvedValue({ data: null, error: null }); const f = mount(); const done = jest.fn();
  await act(async () => { await f.hook.mutateAsync(['bob'], { onSuccess: done }).catch(() => {}); });
  expect(done).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
});

it('copies initiating recipients before an awaited auth read', async () => {
  const auth = deferred<ReturnType<typeof account>>(); mockGetUser.mockReturnValueOnce(auth.promise);
  const f = mount(); const recipients = ['bob']; let work!: Promise<unknown>;
  act(() => { work = f.hook.mutateAsync(recipients); }); recipients.push('not-selected');
  await act(async () => { auth.resolve(account()); await work; });
  expect(mockRpc).toHaveBeenCalledWith('invite_to_circle', { p_circle_id: 'circle-a', p_user_ids: ['bob'] });
});

it('retires before dispatch after unmount during auth', async () => {
  const auth = deferred<ReturnType<typeof account>>(); mockGetUser.mockReturnValueOnce(auth.promise);
  const f = mount(); let work!: Promise<unknown>;
  act(() => { work = f.hook.mutateAsync(['bob']).catch(error => error.name); }); await flush(); f.unmount();
  await act(async () => { auth.resolve(account()); expect(await work).toBe('ObsoleteCircleInviteError'); });
  expect(mockRpc).not.toHaveBeenCalled(); expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
});

it('suppresses callbacks and cache invalidation after unmount during the RPC', async () => {
  const write = deferred<{ data: number; error: null }>(); mockRpc.mockReturnValueOnce(write.promise);
  const f = mount(); const done = jest.fn(); let work!: Promise<unknown>;
  act(() => { work = f.hook.mutateAsync(['bob'], { onSuccess: done }).catch(error => error.name); }); await flush(); f.unmount();
  await act(async () => { write.resolve({ data: 1, error: null }); expect(await work).toBe('ObsoleteCircleInviteError'); });
  expect(done).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
});

it('keeps a current RPC error retryable without cache or success effects', async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: new Error('circle trust check failed') });
  const f = mount(); const failed = jest.fn();
  await act(async () => { await f.hook.mutateAsync(['bob'], { onError: failed }).catch(() => {}); }); await flush();
  expect(failed).toHaveBeenCalledTimes(1); expect(f.invalidate).not.toHaveBeenCalled();
  await act(async () => { expect(await f.hook.mutateAsync(['bob'])).toBe(1); });
  expect(mockRpc).toHaveBeenCalledTimes(2); expect(f.invalidate).toHaveBeenCalledTimes(2);
});

it('keeps same-account token refresh valid during a pending mutation', async () => {
  const write = deferred<{ data: number; error: null }>(); mockRpc.mockReturnValueOnce(write.promise);
  const f = mount(); let work!: Promise<number>; act(() => { work = f.hook.mutateAsync(['bob']); }); await flush();
  act(() => mockAuth?.('TOKEN_REFRESHED', { user: { id: 'alice' } }));
  await act(async () => { write.resolve({ data: 1, error: null }); expect(await work).toBe(1); });
  expect(f.invalidate).toHaveBeenCalledTimes(2);
});

it('does not let an old finalizer unlock a newer circle request', async () => {
  const old = deferred<{ data: number; error: null }>(), fresh = deferred<{ data: number; error: null }>();
  mockRpc.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const f = mount(); let first!: Promise<unknown>; let second!: Promise<unknown>;
  act(() => { first = f.hook.mutateAsync(['bob']).catch(() => {}); }); await flush(); f.change('circle-b');
  act(() => { second = f.hook.mutateAsync(['carol']); }); await flush();
  await act(async () => { old.resolve({ data: 1, error: null }); await first; await f.hook.mutateAsync(['carol']).catch(() => {}); });
  expect(mockRpc).toHaveBeenCalledTimes(2);
  await act(async () => { fresh.resolve({ data: 1, error: null }); await second; });
  expect(f.invalidate).toHaveBeenCalledWith({ queryKey: ['circles', 'detail', 'circle-b'] });
  expect(f.invalidate).not.toHaveBeenCalledWith({ queryKey: ['circles', 'detail', 'circle-a'] });
});
