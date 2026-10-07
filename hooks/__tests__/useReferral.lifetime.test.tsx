import React from 'react';
import { act, create } from 'react-test-renderer';
import { ObsoleteReferralOperation, useReferral } from '../useReferral';

const mockRpc = jest.fn(), mockGetUser = jest.fn();
jest.mock('../../lib/supabase', () => ({ supabase: {
  rpc: (...args: unknown[]) => mockRpc(...args), auth: { getUser: () => mockGetUser() },
} }));
const cleanup: Array<() => void> = [];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function mount() {
  let current!: ReturnType<typeof useReferral>;
  function Harness() { current = useReferral(); return null; }
  let tree!: ReturnType<typeof create>; act(() => { tree = create(<Harness />); });
  cleanup.push(() => act(() => tree.unmount())); return current;
}
function scope() { const entry = { live: true, isCurrent: () => entry.live }; return entry; }
beforeEach(() => {
  mockRpc.mockReset().mockResolvedValue({ data: 'JZJAAJU', error: null });
  mockGetUser.mockReset().mockResolvedValue({ data: { user: { id: 'alice' } }, error: null });
});
afterEach(() => cleanup.splice(0).forEach(fn => fn()));

it('retains the unscoped userId API and exact RPC arguments', async () => {
  await expect(mount().ensureReferralCode('alice')).resolves.toBe('JZJAAJU');
  expect(mockRpc).toHaveBeenCalledWith('ensure_referral_code', { p_user_id: 'alice' });
  expect(mockGetUser).not.toHaveBeenCalled();
});
it('checks a scoped identity and returns a valid original code', async () => {
  mockRpc.mockResolvedValueOnce({ data: 'mixed_Case-09', error: null });
  await expect(mount().ensureReferralCode('alice', scope())).resolves.toBe('mixed_Case-09');
  expect(mockGetUser).toHaveBeenCalledTimes(1); expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('does not start a stale captured action', async () => {
  const entry = scope(); entry.live = false;
  await expect(mount().ensureReferralCode('alice', entry)).rejects.toBeInstanceOf(ObsoleteReferralOperation);
  expect(mockGetUser).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled();
});
it.each([null, { id: 'bob' }])('refuses a missing or switched authenticated account: %p', async user => {
  mockGetUser.mockResolvedValueOnce({ data: { user }, error: null });
  await expect(mount().ensureReferralCode('alice', scope())).rejects.toBeInstanceOf(ObsoleteReferralOperation);
  expect(mockRpc).not.toHaveBeenCalled();
});
it('preserves an actual auth failure without dispatching the RPC', async () => {
  const error = new Error('auth unavailable'); mockGetUser.mockResolvedValueOnce({ data: { user: null }, error });
  await expect(mount().ensureReferralCode('alice', scope())).rejects.toBe(error); expect(mockRpc).not.toHaveBeenCalled();
});
it('retires during the identity read before a code can be generated', async () => {
  const gate = deferred<any>(), entry = scope(); mockGetUser.mockReturnValueOnce(gate.promise);
  const result = mount().ensureReferralCode('alice', entry); const assertion = expect(result).rejects.toBeInstanceOf(ObsoleteReferralOperation);
  entry.live = false; gate.resolve({ data: { user: { id: 'alice' } }, error: null });
  await assertion; expect(mockRpc).not.toHaveBeenCalled();
});
it.each([false, true])('discards a late %s-error receipt when the originating visit retires', async fail => {
  const gate = deferred<any>(), entry = scope(); mockRpc.mockReturnValueOnce(gate.promise);
  const result = mount().ensureReferralCode('alice', entry); const assertion = expect(result).rejects.toBeInstanceOf(ObsoleteReferralOperation);
  await Promise.resolve(); expect(mockRpc).toHaveBeenCalledTimes(1); entry.live = false;
  gate.resolve({ data: fail ? null : 'JZJAAJU', error: fail ? new Error('network') : null }); await assertion;
});
it('retains the initiating epoch even if the same account returns', async () => {
  let epoch = 1; const capturedEpoch = epoch, gate = deferred<any>(); mockRpc.mockReturnValueOnce(gate.promise);
  const result = mount().ensureReferralCode('alice', { isCurrent: () => epoch === capturedEpoch });
  const assertion = expect(result).rejects.toBeInstanceOf(ObsoleteReferralOperation); await Promise.resolve();
  epoch += 2; gate.resolve({ data: 'JZJAAJU', error: null }); await assertion;
});
it.each([null, undefined, '', ' ', 'bad/code', 'bad?query', 'A'.repeat(65), 123, { code: 'JZJAAJU' }])('rejects malformed successful RPC data: %p', async data => {
  mockRpc.mockResolvedValueOnce({ data, error: null });
  await expect(mount().ensureReferralCode('alice', scope())).rejects.toThrow('Invalid referral code');
});
it('keeps current RPC failures retryable by the same caller', async () => {
  const error = new Error('network'), hook = mount(), entry = scope(); mockRpc.mockResolvedValueOnce({ data: null, error });
  await expect(hook.ensureReferralCode('alice', entry)).rejects.toBe(error);
  await expect(hook.ensureReferralCode('alice', entry)).resolves.toBe('JZJAAJU'); expect(mockRpc).toHaveBeenCalledTimes(2);
});
