import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLeaveCircle, type LeaveCircleScope } from '../useLeaveCircle';
import { circleKeys } from '../../lib/circles/keys';
import { UNREAD_CHATS_KEY } from '../../constants/QueryKeys';
import { consumeChatListDirty } from '../../lib/chatListSignal';

const mockRpc = jest.fn(), mockGetUser = jest.fn();
const mockAuthListeners = new Set<(event: string, session: { user: { id: string } } | null) => void>();
jest.mock('../../lib/supabase', () => ({ supabase: {
  rpc: (...args: unknown[]) => mockRpc(...args),
  auth: {
    getUser: () => mockGetUser(),
    onAuthStateChange: (callback: any) => {
      mockAuthListeners.add(callback);
      return { data: { subscription: { unsubscribe: () => mockAuthListeners.delete(callback) } } };
    },
  },
} }));

type Result = ReturnType<typeof useLeaveCircle>;
const account = (id: string | null = 'account-a') => ({ data: { user: id ? { id } : null }, error: null });
const response = (data: unknown = 'left') => ({ data, error: null });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function emit(id: string | null, event = 'SIGNED_IN') {
  for (const listener of [...mockAuthListeners]) listener(event, id ? { user: { id } } : null);
}
async function flush() {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

let tree: ReactTestRenderer | undefined, client: QueryClient, current: Result;
let viewerId: string | null | undefined;
let operationScope: LeaveCircleScope | null | undefined;
let invalidate: jest.SpyInstance;
const detailKey = [...circleKeys.detail('circle-one'), 'account-a', 1];
const historyKey = ['circle-plans', 'circle-one'];
function Harness() { current = useLeaveCircle(viewerId, operationScope); return null; }
const render = () => <QueryClientProvider client={client}><Harness /></QueryClientProvider>;
function mount() { act(() => { tree = create(render()); }); }
function change(id: string | null | undefined, authEvent = false) {
  viewerId = id;
  mockGetUser.mockResolvedValue(account(id ?? null));
  act(() => { if (authEvent) emit(id ?? null); tree!.update(render()); });
}
function callbacks() { return { onSuccess: jest.fn(), onError: jest.fn(), onSettled: jest.fn() }; }
function expectNoEffects(feedback?: ReturnType<typeof callbacks>) {
  expect(invalidate).not.toHaveBeenCalled();
  expect(consumeChatListDirty()).toBe(false);
  if (feedback) for (const callback of Object.values(feedback)) expect(callback).not.toHaveBeenCalled();
}
function expectFreshState() {
  expect(current).toMatchObject({ status: 'idle', isIdle: true, isPending: false, isSuccess: false,
    isError: false, data: undefined, error: null, variables: undefined, failureReason: null, failureCount: 0 });
}
beforeEach(() => {
  jest.clearAllMocks(); mockAuthListeners.clear(); consumeChatListDirty(); viewerId = 'account-a'; operationScope = undefined;
  // The hook must explicitly disable automatic mutation retries even if the
  // enclosing app chooses them as a default.
  client = new QueryClient({ defaultOptions: { mutations: { retry: 2, retryDelay: 0, gcTime: Infinity },
    queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(circleKeys.mine('account-a'), ['circle-one']);
  client.setQueryData(circleKeys.mine('account-b'), ['circle-two']);
  client.setQueryData(UNREAD_CHATS_KEY, 2);
  client.setQueryData(detailKey, { circle: { id: 'circle-one' }, members: [{ user_id: 'account-a' }] });
  client.setQueryData(historyKey, [{ id: 'past-plan' }]);
  invalidate = jest.spyOn(client, 'invalidateQueries');
  mockGetUser.mockReset().mockResolvedValue(account());
  mockRpc.mockReset().mockResolvedValue(response());
});
afterEach(async () => {
  act(() => tree?.unmount()); tree = undefined; client.clear(); await flush();
  expect(mockAuthListeners.size).toBe(0);
});

it.each(['left', 'not_member'])('keeps %s as confirmed scalar success with the original RPC and caller arguments', async result => {
  mockRpc.mockResolvedValue(response(result)); mount(); const feedback = callbacks();
  await act(async () => { expect(await current.mutateAsync('circle-one', feedback)).toBe(result); }); await flush();
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('leave_circle', { p_circle_id: 'circle-one' });
  expect(current).toMatchObject({ data: result, variables: 'circle-one', isSuccess: true, isPending: false });
  expect(feedback.onSuccess.mock.calls[0].slice(0, 2)).toEqual([result, 'circle-one']);
  expect(feedback.onSettled.mock.calls[0].slice(0, 3)).toEqual([result, null, 'circle-one']);
  expect(feedback.onError).not.toHaveBeenCalled();
  expect(invalidate.mock.calls.map(call => call[0])).toEqual([
    { queryKey: circleKeys.mine('account-a') }, { queryKey: UNREAD_CHATS_KEY },
  ]);
  expect(client.getQueryState(circleKeys.mine('account-a'))?.isInvalidated).toBe(true);
  expect(client.getQueryState(circleKeys.mine('account-b'))?.isInvalidated).toBe(false);
  expect(client.getQueryState(UNREAD_CHATS_KEY)?.isInvalidated).toBe(true);
  expect(consumeChatListDirty()).toBe(true); expect(consumeChatListDirty()).toBe(false);
  expect(client.getQueryData(historyKey)).toEqual([{ id: 'past-plan' }]);
  expect(client.getQueryData(detailKey)).toEqual({ circle: { id: 'circle-one' }, members: [{ user_id: 'account-a' }] });
});

it.each([null, undefined, false, 0, [], {}, ['left'], { status: 'left' }, 'joined', 'LEFT', ' left '])(
  'rejects an unconfirmed result (%p) without success or cache effects', async value => {
    mockRpc.mockResolvedValue({ data: value, error: null }); mount(); const feedback = callbacks();
    await act(async () => {
      await expect(current.mutateAsync('circle-one', feedback)).rejects.toThrow('Could not confirm you left');
    }); await flush();
    expectNoEffects(); expect(feedback.onSuccess).not.toHaveBeenCalled();
    expect(feedback.onError).toHaveBeenCalledTimes(1); expect(feedback.onSettled).toHaveBeenCalledTimes(1);
    expect(current.isError).toBe(true); expect(current.isPending).toBe(false);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  },
);

it.each([null, undefined])('does not dispatch without an initiating account (%p)', async value => {
  viewerId = value; mount(); const feedback = callbacks();
  act(() => current.mutate('circle-one', feedback));
  await expect(current.mutateAsync('circle-one')).rejects.toMatchObject({ name: 'ObsoleteCircleLeaveError' });
  expect(mockGetUser).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled(); expectNoEffects(feedback);
});

it('refuses an empty circle before reading auth', async () => {
  mount(); act(() => current.mutate('  '));
  await expect(current.mutateAsync('')).rejects.toThrow('Choose a circle');
  expect(mockGetUser).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled(); expectNoEffects();
});

it.each(['account-b', null])('does not adopt an account returned by preflight (%p)', async id => {
  mockGetUser.mockResolvedValue(account(id)); mount(); const feedback = callbacks();
  await act(async () => {
    await expect(current.mutateAsync('circle-one', feedback)).rejects.toMatchObject({ name: 'ObsoleteCircleLeaveError' });
  });
  expect(mockRpc).not.toHaveBeenCalled(); expectNoEffects(feedback);
});

it.each(['response', 'throw'])('keeps a current auth %s error visible and retryable', async mode => {
  const failure = new Error('Temporary account check failure');
  if (mode === 'response') mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: failure });
  else mockGetUser.mockRejectedValueOnce(failure);
  mount(); const feedback = callbacks();
  await act(async () => { await expect(current.mutateAsync('circle-one', feedback)).rejects.toBe(failure); }); await flush();
  expect(mockRpc).not.toHaveBeenCalled(); expectNoEffects(); expect(feedback.onError).toHaveBeenCalledTimes(1);
  expect(current.error).toBe(failure);
  await act(async () => { expect(await current.mutateAsync('circle-one')).toBe('left'); });
  expect(mockGetUser).toHaveBeenCalledTimes(2); expect(mockRpc).toHaveBeenCalledTimes(1);
});

it.each(['response', 'throw'])('keeps a current RPC %s error visible without automatic retry', async mode => {
  const failure = new Error('Could not reach the circle');
  if (mode === 'response') mockRpc.mockResolvedValueOnce({ data: 'left', error: failure });
  else mockRpc.mockRejectedValueOnce(failure);
  mount(); const feedback = callbacks();
  await act(async () => { await expect(current.mutateAsync('circle-one', feedback)).rejects.toBe(failure); }); await flush();
  expectNoEffects(); expect(feedback.onSuccess).not.toHaveBeenCalled();
  expect(feedback.onError.mock.calls[0].slice(0, 2)).toEqual([failure, 'circle-one']);
  expect(current.error).toBe(failure); expect(mockRpc).toHaveBeenCalledTimes(1);
  await act(async () => { expect(await current.mutateAsync('circle-one')).toBe('left'); });
  expect(mockRpc).toHaveBeenCalledTimes(2); expect(consumeChatListDirty()).toBe(true);
});

it('allows a deliberate retry after an unknown receipt', async () => {
  mockRpc.mockResolvedValueOnce(response(null)); mount();
  await act(async () => { await current.mutateAsync('circle-one').catch(() => {}); });
  await act(async () => { expect(await current.mutateAsync('circle-one')).toBe('left'); });
  expect(mockRpc).toHaveBeenCalledTimes(2);
});

it('captures the account before React Query schedules the mutation function', async () => {
  mount(); const feedback = callbacks();
  act(() => { current.mutate('circle-one', feedback); change('account-b', true); }); await flush();
  expect(mockGetUser).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled();
  expectNoEffects(feedback); expectFreshState();
});

it.each(['prop', 'auth'])('retires a delayed preflight on an account %s transition', async source => {
  const read = deferred<ReturnType<typeof account>>(); mockGetUser.mockReturnValueOnce(read.promise); mount();
  const feedback = callbacks(); let work!: Promise<unknown>;
  act(() => { work = current.mutateAsync('circle-one', feedback).catch(error => error.name); }); await flush();
  if (source === 'prop') change('account-b'); else act(() => { emit('account-b'); emit('account-a'); });
  await act(async () => { read.resolve(account()); expect(await work).toBe('ObsoleteCircleLeaveError'); }); await flush();
  expect(mockRpc).not.toHaveBeenCalled(); expectNoEffects(feedback); expectFreshState();
});

it('does not revive retained public mutation callbacks after an account A to B to A return', async () => {
  mount(); const oldMutate = current.mutate, oldAsync = current.mutateAsync;
  change('account-b'); change('account-a');
  act(() => oldMutate('circle-one')); await expect(oldAsync('circle-one')).rejects.toMatchObject({ name: 'ObsoleteCircleLeaveError' });
  expect(mockRpc).not.toHaveBeenCalled(); expectNoEffects();
  await act(async () => { expect(await current.mutateAsync('circle-one')).toBe('left'); });
});

it.each(['left', 'error'])('suppresses late %s callbacks, result state and effects after account A to B to A', async outcome => {
  const write = deferred<{ data: unknown; error: Error | null }>(); mockRpc.mockReturnValueOnce(write.promise); mount();
  const feedback = callbacks(); let work!: Promise<unknown>;
  act(() => { work = current.mutateAsync('circle-one', feedback).catch(error => error.name); }); await flush();
  act(() => { emit('account-b'); emit('account-a'); }); await flush(); expectFreshState();
  await act(async () => {
    write.resolve(outcome === 'left' ? response() : { data: null, error: new Error('Old account failure') });
    expect(await work).toBe('ObsoleteCircleLeaveError');
  }); await flush();
  expectNoEffects(feedback); expectFreshState();
});

it('retires logout even while the parent still passes the previous account', async () => {
  const write = deferred<ReturnType<typeof response>>(); mockRpc.mockReturnValueOnce(write.promise); mount();
  const feedback = callbacks(); act(() => current.mutate('circle-one', feedback)); await flush();
  act(() => emit(null, 'SIGNED_OUT')); await flush();
  act(() => current.mutate('circle-two', feedback));
  await act(async () => write.resolve(response())); await flush();
  expect(mockRpc).toHaveBeenCalledTimes(1); expectNoEffects(feedback); expectFreshState();
});

it('preserves current work during a same-account token refresh', async () => {
  const write = deferred<ReturnType<typeof response>>(); mockRpc.mockReturnValueOnce(write.promise); mount();
  const feedback = callbacks(); let work!: Promise<unknown>;
  act(() => { work = current.mutateAsync('circle-one', feedback); }); await flush();
  act(() => emit('account-a', 'TOKEN_REFRESHED'));
  await act(async () => { write.resolve(response()); expect(await work).toBe('left'); }); await flush();
  expect(feedback.onSuccess).toHaveBeenCalledTimes(1); expect(invalidate).toHaveBeenCalledTimes(2);
  expect(consumeChatListDirty()).toBe(true); expect(current.isSuccess).toBe(true);
});

it.each(['auth', 'rpc'])('retires work and listeners after unmount during %s', async stage => {
  const read = deferred<ReturnType<typeof account>>(), write = deferred<ReturnType<typeof response>>();
  if (stage === 'auth') mockGetUser.mockReturnValueOnce(read.promise); else mockRpc.mockReturnValueOnce(write.promise);
  mount(); const feedback = callbacks(); let work!: Promise<unknown>;
  act(() => { work = current.mutateAsync('circle-one', feedback).catch(error => error.name); }); await flush();
  const oldListener = [...mockAuthListeners][0];
  act(() => tree!.unmount()); tree = undefined; expect(mockAuthListeners.size).toBe(0);
  act(() => oldListener('SIGNED_IN', { user: { id: 'account-a' } }));
  await act(async () => { read.resolve(account()); write.resolve(response()); expect(await work).toBe('ObsoleteCircleLeaveError'); });
  expect(mockRpc).toHaveBeenCalledTimes(stage === 'auth' ? 0 : 1); expectNoEffects(feedback);
});

it('guards rapid duplicate calls before rerender without replacing the original callbacks', async () => {
  const write = deferred<ReturnType<typeof response>>(); mockRpc.mockReturnValueOnce(write.promise); mount();
  const first = callbacks(), second = callbacks(); let duplicate!: Promise<unknown>;
  act(() => {
    current.mutate('circle-one', first); current.mutate('circle-one', second);
    duplicate = current.mutateAsync('circle-one', second).catch(error => error.message);
  }); await flush();
  expect(await duplicate).toContain('already pending'); expect(mockRpc).toHaveBeenCalledTimes(1);
  await act(async () => write.resolve(response())); await flush();
  expect(first.onSuccess).toHaveBeenCalledTimes(1);
  for (const callback of Object.values(second)) expect(callback).not.toHaveBeenCalled();
});

it('does not let an old finalizer unlock or replace a new account request', async () => {
  const old = deferred<ReturnType<typeof response>>(), fresh = deferred<ReturnType<typeof response>>();
  mockRpc.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise); mount();
  const oldFeedback = callbacks(), freshFeedback = callbacks(); let first!: Promise<unknown>, second!: Promise<unknown>;
  act(() => { first = current.mutateAsync('circle-one', oldFeedback).catch(error => error.name); }); await flush();
  change('account-b', true); act(() => { second = current.mutateAsync('circle-two', freshFeedback); }); await flush();
  await act(async () => { old.resolve(response()); expect(await first).toBe('ObsoleteCircleLeaveError'); }); await flush();
  expect(current.isPending).toBe(true); expect(current.variables).toBe('circle-two');
  await expect(current.mutateAsync('circle-two')).rejects.toThrow('already pending');
  expect(mockRpc).toHaveBeenCalledTimes(2); expectNoEffects(oldFeedback);
  await act(async () => { fresh.resolve(response('not_member')); expect(await second).toBe('not_member'); }); await flush();
  expect(freshFeedback.onSuccess).toHaveBeenCalledTimes(1);
  expect(invalidate.mock.calls.map(call => call[0])).toEqual([
    { queryKey: circleKeys.mine('account-b') }, { queryKey: UNREAD_CHATS_KEY },
  ]);
});

it('stops remaining global effects if invalidating the old directory triggers an account change', async () => {
  mount(); const feedback = callbacks(); const original = QueryClient.prototype.invalidateQueries.bind(client);
  invalidate.mockImplementationOnce((...args: Parameters<typeof client.invalidateQueries>) => {
    const result = original(...args); emit('account-b'); return result;
  });
  await act(async () => {
    await expect(current.mutateAsync('circle-one', feedback)).rejects.toMatchObject({ name: 'ObsoleteCircleLeaveError' });
  }); await flush();
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: circleKeys.mine('account-a') });
  expect(client.getQueryState(UNREAD_CHATS_KEY)?.isInvalidated).toBe(false);
  expect(consumeChatListDirty()).toBe(false);
  for (const callback of Object.values(feedback)) expect(callback).not.toHaveBeenCalled();
  expectFreshState();
});

it('does not run settled feedback or resolve old work if a success callback changes accounts', async () => {
  mount(); const settled = jest.fn();
  await act(async () => {
    await expect(current.mutateAsync('circle-one', { onSuccess: () => emit('account-b'), onSettled: settled }))
      .rejects.toMatchObject({ name: 'ObsoleteCircleLeaveError' });
  }); await flush();
  expect(settled).not.toHaveBeenCalled(); expectFreshState();
});

it.each(['missing', 'mismatched', 'retired'])('does not dispatch when the caller scope is %s', async state => {
  operationScope = state === 'missing' ? null : { userId: state === 'mismatched' ? 'account-b' : 'account-a',
    isCurrent: () => state !== 'retired' };
  mount(); const feedback = callbacks(); act(() => current.mutate('circle-one', feedback));
  await expect(current.mutateAsync('circle-one')).rejects.toMatchObject({ name: 'ObsoleteCircleLeaveError' });
  expect(mockGetUser).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled(); expectNoEffects(feedback);
});

it.each(['auth', 'rpc'])('suppresses continuation after access retires during %s without a parent render', async stage => {
  let accessible = true;
  operationScope = { userId: 'account-a', isCurrent: () => accessible };
  const read = deferred<ReturnType<typeof account>>(), write = deferred<ReturnType<typeof response>>();
  if (stage === 'auth') mockGetUser.mockReturnValueOnce(read.promise); else mockRpc.mockReturnValueOnce(write.promise);
  mount(); const feedback = callbacks(); let work!: Promise<unknown>;
  act(() => { work = current.mutateAsync('circle-one', feedback).catch(error => error.name); }); await flush();
  accessible = false;
  await act(async () => { read.resolve(account()); write.resolve(response()); expect(await work).toBe('ObsoleteCircleLeaveError'); }); await flush();
  expect(mockRpc).toHaveBeenCalledTimes(stage === 'auth' ? 0 : 1); expectNoEffects(feedback); expectFreshState();
});

it('does not revive retained callbacks after a same-account circle A to B to A scope replacement', async () => {
  const roomScope = () => ({ userId: 'account-a', isCurrent: () => true });
  operationScope = roomScope(); mount(); const old = current.mutateAsync;
  operationScope = roomScope(); act(() => tree!.update(render()));
  operationScope = roomScope(); act(() => tree!.update(render()));
  await expect(old('circle-one')).rejects.toMatchObject({ name: 'ObsoleteCircleLeaveError' });
  expect(mockRpc).not.toHaveBeenCalled(); expectNoEffects();
  await act(async () => { expect(await current.mutateAsync('circle-one')).toBe('left'); });
});

it('preserves a pending leave across ordinary rerenders with the same caller scope', async () => {
  operationScope = { userId: 'account-a', isCurrent: () => true };
  const write = deferred<ReturnType<typeof response>>(); mockRpc.mockReturnValueOnce(write.promise); mount();
  let work!: Promise<unknown>; act(() => { work = current.mutateAsync('circle-one'); }); await flush();
  act(() => tree!.update(render()));
  await act(async () => { write.resolve(response()); expect(await work).toBe('left'); });
  expect(invalidate).toHaveBeenCalledTimes(2); expect(consumeChatListDirty()).toBe(true);
});
