import React from 'react';
import { act, create } from 'react-test-renderer';
import { MutationCache, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSetSuggestionStatus, type CircleSuggestionScope, isObsoleteCircleSuggestion } from '../useCircleSuggestions';

const mockRpc = jest.fn(), mockGetUser = jest.fn();
let mockViewer: string | null = 'alice';
const mockListeners = new Set<(event: string, session: { user: { id: string } } | null) => void>();
jest.mock('../../lib/supabase', () => ({ supabase: {
  rpc: (...args: unknown[]) => mockRpc(...args),
  auth: { getUser: () => mockGetUser(), onAuthStateChange: (fn: typeof mockListeners extends Set<infer T> ? T : never) => {
    mockListeners.add(fn); return { data: { subscription: { unsubscribe: () => mockListeners.delete(fn) } } };
  } },
} }));
const cleanup: Array<() => void> = [];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function flush() { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); }
function auth(id: string | null) { mockViewer = id; for (const fn of mockListeners) fn(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null); }
function scope(): CircleSuggestionScope & { live: boolean } { const captured = { userId: 'alice', live: true, isCurrent: () => captured.live }; return captured; }
function mount(cache = new MutationCache()) {
  let userId = 'alice', current!: ReturnType<typeof useSetSuggestionStatus>, mounted = true;
  const client = new QueryClient({ mutationCache: cache, defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  function Harness() { current = useSetSuggestionStatus(userId); return null; }
  const render = () => <QueryClientProvider client={client}><Harness /></QueryClientProvider>;
  let tree!: ReturnType<typeof create>; act(() => { tree = create(render()); });
  const unmount = () => { if (mounted) act(() => tree.unmount()); mounted = false; };
  cleanup.push(() => { unmount(); client.clear(); });
  return { get current() { return current; }, client, invalidate, unmount,
    update(id: string) { userId = id; act(() => tree.update(render())); },
  };
}
function observe<T>(promise: Promise<T>) { return promise.then(value => ({ value, error: null }), error => ({ value: undefined, error })); }
const value = { id: 'suggestion-one', status: 'dismissed' as const };
beforeEach(() => { jest.clearAllMocks(); mockViewer = 'alice'; mockListeners.clear(); onlineManager.setOnline(true);
  mockRpc.mockReset().mockResolvedValue({ data: 'dismissed', error: null });
  mockGetUser.mockReset().mockImplementation(async () => ({ data: { user: mockViewer ? { id: mockViewer } : null }, error: null }));
});
afterEach(() => { onlineManager.setOnline(true); cleanup.splice(0).forEach(fn => fn()); });

it.each(['dismissed', 'converted'] as const)('preserves legacy %s arguments and public callback shape', async status => {
  const f = mount(), onSuccess = jest.fn(), input = { ...value, status };
  mockRpc.mockResolvedValue({ data: status, error: null });
  let result: unknown; await act(async () => { result = await f.current.mutateAsync(input, { onSuccess }); });
  expect(result).toBe(status); expect(mockRpc).toHaveBeenCalledWith('set_circle_suggestion_status', { p_id: value.id, p_status: status });
  expect(onSuccess.mock.calls[0].slice(0, 2)).toEqual([status, input]);
  expect(mockGetUser).not.toHaveBeenCalled(); expect(mockListeners.size).toBe(0);
  expect(f.invalidate).toHaveBeenCalledWith({ queryKey: ['circles', 'suggestions', 'alice'] });
});
it('preserves not_found as a distinct server outcome rather than reporting dismissal', async () => {
  const f = mount(); mockRpc.mockResolvedValue({ data: 'not_found', error: null });
  const result = await observe(f.current.mutateAsync(value, { scope: scope() })); expect(result.value).toBe('not_found');
});
it.each(['account', 'roundtrip', 'visit', 'unmount'])('prevents deferred mutation dispatch after %s retirement', async kind => {
  const gate = deferred<void>(), f = mount(new MutationCache({ onMutate: () => gate.promise })), entry = scope();
  let result!: ReturnType<typeof observe<string>>; act(() => { result = observe(f.current.mutateAsync(value, { scope: entry })); }); await flush();
  if (kind === 'account') { act(() => auth('bob')); f.update('bob'); }
  if (kind === 'roundtrip') act(() => { auth('bob'); auth('alice'); });
  if (kind === 'visit') entry.live = false;
  if (kind === 'unmount') f.unmount();
  await act(async () => gate.resolve()); expect(isObsoleteCircleSuggestion((await result).error)).toBe(true);
  expect(mockGetUser).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
});
it.each(['account', 'roundtrip', 'visit'])('does not resume obsolete offline work after %s', async kind => {
  const f = mount(), entry = scope(); onlineManager.setOnline(false); let result!: ReturnType<typeof observe<string>>;
  act(() => { result = observe(f.current.mutateAsync(value, { scope: entry })); }); await flush();
  if (kind === 'account') { act(() => auth('bob')); f.update('bob'); }
  if (kind === 'roundtrip') act(() => { auth('bob'); auth('alice'); });
  if (kind === 'visit') entry.live = false;
  act(() => onlineManager.setOnline(true)); await flush(); expect(isObsoleteCircleSuggestion((await result).error)).toBe(true);
  expect(mockRpc).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
});
it('resumes a still-current offline request once', async () => {
  const f = mount(); onlineManager.setOnline(false); let result!: ReturnType<typeof observe<string>>;
  act(() => { result = observe(f.current.mutateAsync(value, { scope: scope() })); }); await flush();
  act(() => onlineManager.setOnline(true)); await flush(); expect((await result).value).toBe('dismissed'); expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('requires a matching confirmed account immediately before dispatch', async () => {
  const f = mount(); mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'bob' } }, error: null });
  const result = await observe(f.current.mutateAsync(value, { scope: scope() })); expect(isObsoleteCircleSuggestion(result.error)).toBe(true); expect(mockRpc).not.toHaveBeenCalled();
});
it('rejects an auth roundtrip during preflight despite an old matching response', async () => {
  const gate = deferred<any>(), f = mount(); mockGetUser.mockReturnValueOnce(gate.promise); let result!: ReturnType<typeof observe<string>>;
  act(() => { result = observe(f.current.mutateAsync(value, { scope: scope() })); }); await flush(); act(() => { auth('bob'); auth('alice'); });
  await act(async () => gate.resolve({ data: { user: { id: 'alice' } }, error: null }));
  expect(isObsoleteCircleSuggestion((await result).error)).toBe(true); expect(mockRpc).not.toHaveBeenCalled();
});
it('rechecks suggestion presence after queued work before issuing the RPC', async () => {
  const gate = deferred<void>(), f = mount(new MutationCache({ onMutate: () => gate.promise })); let present = true;
  let result!: ReturnType<typeof observe<string>>;
  act(() => { result = observe(f.current.mutateAsync(value, { scope: { ...scope(), canDispatch: () => present } })); }); await flush(); present = false;
  await act(async () => gate.resolve()); expect(isObsoleteCircleSuggestion((await result).error)).toBe(true); expect(mockRpc).not.toHaveBeenCalled();
});
it('retains completion when a refresh removes the already-dispatched suggestion', async () => {
  const gate = deferred<any>(), f = mount(); let present = true; mockRpc.mockReturnValueOnce(gate.promise);
  let result!: ReturnType<typeof observe<string>>;
  act(() => { result = observe(f.current.mutateAsync(value, { scope: { ...scope(), canDispatch: () => present } })); }); await flush(); present = false;
  await act(async () => gate.resolve({ data: 'dismissed', error: null })); expect((await result).value).toBe('dismissed');
});
it('suppresses late success, feedback and cache invalidation after retirement', async () => {
  const gate = deferred<any>(), f = mount(), entry = scope(), onSuccess = jest.fn(), onError = jest.fn(), onSettled = jest.fn(); mockRpc.mockReturnValueOnce(gate.promise);
  let result!: ReturnType<typeof observe<string>>;
  act(() => { result = observe(f.current.mutateAsync(value, { scope: entry, onSuccess, onError, onSettled })); }); await flush(); entry.live = false;
  await act(async () => gate.resolve({ data: 'dismissed', error: null })); expect(isObsoleteCircleSuggestion((await result).error)).toBe(true);
  expect(onSuccess).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled(); expect(onSettled).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
});
it('checks ownership between RPC success and mutation cache invalidation', async () => {
  const gate = deferred<void>(), f = mount(new MutationCache({ onSuccess: () => gate.promise })), entry = scope();
  let result!: ReturnType<typeof observe<string>>;
  act(() => { result = observe(f.current.mutateAsync(value, { scope: entry })); }); await flush(); act(() => { auth('bob'); auth('alice'); });
  await act(async () => gate.resolve()); expect(isObsoleteCircleSuggestion((await result).error)).toBe(true); expect(f.invalidate).not.toHaveBeenCalled();
});
it('an old captured mutator cannot start under a replacement account/visit', async () => {
  const f = mount(), old = f.current.mutate; f.update('bob'); f.update('alice');
  act(() => old(value, { scope: scope() })); await flush(); expect(mockRpc).not.toHaveBeenCalled();
});
it('keeps each simultaneously queued suggestion tied to its own scope', async () => {
  const gate = deferred<void>(), f = mount(new MutationCache({ onMutate: () => gate.promise })), first = scope(), second = scope();
  let one!: ReturnType<typeof observe<string>>, two!: ReturnType<typeof observe<string>>;
  act(() => { one = observe(f.current.mutateAsync(value, { scope: first })); two = observe(f.current.mutateAsync({ ...value, id: 'suggestion-two' }, { scope: second })); }); await flush();
  first.live = false; await act(async () => gate.resolve());
  expect(isObsoleteCircleSuggestion((await one).error)).toBe(true); expect((await two).value).toBe('dismissed');
  expect(mockRpc.mock.calls).toEqual([['set_circle_suggestion_status', { p_id: 'suggestion-two', p_status: 'dismissed' }]]);
});
it('preserves a current server error and supports an explicit retry with the same ID', async () => {
  const f = mount(), entry = scope(), error = new Error('timeout'), onError = jest.fn(); mockRpc.mockResolvedValueOnce({ data: null, error });
  const first = await observe(f.current.mutateAsync(value, { scope: entry, onError })); expect(first.error).toBe(error); expect(onError.mock.calls[0].slice(0, 2)).toEqual([error, value]);
  expect(f.invalidate).not.toHaveBeenCalled();
  await act(async () => { await f.current.mutateAsync(value, { scope: entry }); }); expect(mockRpc).toHaveBeenCalledTimes(2); expect(f.invalidate).toHaveBeenCalledTimes(1);
});
it('preserves a current auth error as retryable and dispatches no mutation', async () => {
  const f = mount(), error = new Error('Could not reach auth'); mockGetUser.mockResolvedValueOnce({ data: { user: null }, error });
  const result = await observe(f.current.mutateAsync(value, { scope: scope() })); expect(result.error).toBe(error); expect(mockRpc).not.toHaveBeenCalled();
});

it('ignores a delayed initial auth snapshot after a real account transition', async () => {
  const f = mount(); await act(async () => { await f.current.mutateAsync(value, { scope: scope() }); });
  act(() => { auth('bob'); for (const fn of mockListeners) fn('INITIAL_SESSION', { user: { id: 'alice' } }); }); f.update('bob');
  const entry = { userId: 'bob', isCurrent: () => true };
  const result = await observe(f.current.mutateAsync(value, { scope: entry })); expect(result.value).toBe('dismissed'); expect(mockRpc).toHaveBeenCalledTimes(2);
});
it('keeps an in-flight request current for same-account token refresh', async () => {
  const gate = deferred<any>(), f = mount(); mockRpc.mockReturnValueOnce(gate.promise); let result!: ReturnType<typeof observe<string>>;
  act(() => { result = observe(f.current.mutateAsync(value, { scope: scope() })); }); await flush();
  act(() => { for (const fn of mockListeners) fn('TOKEN_REFRESHED', { user: { id: 'alice' } }); });
  await act(async () => gate.resolve({ data: 'dismissed', error: null })); expect((await result).value).toBe('dismissed');
});
