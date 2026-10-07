import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCirclePlans, type CirclePlansScope } from '../useCirclePlans';

const mockGetUser = jest.fn(), mockRead = jest.fn(), mockQuery = jest.fn(), mockAbort = jest.fn();
jest.mock('../../lib/supabase', () => ({ supabase: {
  auth: { getUser: () => mockGetUser() },
  from: (...args: unknown[]) => {
    mockQuery('from', ...args);
    const chain: any = {};
    for (const method of ['select', 'eq', 'in']) chain[method] = (...values: unknown[]) => { mockQuery(method, ...values); return chain; };
    chain.order = (...values: unknown[]) => {
      mockQuery('order', ...values); const response = mockRead();
      return Object.assign(response, { abortSignal: (signal: AbortSignal) => { mockAbort(signal); return response; } });
    };
    return chain;
  },
} }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const row = (id = 'plan-one', overrides: Record<string, unknown> = {}) => ({ id, title: id, start_time: '2030-09-13T20:00:00Z', end_time: null, location_text: 'The park', circle_visibility: 'open', has_own_chat: true, member_count: 12, stranger_cap: 7, ...overrides });
const answer = (rows = [row()]) => ({ data: rows, error: null });
const auth = (id: string | null) => ({ data: { user: id ? { id } : null }, error: null });
let tree: ReactTestRenderer | undefined, client: QueryClient, current: ReturnType<typeof useCirclePlans>;
let circleId: string | null, scope: CirclePlansScope | undefined;
const makeScope = (userId = 'alice', epoch = 1) => { let live = true; return { userId, epoch, isCurrent: () => live, retire: () => { live = false; } }; };
function Harness() { current = useCirclePlans(circleId, scope); return null; }
const render = () => <QueryClientProvider client={client}><Harness /></QueryClientProvider>;
async function flush() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function mount() { act(() => { tree = create(render()); }); await flush(); }
async function update() { act(() => tree!.update(render())); await flush(); }
beforeEach(() => {
  jest.clearAllMocks(); circleId = 'circle-one'; scope = makeScope();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mockGetUser.mockReset().mockResolvedValue(auth('alice')); mockRead.mockReset().mockImplementation(() => Promise.resolve(answer()));
  jest.spyOn(Date, 'now').mockReturnValue(new Date('2030-09-13T21:00:00Z').getTime());
});
afterEach(async () => { act(() => tree?.unmount()); tree = undefined; client.clear(); jest.restoreAllMocks(); await flush(); });

it('retains exact query/filter/order and separates total participants from outsider capacity', async () => {
  await mount();
  expect(mockQuery.mock.calls).toEqual([
    ['from', 'events'],
    ['select', 'id, title, start_time, end_time, location_text, circle_visibility, has_own_chat, member_count, stranger_cap'],
    ['eq', 'circle_id', 'circle-one'], ['in', 'status', ['forming', 'active', 'full']], ['order', 'start_time', { ascending: true }],
  ]);
  expect(current.data?.[0]).toEqual({ id: 'plan-one', title: 'plan-one', start_time: '2030-09-13T20:00:00Z', location_text: 'The park', circle_visibility: 'open', has_own_chat: true, member_count: 12, stranger_cap: 7 });
  expect(mockAbort).toHaveBeenCalledTimes(1); expect(mockGetUser).toHaveBeenCalledTimes(1);
});
it('retains explicit-end and three-hour fallback window, order and nullable field normalization', async () => {
  mockRead.mockResolvedValueOnce(answer([
    row('ongoing', { end_time: '2030-09-13T22:00:00Z' }),
    row('fallback', { location_text: undefined, circle_visibility: undefined, has_own_chat: undefined, member_count: undefined, stranger_cap: undefined }),
    row('ended', { end_time: '2030-09-13T21:00:00Z' }), row('expired', { start_time: '2030-09-13T17:59:00Z' }), row('invalid', { start_time: 'bad' }),
  ])); await mount();
  expect(current.data?.map(plan => plan.id)).toEqual(['ongoing', 'fallback']);
  expect(current.data?.[1]).toMatchObject({ location_text: null, circle_visibility: null, has_own_chat: false, member_count: 0, stranger_cap: null });
});
it('returns a successful empty list only when the request confirms it', async () => {
  mockRead.mockResolvedValueOnce(answer([])); await mount(); expect(current.data).toEqual([]); expect(current.isError).toBe(false); expect(current.isLoading).toBe(false);
});
it.each(['timeout', 'missing column', 'not authorized'])('surfaces %s instead of fabricating an empty calendar and permits same-query retry', async message => {
  const error = new Error(message); mockRead.mockResolvedValueOnce({ data: null, error }); await mount();
  expect(current.isError).toBe(true); expect(current.error).toBe(error); expect(current.data).toBeUndefined();
  await act(async () => { await current.refetch(); }); await flush(); expect(current.data?.[0].id).toBe('plan-one'); expect(current.isError).toBe(false);
  expect(mockQuery.mock.calls.filter(call => call[0] === 'eq')).toEqual([['eq', 'circle_id', 'circle-one'], ['eq', 'circle_id', 'circle-one']]);
});
it('ignores unscoped legacy cache and does not show account A data to B', async () => {
  client.setQueryData(['circle-plans', 'circle-one'], [row('old-unscoped')]); await mount(); expect(current.data?.[0].id).toBe('plan-one');
  const pending = deferred<ReturnType<typeof answer>>(); mockRead.mockReturnValueOnce(pending.promise);
  (scope as ReturnType<typeof makeScope>).retire(); scope = makeScope('bob', 2); mockGetUser.mockResolvedValue(auth('bob')); await update();
  expect(current.data).toBeUndefined(); expect(current.isLoading).toBe(true);
  pending.resolve(answer([row('bob-plan')])); await flush(); expect(current.data?.[0].id).toBe('bob-plan');
});
it('rejects a late account A response after changing accounts', async () => {
  const pending = deferred<ReturnType<typeof answer>>(); mockRead.mockReturnValueOnce(pending.promise); await mount();
  (scope as ReturnType<typeof makeScope>).retire(); scope = makeScope('bob', 2); mockGetUser.mockResolvedValue(auth('bob')); mockRead.mockResolvedValueOnce(answer([row('bob-plan')])); await update();
  pending.resolve(answer([row('alice-private')])); await flush();
  expect(current.data?.[0].id).toBe('bob-plan'); expect(client.getQueryData(['circle-plans', 'circle-one', 'alice', 1])).toBeUndefined();
});
it('uses a new account generation after A to B to A rather than reusing old private cache', async () => {
  await mount(); (scope as ReturnType<typeof makeScope>).retire(); scope = makeScope('bob', 2); mockGetUser.mockResolvedValue(auth('bob')); await update();
  (scope as ReturnType<typeof makeScope>).retire(); scope = makeScope('alice', 3); mockGetUser.mockResolvedValue(auth('alice'));
  const pending = deferred<ReturnType<typeof answer>>(); mockRead.mockReturnValueOnce(pending.promise); await update(); expect(current.data).toBeUndefined();
  pending.resolve(answer([row('revalidated-alice')])); await flush(); expect(current.data?.[0].id).toBe('revalidated-alice');
});
it('checks entry ownership after account preflight before reading any plan', async () => {
  const pending = deferred<ReturnType<typeof auth>>(); mockGetUser.mockReturnValueOnce(pending.promise); await mount();
  (scope as ReturnType<typeof makeScope>).retire(); pending.resolve(auth('alice')); await flush(); expect(mockRead).not.toHaveBeenCalled(); expect(current.isError).toBe(true);
});
it('does not read under a mismatching authenticated account', async () => {
  mockGetUser.mockResolvedValueOnce(auth('bob')); await mount(); expect(mockRead).not.toHaveBeenCalled(); expect(current.isError).toBe(true);
});
it('aborts after the last observer leaves and never caches a late result', async () => {
  const pending = deferred<ReturnType<typeof answer>>(); mockRead.mockReturnValueOnce(pending.promise); await mount();
  const signal = mockAbort.mock.calls[0][0]; act(() => tree!.unmount()); tree = undefined; expect(signal.aborted).toBe(true);
  pending.resolve(answer([row('late')])); await flush(); expect(client.getQueryData(['circle-plans', 'circle-one', 'alice', 1])).toBeUndefined();
});
it('preserves legacy no-scope cache key and skips added auth preflight', async () => {
  scope = undefined; await mount(); expect(mockGetUser).not.toHaveBeenCalled(); expect(mockAbort).not.toHaveBeenCalled();
  expect(client.getQueryData(['circle-plans', 'circle-one'])).toEqual(current.data);
});
it('preserves disabled behavior when no Circle is selected', async () => {
  circleId = null; await mount(); expect(mockGetUser).not.toHaveBeenCalled(); expect(mockRead).not.toHaveBeenCalled();
});
