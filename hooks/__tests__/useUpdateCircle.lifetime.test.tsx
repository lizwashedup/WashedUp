import React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUpdateCircle, type UpdateCircleIdentity, type UpdateCircleScope } from '../useUpdateCircle';

const mockRpc = jest.fn(), mockGetUser = jest.fn(), mockUnsubscribe = jest.fn();
let mockAuth: ((event: string, session: { user: { id: string } } | null) => void) | undefined;
jest.mock('../../lib/supabase', () => ({ supabase: {
  rpc: (...args: unknown[]) => mockRpc(...args),
  auth: { getUser: () => mockGetUser(), onAuthStateChange: (callback: typeof mockAuth) => {
    mockAuth = callback; return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
  } },
} }));
const identity: UpdateCircleIdentity = { name: 'Weekend crew', description: 'Around town' };
const account = (id: string | null = 'alice') => ({ data: { user: id ? { id } : null }, error: null });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function flush() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
const cleanup: Array<() => void> = [];
function mount(userId: string | null = 'alice', initialScope?: UpdateCircleScope | null) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: Infinity }, queries: { retry: false, gcTime: Infinity } } });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  let circleId = 'circle-a', current = true;
  let scope = initialScope === undefined ? { userId: userId ?? '', isCurrent: () => current } : initialScope;
  let hook!: ReturnType<typeof useUpdateCircle>; let tree!: ReturnType<typeof create>; let closed = false;
  function Harness() { hook = useUpdateCircle(circleId, userId, scope); return null; }
  const render = () => <QueryClientProvider client={client}><Harness /></QueryClientProvider>;
  act(() => { tree = create(render()); });
  const unmount = () => { if (!closed) act(() => tree.unmount()); closed = true; };
  cleanup.push(() => { unmount(); client.clear(); });
  return { get hook() { return hook; }, invalidate, unmount, retire: () => { current = false; },
    change: (circle: string, user = userId) => { circleId = circle; userId = user; scope = { userId: userId ?? '', isCurrent: () => current }; act(() => tree.update(render())); } };
}
beforeEach(() => { jest.clearAllMocks(); mockAuth = undefined; mockGetUser.mockReset().mockResolvedValue(account()); mockRpc.mockReset().mockResolvedValue({ error: null }); });
afterEach(() => cleanup.splice(0).forEach(fn => fn()));

it.each([
  [{ ...identity }, null, false],
  [{ ...identity, coverUploadId: 'photo', clearCover: true }, 'photo', false],
  [{ ...identity, clearCover: true }, null, true],
  [{ ...identity, description: null, coverUploadId: null }, null, false],
] as const)('preserves the identity RPC and new-cover precedence (%#)', async (values, cover, clear) => {
  const f = mount(); const success = jest.fn(), settled = jest.fn();
  await act(async () => { await f.hook.mutateAsync(values, { onSuccess: success, onSettled: settled }); });
  expect(mockRpc).toHaveBeenCalledWith('update_circle', {
    p_circle_id: 'circle-a', p_name: values.name, p_description: values.description,
    p_cover_upload_id: cover, p_clear_cover: clear,
  });
  expect(f.invalidate).toHaveBeenCalledWith({ queryKey: ['circles', 'detail', 'circle-a'] });
  expect(f.invalidate).toHaveBeenCalledWith({ queryKey: ['circles', 'mine', 'alice'] });
  expect(success).toHaveBeenCalledTimes(1); expect(settled).toHaveBeenCalledTimes(1);
});
it.each([null, undefined])('does not dispatch without an initiating account (%s)', async (user) => {
  const f = mount(user ?? null);
  await act(async () => { await expect(f.hook.mutateAsync(identity)).rejects.toMatchObject({ name: 'ObsoleteCircleUpdateError' }); });
  expect(mockGetUser).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled();
});
it.each([null, { userId: 'other', isCurrent: () => true }, { userId: 'alice', isCurrent: () => false }])('holds an unavailable parent scope (%#)', async scope => {
  const f = mount('alice', scope);
  await act(async () => { await f.hook.mutateAsync(identity).catch(() => {}); });
  expect(mockRpc).not.toHaveBeenCalled(); expect(mockGetUser).not.toHaveBeenCalled();
});
it('does not adopt a different account returned by auth', async () => {
  mockGetUser.mockResolvedValue(account('other')); const f = mount(); const failed = jest.fn();
  await act(async () => { await f.hook.mutateAsync(identity, { onError: failed }).catch(() => {}); });
  expect(mockRpc).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
});
it('guards a delayed auth continuation before dispatch', async () => {
  const auth = deferred<ReturnType<typeof account>>(); mockGetUser.mockReturnValue(auth.promise); const f = mount();
  let work!: Promise<unknown>; act(() => { work = f.hook.mutateAsync(identity).catch(error => error.name); }); await flush();
  f.retire(); await act(async () => { auth.resolve(account()); expect(await work).toBe('ObsoleteCircleUpdateError'); });
  expect(mockRpc).not.toHaveBeenCalled();
});
it('captures an immutable identity before the auth await', async () => {
  const auth = deferred<ReturnType<typeof account>>(); mockGetUser.mockReturnValue(auth.promise); const f = mount();
  const chosen = { ...identity, coverUploadId: 'selected', clearCover: false }; let work!: Promise<unknown>;
  act(() => { work = f.hook.mutateAsync(chosen); }); chosen.name = 'Changed elsewhere'; chosen.coverUploadId = 'other'; chosen.clearCover = true;
  await act(async () => { auth.resolve(account()); await work; });
  expect(mockRpc).toHaveBeenCalledWith('update_circle', expect.objectContaining({ p_name: identity.name, p_cover_upload_id: 'selected', p_clear_cover: false }));
});
it('refuses retained handlers after circle A to B to A', async () => {
  const f = mount(); const submit = f.hook.mutateAsync; f.change('circle-b'); f.change('circle-a');
  await act(async () => { await submit(identity).catch(() => {}); }); expect(mockRpc).not.toHaveBeenCalled();
});
it.each([false, true])('suppresses old result and callbacks after room replacement (failure=%s)', async failed => {
  const write = deferred<{ error: Error | null }>(); mockRpc.mockReturnValue(write.promise); const f = mount();
  const done = jest.fn(), error = jest.fn(), settled = jest.fn();
  act(() => f.hook.mutate(identity, { onSuccess: done, onError: error, onSettled: settled })); await flush();
  f.change('circle-b'); await act(async () => write.resolve({ error: failed ? new Error('old') : null })); await flush();
  expect(done).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(settled).not.toHaveBeenCalled();
  expect(f.invalidate).not.toHaveBeenCalled(); expect(f.hook.error).toBeNull(); expect(f.hook.isPending).toBe(false);
});
it('retires account A to B to A immediately without a parent render', async () => {
  const write = deferred<{ error: null }>(); mockRpc.mockReturnValue(write.promise); const f = mount(); const done = jest.fn();
  act(() => f.hook.mutate(identity, { onSuccess: done })); await flush();
  act(() => { mockAuth?.('SIGNED_IN', { user: { id: 'other' } }); mockAuth?.('SIGNED_IN', { user: { id: 'alice' } }); });
  await act(async () => write.resolve({ error: null })); await flush();
  expect(done).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
});
it('locks duplicate calls synchronously before mutationFn starts', async () => {
  const write = deferred<{ error: null }>(); mockRpc.mockReturnValue(write.promise); const f = mount();
  const submit = f.hook.mutate; act(() => { submit(identity); submit(identity); }); await flush();
  expect(mockRpc).toHaveBeenCalledTimes(1); await act(async () => write.resolve({ error: null }));
});
it('keeps current authentication and RPC failures retryable', async () => {
  mockGetUser.mockRejectedValueOnce(new Error('auth unavailable'));
  mockRpc.mockResolvedValueOnce({ error: new Error('admin required') }); const f = mount(); const failed = jest.fn();
  for (let i = 0; i < 2; i++) await act(async () => { await f.hook.mutateAsync(identity, { onError: failed }).catch(() => {}); });
  expect(failed).toHaveBeenCalledTimes(2); expect(f.invalidate).not.toHaveBeenCalled();
  await act(async () => { await f.hook.mutateAsync(identity); }); expect(f.invalidate).toHaveBeenCalledTimes(2);
});
it.each(['auth', 'rpc'])('retires unmounted work during %s', async stage => {
  const wait = deferred<any>(); if (stage === 'auth') mockGetUser.mockReturnValue(wait.promise); else mockRpc.mockReturnValue(wait.promise);
  const f = mount(); const done = jest.fn(); let work!: Promise<unknown>;
  act(() => { work = f.hook.mutateAsync(identity, { onSuccess: done }).catch(error => error.name); }); await flush(); f.unmount();
  await act(async () => { wait.resolve(stage === 'auth' ? account() : { error: null }); expect(await work).toBe('ObsoleteCircleUpdateError'); });
  expect(f.invalidate).not.toHaveBeenCalled(); expect(done).not.toHaveBeenCalled(); expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  if (stage === 'auth') expect(mockRpc).not.toHaveBeenCalled();
});
it('preserves a pending update across same-account token refresh', async () => {
  const write = deferred<{ error: null }>(); mockRpc.mockReturnValue(write.promise); const f = mount(); let work!: Promise<unknown>;
  act(() => { work = f.hook.mutateAsync(identity); }); await flush();
  act(() => mockAuth?.('TOKEN_REFRESHED', { user: { id: 'alice' } }));
  await act(async () => { write.resolve({ error: null }); await work; }); expect(f.invalidate).toHaveBeenCalledTimes(2);
});
it('does not let an old finalizer unlock a new room update', async () => {
  const old = deferred<{ error: null }>(), fresh = deferred<{ error: null }>(); mockRpc.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const f = mount(); let first!: Promise<unknown>; let second!: Promise<unknown>;
  act(() => { first = f.hook.mutateAsync(identity).catch(() => {}); }); await flush(); f.change('circle-b');
  act(() => { second = f.hook.mutateAsync(identity); }); await flush();
  await act(async () => { old.resolve({ error: null }); await first; await f.hook.mutateAsync(identity).catch(() => {}); });
  expect(mockRpc).toHaveBeenCalledTimes(2);
  await act(async () => { fresh.resolve({ error: null }); await second; });
  expect(f.invalidate).toHaveBeenCalledWith({ queryKey: ['circles', 'detail', 'circle-b'] });
  expect(f.invalidate).not.toHaveBeenCalledWith({ queryKey: ['circles', 'detail', 'circle-a'] });
});
it('rechecks ownership between detail and directory invalidations', async () => {
  const f = mount(); f.invalidate.mockImplementation(() => { f.retire(); return Promise.resolve(); });
  await act(async () => { await f.hook.mutateAsync(identity); });
  expect(f.invalidate).toHaveBeenCalledTimes(1);
});
