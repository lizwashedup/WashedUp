import React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { usePlanJoin } from '../usePlanJoin';
import { logError } from '../../lib/logger';

const mockGetUser = jest.fn(), mockRpc = jest.fn(), mockInsert = jest.fn();
let mockAccount: string | null = 'alice', mockEpoch = 1;
let mockFocus: (() => void | (() => void)) | undefined, mockBlur: (() => void) | undefined;
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void | (() => void)) => {
  require('react').useEffect(() => {
    mockFocus = callback; mockBlur = callback() || undefined;
    return () => { mockBlur?.(); mockBlur = undefined; mockFocus = undefined; };
  }, [callback]);
} }));
jest.mock('../../lib/supabase', () => ({ supabase: {
  auth: { getUser: () => mockGetUser() },
  rpc: (...args: unknown[]) => mockRpc(...args),
  from: (table: string) => ({ insert: (row: unknown) => mockInsert(table, row) }),
} }));
jest.mock('../../lib/contentFilter', () => ({ checkContent: (text: string) => text === 'blocked message' ? { ok: false, reason: 'Please change this message.' } : { ok: true } }));
jest.mock('../../lib/logger', () => ({ logError: jest.fn() }));

type Options = Parameters<typeof usePlanJoin>[0];
type Controller = ReturnType<typeof usePlanJoin>;
type RpcResult = { data?: unknown; error?: unknown };
const cleanups: Array<() => void> = [];
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); }
function joins() { return mockRpc.mock.calls.filter(([name]) => name === 'join_event_atomic' || name === 'join_circle_plan_atomic'); }
async function mount(overrides: Partial<Options> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: 2, gcTime: Infinity } } });
  const onJoined = jest.fn(), onError = jest.fn();
  let props: Partial<Options> = overrides, current!: Controller;
  function Harness() {
    const epoch = mockEpoch;
    current = usePlanJoin({
      eventId: 'plan-one', viewerId: mockAccount, epoch, isCurrent: () => epoch === mockEpoch,
      ready: true, startTime: '2099-01-01T12:00:00Z', endTime: null,
      circle: { is_circle_plan: false }, age: 28, gender: 'woman', onJoined, onError, ...props,
    });
    return null;
  }
  const render = () => <QueryClientProvider client={client}><Harness /></QueryClientProvider>;
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(render()); });
  let mounted = true;
  const unmount = () => { if (mounted) act(() => tree.unmount()); mounted = false; };
  cleanups.push(() => { unmount(); client.clear(); });
  await flush();
  return {
    client, onJoined, onError, unmount, get current() { return current; },
    update(next: Partial<Options> = {}) { props = { ...props, ...next }; act(() => tree.update(render())); },
    join(greeting?: string) { act(() => current.join(greeting)); },
  };
}
beforeEach(() => {
  jest.clearAllMocks(); mockAccount = 'alice'; mockEpoch = 1; onlineManager.setOnline(true);
  mockGetUser.mockImplementation(async () => ({ data: { user: mockAccount ? { id: mockAccount } : null }, error: null }));
  mockRpc.mockImplementation(async (name: string) => ({ data: name === 'can_join_event_gender' ? true : 'joined', error: null }));
  mockInsert.mockResolvedValue({ data: null, error: null });
});
afterEach(() => { onlineManager.setOnline(true); cleanups.splice(0).forEach(fn => fn()); });

it('joins once on rapid taps, preserves the exact payload and locks after success', async () => {
  const receipt = deferred<RpcResult>();
  mockRpc.mockImplementation((name: string) => name === 'can_join_event_gender' ? Promise.resolve({ data: true }) : receipt.promise);
  const f = await mount(); const tap = f.current.join;
  act(() => { tap('  See you there!  '); tap('Second message'); }); await flush();
  expect(joins()).toEqual([['join_event_atomic', { p_event_id: 'plan-one', p_user_id: 'alice', p_age_at_join: 28, p_gender_at_join: 'woman' }]]);
  expect(f.current.isPending).toBe(true); expect(f.onJoined).not.toHaveBeenCalled();
  await act(async () => receipt.resolve({ data: 'joined' })); await flush();
  expect(mockInsert.mock.calls).toEqual([
    ['messages', { event_id: 'plan-one', user_id: 'alice', content: 'joined the plan', message_type: 'system' }],
    ['messages', { event_id: 'plan-one', user_id: 'alice', content: 'See you there!', message_type: 'user' }],
  ]);
  expect(f.onJoined).toHaveBeenCalledTimes(1); expect(f.current.isPending).toBe(false);
  expect(f.onJoined).toHaveBeenCalledWith({});
  f.join('Replay'); act(() => tap('Retained replay')); await flush();
  expect(joins()).toHaveLength(1); expect(mockInsert).toHaveBeenCalledTimes(2);
});

it.each([null, undefined, false, 'true', 1, { approved: true }])('does not dispatch when eligibility is %p', async data => {
  mockRpc.mockResolvedValue({ data, error: null }); const f = await mount(); f.join('Hi'); await flush();
  expect(joins()).toHaveLength(0); expect(mockInsert).not.toHaveBeenCalled();
  expect(f.onJoined).not.toHaveBeenCalled(); expect(f.onError).toHaveBeenCalledTimes(1); expect(f.current.unconfirmed).toBe(false);
});

it.each([
  ['getUser returned error', { data: { user: null }, error: { message: 'offline' } }],
  ['getUser identity mismatch', { data: { user: { id: 'bob' } }, error: null }],
])('stops before any RPC on %s', async (_name, result) => {
  mockGetUser.mockResolvedValue(result); const f = await mount(); f.join(); await flush();
  expect(mockRpc).not.toHaveBeenCalled(); expect(f.onError).toHaveBeenCalledTimes(1); expect(f.current.unconfirmed).toBe(false);
});

it.each(['auth', 'eligibility'])('a rejected %s read remains retryable without dispatch', async stage => {
  if (stage === 'auth') mockGetUser.mockRejectedValueOnce(new Error('offline'));
  else mockRpc.mockRejectedValueOnce(new Error('offline'));
  const f = await mount(); f.join(); await flush(); expect(joins()).toHaveLength(0);
  expect(f.current.unconfirmed).toBe(false); expect(f.onError).toHaveBeenCalledTimes(1);
  f.join(); await flush(); expect(joins()).toHaveLength(1); expect(f.onJoined).toHaveBeenCalledTimes(1);
});

it.each([
  [{ data: 'full' }, 'filled up', false],
  [{ data: 'not_found' }, 'no longer available', false],
  [{ data: 'waitlist_priority' }, 'saved for the waitlist', false],
  [{ data: null, error: { code: 'P0001', message: 'rejected' } }, 'Couldn’t join', true],
])('keeps a confirmed refusal separate from unknown: %p', async (result, copy, shouldLog) => {
  mockRpc.mockImplementation(async (name: string) => name === 'can_join_event_gender' ? { data: true } : result);
  const f = await mount(); f.join('Hi'); await flush();
  expect(f.current.unconfirmed).toBe(false); expect(f.onError).toHaveBeenCalledWith(expect.stringContaining(copy));
  expect(f.onJoined).not.toHaveBeenCalled(); expect(mockInsert).not.toHaveBeenCalled();
  if (shouldLog) expect(logError).toHaveBeenCalledWith(expect.any(Error), 'plan.join');
  else expect(logError).not.toHaveBeenCalled();
  f.join('Hi'); await flush(); expect(joins()).toHaveLength(2);
});

it.each([
  { data: null }, { data: undefined }, { data: {} }, { data: 'already_joined' }, { data: 'future_receipt' },
  { data: null, error: { message: 'lost response' } }, { data: null, error: { code: '08006' } },
  { data: null, error: { code: 'ERROR' } }, { data: 'joined', error: { message: 'uncertain transport' } },
])('locks an uncertain RPC result without messages or mutation retries: %p', async result => {
  mockRpc.mockImplementation(async (name: string) => name === 'can_join_event_gender' ? { data: true } : result);
  const f = await mount(); f.join('Hi'); await flush();
  expect(f.current.unconfirmed).toBe(true); expect(f.current.isPending).toBe(false);
  expect(f.onJoined).not.toHaveBeenCalled(); expect(mockInsert).not.toHaveBeenCalled(); expect(f.onError).toHaveBeenCalledTimes(1);
  f.join('Replay'); await flush(); expect(joins()).toHaveLength(1);
});

it('a rejected membership promise is uncertain and a false readiness roundtrip cannot unlock it', async () => {
  mockRpc.mockImplementation(async (name: string) => { if (name === 'can_join_event_gender') return { data: true }; throw new Error('offline'); });
  const f = await mount(); f.join(); await flush(); expect(f.current.unconfirmed).toBe(true);
  f.update({ ready: false }); f.update({ ready: true }); f.join(); await flush();
  expect(joins()).toHaveLength(1); expect(f.onError).toHaveBeenCalledTimes(1);
});

it.each(['system returned', 'system rejected', 'greeting returned', 'greeting rejected'])('does not turn a confirmed join into a retry when %s fails', async stage => {
  mockInsert.mockImplementation(async (_table: string, row: { message_type: string }) => {
    if (stage.startsWith(row.message_type === 'system' ? 'system' : 'greeting')) {
      if (stage.endsWith('rejected')) throw new Error('offline');
      return { error: { message: 'denied' } };
    }
    return { error: null };
  });
  const f = await mount(); f.join('Hi'); await flush();
  expect(f.onJoined).toHaveBeenCalledTimes(1); expect(f.onError).not.toHaveBeenCalled(); expect(f.current.unconfirmed).toBe(false);
  expect(f.onJoined).toHaveBeenCalledWith(stage.startsWith('greeting') ? { greetingUnconfirmed: 'Hi' } : {});
  f.join('Replay'); await flush(); expect(joins()).toHaveLength(1); expect(mockInsert).toHaveBeenCalledTimes(2);
});

it.each([false, true])('routes a Circle join through its RPC with own chat = %s', async ownChat => {
  const f = await mount({ circle: { is_circle_plan: true, has_own_chat: ownChat } }); f.join('Hi'); await flush();
  expect(mockRpc).toHaveBeenCalledTimes(1); expect(joins()[0][0]).toBe('join_circle_plan_atomic');
  expect(mockInsert).toHaveBeenCalledTimes(ownChat ? 2 : 0); expect(f.onJoined).toHaveBeenCalledTimes(1);
  expect(f.onJoined).toHaveBeenCalledWith({});
});

it.each([undefined, {}, { data: null }])('preserves the attempted greeting when its write receipt is malformed: %p', async receipt => {
  mockInsert.mockImplementation(async (_table: string, row: { message_type: string }) => row.message_type === 'system' ? { error: null } : receipt);
  const f = await mount(); f.join('  Hi everyone!  '); await flush();
  expect(f.onJoined).toHaveBeenCalledWith({ greetingUnconfirmed: 'Hi everyone!' });
  expect(f.onError).not.toHaveBeenCalled(); expect(f.current.unconfirmed).toBe(false);
  f.join('Replay'); await flush(); expect(joins()).toHaveLength(1); expect(mockInsert).toHaveBeenCalledTimes(2);
});

it.each(['account', 'target', 'blur', 'unmount'])('does not surface late greeting failure after %s retirement', async reason => {
  const greeting = deferred<{ error: unknown }>();
  mockInsert.mockImplementation((_table: string, row: { message_type: string }) => row.message_type === 'system' ? Promise.resolve({ error: null }) : greeting.promise);
  const f = await mount(); f.join('My introduction'); await flush();
  expect(mockInsert).toHaveBeenCalledTimes(2); expect(f.onJoined).not.toHaveBeenCalled();
  if (reason === 'account') { mockAccount = 'bob'; mockEpoch++; f.update(); }
  if (reason === 'target') f.update({ eventId: 'plan-two' });
  if (reason === 'blur') act(() => mockBlur?.());
  if (reason === 'unmount') f.unmount();
  await act(async () => greeting.resolve({ error: { message: 'failed' } })); await flush();
  expect(f.onJoined).not.toHaveBeenCalled(); expect(f.onError).not.toHaveBeenCalled(); expect(mockInsert).toHaveBeenCalledTimes(2);
});

it.each(['not_eligible', 'not_circle_plan'])('recognizes Circle refusal %s without false success', async data => {
  mockRpc.mockResolvedValue({ data }); const f = await mount({ circle: { is_circle_plan: true, has_own_chat: true } });
  f.join('Hi'); await flush(); expect(f.onError).toHaveBeenCalledTimes(1); expect(f.current.unconfirmed).toBe(false);
  expect(f.onJoined).not.toHaveBeenCalled(); expect(mockInsert).not.toHaveBeenCalled();
});

it('preserves confirmed feedback when the own membership refresh makes ready false', async () => {
  const receipt = deferred<RpcResult>(); mockRpc.mockImplementation((name: string) => name === 'can_join_event_gender' ? Promise.resolve({ data: true }) : receipt.promise);
  const f = await mount(); f.join('Hi'); await flush(); f.update({ ready: false });
  await act(async () => receipt.resolve({ data: 'joined' })); await flush();
  expect(f.onJoined).toHaveBeenCalledTimes(1); expect(mockInsert).toHaveBeenCalledTimes(2);
});

it.each(['account', 'ABA', 'target', 'blur', 'unmount'])('retires pre-assent guards and auth continuations after %s', async reason => {
  const auth = deferred<{ data: { user: { id: string } }; error: null }>(); mockGetUser.mockReturnValue(auth.promise);
  const f = await mount(); const guard = f.current.isCurrent, oldJoin = f.current.join; f.join('Hi'); await flush();
  if (reason === 'account') { mockAccount = 'bob'; mockEpoch++; f.update(); }
  if (reason === 'ABA') { mockEpoch += 2; f.update(); }
  if (reason === 'target') f.update({ eventId: 'plan-two' });
  if (reason === 'blur') act(() => mockBlur?.());
  if (reason === 'unmount') f.unmount();
  expect(guard()).toBe(false); act(() => oldJoin('retained'));
  await act(async () => auth.resolve({ data: { user: { id: 'alice' } }, error: null })); await flush();
  expect(mockRpc).not.toHaveBeenCalled(); expect(f.onJoined).not.toHaveBeenCalled(); expect(f.onError).not.toHaveBeenCalled();
});

it('stops after an eligibility await if its focused visit closed and reopened', async () => {
  const gate = deferred<RpcResult>(); mockRpc.mockReturnValue(gate.promise);
  const f = await mount(); const guard = f.current.isCurrent; f.join(); await flush();
  act(() => { mockBlur?.(); mockBlur = mockFocus?.() || undefined; });
  expect(guard()).toBe(false); expect(f.current.isCurrent()).toBe(true);
  await act(async () => gate.resolve({ data: true })); await flush(); expect(joins()).toHaveLength(0);
  expect(f.onJoined).not.toHaveBeenCalled(); expect(f.current.isPending).toBe(false);
});

it.each(['account', 'ABA', 'target', 'blur', 'unmount'])('a dispatched join completion after %s cannot send messages or current feedback', async reason => {
  const receipt = deferred<RpcResult>(); mockRpc.mockImplementation((name: string) => name === 'can_join_event_gender' ? Promise.resolve({ data: true }) : receipt.promise);
  const f = await mount(); const invalidate = jest.spyOn(f.client, 'invalidateQueries'); f.join('Hi'); await flush();
  if (reason === 'account') { mockAccount = 'bob'; mockEpoch++; f.update(); }
  if (reason === 'ABA') { mockEpoch += 2; f.update(); }
  if (reason === 'target') f.update({ eventId: 'plan-two' });
  if (reason === 'blur') act(() => mockBlur?.());
  if (reason === 'unmount') f.unmount();
  await act(async () => receipt.resolve({ data: 'joined' })); await flush();
  expect(mockInsert).not.toHaveBeenCalled(); expect(f.onJoined).not.toHaveBeenCalled(); expect(f.onError).not.toHaveBeenCalled();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['events', 'members', 'plan-one'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['wishlists', 'alice'] });
  if (reason === 'ABA') { f.join('Replay'); await flush(); expect(joins()).toHaveLength(1); }
});

it('retiring during the system message prevents the user greeting and success callback', async () => {
  const system = deferred<{ error: null }>(); mockInsert.mockReturnValue(system.promise);
  const f = await mount(); f.join('Hi'); await flush(); act(() => mockBlur?.());
  await act(async () => system.resolve({ error: null })); await flush();
  expect(mockInsert).toHaveBeenCalledTimes(1); expect(f.onJoined).not.toHaveBeenCalled(); expect(f.onError).not.toHaveBeenCalled();
});

it('a late unknown belongs only to its account and stays locked across A → B → A', async () => {
  const receipt = deferred<RpcResult>();
  mockRpc.mockImplementation((name: string, args: { p_user_id: string }) => name === 'can_join_event_gender' ? Promise.resolve({ data: true }) : args.p_user_id === 'alice' ? receipt.promise : Promise.resolve({ data: 'joined' }));
  const f = await mount(); f.join('Alice'); await flush();
  mockAccount = 'bob'; mockEpoch++; f.update(); expect(f.current.isPending).toBe(false); expect(f.current.unconfirmed).toBe(false);
  f.join('Bob'); await flush(); expect(f.onJoined).toHaveBeenCalledTimes(1);
  await act(async () => receipt.resolve({ data: null })); await flush();
  expect(f.current.unconfirmed).toBe(false); expect(f.onError).not.toHaveBeenCalled();
  mockAccount = 'alice'; mockEpoch++; f.update(); expect(f.current.unconfirmed).toBe(true);
  f.join('Alice replay'); await flush(); expect(joins()).toHaveLength(2);
});

it('pending and unknown locks survive plan A → B → A but do not block B', async () => {
  const receipt = deferred<RpcResult>();
  mockRpc.mockImplementation((name: string, args: { p_event_id: string }) => name === 'can_join_event_gender' ? Promise.resolve({ data: true }) : args.p_event_id === 'plan-one' ? receipt.promise : Promise.resolve({ data: 'joined' }));
  const f = await mount(); const oldGuard = f.current.isCurrent; f.join(); await flush();
  f.update({ eventId: 'plan-two' }); f.join(); await flush(); f.update({ eventId: 'plan-one' });
  expect(oldGuard()).toBe(false); expect(f.current.isPending).toBe(true); f.join(); await flush(); expect(joins()).toHaveLength(2);
  await act(async () => receipt.resolve({ data: 'future_receipt' })); await flush();
  expect(f.current.isPending).toBe(false); expect(f.current.unconfirmed).toBe(true); expect(f.onError).not.toHaveBeenCalled();
  f.join(); await flush(); expect(joins()).toHaveLength(2);
});

it('a retired offline queued attempt cannot dispatch on reconnection', async () => {
  const f = await mount(); onlineManager.setOnline(false); f.join(); await flush();
  act(() => mockBlur?.()); onlineManager.setOnline(true); await flush();
  expect(mockGetUser).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled(); expect(f.onError).not.toHaveBeenCalled();
});

it.each([{ ready: false }, { circle: undefined }, { viewerId: null }, { startTime: undefined }])('does not start from an unresolved entry: %p', async options => {
  const f = await mount(options); f.join(); await flush(); expect(mockGetUser).not.toHaveBeenCalled(); expect(f.current.isPending).toBe(false);
});

it.each([
  [{ startTime: '2000-01-01T12:00:00Z' }, undefined],
  [{}, 'blocked message'],
] as const)('preserves ended-plan and content checks before admission', async (options, greeting) => {
  const f = await mount(options); f.join(greeting); await flush();
  expect(mockRpc).not.toHaveBeenCalled(); expect(f.onError).toHaveBeenCalledTimes(1); expect(f.current.unconfirmed).toBe(false);
});

it.each(['cancelled', 'completed'] as const)('does not join a future plan with authoritative %s status', async status => {
  const f = await mount({ status }); f.join('Hello'); await flush();
  expect(mockGetUser).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled(); expect(mockInsert).not.toHaveBeenCalled();
  expect(f.onJoined).not.toHaveBeenCalled(); expect(f.onError).toHaveBeenCalledWith(status === 'cancelled' ? 'This plan was cancelled. Nobody new can join.' : 'This plan is complete. Nobody new can join.');
  expect(f.current.unconfirmed).toBe(false);
});

it.each([undefined, null, 'forming', 'active', 'full', 'draft', 'future_status', { status: 'cancelled' }])('preserves the existing ready gate rather than inventing terminal rules for %p', async status => {
  const f = await mount({ status }); f.join(); await flush();
  expect(joins()).toHaveLength(1); expect(f.onJoined).toHaveBeenCalledTimes(1);
});

it.each(['cancelled', 'completed'] as const)('stops after an auth await if the loaded plan changes to %s', async status => {
  const auth = deferred<{ data: { user: { id: string } }; error: null }>(); mockGetUser.mockReturnValue(auth.promise);
  const f = await mount({ status: 'active' }); f.join(); await flush(); f.update({ status });
  await act(async () => auth.resolve({ data: { user: { id: 'alice' } }, error: null })); await flush();
  expect(mockRpc).not.toHaveBeenCalled(); expect(f.onJoined).not.toHaveBeenCalled(); expect(f.current.unconfirmed).toBe(false);
});

it.each(['cancelled', 'completed'] as const)('stops immediately before ordinary admission when eligibility was delayed and status became %s', async status => {
  const gate = deferred<RpcResult>(); mockRpc.mockReturnValue(gate.promise);
  const f = await mount({ status: 'active' }); f.join(); await flush(); f.update({ status });
  await act(async () => gate.resolve({ data: true, error: null })); await flush();
  expect(joins()).toHaveLength(0); expect(mockInsert).not.toHaveBeenCalled(); expect(f.onError).toHaveBeenCalledTimes(1);
});

it('the same terminal status check applies to Circle-member admission', async () => {
  const auth = deferred<{ data: { user: { id: string } }; error: null }>(); mockGetUser.mockReturnValue(auth.promise);
  const f = await mount({ status: 'active', circle: { is_circle_plan: true, viewer_is_member: true, has_own_chat: false } }); f.join(); await flush();
  f.update({ status: 'cancelled' }); await act(async () => auth.resolve({ data: { user: { id: 'alice' } }, error: null })); await flush();
  expect(joins()).toHaveLength(0); expect(f.onJoined).not.toHaveBeenCalled();
});

it('a post-dispatch status refresh cannot reinterpret an authoritative join receipt as a failed write', async () => {
  const receipt = deferred<RpcResult>(); mockRpc.mockImplementation(name => name === 'can_join_event_gender' ? Promise.resolve({ data: true }) : receipt.promise);
  const f = await mount({ status: 'active' }); f.join('Hello'); await flush(); expect(joins()).toHaveLength(1);
  f.update({ status: 'completed', ready: false }); await act(async () => receipt.resolve({ data: 'joined', error: null })); await flush();
  expect(f.onJoined).toHaveBeenCalledTimes(1); expect(f.onError).not.toHaveBeenCalled(); expect(f.current.unconfirmed).toBe(false);
  f.join('Again'); await flush(); expect(joins()).toHaveLength(1);
});
