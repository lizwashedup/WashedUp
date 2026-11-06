import React from 'react';
import { act, create } from 'react-test-renderer';
import { MutationCache, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePeopleConnectionMutations, type PeopleConnectionScope, isObsoletePeopleConnection, friendlyConnectionError } from '../usePeopleConnectionMutations';
import { UnconfirmedPeopleConnectionError } from '../../lib/yours/connectionRequests';

const mockRpc = jest.fn(), mockGetUser = jest.fn();
const mockReadPair = jest.fn();
const accepted = { requester_user_id: 'bea', recipient_user_id: 'alice', status: 'accepted', can_re_request: true };
const removed = { ...accepted, status: 'removed', can_re_request: false };
let mockViewer: string | null = 'alice';
const mockListeners = new Set<(event: string, session: { user: { id: string } } | null) => void>();
jest.mock('../../lib/supabase', () => ({ supabase: {
  from: (table: string) => ({
    select: () => ({ in: (column: string, first: string[]) => ({
      in: (otherColumn: string, second: string[]) => mockReadPair(table, column, first, otherColumn, second),
    }) }),
  }),
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
  mockReadPair.mockReset().mockResolvedValue({ data: [accepted], error: null });
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

describe('bounded account preflight', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it.each(['sendRequest', 'accept', 'decline', 'remove', 'setVisibility', 'ping'] as const)('releases stalled %s without a write and permits an explicit retry', async kind => {
    const gate = deferred<any>(); mockGetUser.mockReturnValueOnce(gate.promise);
    const f = mount(), entry = scope(), onError = jest.fn();
    const value = kind === 'sendRequest' ? { recipientId: 'bea', context: 'handle_lookup' }
      : kind === 'ping' ? { recipientId: 'bea', eventId: 'plan-a' } : kind === 'decline' ? { requesterId: 'bea' } : kind === 'setVisibility' ? { global: true } : 'bea';
    const perform = () => (f.current[kind].mutateAsync as any)(value, { scope: entry, onError });
    let outcome: any;
    act(() => { void observe(perform()).then(result => { outcome = result; }); }); await flush();
    expect(mockRpc).not.toHaveBeenCalled();
    await act(async () => { await jest.advanceTimersByTimeAsync(8000); });
    expect(outcome?.error?.name).toBe('RequestDeadlineError');
    // React Query publishes the settled observer state on the next timer turn.
    await act(async () => { await jest.advanceTimersByTimeAsync(1); });
    expect(f.current[kind].isPending).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(f.invalidate).not.toHaveBeenCalled();
    await act(async () => gate.resolve({ data: { user: { id: 'alice' } }, error: null }));
    expect(mockRpc).not.toHaveBeenCalled();
    await act(async () => { await perform(); });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
  it('does not deliver timeout feedback to a retired visit', async () => {
    const gate = deferred<any>(); mockGetUser.mockReturnValueOnce(gate.promise);
    const f = mount(), entry = scope(), onError = jest.fn(); let outcome: any;
    act(() => { void observe(f.current.accept.mutateAsync('bea', { scope: entry, onError })).then(result => { outcome = result; }); }); await flush();
    entry.live = false;
    await act(async () => { await jest.advanceTimersByTimeAsync(8000); });
    expect(isObsoletePeopleConnection(outcome?.error)).toBe(true);
    expect(onError).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled();
  });
  it('keeps a completed preflight from timing out later', async () => {
    const f = mount(), onError = jest.fn();
    await act(async () => { await f.current.accept.mutateAsync('bea', { scope: scope(), onError }); });
    await act(async () => { await jest.advanceTimersByTimeAsync(8000); });
    expect(mockRpc).toHaveBeenCalledTimes(1); expect(onError).not.toHaveBeenCalled();
  });
});

describe('plan invitation ownership', () => {
  const value = { recipientId: 'bea', eventId: 'plan-a' };
  it('retains the void acknowledgement, exact RPC and no cache invalidation', async () => {
    const f = mount(), onSuccess = jest.fn(); mockRpc.mockResolvedValue({ data: null, error: null });
    await act(async () => { await f.current.ping.mutateAsync(value, { scope: scope(), onSuccess }); });
    expect(mockRpc.mock.calls).toEqual([['ping_person', { p_recipient: 'bea', p_event_id: 'plan-a' }]]);
    expect(onSuccess.mock.calls[0].slice(0, 2)).toEqual([undefined, value]);
    expect(f.invalidate).not.toHaveBeenCalled();
  });
  it.each(['account', 'roundtrip', 'visit', 'unmount'])('rejects an offline invitation after %s retirement', async kind => {
    const f = mount(), entry = scope(); onlineManager.setOnline(false); let result!: ReturnType<typeof observe<void>>;
    act(() => { result = observe(f.current.ping.mutateAsync(value, { scope: entry })); }); await flush();
    if (kind === 'account') { act(() => auth('bob')); f.update('bob'); }
    if (kind === 'roundtrip') act(() => { auth('bob'); auth('alice'); });
    if (kind === 'visit') entry.live = false;
    if (kind === 'unmount') f.unmount();
    act(() => onlineManager.setOnline(true)); await act(async () => { await f.client.resumePausedMutations(); });
    expect(isObsoletePeopleConnection((await result).error)).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it('checks the selected recipient again after a delayed account preflight', async () => {
    const gate = deferred<any>(), f = mount(); mockGetUser.mockReturnValueOnce(gate.promise);
    let eligible = true; const entry = { ...scope(), canDispatch: () => eligible };
    let result!: ReturnType<typeof observe<void>>;
    act(() => { result = observe(f.current.ping.mutateAsync(value, { scope: entry })); }); await flush();
    eligible = false;
    await act(async () => gate.resolve({ data: { user: { id: 'alice' } }, error: null }));
    expect((await result).error).toBeTruthy(); expect(mockRpc).not.toHaveBeenCalled();
  });
  it('suppresses late acknowledgements after the invitation closes', async () => {
    const gate = deferred<any>(), f = mount(), entry = scope(), onSuccess = jest.fn(); mockRpc.mockReturnValueOnce(gate.promise);
    let result!: ReturnType<typeof observe<void>>;
    act(() => { result = observe(f.current.ping.mutateAsync(value, { scope: entry, onSuccess })); }); await flush();
    entry.live = false; await act(async () => gate.resolve({ data: null, error: null }));
    expect(isObsoletePeopleConnection((await result).error)).toBe(true);
    expect(onSuccess).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
  });
});


it('resumes a current offline invitation once without changing People caches', async () => {
  const f = mount(); onlineManager.setOnline(false); let result!: ReturnType<typeof observe<void>>;
  act(() => { result = observe(f.current.ping.mutateAsync({ recipientId: 'bea', eventId: 'plan-a' }, { scope: scope() })); }); await flush();
  expect(mockRpc).not.toHaveBeenCalled(); act(() => onlineManager.setOnline(true)); await flush();
  expect((await result).error).toBeNull(); expect(mockRpc).toHaveBeenCalledTimes(1); expect(f.invalidate).not.toHaveBeenCalled();
});
it('does not time out or repeat an invitation once its write has started', async () => {
  jest.useFakeTimers();
  try {
    const gate = deferred<any>(), f = mount(); mockRpc.mockReturnValueOnce(gate.promise); let settled = false;
    let result!: ReturnType<typeof observe<void>>;
    act(() => { result = observe(f.current.ping.mutateAsync({ recipientId: 'bea', eventId: 'plan-a' }, { scope: scope() })); void result.then(() => { settled = true; }); });
    await flush(); await act(async () => { await jest.advanceTimersByTimeAsync(20_000); });
    expect(settled).toBe(false); expect(mockRpc).toHaveBeenCalledTimes(1); expect(f.current.ping.isPending).toBe(true);
    await act(async () => gate.resolve({ data: null, error: null })); expect((await result).error).toBeNull();
  } finally { jest.useRealTimers(); }
});


describe('removing an accepted person', () => {
  it('confirms a lost success for this pair and refreshes Yours without a second write', async () => {
    const f = mount();
    mockReadPair.mockResolvedValueOnce({ data: [accepted] }).mockResolvedValueOnce({ data: [removed] });
    mockRpc.mockRejectedValueOnce(new Error('Lost response'));
    const outcome = await observe(f.current.remove.mutateAsync('bea', { scope: scope() }));
    expect(outcome.error).toBeNull();
    expect(mockReadPair).toHaveBeenCalledWith('people_connections', 'requester_user_id', ['alice', 'bea'], 'recipient_user_id', ['alice', 'bea']);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(f.invalidate).toHaveBeenCalledWith({ queryKey: ['yours', 'grid', 'alice'] });
  });

  it('rechecking an uncertain removal from a fresh visit recognizes the saved marker', async () => {
    const f = mount();
    mockReadPair.mockResolvedValueOnce({ data: [accepted] }).mockRejectedValueOnce(new Error('Offline'));
    mockRpc.mockRejectedValueOnce(new Error('Lost response'));
    expect((await observe(f.current.remove.mutateAsync('bea', { scope: scope() }))).error).toBeTruthy();
    expect(f.invalidate).not.toHaveBeenCalled();
    f.unmount();
    const reopened = mount();
    mockReadPair.mockResolvedValueOnce({ data: [removed] });
    await reopened.current.remove.mutateAsync('bea', { scope: scope() });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(reopened.invalidate).toHaveBeenCalled();
  });

  it.each([null, { ...removed, recipient_user_id: 'other' }, { ...removed, can_re_request: true }, { ...removed, status: 'pending' }])(
    'leaves an unverified relationship alone (%j)', async row => {
      const f = mount();
      mockReadPair.mockResolvedValueOnce({ data: row ? [row] : [] });
      expect((await observe(f.current.remove.mutateAsync('bea', { scope: scope() }))).error).toBeTruthy();
      expect(mockRpc).not.toHaveBeenCalled();
    },
  );

  it('preserves a rejected removal and permits a deliberate retry after reconnecting in the opposite direction', async () => {
    const f = mount();
    const reverse = { ...accepted, requester_user_id: 'alice', recipient_user_id: 'bea' };
    mockReadPair.mockResolvedValue({ data: [removed, reverse] });
    mockRpc.mockResolvedValueOnce({ error: { code: '42501', message: 'Refused' } });
    expect((await observe(f.current.remove.mutateAsync('bea', { scope: scope() }))).error).toBeTruthy();
    expect(f.invalidate).not.toHaveBeenCalled();
    await f.current.remove.mutateAsync('bea', { scope: scope() });
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it.each(['account', 'back', 'access'])('cannot start the write if %s changes during the pair check', async kind => {
    const f = mount(), gate = deferred<any>(), visit = scope();
    let eligible = true;
    mockReadPair.mockReturnValueOnce(gate.promise);
    const result = observe(f.current.remove.mutateAsync('bea', { scope: { ...visit, canDispatch: () => eligible } }));
    await flush();
    if (kind === 'account') act(() => auth('bob'));
    if (kind === 'back') visit.live = false;
    if (kind === 'access') eligible = false;
    gate.resolve({ data: [accepted] });
    expect((await result).error).toBeTruthy();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
