import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useGetOrCreateDm } from '../useGetOrCreateDm';
import { consumeChatListDirty } from '../../lib/chatListSignal';

const mockRpc = jest.fn(), mockGetUser = jest.fn(), mockGetSession = jest.fn();
const mockListeners = new Set<(event: string, session: { user: { id: string } } | null) => void>();
jest.mock('../../lib/supabase', () => ({ supabase: {
  rpc: (...args: unknown[]) => mockRpc(...args),
  auth: {
    getUser: () => mockGetUser(), getSession: () => mockGetSession(),
    onAuthStateChange: (callback: any) => { mockListeners.add(callback); return { data: { subscription: { unsubscribe: () => mockListeners.delete(callback) } } }; },
  },
} }));
const session = (id: string | null = 'alice') => ({ data: { session: id ? { user: { id } } : null }, error: null });
const account = (id: string | null = 'alice') => ({ data: { user: id ? { id } : null }, error: null });
const response = (data: unknown = 'dm-one') => ({ data, error: null });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function emit(id: string | null, event = id ? 'SIGNED_IN' : 'SIGNED_OUT') {
  mockGetUser.mockResolvedValue(account(id)); mockGetSession.mockResolvedValue(session(id));
  for (const listener of mockListeners) listener(event, id ? { user: { id } } : null);
}
let tree: ReactTestRenderer | undefined, client: QueryClient, current: ReturnType<typeof useGetOrCreateDm>;
function Harness() { current = useGetOrCreateDm(); return null; }
function mount() { act(() => { tree = create(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); }); }
async function flush() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
function callbacks() { return { onSuccess: jest.fn(), onError: jest.fn(), onSettled: jest.fn() }; }
function noEffects(feedback?: ReturnType<typeof callbacks>) { expect(consumeChatListDirty()).toBe(false); if (feedback) for (const callback of Object.values(feedback)) expect(callback).not.toHaveBeenCalled(); }
function idle() { expect(current).toMatchObject({ status: 'idle', isIdle: true, isPending: false, isSuccess: false, isError: false, data: undefined, error: null, variables: undefined, failureReason: null, failureCount: 0 }); }
beforeEach(() => {
  jest.clearAllMocks(); mockListeners.clear(); consumeChatListDirty();
  client = new QueryClient({ defaultOptions: { mutations: { retry: 2, retryDelay: 0, gcTime: Infinity }, queries: { retry: false, gcTime: Infinity } } });
  mockRpc.mockReset().mockResolvedValue(response()); mockGetUser.mockReset().mockResolvedValue(account()); mockGetSession.mockReset().mockResolvedValue(session());
});
afterEach(async () => { if (tree) act(() => tree!.unmount()); tree = undefined; client.clear(); await flush(); expect(mockListeners.size).toBe(0); });

it('keeps the no-argument API and scalar recipient/receipt while refreshing the inbox after confirmed success', async () => {
  mount(); const feedback = callbacks();
  await act(async () => { expect(await current.mutateAsync('amelia', feedback)).toBe('dm-one'); }); await flush();
  expect(mockRpc).toHaveBeenCalledWith('get_or_create_dm', { p_other: 'amelia' }); expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockGetUser).toHaveBeenCalledTimes(1); expect(mockGetSession).toHaveBeenCalledTimes(2);
  expect(current).toMatchObject({ data: 'dm-one', variables: 'amelia', isSuccess: true });
  expect(feedback.onSuccess.mock.calls[0].slice(0, 2)).toEqual(['dm-one', 'amelia']);
  expect(feedback.onSettled.mock.calls[0].slice(0, 3)).toEqual(['dm-one', null, 'amelia']);
  expect(feedback.onError).not.toHaveBeenCalled(); expect(consumeChatListDirty()).toBe(true); expect(consumeChatListDirty()).toBe(false);
});

it('keeps normal mutate callbacks usable by KeepPage and PersonProfilePage', async () => {
  mount(); await flush(); const feedback = callbacks(); act(() => current.mutate('amelia', feedback)); await flush();
  expect(feedback.onSuccess.mock.calls[0].slice(0, 2)).toEqual(['dm-one', 'amelia']); expect(consumeChatListDirty()).toBe(true);
});

it.each([null, undefined, false, 0, [], {}, ['dm-one'], '', '   '])('rejects an unconfirmed receipt (%p)', async value => {
  mockRpc.mockResolvedValue({ data: value, error: null }); mount(); const feedback = callbacks();
  await act(async () => { await expect(current.mutateAsync('amelia', feedback)).rejects.toThrow('Could not confirm'); }); await flush();
  expect(feedback.onSuccess).not.toHaveBeenCalled(); expect(feedback.onError).toHaveBeenCalledTimes(1); noEffects();
});

it('does not dispatch an empty recipient or an unauthenticated request', async () => {
  mockGetSession.mockResolvedValue(session(null)); mount();
  await act(async () => { await expect(current.mutateAsync('')).rejects.toThrow('Choose someone'); });
  await act(async () => { await expect(current.mutateAsync('amelia')).rejects.toThrow('Sign in'); });
  expect(mockRpc).not.toHaveBeenCalled(); noEffects();
});

it.each(['auth', 'rpc', 'receipt-session'])('keeps a current %s failure visible without automatic retries, then allows deliberate retry', async stage => {
  const failure = new Error('Temporary failure');
  if (stage === 'auth') mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: failure });
  if (stage === 'rpc') mockRpc.mockResolvedValueOnce({ data: null, error: failure });
  if (stage === 'receipt-session') mockGetSession.mockResolvedValueOnce(session()).mockResolvedValueOnce({ data: { session: null }, error: failure });
  mount(); const feedback = callbacks();
  await act(async () => { await expect(current.mutateAsync('amelia', feedback)).rejects.toBe(failure); }); await flush();
  expect(feedback.onError).toHaveBeenCalledTimes(1); expect(feedback.onSuccess).not.toHaveBeenCalled(); noEffects();
  expect(mockRpc).toHaveBeenCalledTimes(stage === 'auth' ? 0 : 1);
  await act(async () => { expect(await current.mutateAsync('amelia')).toBe('dm-one'); });
});

it('waits for the initial cached identity before validating the caller and dispatching', async () => {
  const read = deferred<ReturnType<typeof session>>(); mockGetSession.mockReturnValueOnce(read.promise); mount();
  let work!: Promise<string>; act(() => { work = current.mutateAsync('amelia'); }); await flush();
  expect(mockGetUser).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled();
  await act(async () => { read.resolve(session()); expect(await work).toBe('dm-one'); });
});

it('lets INITIAL_SESSION identify a cold-start call without waiting on a stalled cached read', async () => {
  const read = deferred<ReturnType<typeof session>>(); mockGetSession.mockReturnValueOnce(read.promise); mount();
  let work!: Promise<string>; act(() => { work = current.mutateAsync('amelia'); }); await flush();
  await act(async () => { emit('alice', 'INITIAL_SESSION'); expect(await work).toBe('dm-one'); });
  read.resolve(session(null)); await flush(); expect(current.isSuccess).toBe(true);
});

it('does not let a late initial read or INITIAL_SESSION replace a newer sign-in', async () => {
  const read = deferred<ReturnType<typeof session>>(); mockGetSession.mockReturnValueOnce(read.promise); mount();
  const old = current.mutateAsync;
  act(() => emit('bob')); await flush(); read.resolve(session('alice')); await flush();
  // A stale initial event must not overwrite Bob. Restore current SDK reads
  // separately; this intentionally emits an old event without switching SDK state.
  act(() => { for (const listener of mockListeners) listener('INITIAL_SESSION', { user: { id: 'alice' } }); });
  await expect(old('amelia')).rejects.toMatchObject({ name: 'ObsoleteDmOperationError' });
  await act(async () => { expect(await current.mutateAsync('jamie')).toBe('dm-one'); });
  expect(mockRpc).toHaveBeenCalledTimes(1); expect(mockRpc).toHaveBeenCalledWith('get_or_create_dm', { p_other: 'jamie' });
});

it('retries a failed initialization on a deliberate action', async () => {
  mockGetSession.mockRejectedValueOnce(new Error('Initial read offline')); mount(); await flush();
  await act(async () => { expect(await current.mutateAsync('amelia')).toBe('dm-one'); });
  expect(mockGetSession).toHaveBeenCalledTimes(3);
});

it('rejects a callback captured before an explicit sign-in even when initial identity was unresolved', async () => {
  const read = deferred<ReturnType<typeof session>>(); mockGetSession.mockReturnValueOnce(read.promise); mount(); const old = current.mutate;
  act(() => emit('bob')); act(() => old('amelia')); await flush(); expect(mockRpc).not.toHaveBeenCalled();
  read.resolve(session('alice'));
});

it('captures identity before React Query schedules mutationFn', async () => {
  mount(); await flush(); const feedback = callbacks();
  act(() => { current.mutate('amelia', feedback); emit('bob'); emit('alice'); }); await flush();
  expect(mockGetUser).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled(); noEffects(feedback); idle();
});

it('refuses retained mutators after A → B → A', async () => {
  mount(); await flush(); const old = current.mutate, oldAsync = current.mutateAsync;
  act(() => { emit('bob'); emit('alice'); }); await flush(); act(() => old('amelia'));
  await expect(oldAsync('amelia')).rejects.toMatchObject({ name: 'ObsoleteDmOperationError' }); noEffects(); expect(mockRpc).not.toHaveBeenCalled();
  await act(async () => { expect(await current.mutateAsync('jamie')).toBe('dm-one'); });
});

it.each(['preflight', 'rpc', 'receipt-session'])('retires delayed %s work on A → B → A', async stage => {
  const authRead = deferred<ReturnType<typeof account>>(), write = deferred<ReturnType<typeof response>>(), receipt = deferred<ReturnType<typeof session>>();
  if (stage === 'preflight') mockGetUser.mockReturnValueOnce(authRead.promise);
  if (stage === 'rpc') mockRpc.mockReturnValueOnce(write.promise);
  if (stage === 'receipt-session') mockGetSession.mockResolvedValueOnce(session()).mockReturnValueOnce(receipt.promise);
  mount(); await flush(); const feedback = callbacks(); let work!: Promise<unknown>;
  act(() => { work = current.mutateAsync('amelia', feedback).catch(error => error); }); await flush();
  act(() => { emit('bob'); emit('alice'); }); await flush();
  await act(async () => {
    authRead.resolve(account()); write.resolve(response()); receipt.resolve(session());
    expect(await work).toMatchObject({ name: 'ObsoleteDmOperationError' });
  }); await flush(); noEffects(feedback); idle();
  if (stage === 'preflight') expect(mockRpc).not.toHaveBeenCalled();
});

it.each(['preflight', 'receipt-session'])('rejects a changed %s account even before an auth event arrives', async stage => {
  if (stage === 'preflight') mockGetUser.mockResolvedValueOnce(account('bob'));
  else mockGetSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session('bob'));
  mount(); const feedback = callbacks(); await act(async () => { await expect(current.mutateAsync('amelia', feedback)).rejects.toMatchObject({ name: 'ObsoleteDmOperationError' }); });
  await flush(); noEffects(feedback); idle(); if (stage === 'preflight') expect(mockRpc).not.toHaveBeenCalled();
});

it('preserves same-account TOKEN_REFRESHED work', async () => {
  const write = deferred<ReturnType<typeof response>>(); mockRpc.mockReturnValueOnce(write.promise); mount(); await flush();
  let work!: Promise<string>; const feedback = callbacks(); act(() => { work = current.mutateAsync('amelia', feedback); }); await flush();
  await act(async () => { emit('alice', 'TOKEN_REFRESHED'); write.resolve(response()); expect(await work).toBe('dm-one'); });
  expect(feedback.onSuccess).toHaveBeenCalledTimes(1); expect(consumeChatListDirty()).toBe(true);
});

it('allows simultaneous legitimate recipients without a global pending lock', async () => {
  const one = deferred<ReturnType<typeof response>>(), two = deferred<ReturnType<typeof response>>();
  mockRpc.mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise); mount(); await flush();
  let first!: Promise<string>, second!: Promise<string>;
  act(() => { first = current.mutateAsync('amelia'); second = current.mutateAsync('jamie'); }); await flush();
  expect(mockRpc.mock.calls.map(call => call[1])).toEqual([{ p_other: 'amelia' }, { p_other: 'jamie' }]);
  await act(async () => { two.resolve(response('dm-two')); expect(await second).toBe('dm-two'); one.resolve(response('dm-one')); expect(await first).toBe('dm-one'); });
  await flush();
  expect(current.variables).toBe('jamie'); expect(current.data).toBe('dm-two');
});

it.each(['success', 'failure'])('suppresses late %s and retained callbacks after unmount', async outcome => {
  const write = deferred<ReturnType<typeof response>>(); mockRpc.mockReturnValueOnce(write.promise); mount(); await flush();
  const saved = current.mutate; const feedback = callbacks(); let work!: Promise<unknown>;
  act(() => { work = current.mutateAsync('amelia', feedback).catch(error => error); }); await flush();
  act(() => tree!.unmount()); tree = undefined; saved('jamie');
  await act(async () => { if (outcome === 'success') write.resolve(response()); else write.reject(new Error('late error')); expect(await work).toMatchObject({ name: 'ObsoleteDmOperationError' }); });
  noEffects(feedback); expect(mockRpc).toHaveBeenCalledTimes(1);
});

it('retires an already queued cold-start call when an explicit sign-in arrives', async () => {
  const read = deferred<ReturnType<typeof session>>(); mockGetSession.mockReturnValueOnce(read.promise); mount();
  const feedback = callbacks(); let work!: Promise<unknown>;
  act(() => { work = current.mutateAsync('amelia', feedback).catch(error => error); }); await flush();
  await act(async () => { emit('bob'); expect(await work).toMatchObject({ name: 'ObsoleteDmOperationError' }); });
  read.resolve(session('alice')); await flush(); expect(mockRpc).not.toHaveBeenCalled(); noEffects(feedback);
});

it('does not let a delayed INITIAL_SESSION undo an already resolved cached identity', async () => {
  mount(); await flush();
  act(() => { for (const listener of mockListeners) listener('INITIAL_SESSION', null); });
  await act(async () => { expect(await current.mutateAsync('amelia')).toBe('dm-one'); });
});

it('suppresses an RPC error receipt if its final session check finds another account', async () => {
  mockRpc.mockResolvedValue({ data: null, error: new Error('Old account denied') });
  mockGetSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session('bob'));
  mount(); const feedback = callbacks();
  await act(async () => { await expect(current.mutateAsync('amelia', feedback)).rejects.toMatchObject({ name: 'ObsoleteDmOperationError' }); });
  await flush(); noEffects(feedback); idle();
});

it('suppresses a delayed RPC exception after an account round trip without blocking the next recipient', async () => {
  const write = deferred<ReturnType<typeof response>>(); mockRpc.mockReturnValueOnce(write.promise);
  mount(); await flush(); const feedback = callbacks(); let work!: Promise<unknown>;
  act(() => { work = current.mutateAsync('amelia', feedback).catch(error => error); }); await flush();
  act(() => { emit('bob'); emit('alice'); }); await flush();
  await act(async () => { write.reject(new Error('Old network failure')); expect(await work).toMatchObject({ name: 'ObsoleteDmOperationError' }); });
  noEffects(feedback);
  await act(async () => { expect(await current.mutateAsync('jamie')).toBe('dm-one'); });
});

// A profile can stay mounted in the navigation stack after focus leaves it.
// Optional caller ownership retires that visit before dispatch, not just its UI.
function visitScope(userId = 'alice') { let live = true; return { userId, isCurrent: () => live, retire: () => { live = false; } }; }
it('preserves the scalar result and callback arguments for a current optional visit scope', async () => {
  mount(); await flush(); const scope = visitScope(), feedback = callbacks();
  await act(async () => { expect(await current.mutateAsync('amelia', { ...feedback, scope })).toBe('dm-one'); }); await flush();
  expect(mockRpc.mock.calls).toEqual([['get_or_create_dm', { p_other: 'amelia' }]]); expect(feedback.onSuccess.mock.calls[0].slice(0, 2)).toEqual(['dm-one', 'amelia']); expect(consumeChatListDirty()).toBe(true);
});
it.each(['retired', 'wrong account'])('does not schedule optional scoped work for a %s caller', async state => {
  mount(); await flush(); const scope = visitScope(state === 'wrong account' ? 'bob' : 'alice'); if (state === 'retired') scope.retire(); const feedback = callbacks();
  act(() => current.mutate('amelia', { ...feedback, scope })); await expect(current.mutateAsync('amelia', { ...feedback, scope })).rejects.toMatchObject({ name: 'ObsoleteDmOperationError' });
  expect(mockGetUser).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled(); noEffects(feedback);
});
it('captures and rechecks visit ownership before React Query schedules mutationFn', async () => {
  mount(); await flush(); const scope = visitScope(), feedback = callbacks();
  act(() => { current.mutate('amelia', { ...feedback, scope }); scope.retire(); }); await flush();
  expect(mockGetUser).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled(); noEffects(feedback); idle();
});
it('retires a scoped cold-start wait without dispatch after the account is identified', async () => {
  const read = deferred<ReturnType<typeof session>>(); mockGetSession.mockReturnValueOnce(read.promise); mount(); const scope = visitScope(), feedback = callbacks(); let work!: Promise<unknown>;
  act(() => { work = current.mutateAsync('amelia', { ...feedback, scope }).catch(e => e); }); await flush(); scope.retire();
  await act(async () => { read.resolve(session()); expect(await work).toMatchObject({ name: 'ObsoleteDmOperationError' }); });
  expect(mockGetUser).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled(); noEffects(feedback);
});
it.each(['preflight', 'rpc', 'receipt-session'])('retires delayed %s on caller blur even while its hook/account stay mounted', async stage => {
  const preflight = deferred<ReturnType<typeof account>>(), write = deferred<ReturnType<typeof response>>(), receipt = deferred<ReturnType<typeof session>>();
  if (stage === 'preflight') mockGetUser.mockReturnValueOnce(preflight.promise);
  if (stage === 'rpc') mockRpc.mockReturnValueOnce(write.promise);
  if (stage === 'receipt-session') mockGetSession.mockResolvedValueOnce(session()).mockReturnValueOnce(receipt.promise);
  mount(); await flush(); const scope = visitScope(), feedback = callbacks(); let work!: Promise<unknown>;
  act(() => { work = current.mutateAsync('amelia', { ...feedback, scope }).catch(e => e); }); await flush(); scope.retire();
  await act(async () => { preflight.resolve(account()); write.resolve(response()); receipt.resolve(session()); expect(await work).toMatchObject({ name: 'ObsoleteDmOperationError' }); }); await flush();
  noEffects(feedback); idle(); if (stage === 'preflight') expect(mockRpc).not.toHaveBeenCalled();
  const next = visitScope(); await act(async () => { expect(await current.mutateAsync('jamie', { scope: next })).toBe('dm-one'); });
});
it('retired scoped failures stay quiet and leave an unrelated scope free to work', async () => {
  const pending = deferred<ReturnType<typeof response>>(); mockRpc.mockReturnValueOnce(pending.promise); mount(); await flush(); const scope = visitScope(), feedback = callbacks(); let work!: Promise<unknown>;
  act(() => { work = current.mutateAsync('amelia', { ...feedback, scope }).catch(e => e); }); await flush(); scope.retire();
  await act(async () => { pending.reject(new Error('Old failure')); expect(await work).toMatchObject({ name: 'ObsoleteDmOperationError' }); }); noEffects(feedback);
  await act(async () => { expect(await current.mutateAsync('jamie', { scope: visitScope() })).toBe('dm-one'); });
});
it('does not let mutation of a caller options object replace the captured visit', async () => {
  const read = deferred<ReturnType<typeof account>>(); mockGetUser.mockReturnValueOnce(read.promise); mount(); await flush(); const scope = visitScope(), options = { scope }; let work!: Promise<unknown>;
  act(() => { work = current.mutateAsync('amelia', options).catch(e => e); }); await flush(); const retire = scope.retire; scope.isCurrent = () => true; options.scope = visitScope(); retire();
  await act(async () => { read.resolve(account()); expect(await work).toMatchObject({ name: 'ObsoleteDmOperationError' }); }); expect(mockRpc).not.toHaveBeenCalled(); noEffects();
});
it('rechecks caller ownership after success callbacks before returning an async result', async () => {
  mount(); await flush(); const scope = visitScope(), onSuccess = jest.fn(() => scope.retire()), onSettled = jest.fn();
  await act(async () => { await expect(current.mutateAsync('amelia', { scope, onSuccess, onSettled })).rejects.toMatchObject({ name: 'ObsoleteDmOperationError' }); });
  expect(onSuccess).toHaveBeenCalledTimes(1); expect(onSettled).not.toHaveBeenCalled();
});
