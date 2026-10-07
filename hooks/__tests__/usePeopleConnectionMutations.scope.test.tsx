import React from 'react';
import { act, create } from 'react-test-renderer';
import { MutationCache, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePeopleConnectionMutations, type PeopleConnectionScope, isObsoletePeopleConnection, friendlyConnectionError } from '../usePeopleConnectionMutations';
import { UnconfirmedPeopleConnectionError } from '../../lib/yours/connectionRequests';

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
function auth(id: string | null) {
  mockViewer = id; for (const fn of mockListeners) fn(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null);
}
function scope(): PeopleConnectionScope & { live: boolean } {
  const captured = { userId: 'alice', live: true, isCurrent: () => captured.live }; return captured;
}
function mount(cache = new MutationCache()) {
  let userId = 'alice', current!: ReturnType<typeof usePeopleConnectionMutations>, mounted = true;
  const client = new QueryClient({ mutationCache: cache, defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  function Harness() { current = usePeopleConnectionMutations(userId); return null; }
  const render = () => <QueryClientProvider client={client}><Harness /></QueryClientProvider>;
  let tree!: ReturnType<typeof create>; act(() => { tree = create(render()); });
  const unmount = () => { if (mounted) act(() => tree.unmount()); mounted = false; };
  cleanup.push(() => { unmount(); client.clear(); });
  return { get current() { return current; }, client, invalidate, unmount,
    update(id: string) { userId = id; act(() => tree.update(render())); },
  };
}
function observe<T>(promise: Promise<T>) { return promise.then(value => ({ value, error: null }), error => ({ value: undefined, error })); }
beforeEach(() => { jest.clearAllMocks(); mockViewer = 'alice'; mockListeners.clear(); onlineManager.setOnline(true);
  mockRpc.mockReset().mockResolvedValue({ data: 'requested', error: null });
  mockGetUser.mockReset().mockImplementation(async () => ({ data: { user: mockViewer ? { id: mockViewer } : null }, error: null }));
});
afterEach(() => { onlineManager.setOnline(true); cleanup.splice(0).forEach(fn => fn()); });

it('preserves legacy variables, RPC arguments, outcomes and callback shape without auth subscription', async () => {
  const f = mount(), onSuccess = jest.fn(), value = { recipientId: 'bea', context: 'handle_lookup' as const };
  let result: unknown; await act(async () => { result = await f.current.sendRequest.mutateAsync(value, { onSuccess }); });
  expect(result).toBe('requested'); expect(mockRpc).toHaveBeenCalledWith('add_or_accept_person', { p_target: 'bea', p_context: 'handle_lookup', p_context_event_id: null });
  expect(onSuccess.mock.calls[0].slice(0, 2)).toEqual(['requested', value]); expect(mockGetUser).not.toHaveBeenCalled(); expect(mockListeners.size).toBe(0);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(f.current.sendRequest.variables).toEqual(value);
});
it.each(['accept', 'decline', 'remove'] as const)('preserves %s arguments and successful void result', async kind => {
  const f = mount(); mockRpc.mockResolvedValue({ data: null, error: null }); let result: unknown;
  await act(async () => { result = kind === 'decline' ? await f.current.decline.mutateAsync({ requesterId: 'bea', block: true }, { scope: scope() }) : await f.current[kind].mutateAsync('bea', { scope: scope() }); });
  expect(result).toBeUndefined();
  const expected = kind === 'accept' ? ['accept_people_request', { p_requester: 'bea' }] : kind === 'decline' ? ['decline_people_request', { p_requester: 'bea', p_block: true }] : ['remove_connection', { p_other: 'bea' }];
  expect(mockRpc).toHaveBeenCalledWith(...expected); expect(f.invalidate).toHaveBeenCalledTimes(6);
});
it.each(['account', 'roundtrip', 'visit', 'unmount'])('rejects a scoped call deferred by onMutate after %s retirement', async kind => {
  const gate = deferred<void>(); const f = mount(new MutationCache({ onMutate: () => gate.promise })), entry = scope();
  let result!: ReturnType<typeof observe<void>>; act(() => { result = observe(f.current.accept.mutateAsync('bea', { scope: entry })); }); await flush();
  if (kind === 'account') { act(() => auth('bob')); f.update('bob'); }
  if (kind === 'roundtrip') act(() => { auth('bob'); auth('alice'); });
  if (kind === 'visit') entry.live = false;
  if (kind === 'unmount') f.unmount();
  await act(async () => gate.resolve()); const outcome = await result; expect(isObsoletePeopleConnection(outcome.error)).toBe(true);
  expect(mockRpc).not.toHaveBeenCalled(); expect(mockGetUser).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
});
it.each(['account', 'roundtrip', 'visit'])('does not run a paused offline mutation after %s retirement', async kind => {
  const f = mount(), entry = scope(); onlineManager.setOnline(false); let result!: ReturnType<typeof observe<void>>;
  act(() => { result = observe(f.current.decline.mutateAsync({ requesterId: 'bea', block: true }, { scope: entry })); }); await flush();
  expect(mockRpc).not.toHaveBeenCalled(); expect(mockGetUser).not.toHaveBeenCalled();
  if (kind === 'account') { act(() => auth('bob')); f.update('bob'); }
  if (kind === 'roundtrip') act(() => { auth('bob'); auth('alice'); });
  if (kind === 'visit') entry.live = false;
  act(() => onlineManager.setOnline(true)); await flush(); const outcome = await result;
  expect(isObsoletePeopleConnection(outcome.error)).toBe(true); expect(mockRpc).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
});
it('resumes a still-current offline action exactly once', async () => {
  const f = mount(); onlineManager.setOnline(false); let result!: ReturnType<typeof observe<void>>;
  act(() => { result = observe(f.current.accept.mutateAsync('bea', { scope: scope() })); }); await flush();
  act(() => onlineManager.setOnline(true)); await flush(); expect((await result).error).toBeNull(); expect(mockRpc).toHaveBeenCalledTimes(1); expect(f.invalidate).toHaveBeenCalledTimes(6);
});
it('retires during the hook auth preflight before actual dispatch', async () => {
  const gate = deferred<any>(); mockGetUser.mockReturnValueOnce(gate.promise); const f = mount(); let result!: ReturnType<typeof observe<void>>;
  act(() => { result = observe(f.current.accept.mutateAsync('bea', { scope: scope() })); }); await flush(); act(() => auth(null));
  await act(async () => gate.resolve({ data: { user: { id: 'alice' } }, error: null }));
  expect(isObsoletePeopleConnection((await result).error)).toBe(true); expect(mockRpc).not.toHaveBeenCalled();
});
it('refuses a current-looking scope when getUser reports another account', async () => {
  mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'bob' } }, error: null }); const f = mount();
  const result = await observe(f.current.accept.mutateAsync('bea', { scope: scope() })); expect(isObsoletePeopleConnection(result.error)).toBe(true); expect(mockRpc).not.toHaveBeenCalled();
});
it('checks received-request eligibility again at dispatch after queued work', async () => {
  const gate = deferred<void>(), f = mount(new MutationCache({ onMutate: () => gate.promise })); let available = true;
  const entry = { ...scope(), canDispatch: () => available }; let result!: ReturnType<typeof observe<void>>;
  act(() => { result = observe(f.current.accept.mutateAsync('bea', { scope: entry })); }); await flush(); available = false;
  await act(async () => gate.resolve()); expect((await result).error.message).toBe('no_pending_request'); expect(mockRpc).not.toHaveBeenCalled();
});
it('late success after RPC dispatch does not invalidate or call success callbacks', async () => {
  const gate = deferred<any>(); mockRpc.mockReturnValueOnce(gate.promise); const f = mount(), entry = scope(), onSuccess = jest.fn(); let result!: ReturnType<typeof observe<void>>;
  act(() => { result = observe(f.current.accept.mutateAsync('bea', { scope: entry, onSuccess })); }); await flush(); entry.live = false;
  await act(async () => gate.resolve({ data: null, error: null })); expect(isObsoletePeopleConnection((await result).error)).toBe(true);
  expect(f.invalidate).not.toHaveBeenCalled(); expect(onSuccess).not.toHaveBeenCalled();
});
it('checks ownership again between mutation result and onSuccess cache invalidation', async () => {
  const gate = deferred<void>(); const f = mount(new MutationCache({ onSuccess: () => gate.promise })), entry = scope(); let result!: ReturnType<typeof observe<void>>;
  act(() => { result = observe(f.current.accept.mutateAsync('bea', { scope: entry })); }); await flush(); expect(mockRpc).toHaveBeenCalledTimes(1); act(() => { auth('bob'); auth('alice'); });
  await act(async () => gate.resolve()); expect(isObsoletePeopleConnection((await result).error)).toBe(true); expect(f.invalidate).not.toHaveBeenCalled();
});
it('stops the invalidation sequence if account ownership changes during it', async () => {
  const f = mount(); f.invalidate.mockImplementationOnce(() => { auth('bob'); return Promise.resolve(); });
  const result = await observe(f.current.accept.mutateAsync('bea', { scope: scope() })); expect(isObsoletePeopleConnection(result.error)).toBe(true); expect(f.invalidate).toHaveBeenCalledTimes(1);
});
it('preserves the exact originating scope for two queued people in the same mutation observer', async () => {
  const gate = deferred<void>(); const f = mount(new MutationCache({ onMutate: () => gate.promise })), first = scope(), second = scope();
  let one!: ReturnType<typeof observe<void>>, two!: ReturnType<typeof observe<void>>;
  act(() => { one = observe(f.current.accept.mutateAsync('bea', { scope: first })); two = observe(f.current.accept.mutateAsync('zoe', { scope: second })); });
  await flush(); first.live = false; await act(async () => gate.resolve());
  expect(isObsoletePeopleConnection((await one).error)).toBe(true); expect((await two).error).toBeNull();
  expect(mockRpc.mock.calls).toEqual([['accept_people_request', { p_requester: 'zoe' }]]);
});
it('an old exposed mutate callback cannot capture a replacement account owner', async () => {
  const f = mount(), entry = scope(), old = f.current.accept.mutate; f.update('bob'); f.update('alice');
  act(() => old('bea', { scope: entry })); await flush(); expect(mockRpc).not.toHaveBeenCalled();
});
it('keeps handshake outcomes without changing auto-accept semantics', async () => {
  const f = mount(); for (const data of ['requested', 'now_connected', 'already_connected']) {
    mockRpc.mockResolvedValueOnce({ data, error: null }); let outcome: unknown;
    await act(async () => { outcome = await f.current.sendRequest.mutateAsync({ recipientId: 'bea', context: 'handle_lookup' }, { scope: scope() }); }); expect(outcome).toBe(data);
  }
});

it.each([null, 'some_future_outcome'])('does not call success or dirty caches for raw unconfirmed Add receipt %p', async data => {
  const f = mount(), entry = scope(), onSuccess = jest.fn(), onError = jest.fn(); mockRpc.mockResolvedValueOnce({ data, error: null });
  const value = { recipientId: 'bea', context: 'handle_lookup' as const };
  const result = await observe(f.current.sendRequest.mutateAsync(value, { scope: entry, onSuccess, onError }));
  expect(result.error).toBeInstanceOf(UnconfirmedPeopleConnectionError);
  expect(friendlyConnectionError(result.error)).toBe('We couldn’t confirm your request. Try again.');
  expect(onSuccess).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
  expect(onError.mock.calls[0].slice(0, 2)).toEqual([result.error, value]);
});

describe('plan visibility ownership', () => {
  it.each([
    [{ global: true }, { p_global: true, p_person: null, p_hidden: null }],
    [{ global: false }, { p_global: false, p_person: null, p_hidden: null }],
    [{ personId: 'bea', hidden: true }, { p_global: null, p_person: 'bea', p_hidden: true }],
    [{ personId: 'bea', hidden: false }, { p_global: null, p_person: 'bea', p_hidden: false }],
  ])('retains unscoped visibility args %p and callback variables', async (value, args) => {
    const f = mount(), onSuccess = jest.fn(); mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await act(async () => { await f.current.setVisibility.mutateAsync(value, { onSuccess }); });
    expect(mockRpc).toHaveBeenCalledWith('set_plan_visibility', args);
    expect(onSuccess.mock.calls[0].slice(0, 2)).toEqual([undefined, value]);
    expect(mockGetUser).not.toHaveBeenCalled(); expect(mockListeners.size).toBe(0);
  });
  it.each(['account', 'roundtrip', 'visit'])('rejects queued visibility after %s changes', async kind => {
    const gate = deferred<void>(), f = mount(new MutationCache({ onMutate: () => gate.promise })), entry = scope();
    let result!: ReturnType<typeof observe<void>>;
    act(() => { result = observe(f.current.setVisibility.mutateAsync({ personId: 'bea', hidden: true }, { scope: entry })); }); await flush();
    if (kind === 'account') { act(() => auth('bob')); f.update('bob'); }
    if (kind === 'roundtrip') act(() => { auth('bob'); auth('alice'); });
    if (kind === 'visit') entry.live = false;
    await act(async () => gate.resolve());
    expect(isObsoletePeopleConnection((await result).error)).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
  });
  it('suppresses late visibility success, callbacks and invalidation', async () => {
    const gate = deferred<any>(), f = mount(), entry = scope(), onSuccess = jest.fn(); mockRpc.mockReturnValueOnce(gate.promise);
    let result!: ReturnType<typeof observe<void>>;
    act(() => { result = observe(f.current.setVisibility.mutateAsync({ personId: 'bea', hidden: false }, { scope: entry, onSuccess })); }); await flush();
    entry.live = false; await act(async () => gate.resolve({ data: null, error: null }));
    expect(isObsoletePeopleConnection((await result).error)).toBe(true);
    expect(onSuccess).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
  });
  it('retains actual visibility errors and permits a current explicit retry', async () => {
    const f = mount(), entry = scope(), error = new Error('server failed'); mockRpc.mockResolvedValueOnce({ data: null, error });
    const first = await observe(f.current.setVisibility.mutateAsync({ personId: 'bea', hidden: true }, { scope: entry }));
    expect(first.error).toBe(error); expect(f.invalidate).not.toHaveBeenCalled();
    await act(async () => { await f.current.setVisibility.mutateAsync({ personId: 'bea', hidden: true }, { scope: entry }); });
    expect(mockRpc).toHaveBeenCalledTimes(2); expect(f.invalidate).toHaveBeenCalledTimes(6);
  });
});
