import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useIncomingRequests } from '../useIncomingRequests';
import { yoursKeys } from '../../lib/yours/keys';

const mockAuth = jest.fn(), mockRead = jest.fn(), mockRpc = jest.fn(), mockAbort = jest.fn();
jest.mock('../../lib/supabase', () => ({ supabase: {
  auth: { getUser: () => mockAuth() },
  rpc: (...args: unknown[]) => {
    mockRpc(...args);
    const promise = mockRead();
    return Object.assign(promise, { abortSignal: (signal: AbortSignal) => { mockAbort(signal); return promise; } });
  },
} }));
const request = { connection_id: 'connection-one', requester_user_id: 'jamie', first_name_display: 'Jamie', profile_photo_url: null,
  handle: null, context: 'referral', context_event_id: null, context_event_title: null, context_line: null, requested_at: '2026-11-05T12:00:00Z' };
const answer = (data: unknown = [request]) => ({ data, error: null });
const own = (userId = 'alice', epoch = 1) => { let active = true; return { userId, epoch, isCurrent: () => active, retire: () => { active = false; } }; };
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(yes => { resolve = yes; }); return { promise, resolve }; };
let owner = own(), viewer: string | null = 'alice', client: QueryClient, tree: ReactTestRenderer | undefined, current: any;
function Harness() { current = { ...useIncomingRequests(viewer, owner) }; return null; }
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
it('retains the incoming request contract and explicit empty results', async () => {
  await mount(); expect(mockRpc).toHaveBeenCalledWith('get_incoming_people_requests', { p_user_id: 'alice' });
  expect(current.data).toEqual([request]);
  mockRead.mockResolvedValueOnce(answer([])); await act(async () => { await current.refetch(); }); await tick();
  expect(current.data).toEqual([]); expect(current.isError).toBe(false);
});
it('ends a stalled request read, ignores its late receipt and permits retry', async () => {
  const read = deferred(); mockRead.mockReturnValueOnce(read.promise); await mount(); await tick(12001);
  expect(current.isFetching).toBe(false); expect(current.isError).toBe(true);
  read.resolve(answer()); await tick(); expect(current.data).toBeUndefined();
  await act(async () => { await current.refetch(); }); await tick(); expect(current.data).toEqual([request]);
});
it('cannot restore earlier account requests after an account roundtrip', async () => {
  await mount(); owner.retire(); viewer = 'bob'; owner = own('bob', 2);
  mockAuth.mockResolvedValue({ data: { user: { id: 'bob' } }, error: null }); act(() => tree!.update(render())); await tick();
  owner.retire(); viewer = 'alice'; owner = own('alice', 3); mockAuth.mockResolvedValue({ data: { user: { id: 'alice' } }, error: null });
  const fresh = deferred(); mockRead.mockReturnValueOnce(fresh.promise); act(() => tree!.update(render())); await tick();
  expect(current.data).toBeUndefined(); fresh.resolve(answer([])); await tick(); expect(current.data).toEqual([]);
});
it('does not dispatch under a different authenticated account', async () => {
  mockAuth.mockResolvedValueOnce({ data: { user: { id: 'bob' } }, error: null }); await mount();
  expect(mockRpc).not.toHaveBeenCalled(); expect(current.isError).toBe(true);
});
it('starts fresh when a new reader mounts with the same observer epoch', async () => {
  await mount(); act(() => tree!.unmount()); tree = undefined; owner.retire(); owner = own();
  const fresh = deferred(); mockRead.mockReturnValueOnce(fresh.promise); await mount();
  expect(current.data).toBeUndefined(); fresh.resolve(answer([])); await tick(); expect(current.data).toEqual([]);
});
it('cancels an unobserved read and cannot cache its late result', async () => {
  const read = deferred(); mockRead.mockReturnValueOnce(read.promise); await mount();
  const signal = mockAbort.mock.calls[0][0]; act(() => tree!.unmount()); tree = undefined;
  expect(signal.aborted).toBe(true); read.resolve(answer()); await tick();
  expect(client.getQueriesData({ queryKey: yoursKeys.requests('alice') }).every(([, data]) => data === undefined)).toBe(true);
});
it('rejects a late result after its account scope retires', async () => {
  const read = deferred(); mockRead.mockReturnValueOnce(read.promise); await mount(); owner.retire(); read.resolve(answer()); await tick();
  expect(current.isError).toBe(true); expect(current.data).toBeUndefined();
});
it('does not dispatch after the scope retires during account preflight', async () => {
  const read = deferred(); mockAuth.mockReturnValueOnce(read.promise); await mount(); owner.retire();
  read.resolve({ data: { user: { id: 'alice' } }, error: null }); await tick();
  expect(mockRpc).not.toHaveBeenCalled(); expect(current.isError).toBe(true);
});
it('bounds a stalled preflight and ignores its late success', async () => {
  const read = deferred(); mockAuth.mockReturnValueOnce(read.promise); await mount(); await tick(12001);
  expect(current.isError).toBe(true); expect(current.isFetching).toBe(false);
  read.resolve({ data: { user: { id: 'alice' } }, error: null }); await tick(); expect(mockRpc).not.toHaveBeenCalled();
});
it('preserves same-session rows on refresh failure and replaces them after retry', async () => {
  await mount(); mockRead.mockResolvedValueOnce({ data: null, error: new Error('offline') });
  await act(async () => { await current.refetch(); }); await tick();
  expect(current.isError).toBe(true); expect(current.data).toEqual([request]);
  mockRead.mockResolvedValueOnce(answer([])); await act(async () => { await current.refetch(); }); await tick();
  expect(current.isError).toBe(false); expect(current.data).toEqual([]);
});
it('retains prefix invalidation from existing accept/decline/block operations', async () => {
  await mount(); mockRead.mockResolvedValueOnce(answer([]));
  await act(async () => { await client.invalidateQueries({ queryKey: yoursKeys.requests('alice') }); }); await tick();
  expect(mockRpc).toHaveBeenCalledTimes(2); expect(current.data).toEqual([]);
});
it.each([null, {}, [null], [{...request, connection_id: ''}], [{...request, requested_at: null}]])('rejects an unconfirmed list (%p)', async data => {
  mockRead.mockResolvedValueOnce(answer(data)); await mount(); expect(current.isError).toBe(true); expect(current.data).toBeUndefined();
});
it('does not read without an observed viewer', async () => {
  viewer = null; await mount(); expect(mockAuth).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled();
});
