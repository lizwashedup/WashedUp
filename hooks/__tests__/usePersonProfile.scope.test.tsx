import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePersonProfile, type PersonProfileScope } from '../usePersonProfile';
import { yoursKeys } from '../../lib/yours/keys';
const mockAuth = jest.fn(), mockRpc = jest.fn(), mockRead = jest.fn(), mockAbort = jest.fn();
jest.mock('../../lib/supabase', () => ({ supabase: {
  auth: { getUser: () => mockAuth() },
  rpc: (...args: unknown[]) => { mockRpc(...args); const promise = mockRead(); return Object.assign(promise, { abortSignal: (signal: AbortSignal) => { mockAbort(signal); return promise; } }); },
} }));
const auth = (id: string | null = 'alice') => ({ data: { user: id ? { id } : null }, error: null });
const answer = (data: unknown = { user_id: 'amelia', handle: 'amelia', upcoming: [], past: [] }) => ({ data, error: null });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const owned = (userId = 'alice', epoch = 0) => { let live = true; return { userId, epoch, isCurrent: () => live, retire: () => { live = false; } }; };
let client: QueryClient, tree: ReactTestRenderer | undefined, current: ReturnType<typeof usePersonProfile>;
let userId: string | null, targetId: string | null, scope: PersonProfileScope | undefined;
function Harness() { current = usePersonProfile(userId, targetId, scope); return null; }
const render = () => <QueryClientProvider client={client}><Harness/></QueryClientProvider>;
async function flush() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
async function mount() { act(() => { tree = create(render()); }); await flush(); }
async function update() { act(() => tree!.update(render())); await flush(); }
beforeEach(() => { jest.clearAllMocks(); userId = 'alice'; targetId = 'amelia'; scope = owned(); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); mockAuth.mockReset().mockResolvedValue(auth()); mockRead.mockReset().mockImplementation(() => Promise.resolve(answer())); });
afterEach(async () => { act(() => tree?.unmount()); tree = undefined; client.clear(); await flush(); });
it('preserves the gated RPC payload and fields under a viewer-generation cache key', async () => {
  await mount(); expect(mockRpc.mock.calls).toEqual([['get_person_profile', { p_target: 'amelia' }]]);
  expect(current.data).toEqual(answer().data); expect(mockAuth).toHaveBeenCalledTimes(1); expect(mockAbort).toHaveBeenCalledTimes(1);
  expect(client.getQueryData([...yoursKeys.personProfile('alice', 'amelia'), 0])).toEqual(answer().data);
});
it.each([null, undefined])('keeps null/absent private results indistinguishable from a missing profile', async data => { mockRead.mockResolvedValueOnce({ data, error: null }); await mount(); expect(current.data).toBeNull(); expect(current.isError).toBe(false); });
it('retains read errors and supports retry without fabricating private unavailable', async () => {
  const error = new Error('offline'); mockRead.mockResolvedValueOnce({ data: null, error }); await mount(); expect(current.error).toBe(error); expect(current.isError).toBe(true); expect(current.data).toBeUndefined();
  await act(async () => { await current.refetch(); }); await flush(); expect(current.data?.user_id).toBe('amelia'); expect(current.isError).toBe(false);
});
it.each([{ user_id: 'luca' }, [], 'unknown'])('does not expose a mismatched or malformed payload %j', async data => { mockRead.mockResolvedValueOnce(answer(data)); await mount(); expect(current.isError).toBe(true); expect(current.data).toBeUndefined(); });
it('checks the authenticated account before dispatch', async () => { mockAuth.mockResolvedValueOnce(auth('bob')); await mount(); expect(mockRpc).not.toHaveBeenCalled(); expect(current.isError).toBe(true); });
it('retires a delayed auth preflight before any RPC', async () => { const pending = deferred<ReturnType<typeof auth>>(); mockAuth.mockReturnValueOnce(pending.promise); await mount(); (scope as ReturnType<typeof owned>).retire(); pending.resolve(auth()); await flush(); expect(mockRpc).not.toHaveBeenCalled(); });
it('does not cache a late response after account switch and isolates a return to the same account', async () => {
  const pending = deferred<ReturnType<typeof answer>>(); mockRead.mockReturnValueOnce(pending.promise); await mount();
  (scope as ReturnType<typeof owned>).retire(); userId = 'bob'; scope = owned('bob', 1); mockAuth.mockResolvedValue(auth('bob')); await update();
  pending.resolve(answer({ user_id: 'amelia', bio: 'Old private biography' })); await flush(); expect(current.data).toEqual(answer().data); expect(client.getQueryData([...yoursKeys.personProfile('alice', 'amelia'), 0])).toBeUndefined();
  (scope as ReturnType<typeof owned>).retire(); userId = 'alice'; scope = owned('alice', 2); mockAuth.mockResolvedValue(auth()); const again = deferred<ReturnType<typeof answer>>(); mockRead.mockReturnValueOnce(again.promise); await update(); expect(current.data).toBeUndefined(); again.resolve(answer()); await flush(); expect(current.data).toEqual(answer().data);
});
it('aborts an unobserved request and cannot cache its later response', async () => { const pending = deferred<ReturnType<typeof answer>>(); mockRead.mockReturnValueOnce(pending.promise); await mount(); const signal = mockAbort.mock.calls[0][0]; act(() => tree!.unmount()); tree = undefined; expect(signal.aborted).toBe(true); pending.resolve(answer()); await flush(); expect(client.getQueryData([...yoursKeys.personProfile('alice', 'amelia'), 0])).toBeUndefined(); });
it('keeps the legacy key and avoids new auth preflight for callers without scope', async () => { scope = undefined; await mount(); expect(mockAuth).not.toHaveBeenCalled(); expect(mockAbort).not.toHaveBeenCalled(); expect(client.getQueryData(yoursKeys.personProfile('alice', 'amelia'))).toEqual(answer().data); });
it.each(['viewer', 'target'])('does not dispatch without a %s', async missing => { if (missing === 'viewer') userId = null; else targetId = null; await mount(); expect(mockAuth).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled(); });
