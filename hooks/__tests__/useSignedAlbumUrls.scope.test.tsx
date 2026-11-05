import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSignedAlbumUrls } from '../useSignedAlbumUrls';

const mockGetUser = jest.fn(), mockSign = jest.fn(), mockBucket = jest.fn();
jest.mock('../../lib/supabase', () => ({ supabase: {
  auth: { getUser: () => mockGetUser() },
  storage: { from: (bucket: string) => { mockBucket(bucket); return { createSignedUrls: (...args: unknown[]) => mockSign(...args) }; } },
} }));
const auth = (id = 'alice') => ({ data: { user: { id } }, error: null });
const response = (url = 'alice-url', path = 'photo') => ({ data: [{ path, signedUrl: url }], error: null });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function owner(userId = 'alice', epoch = 1) { let active = true; return { userId, epoch, isCurrent: () => active, retire: () => { active = false; } }; }
let tree: ReactTestRenderer | undefined, client: QueryClient, current: any;
let scope: ReturnType<typeof owner> | undefined, paths: (string | null | undefined)[];
function Harness() { current = (useSignedAlbumUrls as any)(paths, scope); return null; }
const render = () => <QueryClientProvider client={client}><Harness /></QueryClientProvider>;
async function flush() { for (let i = 0; i < 5; i++) await act(async () => { await jest.advanceTimersByTimeAsync(0); }); }
async function mount() { act(() => { tree = create(render()); }); await flush(); }
async function update() { act(() => { tree!.update(render()); }); await flush(); }
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); scope = owner(); paths = ['photo'];
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mockGetUser.mockReset().mockResolvedValue(auth()); mockSign.mockReset().mockResolvedValue(response());
});
afterEach(async () => { act(() => tree?.unmount()); tree = undefined; client.clear(); await flush(); jest.useRealTimers(); });

it('preserves bucket, two-hour TTL, deduplication and mapping', async () => {
  paths = ['photo', null, 'photo', undefined, '', 'other'];
  mockSign.mockResolvedValueOnce({ data: [{ path: 'photo', signedUrl: 'url' }, { path: 'other', signedUrl: null }, { path: null, signedUrl: 'bad' }], error: null });
  await mount(); expect(mockBucket).toHaveBeenCalledWith('album-media');
  expect(mockSign).toHaveBeenCalledWith(['photo', 'other'], 7200); expect(current.data).toEqual({ photo: 'url' });
});
it('never reads the legacy path-only private cache', async () => {
  client.setQueryData(['album-signed-urls', 'photo'], { photo: 'old-private-url' });
  const pending = deferred<any>(); mockSign.mockReturnValueOnce(pending.promise); await mount();
  expect(current.data).toBeUndefined(); expect(mockSign).toHaveBeenCalledTimes(1);
  pending.resolve(response()); await flush(); expect(current.data).toEqual({ photo: 'alice-url' });
});
it('does not sign or expose a private URL without a confirmed owner', async () => {
  scope = undefined; await mount(); expect(mockSign).not.toHaveBeenCalled(); expect(current.data).toBeUndefined();
  await act(async () => { await current.refetch(); }); expect(mockSign).not.toHaveBeenCalled();
});
it('does not start account or storage reads for empty paths', async () => {
  paths = []; await mount(); expect(mockGetUser).not.toHaveBeenCalled(); expect(mockSign).not.toHaveBeenCalled();
});
it('rejects an account mismatch before signing', async () => {
  mockGetUser.mockResolvedValueOnce(auth('bob')); await mount(); expect(current.isError).toBe(true); expect(mockSign).not.toHaveBeenCalled();
});
it('isolates Alice from Bob and ignores the late Alice result', async () => {
  const old = deferred<any>(); mockSign.mockReturnValueOnce(old.promise); await mount();
  scope!.retire(); scope = owner('bob', 2); mockGetUser.mockResolvedValue(auth('bob'));
  const next = deferred<any>(); mockSign.mockReturnValueOnce(next.promise); await update();
  old.resolve(response('alice-private')); await flush(); expect(current.data).toBeUndefined();
  next.resolve(response('bob-private')); await flush(); expect(current.data).toEqual({ photo: 'bob-private' });
});
it('revalidates Alice after Alice → Bob → Alice', async () => {
  await mount(); scope!.retire(); scope = owner('bob', 2); mockGetUser.mockResolvedValue(auth('bob')); await update();
  scope!.retire(); scope = owner('alice', 3); mockGetUser.mockResolvedValue(auth());
  const pending = deferred<any>(); mockSign.mockReturnValueOnce(pending.promise); await update(); expect(current.data).toBeUndefined();
  pending.resolve(response('fresh-alice')); await flush(); expect(current.data).toEqual({ photo: 'fresh-alice' });
});
it('hides a retired owner’s warm result on the next render', async () => {
  await mount(); scope!.retire(); await update(); expect(current.data).toBeUndefined();
});
it('does not start signing after retirement during account confirmation', async () => {
  const pending = deferred<any>(); mockGetUser.mockReturnValueOnce(pending.promise); await mount();
  scope!.retire(); pending.resolve(auth()); await flush(); expect(mockSign).not.toHaveBeenCalled();
});
it('does not confuse path sets containing delimiter characters', async () => {
  paths = ['a|b', 'c']; await mount(); paths = ['a', 'b|c']; await update(); expect(mockSign).toHaveBeenCalledTimes(2);
});
it('shares a warm set independent of input order', async () => {
  paths = ['a', 'b']; await mount(); paths = ['b', 'a']; await update(); expect(mockSign).toHaveBeenCalledTimes(1);
});
it('shows an authorized warm result after the parent visit becomes active at commit', async () => {
  let active = false;
  const parentScope = { userId: 'alice', epoch: 1, isCurrent: () => active };
  client.setQueryData(['album-signed-urls', 'alice', 1, ['photo']], { photo: 'warm-authorized' });
  function Parent() {
    current = (useSignedAlbumUrls as any)(['photo'], parentScope);
    React.useLayoutEffect(() => { active = true; return () => { active = false; }; }, []);
    return null;
  }
  act(() => { tree = create(<QueryClientProvider client={client}><Parent /></QueryClientProvider>); }); await flush();
  expect(current.data).toEqual({ photo: 'warm-authorized' }); expect(mockSign).not.toHaveBeenCalled();
});
it.each(['account', 'signing'])('bounds a stalled %s read and supports retry without accepting its late result', async stage => {
  const pending = deferred<any>(); (stage === 'account' ? mockGetUser : mockSign).mockReturnValueOnce(pending.promise); await mount();
  await act(async () => { await jest.advanceTimersByTimeAsync(12_001); }); await flush();
  expect(current.isError).toBe(true); expect(current.error.name).toBe('RequestDeadlineError');
  pending.resolve(stage === 'account' ? auth() : response('late')); await flush(); expect(current.data).toBeUndefined();
  if (stage === 'account') expect(mockSign).not.toHaveBeenCalled();
  await act(async () => { await current.refetch(); }); await flush(); expect(current.data).toEqual({ photo: 'alice-url' });
});
it('hides stale URLs after a rejected refresh and recovers explicitly', async () => {
  await mount(); mockSign.mockResolvedValueOnce({ data: null, error: new Error('No access') });
  await act(async () => { await current.refetch(); }); await flush(); expect(current.isError).toBe(true); expect(current.data).toBeUndefined();
  await act(async () => { await current.refetch(); }); await flush(); expect(current.data).toEqual({ photo: 'alice-url' });
});
it('does not publish an in-flight signing result after its last observer unmounts', async () => {
  const pending = deferred<any>(); mockSign.mockReturnValueOnce(pending.promise); await mount();
  act(() => tree!.unmount()); tree = undefined; pending.resolve(response('late')); await flush();
  expect(client.getQueryCache().getAll().some(q => !!q.state.data)).toBe(false);
});
