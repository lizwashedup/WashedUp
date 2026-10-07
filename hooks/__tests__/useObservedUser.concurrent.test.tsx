import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockGetUser = jest.fn();
const mockListeners = new Set<(event: string, session: any) => void>();
jest.mock('../../lib/supabase', () => ({ supabase: { auth: {
  getUser: () => mockGetUser(),
  onAuthStateChange: (callback: any) => {
    mockListeners.add(callback);
    return { data: { subscription: { unsubscribe: () => mockListeners.delete(callback) } } };
  },
} } }));
import { useObservedUser } from '../useObservedUser';
const values = new Map<string, ReturnType<typeof useObservedUser>>();
function Reader({ name }: { name: string }) { values.set(name, useObservedUser()); return null; }
function pending() { let resolve!: (value: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { promise, resolve }; }
const answer = (id: string) => ({ data: { user: { id } }, error: null });
let tree: ReactTestRenderer | undefined;
async function flush() { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); }
beforeEach(() => { mockGetUser.mockReset(); values.clear(); mockListeners.clear(); });
afterEach(() => { act(() => tree?.unmount()); tree = undefined; });

it('shares one pending server verification across concurrent identity readers', async () => {
  const read = pending(); mockGetUser.mockReturnValue(read.promise);
  act(() => { tree = create(<><Reader name="route" /><Reader name="messages" /><Reader name="notifications" /></>); });
  expect(mockGetUser).toHaveBeenCalledTimes(1);
  expect([...values.values()].every(v => v.isLoading)).toBe(true);
  read.resolve(answer('a')); await flush();
  expect([...values.values()].every(v => v.viewerId === 'a' && !v.isLoading)).toBe(true);
});

it('never reuses a completed verification for a later mounted reader', async () => {
  mockGetUser.mockResolvedValue(answer('a'));
  act(() => { tree = create(<Reader name="first" />); }); await flush();
  act(() => { tree!.update(<><Reader name="first" /><Reader name="later" /></>); }); await flush();
  expect(mockGetUser).toHaveBeenCalledTimes(2);
});

it('does not share an old pending verification across an account transition', async () => {
  const old = pending(); mockGetUser.mockReturnValueOnce(old.promise).mockResolvedValue(answer('b'));
  act(() => { tree = create(<Reader name="first" />); });
  act(() => { for (const fn of [...mockListeners]) fn('SIGNED_IN', { user: { id: 'b' } }); });
  act(() => { tree!.update(<><Reader name="first" /><Reader name="later" /></>); }); await flush();
  expect(mockGetUser).toHaveBeenCalledTimes(2);
  old.resolve(answer('a')); await flush();
  expect(values.get('first')?.viewerId).toBe('b'); expect(values.get('later')?.viewerId).toBe('b');
});

it('retires an abandoned read before a new visit even if the account returned while away', async () => {
  const old = pending(); mockGetUser.mockReturnValueOnce(old.promise).mockResolvedValue(answer('a'));
  act(() => { tree = create(<Reader name="old" />); });
  act(() => { tree!.unmount(); tree = undefined; });
  act(() => { tree = create(<Reader name="new" />); }); await flush();
  expect(mockGetUser).toHaveBeenCalledTimes(2);
  expect(values.get('new')?.viewerId).toBe('a');
  old.resolve(answer('other')); await flush();
  expect(values.get('new')?.viewerId).toBe('a');
});
