import React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { useCommunityChatPreference } from '../useCommunityChatPreference';
import { getCommunityChatPreference, setCommunityChatPreference, type CommunityChatPreference } from '../../lib/communityChatPreference';
import type { ObservedUser } from '../useObservedUser';
jest.mock('../../lib/communityChatPreference', () => ({ getCommunityChatPreference: jest.fn(), setCommunityChatPreference: jest.fn() }));
jest.mock('../../lib/supabase', () => ({ supabase: { auth: { getUser: jest.fn() }, rpc: jest.fn() } }));
const read = jest.mocked(getCommunityChatPreference), write = jest.mocked(setCommunityChatPreference);
const value = (muted = false, version = 0, userId = 'a'): CommunityChatPreference => ({ communityId: 'page', userId, muted, version });
const cleanup: Array<() => void> = [];
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { resolve, promise }; };
let fakeTime = false;
async function flush() { for (let i = 0; i < 4; i++) await act(async () => { if (fakeTime) await jest.advanceTimersByTimeAsync(1); else await new Promise(yes => setTimeout(yes, 0)); }); }
function mount(communityId = 'page', initialUserId = 'a') {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });
  let result!: ReturnType<typeof useCommunityChatPreference>, tree!: ReturnType<typeof create>, id = initialUserId, epoch = 1, enabled = true;
  function Harness() { const captured = id; const viewer = { viewerId: id, epoch, isLoading: false, error: null, retry: async () => {}, isCurrent: () => captured === id } as ObservedUser; result = useCommunityChatPreference(communityId, viewer, enabled); return null; }
  const node = () => <QueryClientProvider client={client}><Harness /></QueryClientProvider>;
  act(() => { tree = create(node()); }); cleanup.push(() => { act(() => tree.unmount()); client.clear(); });
  return { get result() { return result; }, focus: (next: boolean) => { enabled = next; act(() => tree.update(node())); }, account: (next: string) => { id = next; epoch++; act(() => tree.update(node())); } };
}
beforeEach(() => { jest.clearAllMocks(); read.mockResolvedValue(value()); write.mockResolvedValue(value(true, 1)); });
afterEach(async () => { cleanup.splice(0).forEach(fn => fn()); jest.restoreAllMocks(); jest.useRealTimers(); fakeTime = false; await flush(); });
it('loads without changing preferences and retains unknown reads as errors', async () => {
  read.mockRejectedValue(Error('Offline')); const f = mount(); await flush();
  expect(f.result.data).toBeUndefined(); expect(f.result.error).toBeTruthy(); expect(f.result.ready).toBe(false); expect(write).not.toHaveBeenCalled();
});
it('serializes repeated taps and confirms only the saved parent state', async () => {
  const pending = deferred<CommunityChatPreference>(); write.mockReturnValue(pending.promise); const f = mount(); await flush();
  let operation: any; act(() => { operation = f.result.change(true); void f.result.change(true); }); await flush(); expect(write).toHaveBeenCalledTimes(1);
  read.mockResolvedValue(value(true, 1)); await act(async () => { pending.resolve(value(true, 1)); await operation; }); await flush();
  expect(f.result.pending).toBeNull(); expect(f.result.data?.muted).toBe(true); expect(f.result.notice).toContain('Unread messages stay here');
});
it('requires checking after unknown save and never resubmits an already committed result', async () => {
  write.mockRejectedValue(Error('Response lost')); const f = mount(); await flush(); await act(async () => { await f.result.change(true); }); await flush();
  await act(async () => { await f.result.retry(); await f.result.change(false); }); expect(write).toHaveBeenCalledTimes(1);
  read.mockResolvedValue(value(true, 1)); await act(async () => { await f.result.check(); }); expect(f.result.pending).toBeNull(); expect(write).toHaveBeenCalledTimes(1);
});
it('retries only the original desired choice against a freshly observed version', async () => {
  write.mockRejectedValueOnce(Error('Conflict')).mockResolvedValue(value(true, 8)); const f = mount(); await flush();
  await act(async () => { await f.result.change(true); }); await flush(); read.mockResolvedValue(value(false, 7));
  await act(async () => { await f.result.check(); }); expect(f.result.pending?.retryReady).toBe(true); expect(write).toHaveBeenCalledTimes(1);
  read.mockResolvedValue(value(true, 8)); await act(async () => { await f.result.retry(); });
  expect(write.mock.calls[1][0]).toEqual(value(false, 7)); expect(write.mock.calls[1][1]).toBe(true);
});
it('failed recovery remains unknown with retry mutation unavailable', async () => {
  write.mockRejectedValue(Error('Response lost')); const f = mount(); await flush(); await act(async () => { await f.result.change(true); });
  read.mockRejectedValue(Error('Offline')); await act(async () => { await f.result.check(); await f.result.retry(); });
  expect(f.result.pending?.retryReady).toBe(false); expect(write).toHaveBeenCalledTimes(1);
});
it('preserves uncertain save across blur and reconciles by reading on return', async () => {
  const pending = deferred<CommunityChatPreference>(); write.mockReturnValue(pending.promise); const f = mount(); await flush();
  let operation: any; act(() => { operation = f.result.change(true); }); await flush(); f.focus(false);
  await act(async () => { pending.resolve(value(true, 1)); await operation; }); expect(f.result.pending).not.toBeNull();
  read.mockResolvedValue(value(true, 1)); f.focus(true); await flush(); expect(f.result.pending).toBeNull(); expect(write).toHaveBeenCalledTimes(1);
});
it('retires pending results and old callbacks after account changes', async () => {
  const pending = deferred<CommunityChatPreference>(); write.mockReturnValue(pending.promise); const f = mount(); await flush(); const old = f.result;
  let operation: any; act(() => { operation = old.change(true); }); await flush(); read.mockResolvedValue(value(false, 0, 'b')); f.account('b'); await flush();
  await act(async () => { pending.resolve(value(true, 1)); await operation; await old.change(false); await old.check(); });
  expect(f.result.data?.userId).toBe('b'); expect(f.result.pending).toBeNull(); expect(f.result.notice).toBeNull(); expect(write).toHaveBeenCalledTimes(1);
});
it('does not dispatch a new choice when the surface is disabled', async () => {
  const f = mount(); await flush(); f.focus(false); await act(async () => { await f.result.change(true); }); expect(write).not.toHaveBeenCalled();
});
it('refreshes another mounted surface for the same account without duplicating a save', async () => {
  let saved = value();read.mockImplementation(async () => saved);write.mockImplementation(async (_observed, desired) => { saved = value(desired, saved.version + 1); return saved; });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let a!: ReturnType<typeof useCommunityChatPreference>, b!: ReturnType<typeof useCommunityChatPreference>, tree!: ReturnType<typeof create>;
  function Harness(){const viewer={viewerId:'a',epoch:1,isCurrent:()=>true,isLoading:false,error:null,retry:async()=>{}} as ObservedUser;a=useCommunityChatPreference('page',viewer,true);b=useCommunityChatPreference('page',{...viewer,epoch:2},true);return null;}
  act(()=>{tree=create(<QueryClientProvider client={client}><Harness/></QueryClientProvider>);});cleanup.push(()=>{act(()=>tree.unmount());client.clear();});await flush();
  expect(a.data?.muted).toBe(false);expect(b.data?.muted).toBe(false);await act(async()=>{await a.change(true);});await flush();
  expect(a.data?.muted).toBe(true);expect(b.data?.muted).toBe(true);expect(write).toHaveBeenCalledTimes(1);
});
it('does not let another surface’s older initial read replace a confirmed save', async () => {
  const old = deferred<CommunityChatPreference>();read.mockResolvedValueOnce(value()).mockReturnValueOnce(old.promise).mockResolvedValue(value(true, 1));write.mockResolvedValue(value(true, 1));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });let a!:ReturnType<typeof useCommunityChatPreference>,b!:ReturnType<typeof useCommunityChatPreference>,tree!:ReturnType<typeof create>;
  function Harness(){const viewer={viewerId:'a',epoch:1,isCurrent:()=>true,isLoading:false,error:null,retry:async()=>{}} as ObservedUser;a=useCommunityChatPreference('page',viewer,true);b=useCommunityChatPreference('page',{...viewer,epoch:2},true);return null;}
  act(()=>{tree=create(<QueryClientProvider client={client}><Harness/></QueryClientProvider>);});cleanup.push(()=>{act(()=>tree.unmount());client.clear();});await flush();
  await act(async()=>{await a.change(true);});await flush();await act(async()=>{old.resolve(value(false,0));});await flush();
  expect(a.data?.muted).toBe(true);expect(b.data?.muted).toBe(true);expect(write).toHaveBeenCalledTimes(1);
});

function useClock() { fakeTime = true; jest.useFakeTimers(); }
async function tick(ms: number) { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); await flush(); }
it('ends a stalled initial read with retry available and ignores its late result', async () => {
  useClock(); const pending = deferred<CommunityChatPreference>(); read.mockReturnValueOnce(pending.promise);
  const f = mount(); await flush(); expect(f.result.loading).toBe(true);
  await tick(12000); expect(f.result.loading).toBe(false); expect(f.result.fetching).toBe(false); expect(f.result.error).toBeTruthy();
  expect(read.mock.calls[0][1].isCurrent()).toBe(false); expect(read).toHaveBeenCalledTimes(1);
  await act(async () => { await f.result.refresh(); }); await flush(); expect(f.result.data?.muted).toBe(false); expect(f.result.ready).toBe(true);
  await act(async () => pending.resolve(value(true, 1))); await flush(); expect(f.result.data?.muted).toBe(false);
});
it('releases a stalled save and recovers a committed choice without repeating the write', async () => {
  useClock(); const f = mount(); await flush(); const pending = deferred<CommunityChatPreference>(); write.mockReturnValueOnce(pending.promise);
  act(() => { void f.result.change(true); }); await flush(); expect(f.result.busy).toBe(true);
  await tick(25000); expect(f.result.busy).toBe(false); expect(f.result.pending?.retryReady).toBe(false);
  expect(write.mock.calls[0][2].isCurrent()).toBe(false);
  await act(async () => { await f.result.retry(); await f.result.change(false); }); expect(write).toHaveBeenCalledTimes(1);
  read.mockResolvedValue(value(true, 1)); await act(async () => { await f.result.check(); }); await flush();
  expect(f.result.data?.muted).toBe(true); expect(f.result.pending).toBeNull();
  await act(async () => pending.resolve(value(false, 0))); await flush(); expect(f.result.data?.muted).toBe(true); expect(write).toHaveBeenCalledTimes(1);
});
it('keeps a stalled recovery read retryable without enabling an unconfirmed write', async () => {
  useClock(); const f = mount(); await flush(); write.mockRejectedValueOnce(Error('Lost response'));
  await act(async () => { await f.result.change(true); }); await flush();
  const old = deferred<CommunityChatPreference>(); read.mockReturnValueOnce(old.promise);
  act(() => { void f.result.check(); }); await flush(); await tick(12000);
  expect(f.result.busy).toBe(false); expect(f.result.pending?.retryReady).toBe(false);
  await act(async () => { await f.result.retry(); }); expect(write).toHaveBeenCalledTimes(1);
  read.mockResolvedValue(value(false, 7)); await act(async () => { await f.result.check(); });
  expect(f.result.pending?.observed.version).toBe(7); expect(f.result.pending?.retryReady).toBe(true);
  await act(async () => old.resolve(value(true, 1))); await flush(); expect(f.result.pending?.observed.version).toBe(7);
});
it.each(['deadline', 'leave and return', 'background and return'] as const)('does not dispatch when authentication arrives after %s', async reason => {
  useClock();
  const listener = jest.spyOn(AppState, 'addEventListener');
  const communityId = '774c2329-e22e-4113-8a2a-67ca854dd2c9', userId = '753c5b17-ca8d-431f-ad8f-0d9b70c0dccb';
  read.mockResolvedValue({ ...value(), communityId, userId }); const f = mount(communityId, userId); await flush();
  const auth = deferred<any>(), supabase = require('../../lib/supabase').supabase;
  supabase.auth.getUser.mockReturnValueOnce(auth.promise);
  write.mockImplementationOnce(jest.requireActual('../../lib/communityChatPreference').setCommunityChatPreference);
  act(() => { void f.result.change(true); }); await flush();
  if (reason === 'deadline') await tick(25000);
  else if (reason === 'leave and return') { f.focus(false); f.focus(true); await flush(); }
  else {
    const change = listener.mock.calls.find(call => call[0] === 'change')![1];
    act(() => { change('background'); change('active'); }); await flush();
  }
  await act(async () => auth.resolve({ data: { user: { id: userId } }, error: null })); await flush();
  expect(supabase.rpc).not.toHaveBeenCalled(); expect(f.result.busy).toBe(false); expect(f.result.pending).not.toBeNull();
});

it.each(['deadline', 'leave and return'] as const)('does not begin a save if query cancellation finishes after %s', async reason => {
  useClock(); const f = mount(); await flush(); const cancellation = deferred<void>();
  jest.spyOn(QueryClient.prototype, 'cancelQueries').mockReturnValueOnce(cancellation.promise);
  act(() => { void f.result.change(true); }); await flush();
  if (reason === 'deadline') await tick(25000); else { f.focus(false); f.focus(true); await flush(); }
  await act(async () => cancellation.resolve()); await flush();
  expect(write).not.toHaveBeenCalled(); expect(f.result.busy).toBe(false); expect(f.result.pending?.desired).toBe(true);
});
