import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useYoursGrid } from '../useYoursGrid';
import { usePlanHistoryBacklog } from '../usePlanHistoryBacklog';
import { YOURS_GRID_KEYS, BACKLOG_KEYS } from '../../lib/yours/shapeGuard';
const mockAuth = jest.fn(), mockRead = jest.fn(), mockRpc = jest.fn(), mockSignal = jest.fn();
jest.mock('../../lib/supabase', () => ({ supabase: {
  auth: { getUser: () => mockAuth() }, rpc: (...args: unknown[]) => {
    mockRpc(...args); const pending = mockRead();
    return Object.assign(pending, { abortSignal: (signal: AbortSignal) => { mockSignal(signal); return pending; } });
  },
} }));
const own = (userId = 'alice', epoch = 1) => { let live = true; return { userId, epoch, isCurrent: () => live, retire: () => { live = false; } }; };
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(yes => { resolve = yes; }); return { promise, resolve }; };
const person = { ...Object.fromEntries([...YOURS_GRID_KEYS, ...BACKLOG_KEYS].map(key => [key, null])), user_id: 'friend', handle: 'private.friend', state: 'none' };
const answer = (data: unknown = [person]) => ({ data, error: null });

describe.each(['grid', 'backlog'] as const)('%s reader ownership', kind => {
  let client: QueryClient, tree: ReactTestRenderer | undefined, current: any, owner = own(), viewer: string | null;
  const rpc = kind === 'grid' ? 'get_yours_grid' : 'get_plan_history_backlog';
  function Harness() { current = { ...(kind === 'grid' ? useYoursGrid(viewer, owner) : usePlanHistoryBacklog(viewer, owner)) }; return null; }
  const render = () => <QueryClientProvider client={client}><Harness /></QueryClientProvider>;
  const tick = async (ms = 1) => { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); };
  const mount = async () => { act(() => { tree = create(render()); }); await tick(); };
  beforeEach(() => {
    jest.useFakeTimers(); jest.clearAllMocks(); owner = own(); viewer = 'alice';
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    mockAuth.mockReset().mockResolvedValue({ data: { user: { id: 'alice' } }, error: null });
    mockRead.mockReset().mockImplementation(() => Promise.resolve(answer()));
  });
  afterEach(() => { act(() => tree?.unmount()); tree = undefined; client.clear(); jest.useRealTimers(); });
  it('does not reuse a retired reader cache when the observer epoch starts over', async () => {
    await mount(); expect(current.data).toEqual([person]); act(() => tree!.unmount()); tree = undefined; owner.retire(); owner = own();
    const fresh = deferred(); mockRead.mockReturnValueOnce(fresh.promise); await mount();
    expect(current.data).toBeUndefined(); fresh.resolve(answer([])); await tick(); expect(current.data).toEqual([]);
  });
  it('rejects a different authenticated account before reading private people', async () => {
    mockAuth.mockResolvedValueOnce({ data: { user: { id: 'bob' } }, error: null }); await mount();
    expect(mockRpc).not.toHaveBeenCalled(); expect(current.isError).toBe(true);
  });
  it('rejects delayed results after account retirement', async () => {
    const read = deferred(); mockRead.mockReturnValueOnce(read.promise); await mount(); owner.retire(); read.resolve(answer()); await tick();
    expect(current.data).toBeUndefined(); expect(current.isError).toBe(true);
  });
  it('cancels unobserved reads and does not cache their late data', async () => {
    const read = deferred(); mockRead.mockReturnValueOnce(read.promise); await mount();
    act(() => tree!.unmount()); tree = undefined;
    expect(mockSignal.mock.calls[0][0].aborted).toBe(true);
    read.resolve(answer()); await tick();
    expect(client.getQueriesData({ queryKey: ['yours', kind, 'alice'] }).every(([, data]) => data === undefined)).toBe(true);
  });
  it('bounds account preflight and ignores late success until explicit retry', async () => {
    const auth = deferred(); mockAuth.mockReturnValueOnce(auth.promise); await mount(); await tick(12001);
    expect(current.isError).toBe(true); expect(mockRpc).not.toHaveBeenCalled();
    auth.resolve({ data: { user: { id: 'alice' } }, error: null }); await tick(); expect(mockRpc).not.toHaveBeenCalled();
    await act(async () => { await current.refetch(); }); await tick(); expect(current.data).toEqual([person]);
  });
  it('preserves verified same-reader data on failed refresh and still supports prefix invalidation', async () => {
    await mount(); mockRead.mockResolvedValueOnce({ data: null, error: new Error('offline') });
    await act(async () => { await current.refetch(); }); await tick(); expect(current.isError).toBe(true); expect(current.data).toEqual([person]);
    mockRead.mockResolvedValueOnce(answer([]));
    await act(async () => { await client.invalidateQueries({ queryKey: ['yours', kind, 'alice'] }); }); await tick();
    expect(current.data).toEqual([]); expect(mockRpc).toHaveBeenLastCalledWith(rpc, { p_user_id: 'alice' });
  });
  it.each([null, {}, [null], [{ ...person, user_id: '' }]])('rejects an unconfirmed list (%p)', async data => {
    mockRead.mockResolvedValueOnce(answer(data)); await mount(); expect(current.isError).toBe(true); expect(current.data).toBeUndefined();
  });
});
