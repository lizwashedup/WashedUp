import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMyCircles } from '../useMyCircles';
import { useCircleSuggestions } from '../useCircleSuggestions';
import { useCircleMemberPreviews } from '../useCircleMemberPreviews';
import type { CirclePlansScope } from '../useCirclePlans';

const mockRpc = jest.fn(), mockGetUser = jest.fn(), mockMembers = jest.fn(), mockQuery = jest.fn(), mockAbort = jest.fn();
jest.mock('../../lib/supabase', () => ({ supabase: {
  auth: { getUser: () => mockGetUser() },
  rpc: (...args: unknown[]) => { const response = mockRpc(...args); return Object.assign(response, { abortSignal: (signal: AbortSignal) => { mockAbort(signal); return response; } }); },
  from: (...args: unknown[]) => {
    mockQuery('from', ...args); const chain: any = {};
    for (const method of ['select', 'in', 'eq', 'order']) chain[method] = (...values: unknown[]) => { mockQuery(method, ...values); return chain; };
    chain.then = (...callbacks: any[]) => mockMembers().then(...callbacks);
    chain.abortSignal = (signal: AbortSignal) => { mockAbort(signal); return chain; }; return chain;
  },
} }));
type Kind = 'mine' | 'suggestions' | 'members';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const auth = (id: string | null) => ({ data: { user: id ? { id } : null }, error: null });
const circle = (id = 'circle-a', name = 'Sunset friends') => ({ id, name, member_count: 3 });
const suggestion = (id = 'suggestion-a') => ({ id, suggested_user_ids: ['bea', 'zoe'], shared_event_ids: ['plan-one'], shared_count: 1, people: [] });
const member = (id = 'bea') => ({ circle_id: 'circle-a', user_id: id, profiles_public: { first_name_display: id, profile_photo_url: `${id}.jpg` } });
const makeScope = (userId = 'alice', epoch = 1) => { let live = true; return { userId, epoch, isCurrent: () => live, retire: () => { live = false; } }; };
let tree: ReactTestRenderer | undefined, client: QueryClient, current: any, kind: Kind, userId: string | null, scope: CirclePlansScope | undefined, circleIds: string[];
function Harness() {
  const mine = useMyCircles(kind === 'mine' ? userId : null, scope);
  const suggestions = useCircleSuggestions(kind === 'suggestions' ? userId : null, scope);
  const members = useCircleMemberPreviews(circleIds, kind === 'members' ? userId : null, scope);
  current = kind === 'mine' ? mine : kind === 'suggestions' ? suggestions : members; return null;
}
const render = () => <QueryClientProvider client={client}><Harness /></QueryClientProvider>;
async function flush() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function mount() { act(() => { tree = create(render()); }); await flush(); }
async function update() { act(() => tree!.update(render())); await flush(); }
function pendingRead() { const pending = deferred<any>(); if (kind === 'members') mockMembers.mockReturnValueOnce(pending.promise); else mockRpc.mockReturnValueOnce(pending.promise); return pending; }
function response(id: string) { return { data: kind === 'mine' ? [circle(id)] : kind === 'suggestions' ? [suggestion(id)] : [member(id)], error: null }; }
function ids() { return kind === 'members' ? current.data?.['circle-a']?.map((r: any) => r.user_id) : current.data?.map((r: any) => r.id); }
function key(viewer = 'alice', epoch?: number) {
  const base = kind === 'mine' ? ['circles', 'mine', viewer] : kind === 'suggestions' ? ['circles', 'suggestions', viewer] : ['circleMemberPreviews', viewer, 'circle-a,circle-b'];
  return epoch === undefined ? base : [...base, epoch];
}
beforeEach(() => {
  jest.clearAllMocks(); kind = 'mine'; userId = 'alice'; scope = makeScope(); circleIds = ['circle-b', 'circle-a'];
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mockGetUser.mockReset().mockResolvedValue(auth('alice'));
  mockRpc.mockReset().mockImplementation(async name => ({ data: name === 'get_my_circles' ? [circle()] : [suggestion()], error: null }));
  mockMembers.mockReset().mockResolvedValue({ data: [member()], error: null });
});
afterEach(async () => { act(() => tree?.unmount()); tree = undefined; client.clear(); await flush(); });

it('preserves the no-argument joined-Circle RPC and server result order', async () => {
  mockRpc.mockResolvedValueOnce({ data: [circle('newest'), circle('older')], error: null }); await mount();
  expect(mockRpc).toHaveBeenCalledWith('get_my_circles'); expect(ids()).toEqual(['newest', 'older']); expect(mockQuery).not.toHaveBeenCalled();
});
it('preserves optional unnamed identity enrichment and does not reorder rows', async () => {
  mockRpc.mockResolvedValueOnce({ data: [circle('named'), circle('circle-a', '')], error: null });
  mockMembers.mockResolvedValueOnce({ data: [member('alice'), member('bea'), member('zoe')], error: null }); await mount();
  expect(ids()).toEqual(['named', 'circle-a']); expect(current.data[1].display_name).toBe('bea, zoe');
  expect(mockQuery.mock.calls).toEqual([['from', 'circle_members'], ['select', 'circle_id, user_id, profiles_public!inner(first_name_display)'], ['in', 'circle_id', ['circle-a']], ['eq', 'status', 'joined']]);
});
it('keeps unnamed optional lookup failure separate from the primary directory result', async () => {
  mockRpc.mockResolvedValueOnce({ data: [circle('circle-a', '')], error: null }); mockMembers.mockResolvedValueOnce({ data: null, error: new Error('optional name lookup failed') }); await mount();
  expect(current.isError).toBe(false); expect(current.data[0].display_name).toBe('New circle');
});
it('preserves pending-suggestion RPC order without fabricating acceptance', async () => {
  kind = 'suggestions'; mockRpc.mockResolvedValueOnce({ data: [suggestion('newest'), suggestion('older')], error: null }); await mount();
  expect(mockRpc).toHaveBeenCalledWith('get_circle_suggestions'); expect(ids()).toEqual(['newest', 'older']);
});
it('preserves joined-member preview query, stable ID key and nullable profile mapping', async () => {
  kind = 'members'; mockMembers.mockResolvedValueOnce({ data: [member('bea'), { circle_id: 'circle-a', user_id: 'zoe', profiles_public: null }], error: null }); await mount();
  expect(mockQuery.mock.calls).toEqual([['from', 'circle_members'], ['select', 'circle_id, user_id, joined_at, profiles_public!inner(first_name_display, profile_photo_url)'], ['in', 'circle_id', ['circle-b', 'circle-a']], ['eq', 'status', 'joined'], ['order', 'joined_at']]);
  expect(current.data['circle-a']).toEqual([{ user_id: 'bea', name: 'bea', photo_url: 'bea.jpg' }, { user_id: 'zoe', name: null, photo_url: null }]);
  circleIds = ['circle-a', 'circle-b']; await update(); expect(mockMembers).toHaveBeenCalledTimes(1);
});
it.each(['mine', 'suggestions', 'members'] as const)('%s never uses an unscoped warm private cache', async which => {
  kind = which; client.setQueryData(key(), kind === 'members' ? { 'circle-a': [{ user_id: 'legacy' }] } : [{ id: 'legacy' }]); await mount();
  expect(ids()).not.toContain('legacy'); expect(client.getQueryData(key('alice', 1))).toEqual(current.data);
});
it.each(['mine', 'suggestions', 'members'] as const)('%s isolates account A from B and rejects the late A result', async which => {
  kind = which; const old = pendingRead(); await mount(); (scope as ReturnType<typeof makeScope>).retire(); scope = makeScope('bob', 2); userId = 'bob'; mockGetUser.mockResolvedValue(auth('bob'));
  const next = pendingRead(); await update(); expect(current.data).toBeUndefined(); old.resolve(response('alice-private')); await flush(); expect(current.data).toBeUndefined();
  next.resolve(response('bob-private')); await flush(); expect(ids()).toEqual(['bob-private']); expect(client.getQueryData(key('alice', 1))).toBeUndefined();
});
it.each(['mine', 'suggestions', 'members'] as const)('%s revalidates when A returns after B rather than reusing old generation', async which => {
  kind = which; await mount(); (scope as ReturnType<typeof makeScope>).retire(); scope = makeScope('bob', 2); userId = 'bob'; mockGetUser.mockResolvedValue(auth('bob')); await update();
  (scope as ReturnType<typeof makeScope>).retire(); scope = makeScope('alice', 3); userId = 'alice'; mockGetUser.mockResolvedValue(auth('alice')); const pending = pendingRead(); await update(); expect(current.data).toBeUndefined();
  pending.resolve(response('fresh-alice')); await flush(); expect(ids()).toEqual(['fresh-alice']);
});
it.each(['mine', 'suggestions', 'members'] as const)('%s rejects preflight mismatch before any data read', async which => {
  kind = which; mockGetUser.mockResolvedValueOnce(auth('bob')); await mount(); expect(current.isError).toBe(true); expect(mockRpc).not.toHaveBeenCalled(); expect(mockMembers).not.toHaveBeenCalled();
});
it.each(['mine', 'suggestions', 'members'] as const)('%s retires during delayed account confirmation', async which => {
  kind = which; const pending = deferred<ReturnType<typeof auth>>(); mockGetUser.mockReturnValueOnce(pending.promise); await mount();
  (scope as ReturnType<typeof makeScope>).retire(); pending.resolve(auth('alice')); await flush(); expect(mockRpc).not.toHaveBeenCalled(); expect(mockMembers).not.toHaveBeenCalled();
});
it('does not cache names from a late unnamed-Circle enrichment after account retirement', async () => {
  mockRpc.mockResolvedValueOnce({ data: [circle('circle-a', '')], error: null }); const pending = deferred<any>(); mockMembers.mockReturnValueOnce(pending.promise); await mount();
  (scope as ReturnType<typeof makeScope>).retire(); pending.resolve({ data: [member('private-old-name')], error: null }); await flush();
  expect(current.isError).toBe(true); expect(client.getQueryData(key('alice', 1))).toBeUndefined();
});
it.each(['mine', 'suggestions', 'members'] as const)('%s distinguishes read failure from confirmed empty and retries', async which => {
  kind = which; const error = new Error('timeout'); if (kind === 'members') mockMembers.mockResolvedValueOnce({ data: null, error }); else mockRpc.mockResolvedValueOnce({ data: null, error });
  await mount(); expect(current.error).toBe(error); expect(current.data).toBeUndefined();
  if (kind === 'members') mockMembers.mockResolvedValueOnce({ data: [], error: null }); else mockRpc.mockResolvedValueOnce({ data: [], error: null });
  await act(async () => { await current.refetch(); }); await flush(); expect(current.isError).toBe(false); expect(current.data).toEqual(kind === 'members' ? {} : []);
});
it.each(['mine', 'suggestions', 'members'] as const)('%s preserves legacy no-scope cache and skips new auth checks', async which => {
  kind = which; scope = undefined; await mount(); expect(mockGetUser).not.toHaveBeenCalled(); expect(mockAbort).not.toHaveBeenCalled(); expect(client.getQueryData(key())).toEqual(current.data);
});
it.each(['mine', 'suggestions', 'members'] as const)('%s stays disabled without an account', async which => {
  kind = which; userId = null; await mount(); expect(mockRpc).not.toHaveBeenCalled(); expect(mockMembers).not.toHaveBeenCalled(); expect(mockGetUser).not.toHaveBeenCalled();
});
