const mockStore = new Map<string, string>();
const mockRpc = jest.fn();
const mockSession = jest.fn(), mockHeader = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStore.set(key, value); }),
  removeItem: jest.fn(async (key: string) => { mockStore.delete(key); }),
}));
jest.mock('../supabase', () => ({ supabase: {
  rpc: (...args: any[]) => { const promise = Promise.resolve(mockRpc(...args)); return Object.assign(promise, { setHeader: (...headers: any[]) => { mockHeader(...headers); return promise; } }); },
  auth: { getSession: () => mockSession() },
} }));
import AsyncStorage from '@react-native-async-storage/async-storage';
import { consumePendingReferral, stashPendingReferral } from '../yours/referralLink';
const key = 'pendingReferral.v1';
const legacyKey = 'pendingReferralCode';
const scope = { userId: 'account-a', isCurrent: () => true };
const pending = () => { const value = mockStore.get(key); if (!value) return null; return value.startsWith('{') ? JSON.parse(value) : { code: value, ownerId: null }; };
const inviter = '11111111-1111-4111-8111-111111111111';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => { mockStore.clear(); jest.clearAllMocks(); mockRpc.mockReset().mockResolvedValue({ data: inviter, error: null }); mockSession.mockReset().mockResolvedValue({ data: { session: { user: { id: 'account-a' }, access_token: 'fictional-access' } }, error: null }); });

it('removes a confirmed pending referral', async () => {
  await stashPendingReferral('FIRST'); await consumePendingReferral(scope);
  expect(mockStore.has(key)).toBe(false); expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('retains a pending referral after an unconfirmed server failure', async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'network unavailable' } });
  await stashPendingReferral('FIRST'); await consumePendingReferral(scope);
  expect(pending()).toMatchObject({ code: 'FIRST', ownerId: 'account-a' });
});
it('does not dispatch the same pending claim twice for concurrent consumers', async () => {
  const claim = deferred<any>(); mockRpc.mockReturnValue(claim.promise);
  await stashPendingReferral('FIRST'); const a = consumePendingReferral(scope), b = consumePendingReferral(scope); await flush();
  const count = mockRpc.mock.calls.length;
  claim.resolve({ data: inviter, error: null }); await Promise.all([a, b]);
  expect(count).toBe(1);
});
it('does not erase or claim an obsolete read after a newer invite arrives', async () => {
  await stashPendingReferral('FIRST'); const read = deferred<string | null>();
  jest.mocked(AsyncStorage.getItem).mockReturnValueOnce(read.promise);
  const consume = consumePendingReferral(scope); await flush();
  const newer = stashPendingReferral('SECOND'); read.resolve('FIRST'); await Promise.all([consume, newer]);
  expect(pending()?.code).toBe('SECOND'); expect(mockRpc).not.toHaveBeenCalled();
});

it('pins the claim to the initiating session token', async () => {
  await stashPendingReferral('FIRST'); await consumePendingReferral(scope);
  expect(mockHeader).toHaveBeenCalledWith('Authorization', 'Bearer fictional-access');
});
it('keeps uncertain owned claims away from a later account, then retries for their owner', async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
  await stashPendingReferral('FIRST'); await consumePendingReferral(scope);
  await consumePendingReferral({ userId: 'account-b', isCurrent: () => true });
  expect(mockRpc).toHaveBeenCalledTimes(1); expect(pending()?.ownerId).toBe('account-a');
  await consumePendingReferral(scope); expect(mockRpc).toHaveBeenCalledTimes(2); expect(pending()).toBeNull();
});
it.each(['SECOND', 'FIRST'])('keeps a newer %s invite when an older dispatched claim finishes', async code => {
  const claim = deferred<any>(); mockRpc.mockReturnValueOnce(claim.promise);
  await stashPendingReferral('FIRST'); const consume = consumePendingReferral(scope); await flush();
  expect(mockRpc).toHaveBeenCalledTimes(1); await stashPendingReferral(code);
  claim.resolve({ data: inviter, error: null }); await consume;
  expect(pending()).toMatchObject({ code, ownerId: null });
});
it('does not claim after its sign-in scope retires during the session read', async () => {
  let active = true; const session = deferred<any>(); mockSession.mockReturnValueOnce(session.promise);
  await stashPendingReferral('FIRST'); const consume = consumePendingReferral({ userId: 'account-a', isCurrent: () => active }); await flush();
  active = false; session.resolve({ data: { session: { user: { id: 'account-a' }, access_token: 'fictional-access' } }, error: null }); await consume;
  expect(mockRpc).not.toHaveBeenCalled(); expect(pending()?.ownerId).toBe('account-a');
});
it('refuses a mismatched session before dispatch', async () => {
  mockSession.mockResolvedValueOnce({ data: { session: { user: { id: 'account-b' }, access_token: 'fictional-other' } }, error: null });
  await stashPendingReferral('FIRST'); await consumePendingReferral(scope);
  expect(mockRpc).not.toHaveBeenCalled(); expect(pending()?.ownerId).toBe('account-a');
});
it('does not send when durable ownership could not be saved', async () => {
  await stashPendingReferral('FIRST'); jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk unavailable'));
  await consumePendingReferral(scope); expect(mockRpc).not.toHaveBeenCalled(); expect(pending()?.code).toBe('FIRST');
  await consumePendingReferral(scope); expect(mockRpc).toHaveBeenCalledTimes(1); expect(pending()).toBeNull();
});
it('migrates an existing plain code before claiming it', async () => {
  mockStore.set(legacyKey, 'LEGACY'); await consumePendingReferral(scope);
  expect(mockRpc).toHaveBeenCalledWith('claim_referral_invite', { p_code: 'LEGACY' }); expect(pending()).toBeNull();
  expect(mockStore.has(legacyKey)).toBe(false);
});
it.each(['invalid_referral_code', 'invalid_recipient', 'blocked', 'cannot_re_request'])('retires the confirmed terminal server result %s', async message => {
  mockRpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message } });
  await stashPendingReferral('FIRST'); await consumePendingReferral(scope); expect(pending()).toBeNull();
});
it('retains a null or malformed receipt without inventing confirmation', async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: null }); await stashPendingReferral('FIRST'); await consumePendingReferral(scope);
  expect(pending()?.ownerId).toBe('account-a');
  mockRpc.mockResolvedValueOnce({ data: 'not-a-uuid', error: null }); await consumePendingReferral(scope); expect(pending()?.code).toBe('FIRST');
});
it('keeps recipient ownership when the module restarts', async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
  await stashPendingReferral('FIRST'); await consumePendingReferral(scope);
  let reopened!: typeof import('../yours/pendingReferral');
  jest.isolateModules(() => { reopened = require('../yours/pendingReferral'); });
  await reopened.consumePendingReferral({ userId: 'account-b', isCurrent: () => true });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  await reopened.consumePendingReferral(scope); expect(mockRpc).toHaveBeenCalledTimes(2); expect(pending()).toBeNull();
});
it('bounds a stalled read and ignores its later value', async () => {
  jest.useFakeTimers(); const read = deferred<string | null>();
  try {
    await stashPendingReferral('FIRST'); jest.mocked(AsyncStorage.getItem).mockReturnValueOnce(read.promise);
    const consume = consumePendingReferral(scope); await flush();
    await jest.advanceTimersByTimeAsync(12_001); await consume;
    await stashPendingReferral('SECOND'); read.resolve('FIRST'); await flush();
    expect(mockRpc).not.toHaveBeenCalled(); expect(pending()?.code).toBe('SECOND');
  } finally { jest.useRealTimers(); }
});
it('keeps an uncertain claim through a deadline and ignores its late receipt', async () => {
  jest.useFakeTimers(); const claim = deferred<any>();
  try {
    mockRpc.mockReturnValueOnce(claim.promise); await stashPendingReferral('FIRST');
    const consume = consumePendingReferral(scope); await flush();
    await jest.advanceTimersByTimeAsync(12_001); await consume;
    expect(pending()).toMatchObject({ code: 'FIRST', ownerId: 'account-a' });
    await stashPendingReferral('SECOND'); claim.resolve({ data: inviter, error: null }); await flush();
    expect(pending()).toMatchObject({ code: 'SECOND', ownerId: null });
  } finally { jest.useRealTimers(); }
});
it('orders a new stash behind an already-dispatched removal', async () => {
  const removal = deferred<void>();
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async name => { if (name === key) await removal.promise; mockStore.delete(name); });
  await stashPendingReferral('FIRST'); const consume = consumePendingReferral(scope); await flush();
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith(key);
  const newer = stashPendingReferral('SECOND'); await flush();
  expect(pending()?.code).toBe('FIRST');
  removal.resolve(); await Promise.all([consume, newer]);
  expect(pending()).toMatchObject({ code: 'SECOND', ownerId: null });
});

it('never exposes an owned retry as an unowned legacy code on rollback', async () => {
  mockStore.set(legacyKey, 'LEGACY'); mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
  await consumePendingReferral(scope);
  expect(pending()).toMatchObject({ code: 'LEGACY', ownerId: 'account-a' });
  expect(mockStore.get(legacyKey)).toBeUndefined();
});
it('keeps a failed migration retryable without dispatching before the legacy pointer is removed', async () => {
  mockStore.set(legacyKey, 'LEGACY');
  jest.mocked(AsyncStorage.removeItem).mockRejectedValueOnce(new Error('disk unavailable'));
  await consumePendingReferral(scope);
  expect(mockRpc).not.toHaveBeenCalled(); expect(mockStore.get(legacyKey)).toBe('LEGACY');
  expect(pending()).toMatchObject({ code: 'LEGACY', ownerId: 'account-a' });
  await consumePendingReferral(scope);
  expect(mockRpc).toHaveBeenCalledTimes(1); expect(mockStore.size).toBe(0);
});
it('prefers the newer saved invite over the legacy pointer', async () => {
  mockStore.set(legacyKey, 'LEGACY'); await stashPendingReferral('NEW');
  await consumePendingReferral(scope);
  expect(mockRpc).toHaveBeenCalledWith('claim_referral_invite', { p_code: 'NEW' });
  expect(mockStore.size).toBe(0);
});
