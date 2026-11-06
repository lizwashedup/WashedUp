import React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { useFeedWishlist } from '../useFeedWishlist';

const mockSavedStatus = jest.fn();
const mockGetUser = jest.fn(), mockWrite = jest.fn(), mockRead = jest.fn();
let mockEpoch = 1, mockAccount = 'alice';
let mockIdentityError: Error | null = null;
const mockIdentityRetry = jest.fn();
let mockFocus: (() => void | (() => void)) | undefined, mockBlur: (() => void) | undefined;
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void | (() => void)) => {
  require('react').useEffect(() => { mockFocus = callback; mockBlur = callback() || undefined;
    return () => { mockBlur?.(); mockBlur = undefined; mockFocus = undefined; };
  }, [callback]);
} }));
jest.mock('../useObservedUser', () => ({ useObservedUser: () => {
  const epoch = mockEpoch;
  return { viewerId: mockAccount, epoch, error: mockIdentityError, isLoading: false, retry: mockIdentityRetry, isCurrent: () => epoch === mockEpoch };
} }));
jest.mock('../../lib/haptics', () => ({ hapticError: jest.fn() }));
jest.mock('../../lib/supabase', () => ({ supabase: {
  auth: { getUser: () => mockGetUser() },
  from: (table: string) => ({
    select: () => ({ eq: (_field: string, account: string) => ({
      then: (ok:any,fail:any) => mockRead(account).then(ok,fail),
      eq: (_event:string,id:string) => ({maybeSingle:()=>mockSavedStatus(account,id)}),
    }) }),
    insert: (row: { user_id: string; event_id: string }) => mockWrite('insert', table, row),
    delete: () => ({ eq: (_field: string, account: string) => ({ eq: (_event: string, eventId: string) => mockWrite('delete', table, { user_id: account, event_id: eventId }) }) }),
  }),
} }));
const cleanups: Array<() => void> = [];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => resolve = yes); return { promise, resolve }; }
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); }
async function mount(initial: string[] | undefined = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  if (initial) client.setQueryData(['wishlists', 'alice'], initial);
  const saved = jest.fn(); let account = 'alice', current!: ReturnType<typeof useFeedWishlist>;
  let renderedPending = false;
  function Harness() { current = useFeedWishlist(account, saved); renderedPending = current.pending('one'); return null; }
  const render = () => <QueryClientProvider client={client}><Harness /></QueryClientProvider>;
  let tree!: ReturnType<typeof create>; act(() => { tree = create(render()); });
  let mounted = true; const unmount = () => { if (mounted) act(() => tree.unmount()); mounted = false; };
  cleanups.push(() => { unmount(); client.clear(); });
  await flush();
  return { client, saved, unmount, get current() { return current; }, get renderedPending() { return renderedPending; },
    update(next: string) { account = next; act(() => tree.update(render())); },
    toggle(event = 'plan-one', announce = true) { act(() => current.toggle(event, 'Sunday walk', announce)); },
  };
}
beforeEach(() => {
  mockSavedStatus.mockReset().mockResolvedValue({data:null,error:null});
  jest.clearAllMocks(); mockEpoch = 1; mockAccount = 'alice'; mockIdentityError = null; onlineManager.setOnline(true);
  mockGetUser.mockImplementation(async () => ({ data: { user: { id: mockAccount } }, error: null }));
  mockWrite.mockResolvedValue({ error: null }); mockRead.mockResolvedValue({ data: [], error: null });
});
afterEach(() => { onlineManager.setOnline(true); cleanups.splice(0).forEach(fn => fn()); jest.useRealTimers(); });

it('announces only after a confirmed save and blocks repeated taps synchronously', async () => {
  const gate = deferred<{ error: null }>(); mockWrite.mockReturnValue(gate.promise);
  const f = await mount(); const tap = f.current.toggle;
  act(() => { tap('plan-one', 'Sunday walk'); tap('plan-one', 'Sunday walk'); }); await flush();
  expect(mockWrite).toHaveBeenCalledTimes(1); expect(f.saved).not.toHaveBeenCalled();
  expect(f.current.pending('plan-one')).toBe(true);
  expect(f.client.getQueryData(['wishlists', 'alice'])).toContain('plan-one');
  await act(async () => gate.resolve({ error: null })); await flush();
  expect(f.saved).toHaveBeenCalledWith('plan-one', 'Sunday walk');
  expect(f.current.pending('plan-one')).toBe(false);
});

it('returned Supabase errors roll back and leave an actionable retry without a Saved claim', async () => {
  mockWrite.mockResolvedValueOnce({ error: { message: 'offline' } }); const f = await mount();
  f.toggle(); await flush();
  expect(f.saved).not.toHaveBeenCalled(); expect(f.current.feedback?.kind).toBe('error');
  expect(f.client.getQueryData(['wishlists', 'alice'])).toEqual([]);
  act(() => f.current.retry()); await flush();
  expect(mockWrite).toHaveBeenCalledTimes(2); expect(f.saved).toHaveBeenCalledTimes(1);
});

it('a failed remove restores saved state and never announces a new save', async () => {
  mockRead.mockResolvedValue({ data: [{ event_id: 'plan-one' }], error: null });
  mockWrite.mockResolvedValue({ error: new Error('offline') }); mockSavedStatus.mockResolvedValue({data:{event_id:'plan-one'},error:null}); const f = await mount(['plan-one']);
  f.toggle(); await flush();
  expect(mockWrite).toHaveBeenCalledWith('delete', 'wishlists', { user_id: 'alice', event_id: 'plan-one' });
  expect(f.client.getQueryData(['wishlists', 'alice'])).toEqual(['plan-one']);
  expect(f.current.feedback?.call.wasSaved).toBe(true); expect(f.saved).not.toHaveBeenCalled();
});

it('rollback touches only the failed plan while another save is pending', async () => {
  const first = deferred<{ error: Error }>(), second = deferred<{ error: null }>();
  mockWrite.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const f = await mount(); const invalidate = jest.spyOn(f.client, 'invalidateQueries').mockResolvedValue();
  f.toggle('one'); f.toggle('two'); await flush();
  await act(async () => first.resolve({ error: new Error('offline') })); await flush();
  expect(f.client.getQueryData(['wishlists', 'alice'])).toEqual(['two']);
  expect(f.current.pending('two')).toBe(true);
  await act(async () => second.resolve({ error: null })); await flush(); invalidate.mockRestore();
});

it.each(['account', 'roundtrip', 'blur', 'unmount'])('does not dispatch after auth preflight crosses %s', async reason => {
  const auth = deferred<{ data: { user: { id: string } }; error: null }>();
  mockGetUser.mockReturnValue(auth.promise); const f = await mount(); f.toggle(); await flush();
  if (reason === 'account') { mockEpoch++; mockAccount = 'bob'; f.update('bob'); }
  if (reason === 'roundtrip') { mockEpoch += 2; f.update('alice'); }
  if (reason === 'blur') act(() => mockBlur?.());
  if (reason === 'unmount') f.unmount();
  await act(async () => auth.resolve({ data: { user: { id: 'alice' } }, error: null })); await flush();
  expect(mockWrite).not.toHaveBeenCalled(); expect(f.saved).not.toHaveBeenCalled();
});

it('late completion reconciles the initiating account without showing success in the next account', async () => {
  const write = deferred<{ error: null }>(); mockWrite.mockReturnValue(write.promise);
  mockRead.mockImplementation(async (account: string) => ({ data: account === 'bob' ? [{event_id:'bob-plan'}] : [], error:null }));
  const f = await mount(); const invalidate = jest.spyOn(f.client, 'invalidateQueries');
  f.toggle(); await flush(); mockEpoch++; mockAccount = 'bob'; f.update('bob');
  f.client.setQueryData(['wishlists', 'bob'], ['bob-plan']);
  await act(async () => write.resolve({ error: null })); await flush();
  expect(f.saved).not.toHaveBeenCalled();
  expect(f.client.getQueryData(['wishlists', 'bob'])).toEqual(['bob-plan']);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['wishlists', 'alice'] });
});

it('retained callbacks from an earlier focused visit cannot save on a return visit', async () => {
  const f = await mount(); const oldToggle = f.current.toggle;
  act(() => { mockBlur?.(); mockBlur = mockFocus?.() || undefined; });
  act(() => oldToggle('old-plan', 'Old')); await flush(); expect(mockWrite).not.toHaveBeenCalled();
  f.toggle(); await flush(); expect(mockWrite).toHaveBeenCalledTimes(1);
});

it('an offline queued save cannot dispatch after its visit closes', async () => {
  const f = await mount(); onlineManager.setOnline(false); f.toggle(); await flush();
  act(() => mockBlur?.()); act(() => onlineManager.setOnline(true)); await flush();
  expect(mockWrite).not.toHaveBeenCalled(); expect(f.saved).not.toHaveBeenCalled();
});

it('a failed saved-list read remains unknown and prevents opposite bookmark actions', async () => {
  mockRead.mockResolvedValue({ data: null, error: new Error('offline') });
  const f = await mount(); f.client.removeQueries({ queryKey: ['wishlists', 'alice'] });
  await act(async () => { await f.current.refetch(); }); await flush();
  expect(f.current.isError).toBe(true); f.toggle(); await flush(); expect(mockWrite).not.toHaveBeenCalled();
});

it('uses current cached membership rather than a retained visual bookmark state, and preserves featured silence', async () => {
  const f = await mount(); f.client.setQueryData(['wishlists', 'alice'], ['plan-one']);
  f.toggle('plan-one', false); await flush();
  expect(mockWrite).toHaveBeenCalledWith('delete', 'wishlists', { user_id: 'alice', event_id: 'plan-one' });
  expect(f.saved).not.toHaveBeenCalled();
});

it('confirms a committed save after the response is lost without a second write or false error', async () => {
  mockWrite.mockResolvedValueOnce({ error: new Error('lost receipt') });
  mockSavedStatus.mockResolvedValueOnce({data:{event_id:'plan-one'},error:null});
  mockRead.mockResolvedValue({ data: [{ event_id: 'plan-one' }], error: null });
  const f = await mount(); f.toggle(); await flush();
  expect(mockSavedStatus).toHaveBeenCalledWith('alice','plan-one');
  expect(f.current.feedback).toBeNull(); expect(f.saved).toHaveBeenCalledTimes(1);
  expect(f.client.getQueryData(['wishlists','alice'])).toEqual(['plan-one']);
  expect(mockWrite).toHaveBeenCalledTimes(1);
});

it.each([true,false])('rechecks before retrying an uncertain save (already saved: %s)', async committed => {
  const f=await mount(); mockWrite.mockRejectedValueOnce(Error('offline'));
  mockSavedStatus.mockRejectedValueOnce(Error('status offline')); f.toggle();await flush();
  expect(f.current.feedback?.uncertain).toBe(true); expect(f.saved).not.toHaveBeenCalled();
  mockSavedStatus.mockResolvedValueOnce({data:committed?{event_id:'plan-one'}:null,error:null});
  act(()=>f.current.retry());await flush();
  expect(mockWrite).toHaveBeenCalledTimes(committed?1:2);expect(f.saved).toHaveBeenCalledTimes(1);
});

it('retires a late status read rather than announcing the previous account’s save', async () => {
  const f=await mount(), status=deferred<any>();
  mockWrite.mockRejectedValueOnce(Error('offline'));mockSavedStatus.mockReturnValueOnce(status.promise);
  f.toggle();await flush();mockEpoch++;mockAccount='bob';f.update('bob');
  await act(async()=>status.resolve({data:{event_id:'plan-one'},error:null}));await flush();
  expect(f.saved).not.toHaveBeenCalled();expect(f.current.feedback).toBeNull();expect(mockWrite).toHaveBeenCalledTimes(1);
});

it('pending state belongs to an account even when both accounts see the same plan', async () => {
  const write = deferred<{ error: null }>(); mockWrite.mockReturnValueOnce(write.promise);
  const f = await mount(); f.toggle(); await flush();
  mockEpoch++; mockAccount = 'bob'; f.update('bob'); await flush();
  expect(f.current.pending('plan-one')).toBe(false); expect(f.current.canWrite).toBe(true);
  f.toggle(); await flush();
  expect(mockWrite).toHaveBeenCalledTimes(2);
  expect(mockWrite.mock.calls[1][2].user_id).toBe('bob');
  await act(async () => write.resolve({ error: null }));
});


it('publishes pending completion into a return visit while another plan is still pending', async () => {
  const one = deferred<{ error: null }>(), two = deferred<{ error: null }>();
  mockWrite.mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise);
  const f = await mount(); f.toggle('one'); f.toggle('two'); await flush();
  act(() => { mockBlur?.(); mockBlur = mockFocus?.() || undefined; });
  expect(f.renderedPending).toBe(true);
  await act(async () => one.resolve({ error: null })); await flush();
  expect(f.renderedPending).toBe(false); expect(f.current.pending('two')).toBe(true);
  expect(f.saved).not.toHaveBeenCalled();
  await act(async () => two.resolve({ error: null }));
});

it('a failed identity check exposes a retry and disables writing despite cached saved data', async () => {
  mockIdentityError = new Error('offline'); const f = await mount();
  expect(f.current.isSuccess).toBe(true); expect(f.current.canWrite).toBe(false);
  expect(f.current.identityError).toBe(mockIdentityError);
  f.toggle(); await flush(); expect(mockWrite).not.toHaveBeenCalled();
  await f.current.retryIdentity(); expect(mockIdentityRetry).toHaveBeenCalledTimes(1);
});


it.each([false, true])('recovers a stalled account check for an original saved state of %s', async wasSaved => {
  mockRead.mockResolvedValue({ data: wasSaved ? [{ event_id: 'plan-one' }] : [], error: null });
  const f = await mount(wasSaved ? ['plan-one'] : []), auth = deferred<any>();
  mockGetUser.mockReturnValueOnce(auth.promise); jest.useFakeTimers();
  f.toggle(); await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  expect(f.current.pending('plan-one')).toBe(true);
  await act(async () => { await jest.advanceTimersByTimeAsync(8001); });
  expect(f.current.pending('plan-one')).toBe(false); expect(f.current.feedback?.kind).toBe('error');
  expect(f.client.getQueryData(['wishlists', 'alice'])).toEqual(wasSaved ? ['plan-one'] : []);
  expect(mockWrite).not.toHaveBeenCalled(); expect(f.saved).not.toHaveBeenCalled();
  await act(async () => { auth.resolve({ data: { user: { id: 'alice' } }, error: null }); await jest.advanceTimersByTimeAsync(1); });
  expect(mockWrite).not.toHaveBeenCalled();
  act(() => f.current.retry()); await act(async () => { await jest.advanceTimersByTimeAsync(5); });
  expect(mockWrite).toHaveBeenCalledTimes(1); expect(mockWrite.mock.calls[0][0]).toBe(wasSaved ? 'delete' : 'insert');
});
it('a stalled account check rolls back only its plan while another save remains pending', async () => {
  const f=await mount(),auth=deferred<any>(),write=deferred<any>();
  mockGetUser.mockReturnValueOnce(auth.promise);mockWrite.mockReturnValueOnce(write.promise);jest.useFakeTimers();
  f.toggle('one');await act(async()=>{await jest.advanceTimersByTimeAsync(1);});
  f.toggle('two');await act(async()=>{await jest.advanceTimersByTimeAsync(8001);});
  expect(f.current.pending('one')).toBe(false);expect(f.current.pending('two')).toBe(true);
  expect(f.client.getQueryData(['wishlists','alice'])).toEqual(['two']);expect(mockWrite).toHaveBeenCalledTimes(1);
  await act(async()=>{write.resolve({error:null});await jest.advanceTimersByTimeAsync(5);});
});
it('does not time out or repeat a submitted wishlist write',async()=>{
 const f=await mount(),write=deferred<any>();mockWrite.mockReturnValueOnce(write.promise);jest.useFakeTimers();f.toggle();
 await act(async()=>{await jest.advanceTimersByTimeAsync(30000);});f.toggle();
 expect(f.current.pending('plan-one')).toBe(true);expect(mockWrite).toHaveBeenCalledTimes(1);expect(f.saved).not.toHaveBeenCalled();
 await act(async()=>{write.resolve({error:null});await jest.advanceTimersByTimeAsync(5);});expect(f.saved).toHaveBeenCalledTimes(1);
});
