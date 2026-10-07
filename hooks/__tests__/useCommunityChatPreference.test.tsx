import React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCommunityChatPreference } from '../useCommunityChatPreference';
import { getCommunityChatPreference, setCommunityChatPreference, type CommunityChatPreference } from '../../lib/communityChatPreference';
import type { ObservedUser } from '../useObservedUser';
jest.mock('../../lib/communityChatPreference', () => ({ getCommunityChatPreference: jest.fn(), setCommunityChatPreference: jest.fn() }));
const read = jest.mocked(getCommunityChatPreference), write = jest.mocked(setCommunityChatPreference);
const value = (muted = false, version = 0, userId = 'a'): CommunityChatPreference => ({ communityId: 'page', userId, muted, version });
const cleanup: Array<() => void> = [];
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { resolve, promise }; };
async function flush() { for (let i = 0; i < 4; i++) await act(async () => { await new Promise(yes => setTimeout(yes, 0)); }); }
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });
  let result!: ReturnType<typeof useCommunityChatPreference>, tree!: ReturnType<typeof create>, id = 'a', epoch = 1, enabled = true;
  function Harness() { const captured = id; const viewer = { viewerId: id, epoch, isLoading: false, error: null, retry: async () => {}, isCurrent: () => captured === id } as ObservedUser; result = useCommunityChatPreference('page', viewer, enabled); return null; }
  const node = () => <QueryClientProvider client={client}><Harness /></QueryClientProvider>;
  act(() => { tree = create(node()); }); cleanup.push(() => { act(() => tree.unmount()); client.clear(); });
  return { get result() { return result; }, focus: (next: boolean) => { enabled = next; act(() => tree.update(node())); }, account: (next: string) => { id = next; epoch++; act(() => tree.update(node())); } };
}
beforeEach(() => { jest.clearAllMocks(); read.mockResolvedValue(value()); write.mockResolvedValue(value(true, 1)); });
afterEach(async () => { cleanup.splice(0).forEach(fn => fn()); await flush(); });
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
