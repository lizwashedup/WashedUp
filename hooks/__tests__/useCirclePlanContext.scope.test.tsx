import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CirclePlanContextUnavailableError, useCirclePlanContext, type CirclePlanContextOptions } from '../useCirclePlanContext';

const mockGetUser = jest.fn(), mockRpc = jest.fn(), mockAbort = jest.fn();
jest.mock('../../lib/supabase', () => ({ supabase: {
  auth: { getUser: () => mockGetUser() },
  rpc: (...args: unknown[]) => {
    const response = mockRpc(...args);
    return { abortSignal: (signal: AbortSignal) => { mockAbort(signal); return response; } };
  },
} }));
const circle = '7b42d4c2-8bd2-4f4a-8a52-37275f1c14ef';
const otherCircle = '2db0809d-8c43-4393-8366-7f92e8145646';
const receipt = (extra: Record<string, unknown> = {}) => ({
  is_circle_plan: true, circle_id: circle, circle_name: 'Sunday circle', circle_visibility: 'open',
  stranger_cap: 4, has_own_chat: true, viewer_is_member: false, viewer_stranger_spots_left: 2, ...extra,
});
const auth = (id: string | null = 'alice') => ({ data: { user: id ? { id } : null }, error: null });
const reply = (value: unknown = receipt()) => ({ data: value, error: null });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
function scope(viewerId = 'alice', epoch = 1) { let live = true; return { viewerId, epoch, isCurrent: () => live, retire: () => { live = false; } }; }
let identity: ReturnType<typeof scope>, eventId: string | null, options: CirclePlanContextOptions | undefined;
let tree: ReactTestRenderer | undefined, client: QueryClient, current: ReturnType<typeof useCirclePlanContext>;
function Probe() { current = useCirclePlanContext(eventId, options); return null; }
const element = () => <QueryClientProvider client={client}><Probe /></QueryClientProvider>;
async function flush() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function mount() { act(() => { tree = create(element()); }); await flush(); }
async function update() { act(() => tree!.update(element())); await flush(); }
function key(viewerId = 'alice', epoch = 1, id = 'event-a', circleId: string | null = circle) { return ['circle-plan-context', id, viewerId, epoch, id, circleId]; }
beforeEach(() => {
  jest.clearAllMocks(); identity = scope(); eventId = 'event-a'; options = { ...identity, event: { id: eventId, circle_id: circle } };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mockGetUser.mockReset().mockResolvedValue(auth()); mockRpc.mockReset().mockImplementation(() => Promise.resolve(reply()));
});
afterEach(async () => { act(() => tree?.unmount()); tree = undefined; client.clear(); await flush(); });

it('preserves exact RPC target, authenticates the viewer and returns confirmed open context without coercion', async () => {
  await mount(); expect(mockGetUser).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('get_circle_plan_context', { p_event_id: 'event-a' });
  expect(current.data).toEqual(receipt()); expect(current.isContextReady).toBe(true); expect(mockAbort).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(key())).toEqual(receipt());
});
it('preserves a real zero remaining, false membership and configured outsider cap separately', async () => {
  mockRpc.mockResolvedValueOnce(reply(receipt({ viewer_stranger_spots_left: 0, viewer_is_member: false, stranger_cap: 7 })));
  await mount(); expect(current.data).toMatchObject({ stranger_cap: 7, viewer_stranger_spots_left: 0, viewer_is_member: false }); expect(current.isContextReady).toBe(true);
});
it('preserves private nullable fields, false own-chat and actual membership', async () => {
  const value = receipt({ circle_name: null, circle_visibility: 'circle_only', stranger_cap: null, viewer_stranger_spots_left: null, has_own_chat: false, viewer_is_member: true });
  mockRpc.mockResolvedValueOnce(reply(value)); await mount(); expect(current.data).toEqual(value); expect(current.isContextReady).toBe(true);
});
it('uses explicit matching event null provenance for ordinary compatibility without a Circle RPC', async () => {
  options!.event!.circle_id = null; mockRpc.mockRejectedValue(new Error('Circle RPC unavailable'));
  await mount(); expect(current.data).toEqual({ is_circle_plan: false }); expect(current.isContextReady).toBe(true);
  expect(mockGetUser).toHaveBeenCalledTimes(1); expect(mockRpc).not.toHaveBeenCalled();
});
it.each(['no options', 'no viewer', 'no event', 'wrong event', 'no target', 'retired'] as const)('never infers ordinary or dispatches with %s', async kind => {
  if (kind === 'no options') options = undefined;
  if (kind === 'no viewer') options!.viewerId = null;
  if (kind === 'no event') options!.event = undefined;
  if (kind === 'wrong event') options!.event = { id: 'previous-event', circle_id: null };
  if (kind === 'no target') eventId = null;
  if (kind === 'retired') identity.retire();
  await mount(); expect(current.data).toBeUndefined(); expect(current.isContextReady).toBe(false);
  expect(mockGetUser).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled();
});
it.each([undefined, '', 'not-a-circle-id'])('does not turn a matching event with unknown circle_id %s into an ordinary plan', async circleId => {
  options!.event!.circle_id = circleId; await mount(); expect(current.data).toBeUndefined(); expect(current.isContextReady).toBe(false);
  expect(current.error).toBeInstanceOf(CirclePlanContextUnavailableError); expect(mockRpc).not.toHaveBeenCalled();
});
it.each([
  ['missing PostgREST RPC', { code: 'PGRST202', message: 'Could not find the function get_circle_plan_context' }],
  ['missing SQL RPC', { code: '42883', message: 'function does not exist' }],
  ['404', { status: 404, message: 'Not found' }],
  ['permission error', { code: '42501', message: 'Permission denied' }],
  ['transport failure', new TypeError('Network unavailable')],
] as const)('surfaces %s for a known Circle, then permits the same current read to retry', async (_name, error) => {
  mockRpc.mockResolvedValueOnce({ data: null, error }); await mount();
  expect(current.isError).toBe(true); expect(current.error).toBe(error); expect(current.data).toBeUndefined(); expect(current.isContextReady).toBe(false);
  await act(async () => { await current.refetch(); }); await flush(); expect(current.data).toEqual(receipt()); expect(current.isContextReady).toBe(true);
  expect(mockRpc.mock.calls).toEqual([['get_circle_plan_context', { p_event_id: 'event-a' }], ['get_circle_plan_context', { p_event_id: 'event-a' }]]);
});
it.each([
  ['null', null], ['false', false], ['normal receipt', { is_circle_plan: false }], ['empty object', {}],
  ['array', [receipt()]], ['true boolean', true], ['string flag', receipt({ is_circle_plan: 'true' })],
  ['wrong Circle', receipt({ circle_id: otherCircle })], ['invalid Circle id', receipt({ circle_id: 'circle-one' })],
  ['missing viewer flag', receipt({ viewer_is_member: undefined })], ['string viewer flag', receipt({ viewer_is_member: 'false' })],
  ['null own-chat flag', receipt({ has_own_chat: null })], ['missing name', receipt({ circle_name: undefined })],
  ['unknown visibility', receipt({ circle_visibility: null })], ['missing remaining count', receipt({ viewer_stranger_spots_left: undefined })],
  ['negative remaining count', receipt({ viewer_stranger_spots_left: -1 })], ['string remaining count', receipt({ viewer_stranger_spots_left: '2' })],
  ['remaining above cap', receipt({ viewer_stranger_spots_left: 5 })], ['fractional cap', receipt({ stranger_cap: 2.5 })],
  ['private with open capacity', receipt({ circle_visibility: 'circle_only' })],
] as const)('rejects a %s Circle receipt before admission decisions can read it', async (_name, value) => {
  mockRpc.mockResolvedValueOnce(reply(value)); await mount();
  expect(current.data).toBeUndefined(); expect(current.isContextReady).toBe(false); expect(current.error).toBeInstanceOf(CirclePlanContextUnavailableError);
});
it('ignores the old unscoped cache and masks a cached context while refreshing or after an error', async () => {
  client.setQueryData(['circle-plan-context', 'event-a'], receipt({ viewer_is_member: true }));
  await mount(); expect(current.data?.viewer_is_member).toBe(false);
  const pending = deferred<any>(); mockRpc.mockReturnValueOnce(pending.promise); let retry!: ReturnType<typeof current.refetch>;
  act(() => { retry = current.refetch(); }); await flush(); expect(current.data).toBeUndefined(); expect(current.isContextReady).toBe(false);
  await act(async () => { pending.resolve({ data: null, error: new Error('read failed') }); await retry; }); await flush();
  expect(current.isError).toBe(true); expect(current.data).toBeUndefined(); expect(current.isContextReady).toBe(false);
});
it('separates viewer membership across A to B to A account generations', async () => {
  mockRpc.mockResolvedValueOnce(reply(receipt({ viewer_is_member: true }))); await mount(); expect(current.data?.viewer_is_member).toBe(true);
  identity.retire(); identity = scope('bob', 2); options = { ...identity, event: { id: eventId!, circle_id: circle } }; mockGetUser.mockResolvedValue(auth('bob')); await update();
  expect(current.data?.viewer_is_member).toBe(false);
  identity.retire(); identity = scope('alice', 3); options = { ...identity, event: { id: eventId!, circle_id: circle } }; mockGetUser.mockResolvedValue(auth('alice'));
  const pending = deferred<any>(); mockRpc.mockReturnValueOnce(pending.promise); await update(); expect(current.data).toBeUndefined(); expect(current.isContextReady).toBe(false);
  pending.resolve(reply(receipt({ viewer_is_member: false, viewer_stranger_spots_left: 0 }))); await flush();
  expect(current.data).toMatchObject({ viewer_is_member: false, viewer_stranger_spots_left: 0 }); expect(client.getQueryData(key('alice', 1))).toMatchObject({ viewer_is_member: true });
});
it('retires an auth wait before RPC dispatch when the observed account changes A to B to A before rerender', async () => {
  const pending = deferred<any>(); mockGetUser.mockReturnValueOnce(pending.promise); await mount(); identity.retire();
  pending.resolve(auth('alice')); await flush(); expect(mockRpc).not.toHaveBeenCalled(); expect(current.data).toBeUndefined();
});
it('does not accept an old target response or old retry callback after switching plans', async () => {
  const pending = deferred<any>(); mockRpc.mockReturnValueOnce(pending.promise); await mount(); const oldRetry = current.refetch;
  eventId = 'event-b'; options = { ...identity, event: { id: eventId, circle_id: otherCircle } }; mockRpc.mockResolvedValueOnce(reply(receipt({ circle_id: otherCircle, circle_name: 'Another circle' }))); await update();
  pending.resolve(reply(receipt({ viewer_is_member: true }))); await flush();
  expect(current.data?.circle_id).toBe(otherCircle); expect(client.getQueryData(key())).toBeUndefined();
  const calls = mockRpc.mock.calls.length; await expect(oldRetry()).rejects.toBeInstanceOf(CirclePlanContextUnavailableError); expect(mockRpc).toHaveBeenCalledTimes(calls);
});
it('does not reuse an ordinary result after authoritative Circle provenance changes', async () => {
  options!.event!.circle_id = null; await mount(); expect(current.data).toEqual({ is_circle_plan: false });
  options = { ...identity, event: { id: eventId!, circle_id: circle } };
  const pending = deferred<any>(); mockRpc.mockReturnValueOnce(pending.promise); await update(); expect(current.data).toBeUndefined(); expect(current.isContextReady).toBe(false);
  pending.resolve(reply()); await flush(); expect(current.data?.is_circle_plan).toBe(true);
});
it.each(['wrong viewer', 'missing viewer', 'auth error'] as const)('does not dispatch with %s from preflight', async kind => {
  mockGetUser.mockResolvedValueOnce(kind === 'auth error' ? { data: { user: null }, error: new Error('auth failed') } : auth(kind === 'wrong viewer' ? 'bob' : null));
  await mount(); expect(mockRpc).not.toHaveBeenCalled(); expect(current.isError).toBe(true); expect(current.isContextReady).toBe(false);
});
it('aborts the request and never accepts a late response after unmount', async () => {
  const pending = deferred<any>(); mockRpc.mockReturnValueOnce(pending.promise); await mount(); const signal = mockAbort.mock.calls[0][0];
  act(() => tree!.unmount()); tree = undefined; expect(signal.aborted).toBe(true);
  pending.resolve(reply(receipt({ viewer_is_member: true }))); await flush(); expect(client.getQueryData(key())).toBeUndefined();
});
it('retains the existing prefix invalidation used by Circle coordination actions', async () => {
  await mount(); mockRpc.mockResolvedValueOnce(reply(receipt({ viewer_stranger_spots_left: 1 })));
  await act(async () => { await client.invalidateQueries({ queryKey: ['circle-plan-context', 'event-a'] }); }); await flush();
  expect(mockRpc).toHaveBeenCalledTimes(2); expect(current.data?.viewer_stranger_spots_left).toBe(1);
});
