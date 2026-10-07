import React from 'react';
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useBlock } from '../useBlock';
import { chatListMemoryCache, subscribeChatListPrivacy } from '../../lib/chatListCache';
import { consumeChatListDirty } from '../../lib/chatListSignal';

const mockGetUser = jest.fn(), mockRead = jest.fn(), mockWrite = jest.fn(), mockReport = jest.fn(), mockInvalidate = jest.fn();
const mockWriteFilters = jest.fn();
const mockQueryClient = { invalidateQueries: mockInvalidate };
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => mockQueryClient }));
jest.mock('../../lib/supabase', () => ({ supabase: {
  auth: { getUser: (...args: any[]) => mockGetUser(...args) },
  from: (table: string) => table === 'reports' ? { insert: (...args: any[]) => mockReport(...args) } : {
    select: () => ({ eq: (_key: string, id: string) => ({ single: () => mockRead(id) }) }),
    update: (value: unknown) => {
      let id = '';
      const query: any = {
        eq: (key: string, next: string) => { if (key === 'id') id = next; else mockWriteFilters(key, next); return query; },
        is: (key: string, next: null) => { mockWriteFilters(key, next); return query; },
        select: () => query, maybeSingle: () => mockWrite(id, value),
      }; return query;
    },
  },
} }));
let tree: ReactTestRenderer, controller: ReturnType<typeof useBlock>;
let current: string;
const after = jest.fn();
const scope = (userId = 'alice') => ({ userId, isCurrent: () => current === userId });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const user = (id: string) => ({ data: { user: { id } } });
function Harness() { controller = useBlock(); return null; }
async function mount() { await act(async () => { tree = create(<Harness />); }); }
async function open(context?: ReturnType<typeof scope>) { await act(async () => controller.blockUser('target', 'Jamie', after, context)); }
function confirm() { return (jest.mocked(Alert.alert).mock.calls[0][2]![1].onPress as () => Promise<void>); }
beforeEach(() => {
  chatListMemoryCache.clear(); consumeChatListDirty();
  jest.useFakeTimers(); jest.clearAllMocks(); jest.spyOn(Alert, 'alert').mockImplementation(() => {}); current = 'alice';
  mockGetUser.mockResolvedValue(user('alice')); mockRead.mockResolvedValue({ data: { blocked_users: ['existing'] }, error: null });
  mockWrite.mockImplementation(async (id: string, value: any) => ({ data: { id, ...value }, error: null })); mockReport.mockResolvedValue({ error: null }); mockInvalidate.mockResolvedValue(undefined);
});
afterEach(async () => { await act(async () => tree?.unmount()); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

it('rejects a retired native confirmation before looking up an account', async () => {
  await mount(); await open(scope()); const commit = confirm(); current = 'bob'; await act(async () => commit());
  expect(mockGetUser).not.toHaveBeenCalled(); expect(mockWrite).not.toHaveBeenCalled(); expect(after).not.toHaveBeenCalled();
});

it.each(['auth', 'profile'] as const)('does not write when scope retires during its %s read', async stage => {
  const pending = deferred<any>(); (stage === 'auth' ? mockGetUser : mockRead).mockReturnValueOnce(pending.promise);
  await mount(); await open(scope()); let work!: Promise<void>; act(() => { work = confirm()(); });
  await act(async () => { await Promise.resolve(); }); current = 'bob';
  await act(async () => { pending.resolve(stage === 'auth' ? user('bob') : { data: { blocked_users: [] }, error: null }); await work; });
  expect(mockWrite).not.toHaveBeenCalled(); expect(mockReport).not.toHaveBeenCalled(); expect(mockInvalidate).not.toHaveBeenCalled();
});

it('rejects an auth response for another user even if the caller guard remains true', async () => {
  mockGetUser.mockResolvedValue(user('bob')); await mount(); await open(scope()); await act(async () => confirm()());
  expect(mockRead).not.toHaveBeenCalled(); expect(mockWrite).not.toHaveBeenCalled();
});

it('does not report, invalidate or show completion after an already-dispatched write loses ownership', async () => {
  const pending = deferred<any>(); mockWrite.mockReturnValueOnce(pending.promise);
  await mount(); await open(scope()); let work!: Promise<void>; act(() => { work = confirm()(); });
  await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); expect(mockWrite).toHaveBeenCalledTimes(1);
  current = 'bob'; await act(async () => { pending.resolve({ error: null }); await work; jest.runOnlyPendingTimers(); });
  expect(mockReport).not.toHaveBeenCalled(); expect(mockInvalidate).not.toHaveBeenCalled(); expect(after).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledTimes(1);
});

it('preserves the initiating profile list, existing report payload and success callback for a current scope', async () => {
  await mount(); await open(scope()); await act(async () => confirm()());
  expect(mockWrite).toHaveBeenCalledWith('alice', { blocked_users: ['existing', 'target'] });
  expect(mockReport).toHaveBeenCalledWith(expect.objectContaining({ reporter_user_id: 'alice', reported_user_id: 'target', reason: 'Blocked by user' }));
  expect(mockInvalidate).toHaveBeenCalled(); expect(after).toHaveBeenCalledTimes(1);
  current = 'bob'; act(() => jest.runOnlyPendingTimers()); expect(Alert.alert).toHaveBeenCalledTimes(1);
});

it('keeps the original unscoped calling convention and successful confirmation', async () => {
  await mount(); await open(); await act(async () => confirm()()); act(() => jest.runOnlyPendingTimers());
  expect(mockWrite).toHaveBeenCalledTimes(1); expect(after).toHaveBeenCalledTimes(1);
  expect(Alert.alert).toHaveBeenLastCalledWith('Blocked', 'Jamie has been blocked.');
});

it.each(['read', 'write'] as const)('does not report success when a scoped %s returns an error', async stage => {
  (stage === 'read' ? mockRead : mockWrite).mockResolvedValueOnce({ data: null, error: new Error('request failed') });
  await mount(); await open(scope()); await act(async () => confirm()());
  expect(mockWrite).toHaveBeenCalledTimes(stage === 'read' ? 0 : 1); expect(mockReport).not.toHaveBeenCalled(); expect(after).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith('Error', 'Could not block user. Please try again.');
});

it.each(['auth', 'read', 'write', 'missing-profile'] as const)('does not report unscoped success or remove previews after %s fails', async stage => {
  const row = { is_dm: true, dm_user_id: 'target', conversationId: 'dm-target' } as any;
  chatListMemoryCache.set('alice', [row]);
  if (stage === 'auth') mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'alice' } }, error: new Error('auth failed') });
  else (stage === 'write' ? mockWrite : mockRead).mockResolvedValueOnce({ data: null, error: stage === 'missing-profile' ? null : new Error('failed') });
  await mount(); await open(); await act(async () => confirm()()); act(() => jest.runOnlyPendingTimers());
  expect(after).not.toHaveBeenCalled(); expect(mockReport).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith('Error', 'Could not block user. Please try again.');
  expect(chatListMemoryCache.get('alice')).toEqual([row]); expect(consumeChatListDirty()).toBe(false);
});

it.each([false, true])('removes only the matching account/private preview after confirmation (already blocked: %s)', async alreadyBlocked => {
  const row = (conversationId: string, dm_user_id: string, is_dm = true) => ({ conversationId, dm_user_id, is_dm, title: 'Same display name' }) as any;
  chatListMemoryCache.set('alice', [row('target-dm', 'target'), row('other-dm', 'other'), row('shared-circle', 'target', false)]);
  chatListMemoryCache.set('bob', [row('bob-dm', 'target')]);
  if (alreadyBlocked) mockRead.mockResolvedValueOnce({ data: { blocked_users: ['target'] }, error: null });
  await mount(); await open(scope()); await act(async () => confirm()());
  expect(chatListMemoryCache.get('alice')?.map(chat => chat.conversationId)).toEqual(['other-dm', 'shared-circle']);
  expect(chatListMemoryCache.get('bob')?.map(chat => chat.conversationId)).toEqual(['bob-dm']);
  expect(consumeChatListDirty()).toBe(true); expect(after).toHaveBeenCalledTimes(1);
});


it('serializes repeated scoped confirmation callbacks before auth resolves', async () => {
  const pending = deferred<any>(); mockGetUser.mockReturnValueOnce(pending.promise);
  await mount(); await open(scope()); const commit = confirm(); let first!: Promise<void>;
  act(() => { first = commit(); void commit(); });
  expect(mockGetUser).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(user('alice')); await first; });
  expect(mockWrite).toHaveBeenCalledTimes(1);
});

it('does not let an old completion release a new account block attempt', async () => {
  const oldAuth = deferred<any>(), nextProfile = deferred<any>(); mockGetUser.mockReturnValueOnce(oldAuth.promise);
  await mount(); await open(scope()); let oldWork!: Promise<void>; act(() => { oldWork = confirm()(); });
  current = 'bob'; mockGetUser.mockResolvedValue(user('bob')); mockRead.mockReturnValueOnce(nextProfile.promise);
  await open(scope('bob'));
  const commitNext = jest.mocked(Alert.alert).mock.calls[1][2]![1].onPress as () => Promise<void>;
  let nextWork!: Promise<void>; act(() => { nextWork = commitNext(); });
  await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
  expect(controller.blocking).toBe(true);
  await act(async () => { oldAuth.resolve(user('alice')); await oldWork; });
  expect(controller.blocking).toBe(true); expect(mockWrite).not.toHaveBeenCalled();
  await act(async () => { nextProfile.resolve({ data: { blocked_users: [] }, error: null }); await nextWork; });
  expect(mockWrite).toHaveBeenCalledWith('bob', { blocked_users: ['target'] }); expect(controller.blocking).toBe(false);
});

it('retires an open scoped native confirmation when its hook unmounts', async () => {
  await mount(); await open(scope()); const commit = confirm(); await act(async () => tree.unmount());
  await act(async () => commit()); expect(mockGetUser).not.toHaveBeenCalled(); expect(mockWrite).not.toHaveBeenCalled();
});

it.each([null, { id: 'bob', blocked_users: ['existing', 'target'] }, { id: 'alice', blocked_users: ['existing'] },
  { id: 'alice', blocked_users: ['target'] }])('requires a matching saved block receipt: %j', async receipt => {
  mockWrite.mockResolvedValueOnce({ data: receipt, error: null });
  await mount(); await open(scope()); await act(async () => confirm()());
  expect(after).not.toHaveBeenCalled(); expect(mockReport).not.toHaveBeenCalled();
  expect(consumeChatListDirty()).toBe(false);
  expect(Alert.alert).toHaveBeenLastCalledWith('Error', 'Could not block user. Please try again.');
});
it.each([null, [], ['existing']])('compares the stored array before writing so concurrent blocks cannot be overwritten: %j', async stored => {
  mockRead.mockResolvedValueOnce({ data: { blocked_users: stored }, error: null });
  await mount(); await open(scope()); await act(async () => confirm()());
  expect(mockWriteFilters).toHaveBeenCalledWith('blocked_users', stored === null ? null : `{${stored.join(',')}}`);
  expect(after).toHaveBeenCalledTimes(1);
});
it('finishes a confirmed block even if the best-effort report never resolves', async () => {
  mockReport.mockReturnValueOnce(new Promise(() => {}));
  await mount(); await open(scope()); await act(async () => confirm()());
  expect(after).toHaveBeenCalledTimes(1); expect(controller.blocking).toBe(false);
  expect(consumeChatListDirty()).toBe(true);
});
it('does not repeat or revive an unscoped confirmation after unmount', async () => {
  const pending = deferred<any>(); mockGetUser.mockReturnValueOnce(pending.promise);
  await mount(); await open(); const commit = confirm(); let first!: Promise<void>;
  act(() => { first = commit(); void commit(); }); expect(mockGetUser).toHaveBeenCalledTimes(1);
  act(() => tree.unmount()); await act(async () => { pending.resolve(user('alice')); await first; await commit(); });
  expect(mockWrite).not.toHaveBeenCalled(); expect(after).not.toHaveBeenCalled();
});
it.each(['auth', 'read', 'write'] as const)('ends a stalled %s with an error and no false success', async stage => {
  ({ auth: mockGetUser, read: mockRead, write: mockWrite })[stage].mockReturnValueOnce(new Promise(() => {}));
  await mount(); await open(scope()); let work!: Promise<void>; act(() => { work = confirm()(); });
  await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); });
  await act(async () => { jest.advanceTimersByTime(12_000); await work; });
  expect(after).not.toHaveBeenCalled(); expect(controller.blocking).toBe(false);
  expect(Alert.alert).toHaveBeenLastCalledWith('Error', 'Could not block user. Please try again.');
});

it('invalidates the initiating account before the privacy signal retires its chat entry', async () => {
  const stop = subscribeChatListPrivacy(() => { current = 'retired'; });
  try {
    await mount(); await open(scope()); await act(async () => confirm()());
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['profile-blocked'] });
    expect(mockInvalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: expect.arrayContaining(['alice']) }));
    expect(consumeChatListDirty()).toBe(true); expect(after).not.toHaveBeenCalled();
  } finally { stop(); }
});
