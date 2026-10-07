import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockStorage = new Map<string, string>(), mockSet = jest.fn(), mockGet = jest.fn(), mockRemove = jest.fn();
const mockSession = jest.fn(), mockRpc = jest.fn();
jest.mock('../../lib/supabase', () => ({ supabase: { auth: { getSession: (...a: unknown[]) => mockSession(...a) }, rpc: (...a: unknown[]) => mockRpc(...a) } }));
const mockReview = jest.fn(), mockSubmit = jest.fn(), mockStatus = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
  getItem: (...a: unknown[]) => mockGet(...a), setItem: (...a: unknown[]) => mockSet(...a), removeItem: (...a: unknown[]) => mockRemove(...a),
} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '33333333-3333-4333-8333-333333333333' }));
jest.mock('../../lib/attendeeMessageSend', () => {
  const actual = jest.requireActual('../../lib/attendeeMessageContract');
  return { messageContent: (d: any) => actual.readMessageContent({ ...d, audience: { ...d.audience, search: '' } }),
    reviewAttendeeMessage: (...a: unknown[]) => mockReview(...a), submitAttendeeMessage: (...a: unknown[]) => mockSubmit(...a),
    readAttendeeMessageStatus: (...a: unknown[]) => mockStatus(...a), AttendeeMessageRejected: class extends Error {},
  };
});
import { useAttendeeMessageSend } from '../useAttendeeMessageSend';
import { AttendeeMessageRejected } from '../../lib/attendeeMessageSend';
import { EMPTY_MESSAGE_DRAFT } from '../../lib/communicationMessageDraft';
import { clearAttendeeMessageAttempt, loadAttendeeMessageAttempt } from '../../lib/attendeeMessageAttempt';
const account = '11111111-1111-4111-8111-111111111111', event = '22222222-2222-4222-8222-222222222222', request = '33333333-3333-4333-8333-333333333333';
const review = { eventId: event, recipientCount: 2, reviewHash: 'a'.repeat(64), channel: 'in_app_push', providerDeliveryConfirmed: false };
const receipt = { id: '44444444-4444-4444-8444-444444444444', eventId: event, requestId: request, recipientCount: 2, pushQueuedCount: 2, deliveryStatus: 'queued', createdAt: '2026-09-16T17:00:00Z', providerDeliveryConfirmed: false };
const draft = { ...EMPTY_MESSAGE_DRAFT, subject: 'Sunday update', body: 'Meet by the north gate.' };
let tree: ReactTestRenderer, value: ReturnType<typeof useAttendeeMessageSend>, active: boolean;
let scope: { userId: string; isCurrent(): boolean };
function Probe({ message = draft, enabled = true, owned = scope, isAuthorized }: any) { value = useAttendeeMessageSend(event, owned, message, enabled, isAuthorized); return null; }
const mount = async (props: any = {}) => { await act(async () => { tree = create(<Probe {...props} />); }); };
const prepare = async () => { await act(async () => { await value.prepare(); }); };
beforeEach(() => {
  jest.clearAllMocks(); mockStorage.clear(); active = true; scope = { userId: account, isCurrent: () => active };
  mockGet.mockImplementation(async k => mockStorage.get(k) ?? null);
  mockSet.mockImplementation(async (k, v) => { mockStorage.set(k, v); }); mockRemove.mockImplementation(async k => { mockStorage.delete(k); });
  mockReview.mockResolvedValue(review); mockSubmit.mockResolvedValue(receipt); mockStatus.mockResolvedValue(null);
});
afterEach(() => { if (tree) act(() => tree.unmount()); jest.useRealTimers(); });
it('saves the reviewed request before the only explicit send, guarding rapid taps', async () => {
  await mount(); await prepare(); expect(mockSubmit).not.toHaveBeenCalled();
  mockSubmit.mockImplementation(async (_e, id) => { expect(mockStorage.size).toBe(1); expect(JSON.parse([...mockStorage.values()][0]).requestId).toBe(id); return receipt; });
  await act(async () => { await Promise.all([value.send(), value.send()]); });
  expect(mockSubmit).toHaveBeenCalledTimes(1); expect(value.receipt).toEqual(receipt);
});
it('a failed durable write prevents submission and retains the draft/request', async () => {
  await mount(); await prepare(); mockSet.mockRejectedValueOnce(Error('Disk unavailable'));
  await act(async () => { await value.send(); });
  expect(mockSubmit).not.toHaveBeenCalled(); expect(value.attempt?.message.subject).toBe(draft.subject);
});
it('lost response remounts with the same saved request; status is read-only and retry reuses its key', async () => {
  await mount(); await prepare(); mockSubmit.mockRejectedValueOnce(Error('Connection lost'));
  await act(async () => { await value.send(); });
  act(() => tree.unmount()); await mount();
  expect(value.attempt?.requestId).toBe(request); expect(mockSubmit).toHaveBeenCalledTimes(1);
  await act(async () => { await value.send(); await value.check(); });
  expect(mockSubmit).toHaveBeenCalledTimes(1); expect(value.retryOriginal).toBe(true);
  await act(async () => { await value.retry(); });
  expect(mockSubmit.mock.calls.map(c => c[1])).toEqual([request, request]); expect(value.receipt).toEqual(receipt);
});
it('a confirmed receipt clears the draft before dropping its original request', async () => {
  await mount(); await prepare(); await act(async () => { await value.send(); });
  const clear = jest.fn(async () => { expect(mockStorage.size).toBe(1); return true; });
  await act(async () => { await value.finish(clear); });
  expect(clear).toHaveBeenCalledTimes(1); expect(mockStorage.size).toBe(0); expect(value.attempt).toBeNull();
});
it('a failed draft reset keeps the confirmed receipt recoverable', async () => {
  await mount(); await prepare(); await act(async () => { await value.send(); await value.finish(async () => false); });
  expect(mockStorage.size).toBe(1); expect(value.receipt).toEqual(receipt);
});
it('editing invalidates a review and cannot send the previous content', async () => {
  await mount(); await prepare(); await act(async () => tree.update(<Probe message={{ ...draft, body: 'Changed' }} />));
  await act(async () => { await value.send(); }); expect(mockSubmit).not.toHaveBeenCalled(); expect(value.review).toBeNull();
});
it('only an explicit post-lock rejection permits editing the preserved draft', async () => {
  await mount(); await prepare(); mockSubmit.mockRejectedValueOnce(new AttendeeMessageRejected('Review again'));
  await act(async () => { await value.send(); }); expect(value.rejected).toBe(true);
  await act(async () => { await value.finish(); }); expect(value.attempt).toBeNull(); expect(mockStorage.size).toBe(0);
});
it('unknown status cannot erase a possibly recorded request', async () => {
  await mount(); await prepare(); mockSubmit.mockRejectedValueOnce(Error('Unknown'));
  await act(async () => { await value.send(); await value.finish(); }); expect(mockStorage.size).toBe(1);
  mockStatus.mockRejectedValueOnce(Error('Offline')); await act(async () => { await value.check(); });
  expect(value.retryOriginal).toBe(false); expect(value.attempt?.requestId).toBe(request);
});
it('holds corrupt stored attempts without clearing or submitting them', async () => {
  mockStorage.set(`attendee-message-attempt:v1:${account}:${event}`, '{bad'); await mount();
  await act(async () => { await value.prepare(); await value.send(); });
  expect(value.loadFailed).toBe(true); expect(mockRemove).not.toHaveBeenCalled(); expect(mockSubmit).not.toHaveBeenCalled();
});
it('keeps read-only recovery when sending is gated off', async () => {
  await mount(); await prepare(); mockSubmit.mockRejectedValueOnce(Error('Unknown')); await act(async () => { await value.send(); });
  act(() => tree.unmount()); await mount({ enabled: false }); mockStatus.mockResolvedValueOnce(receipt);
  await act(async () => { await value.check(); await value.retry(); await value.send(); });
  expect(value.receipt).toEqual(receipt); expect(mockSubmit).toHaveBeenCalledTimes(1);
});
it('does not dispatch after sign-out during local persistence', async () => {
  await mount(); await prepare(); mockSet.mockImplementationOnce(async (k, v) => { mockStorage.set(k, v); active = false; });
  await act(async () => { await value.send(); }); expect(mockSubmit).not.toHaveBeenCalled(); expect(mockStorage.size).toBe(1);
});
it('does not erase a newer request during late cleanup', async () => {
  await mount(); await prepare(); await act(async () => { await value.send(); });
  const original = value.attempt!; const newer = { ...original, requestId: receipt.id };
  mockStorage.set(`attendee-message-attempt:v1:${account}:${event}`, JSON.stringify(newer));
  await expect(clearAttendeeMessageAttempt(original, scope)).rejects.toThrow('Another saved');
  expect((await loadAttendeeMessageAttempt(event, scope))?.requestId).toBe(receipt.id);
});
it('keeps a durable request without submitting when authority changes during persistence', async () => {
  let allowed = true;
  await mount({ isAuthorized: () => allowed }); await prepare();
  mockSet.mockImplementationOnce(async (k, v) => { mockStorage.set(k, v); allowed = false; });
  await act(async () => { await value.send(); });
  expect(mockSubmit).not.toHaveBeenCalled(); expect(mockStorage.size).toBe(1);
  expect(value.attempt?.requestId).toBe(request); expect(value.error).toContain('before sending');
  await act(async () => { await value.check(); await value.retry(); });
  expect(mockStatus).toHaveBeenCalledTimes(1); expect(value.retryOriginal).toBe(true);
  expect(mockSubmit).not.toHaveBeenCalled();
  allowed = true;
  await act(async () => { await value.retry(); });
  expect(mockSubmit).toHaveBeenCalledTimes(1); expect(mockSubmit.mock.calls[0][1]).toBe(request);
});
it('discards a pending review when current event or audience authority becomes unknown', async () => {
  let allowed = true, resolve!: (value: typeof review) => void;
  mockReview.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await mount({ isAuthorized: () => allowed });
  let pending!: Promise<boolean>;
  act(() => { pending = value.prepare(); });
  allowed = false;
  await act(async () => { resolve(review); expect(await pending).toBe(false); });
  expect(value.review).toBeNull(); expect(value.busy).toBe(false);
});
it('old send callbacks consult the current feature flag and authority callback', async () => {
  await mount(); await prepare(); const old = value;
  await act(async () => { tree.update(<Probe enabled={false} isAuthorized={() => false}/>); });
  await act(async () => { await old.prepare(); await old.send(); });
  expect(mockReview).toHaveBeenCalledTimes(1); expect(mockSubmit).not.toHaveBeenCalled();
  expect(mockSet).not.toHaveBeenCalled();
});
it('passes live authorization through the existing transport scope', async () => {
  let allowed = true;
  await mount({ isAuthorized: () => allowed }); await prepare();
  const reviewScope = mockReview.mock.calls[0][2];
  expect(reviewScope.userId).toBe(account); expect(reviewScope.isCurrent()).toBe(false); // The completed review operation is retired.
  mockSubmit.mockImplementationOnce(async (_event, _request, _message, _hash, owned) => {
    expect(owned.isCurrent()).toBe(true);
    allowed = false;
    expect(owned.isCurrent()).toBe(false);
    throw Error('Access changed during session lookup');
  });
  await act(async () => { await value.send(); });
  expect(reviewScope.isCurrent()).toBe(false); expect(value.receipt).toBeNull();
  expect(value.attempt?.requestId).toBe(request);
});
it('loads and checks an existing request while authority is unknown without granting resend', async () => {
  await mount(); await prepare(); mockSubmit.mockRejectedValueOnce(Error('Unknown'));
  await act(async () => { await value.send(); }); act(() => tree.unmount());
  await mount({ isAuthorized: () => false });
  expect(value.attempt?.requestId).toBe(request);
  mockStatus.mockResolvedValueOnce(receipt);
  await act(async () => { await value.check(); await value.retry(); });
  expect(value.receipt).toEqual(receipt); expect(mockSubmit).toHaveBeenCalledTimes(1);
  const clear = jest.fn(async () => true);
  await act(async () => { expect(await value.finish(clear)).toBe(false); });
  expect(clear).not.toHaveBeenCalled(); expect(mockRemove).not.toHaveBeenCalled();
});
it('retains a confirmed original request if authority changes during draft cleanup', async () => {
  let allowed = true;
  await mount({ isAuthorized: () => allowed }); await prepare();
  await act(async () => { await value.send(); });
  await act(async () => { expect(await value.finish(async () => { allowed = false; return true; })).toBe(false); });
  expect(mockRemove).not.toHaveBeenCalled(); expect(mockStorage.size).toBe(1);
  expect(value.receipt).toEqual(receipt);
});
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const tick = async (ms: number) => { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); };
it('ends a stalled local load without treating an unread request as empty', async () => {
  jest.useFakeTimers(); const pending = deferred<string | null>(); mockGet.mockReturnValueOnce(pending.promise);
  await mount(); expect(value.loading).toBe(true); await tick(12_000);
  expect(value.loading).toBe(false); expect(value.loadFailed).toBe(true);
  await act(async () => { await value.prepare(); await value.send(); }); expect(mockReview).not.toHaveBeenCalled();
  await act(async () => { await value.load(); }); expect(value.loadFailed).toBe(false);
  await act(async () => pending.resolve('{corrupt old result')); expect(value.loadFailed).toBe(false);
});
it('retires an expired review without releasing or replacing a newer pending review', async () => {
  jest.useFakeTimers(); const first = deferred<any>(), second = deferred<any>();
  mockReview.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await mount(); act(() => { void value.prepare(); }); await tick(12_000);
  expect(value.busy).toBe(false); expect(value.review).toBeNull(); expect(mockReview.mock.calls[0][2].isCurrent()).toBe(false);
  act(() => { void value.prepare(); }); await act(async () => first.resolve(review));
  expect(value.busy).toBe(true); expect(value.review).toBeNull();
  await act(async () => second.resolve(review)); expect(value.busy).toBe(false); expect(value.review?.receipt).toEqual(review);
});
it('never submits when an expired durable write later completes; explicit retry uses the original request', async () => {
  jest.useFakeTimers(); const pending = deferred<void>(); await mount(); await prepare();
  mockSet.mockImplementationOnce(async (k, v) => { await pending.promise; mockStorage.set(k, v); });
  act(() => { void value.send(); }); await tick(25_000);
  expect(value.busy).toBe(false); expect(value.attempt?.requestId).toBe(request); expect(mockSubmit).not.toHaveBeenCalled();
  await act(async () => { await value.check(); }); expect(value.retryOriginal).toBe(true);
  act(() => { void value.retry(); }); await act(async () => pending.resolve());
  expect(mockSubmit).toHaveBeenCalledTimes(1); expect(mockSubmit.mock.calls[0][1]).toBe(request); expect(value.receipt).toEqual(receipt);
});
it('retires the real session preflight before a late session can dispatch an RPC', async () => {
  jest.useFakeTimers(); const session = deferred<any>(); mockSession.mockReturnValue(session.promise);
  mockSubmit.mockImplementation(jest.requireActual('../../lib/attendeeMessageSend').submitAttendeeMessage);
  await mount(); await prepare(); act(() => { void value.send(); }); await tick(25_000);
  expect(value.busy).toBe(false); expect(value.receipt).toBeNull(); expect(mockRpc).not.toHaveBeenCalled();
  await act(async () => session.resolve({ data: { session: { user: { id: account }, access_token: 'synthetic' } }, error: null }));
  expect(mockRpc).not.toHaveBeenCalled(); expect(value.attempt?.requestId).toBe(request);
});
it('requires read-only status after an expired send and ignores its late receipt', async () => {
  jest.useFakeTimers(); const send = deferred<any>(), status = deferred<any>(); mockSubmit.mockReturnValueOnce(send.promise);
  await mount(); await prepare(); act(() => { void value.send(); }); await tick(25_000);
  expect(value.retryOriginal).toBe(false); expect(value.error).toContain('Check its status');
  mockStatus.mockReturnValueOnce(status.promise); act(() => { void value.check(); });
  await act(async () => send.resolve(receipt)); expect(value.receipt).toBeNull(); expect(value.busy).toBe(true);
  await act(async () => status.resolve(receipt)); expect(value.receipt).toEqual(receipt); expect(value.busy).toBe(false);
  expect(mockSubmit).toHaveBeenCalledTimes(1);
});
it('recovers stalled status without granting retry and ignores late no-receipt results', async () => {
  jest.useFakeTimers(); await mount(); await prepare(); mockSubmit.mockRejectedValueOnce(Error('Lost'));
  await act(async () => { await value.send(); }); const first = deferred<any>(); mockStatus.mockReturnValueOnce(first.promise);
  act(() => { void value.check(); }); await tick(12_000);
  expect(value.busy).toBe(false); expect(value.retryOriginal).toBe(false);
  mockStatus.mockResolvedValueOnce(receipt); await act(async () => { await value.check(); });
  await act(async () => first.resolve(null)); expect(value.receipt).toEqual(receipt); expect(value.retryOriginal).toBe(false);
});
it('retains a confirmed request when draft cleanup expires and ignores late cleanup completion', async () => {
  jest.useFakeTimers(); await mount(); await prepare(); await act(async () => { await value.send(); });
  const clear = deferred<boolean>(); act(() => { void value.finish(() => clear.promise); }); await tick(25_000);
  expect(value.busy).toBe(false); expect(value.attempt?.requestId).toBe(request);
  await act(async () => clear.resolve(true)); expect(mockRemove).not.toHaveBeenCalled(); expect(value.receipt).toEqual(receipt);
  await act(async () => { expect(await value.finish(async () => true)).toBe(true); }); expect(value.attempt).toBeNull();
});
it('a stalled attempt removal recovers without dropping the visible receipt or a newer request', async () => {
  jest.useFakeTimers(); await mount(); await prepare(); await act(async () => { await value.send(); });
  const remove = deferred<void>(); mockRemove.mockImplementationOnce(async k => { await remove.promise; mockStorage.delete(k); });
  act(() => { void value.finish(async () => true); }); await tick(25_000);
  expect(value.busy).toBe(false); expect(value.receipt).toEqual(receipt);
  act(() => { void value.finish(async () => true); }); await act(async () => remove.resolve());
  expect(value.attempt).toBeNull(); await prepare(); await act(async () => { await value.send(); });
  expect(value.receipt).toEqual(receipt); expect(mockStorage.size).toBe(1);
});
