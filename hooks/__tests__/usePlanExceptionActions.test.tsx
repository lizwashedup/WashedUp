import React from 'react';
import { act, create } from 'react-test-renderer';
import { usePlanExceptionActions } from '../usePlanExceptionActions';
import { recordScopedPlanAssent } from '../../lib/planParticipationScope';

const mockGetUser = jest.fn(), mockRpc = jest.fn(), mockUpdate = jest.fn();
let mockAccount: string | null = 'alice', mockEpoch = 1;
let mockFocus: (() => void | (() => void)) | undefined, mockBlur: (() => void) | undefined;
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void | (() => void)) => {
  require('react').useEffect(() => {
    mockFocus = callback; mockBlur = callback() || undefined;
    return () => { mockBlur?.(); mockBlur = undefined; mockFocus = undefined; };
  }, [callback]);
} }));
jest.mock('../../lib/supabase', () => ({ supabase: {
  auth: { getUser: () => mockGetUser() }, rpc: (...args: unknown[]) => mockRpc(...args),
  from: (table: string) => ({ update: (values: unknown) => {
    const filters: unknown[] = [];
    const query = { eq: (...args: unknown[]) => { filters.push(args); return query; },
      then: (yes: (value: unknown) => unknown, no: (error: unknown) => unknown) => Promise.resolve(mockUpdate(table, values, filters)).then(yes, no) };
    return query;
  } }),
} }));

type Options = Parameters<typeof usePlanExceptionActions>[0];
type Controller = ReturnType<typeof usePlanExceptionActions>;
type Result = { data?: unknown; error?: unknown };
const cleanups: Array<() => void> = [];
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
function writes() { return mockRpc.mock.calls.filter(([name]) => name === 'accept_waitlist_exception' || name === 'decline_waitlist_exception'); }
function records() { return mockRpc.mock.calls.filter(([name]) => name === 'record_participation_assent'); }
function mount(overrides: Partial<Options> = {}) {
  const onAccepted = jest.fn(), onDeclined = jest.fn(), onNotice = jest.fn(), onNoticeComplete = jest.fn(), onError = jest.fn();
  let props = overrides, current!: Controller;
  function Harness() {
    const epoch = mockEpoch;
    current = usePlanExceptionActions({ eventId: 'plan-a', viewerId: mockAccount, epoch, isCurrent: () => epoch === mockEpoch,
      available: true, organizerUserId: 'creator-a', organizerName: 'Amelia',
      onAccepted, onDeclined, onNotice, onNoticeComplete, onError, ...props });
    return null;
  }
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<Harness />); });
  let mounted = true;
  const unmount = () => { if (mounted) act(() => tree.unmount()); mounted = false; };
  cleanups.push(unmount);
  return { onAccepted, onDeclined, onNotice, onNoticeComplete, onError, unmount,
    get current() { return current; },
    update(next: Partial<Options> = {}) { props = { ...props, ...next }; act(() => tree.update(<Harness />)); },
    accept() { act(() => { void current.requestAccept(); }); },
    decline() { act(() => current.declineExceptionMutation.mutate()); },
    guard() { return onNotice.mock.calls.at(-1)![0] as () => boolean; },
  };
}
beforeEach(() => {
  jest.clearAllMocks(); mockAccount = 'alice'; mockEpoch = 1;
  mockGetUser.mockImplementation(async () => ({ data: { user: mockAccount ? { id: mockAccount } : null }, error: null }));
  mockRpc.mockImplementation(async (name: string) => ({ data: name === 'get_participation_notice_status' ? { needs_assent: false } : null, error: null }));
  mockUpdate.mockResolvedValue({ error: null });
});
afterEach(() => cleanups.splice(0).forEach(fn => fn()));

it('accepts once, retains the VOID helper contract and original notification filters', async () => {
  const write = deferred<Result>();
  mockRpc.mockImplementation((name: string) => name === 'get_participation_notice_status' ? Promise.resolve({ data: { needs_assent: false } }) : write.promise);
  const f = mount(); const accept = f.current.requestAccept, decline = f.current.declineExceptionMutation.mutate;
  act(() => { void accept(); void accept(); decline(); }); await flush();
  expect(writes()).toEqual([['accept_waitlist_exception', { p_event_id: 'plan-a' }]]);
  expect(f.current.acceptExceptionMutation.isPending).toBe(true); expect(f.onAccepted).not.toHaveBeenCalled();
  await act(async () => write.resolve({ data: null, error: null }));
  expect(mockUpdate).toHaveBeenCalledWith('app_notifications', { status: 'acted' }, [['type', 'exception_invite'], ['event_id', 'plan-a'], ['user_id', 'alice']]);
  expect(f.onAccepted).toHaveBeenCalledTimes(1); expect(f.current.acceptExceptionMutation.isPending).toBe(false);
  f.accept(); f.decline(); await flush(); expect(writes()).toHaveLength(1);
});

it('declines without status/assent and preserves the read notification cleanup', async () => {
  const f = mount(); f.decline(); await flush();
  expect(mockRpc.mock.calls).toEqual([['decline_waitlist_exception', { p_event_id: 'plan-a' }]]);
  expect(mockUpdate).toHaveBeenCalledWith('app_notifications', { status: 'read' }, [['type', 'exception_invite'], ['event_id', 'plan-a'], ['user_id', 'alice']]);
  expect(f.onDeclined).toHaveBeenCalledTimes(1); expect(f.onAccepted).not.toHaveBeenCalled();
});

it('locks both actions synchronously across status, notice and assent; only an explicit agreement accepts', async () => {
  const status = deferred<Result>(), assent = deferred<Result>();
  mockRpc.mockImplementation((name: string) => name === 'get_participation_notice_status' ? status.promise : name === 'record_participation_assent' ? assent.promise : Promise.resolve({ data: null }));
  const f = mount(); f.accept(); f.decline(); f.accept(); await flush();
  expect(f.current.acceptExceptionMutation.isPending).toBe(true); expect(writes()).toHaveLength(0);
  await act(async () => status.resolve({ data: { needs_assent: true } }));
  expect(f.onNotice).toHaveBeenCalledTimes(1); f.decline(); f.accept(); await flush(); expect(writes()).toHaveLength(0);
  const guard = f.guard(); let first!: Promise<boolean>, second!: Promise<boolean>;
  act(() => { first = f.current.agree(guard); second = f.current.agree(guard); }); await flush();
  expect(await second).toBe(false); expect(records()).toHaveLength(1);
  expect(f.current.cancelNotice(guard)).toBe(false);
  await act(async () => assent.resolve({ data: null, error: null })); expect(await first).toBe(true);
  expect(records()).toEqual([['record_participation_assent', {
    p_listing_type: 'plan', p_listing_id: 'plan-a', p_organizer_user_id: 'creator-a', p_organizer_name: 'Amelia', p_action: 'join',
  }]]);
  expect(f.onNoticeComplete).toHaveBeenCalledWith(guard); expect(writes()).toHaveLength(1); expect(f.onAccepted).toHaveBeenCalledTimes(1);
});

it('captures the creator evidence shown when the exception notice opened', async () => {
  mockRpc.mockImplementation(async name => ({ data: name === 'get_participation_notice_status' ? { needs_assent: true } : null }));
  const f = mount(); f.accept(); await flush(); const guard = f.guard();
  f.update({ organizerUserId: 'later-creator', organizerName: 'Later name' });
  await act(async () => { await f.current.agree(guard); });
  expect(records()[0][1]).toMatchObject({ p_organizer_user_id: 'creator-a', p_organizer_name: 'Amelia' });
});

it('cancelled notice guards cannot agree or dismiss the next notice in the same focused visit', async () => {
  mockRpc.mockImplementation(async name => ({ data: name === 'get_participation_notice_status' ? { needs_assent: true } : null }));
  const f = mount(); f.accept(); await flush(); const first = f.guard();
  act(() => { expect(f.current.cancelNotice(first)).toBe(true); }); expect(first()).toBe(false);
  f.accept(); await flush(); const second = f.guard(); expect(second).not.toBe(first);
  await act(async () => { expect(await f.current.agree(first)).toBe(false); expect(f.current.cancelNotice(first)).toBe(false); });
  expect(records()).toHaveLength(0); expect(second()).toBe(true);
  await act(async () => { await f.current.agree(second); }); expect(writes()).toHaveLength(1);
});

it.each(['returned', 'thrown'])('a failed assent (%s) keeps the same notice retryable and never accepts', async kind => {
  let calls = 0;
  mockRpc.mockImplementation(async name => {
    if (name === 'get_participation_notice_status') return { data: { needs_assent: true } };
    if (name === 'record_participation_assent' && calls++ === 0) {
      if (kind === 'thrown') throw new Error('offline');
      return { error: { message: 'denied' } };
    }
    return { data: null, error: null };
  });
  const f = mount(); f.accept(); await flush(); const guard = f.guard();
  await act(async () => { expect(await f.current.agree(guard)).toBe(false); });
  expect(writes()).toHaveLength(0); expect(f.onNoticeComplete).not.toHaveBeenCalled(); expect(f.onError).not.toHaveBeenCalled();
  await act(async () => { expect(await f.current.agree(guard)).toBe(true); }); expect(writes()).toHaveLength(1);
});

it.each(['PGRST202', '42883'])('preserves dormant missing status RPC compatibility for %s', async code => {
  mockRpc.mockImplementation(async name => name === 'get_participation_notice_status' ? { error: { code } } : { data: null, error: null });
  const f = mount(); f.accept(); await flush(); expect(f.onNotice).not.toHaveBeenCalled(); expect(writes()).toHaveLength(1);
});

it('other status RPC failures retain the authoritative notice-first behavior', async () => {
  mockRpc.mockResolvedValue({ error: { code: '42501' } }); const f = mount(); f.accept(); await flush();
  expect(f.onNotice).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(0);
});

it.each(['accept', 'decline'] as const)('%s stops at mismatched current-user preflight and remains retryable', async kind => {
  mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'bob' } }, error: null });
  const f = mount(); f[kind](); await flush(); expect(mockRpc).not.toHaveBeenCalled(); expect(f.onError).toHaveBeenCalledTimes(1);
  f[kind](); await flush(); expect(writes()).toHaveLength(1);
});

it.each(['auth', 'status'])('a thrown %s preflight surfaces a current failure and releases the lock', async stage => {
  if (stage === 'auth') mockGetUser.mockRejectedValueOnce(new Error('offline'));
  else mockRpc.mockRejectedValueOnce(new Error('offline'));
  const f = mount(); f.accept(); await flush(); expect(writes()).toHaveLength(0); expect(f.onError).toHaveBeenCalledTimes(1);
  f.accept(); await flush(); expect(writes()).toHaveLength(1);
});

it('checks the account again between delayed status and accept dispatch', async () => {
  const status = deferred<Result>(); mockRpc.mockReturnValue(status.promise);
  const f = mount(); f.accept(); await flush(); mockAccount = 'bob';
  await act(async () => status.resolve({ data: { needs_assent: false } }));
  expect(writes()).toHaveLength(0); expect(f.onAccepted).not.toHaveBeenCalled(); expect(f.onError).toHaveBeenCalledTimes(1);
});

it('checks the account again after recorded assent before acceptance', async () => {
  const assent = deferred<Result>();
  mockRpc.mockImplementation(name => name === 'get_participation_notice_status' ? Promise.resolve({ data: { needs_assent: true } }) : assent.promise);
  const f = mount(); f.accept(); await flush(); let agreement!: Promise<boolean>;
  act(() => { agreement = f.current.agree(f.guard()); }); await flush(); mockAccount = 'bob';
  await act(async () => assent.resolve({ data: null, error: null })); expect(await agreement).toBe(false);
  expect(writes()).toHaveLength(0); expect(f.onAccepted).not.toHaveBeenCalled();
  expect(f.onError).toHaveBeenCalledTimes(1); expect(f.current.acceptExceptionMutation.isPending).toBe(false);
});

it.each(['account', 'ABA', 'target', 'blur', 'unmount'])('retires delayed auth before any RPC after %s', async reason => {
  const auth = deferred<unknown>(); mockGetUser.mockReturnValue(auth.promise);
  const f = mount(); const oldAccept = f.current.requestAccept, oldDecline = f.current.declineExceptionMutation.mutate;
  f.accept(); await flush();
  if (reason === 'account') { mockAccount = 'bob'; mockEpoch++; f.update(); }
  if (reason === 'ABA') { mockEpoch += 2; f.update(); }
  if (reason === 'target') f.update({ eventId: 'plan-b' });
  if (reason === 'blur') act(() => mockBlur?.());
  if (reason === 'unmount') f.unmount();
  act(() => { void oldAccept(); oldDecline(); });
  await act(async () => auth.resolve({ data: { user: { id: 'alice' } }, error: null }));
  expect(mockRpc).not.toHaveBeenCalled(); expect(f.onNotice).not.toHaveBeenCalled(); expect(f.onError).not.toHaveBeenCalled();
});

it.each(['status', 'assent'])('retires %s completion after blur and refocus', async stage => {
  const result = deferred<Result>();
  mockRpc.mockImplementation(name => name === 'get_participation_notice_status' ? stage === 'status' ? result.promise : Promise.resolve({ data: { needs_assent: true } }) : result.promise);
  const f = mount(); f.accept(); await flush();
  if (stage === 'assent') { act(() => { void f.current.agree(f.guard()); }); await flush(); }
  act(() => { mockBlur?.(); mockBlur = mockFocus?.() || undefined; });
  await act(async () => result.resolve({ data: stage === 'status' ? { needs_assent: false } : null, error: null }));
  expect(writes()).toHaveLength(0); expect(f.onAccepted).not.toHaveBeenCalled(); expect(f.onError).not.toHaveBeenCalled();
  expect(f.current.acceptExceptionMutation.isPending).toBe(false);
});

it.each(['accept', 'decline'] as const)('a dispatched %s completing after blur cannot update notifications or navigate, and remains locked while pending', async kind => {
  const receipt = deferred<Result>();
  mockRpc.mockImplementation(name => name === 'get_participation_notice_status' ? Promise.resolve({ data: { needs_assent: false } }) : receipt.promise);
  const f = mount(); f[kind](); await flush(); expect(writes()).toHaveLength(1);
  act(() => { mockBlur?.(); mockBlur = mockFocus?.() || undefined; });
  f.accept(); f.decline(); await flush(); expect(writes()).toHaveLength(1);
  await act(async () => receipt.resolve({ data: null, error: null }));
  expect(mockUpdate).not.toHaveBeenCalled(); expect(f.onAccepted).not.toHaveBeenCalled(); expect(f.onDeclined).not.toHaveBeenCalled(); expect(f.onError).not.toHaveBeenCalled();
});

it('does not let a late account A result invoke account B callbacks', async () => {
  const receipt = deferred<Result>();
  mockRpc.mockImplementation(name => name === 'get_participation_notice_status' ? Promise.resolve({ data: { needs_assent: false } }) : receipt.promise);
  const f = mount(); f.accept(); await flush(); mockAccount = 'bob'; mockEpoch++; f.update();
  expect(f.current.acceptExceptionMutation.isPending).toBe(false);
  await act(async () => receipt.resolve({ data: null, error: null }));
  expect(f.onAccepted).not.toHaveBeenCalled(); expect(mockUpdate).not.toHaveBeenCalled();
});

it('notification cleanup failure cannot turn confirmed acceptance into a failed retry', async () => {
  mockUpdate.mockRejectedValueOnce(new Error('offline')); const f = mount(); f.accept(); await flush();
  expect(f.onAccepted).toHaveBeenCalledTimes(1); expect(f.onError).not.toHaveBeenCalled(); f.accept(); await flush(); expect(writes()).toHaveLength(1);
});

it('notification account preflight rejects a replacement account without false current success', async () => {
  let authCount = 0;
  mockGetUser.mockImplementation(async () => ({ data: { user: { id: ++authCount < 3 ? 'alice' : 'bob' } }, error: null }));
  const f = mount(); f.accept(); await flush(); expect(writes()).toHaveLength(1);
  expect(mockUpdate).not.toHaveBeenCalled(); expect(f.onAccepted).not.toHaveBeenCalled();
});

it('retiring while notification cleanup runs prevents current feedback', async () => {
  const notification = deferred<Result>(); mockUpdate.mockReturnValue(notification.promise);
  const f = mount(); f.accept(); await flush(); act(() => mockBlur?.());
  await act(async () => notification.resolve({ error: null })); expect(f.onAccepted).not.toHaveBeenCalled(); expect(f.onError).not.toHaveBeenCalled();
});

it.each([{ available: false }, { viewerId: null }, { eventId: '' }])('does not begin from an unavailable entry: %p', options => {
  const f = mount(options); f.accept(); f.decline(); expect(mockGetUser).not.toHaveBeenCalled();
});

it('retained accept/decline callbacks cannot act in a later focused visit', async () => {
  const f = mount(), accept = f.current.requestAccept, decline = f.current.declineExceptionMutation.mutate;
  act(() => { mockBlur?.(); mockBlur = mockFocus?.() || undefined; });
  act(() => { void accept(); decline(); }); await flush(); expect(mockGetUser).not.toHaveBeenCalled();
  f.accept(); await flush(); expect(writes()).toHaveLength(1);
});

it('the shared ordinary-notice assent helper rejects a replaced notice before recording', async () => {
  const auth = deferred<unknown>(); mockGetUser.mockReturnValue(auth.promise); let current = true;
  const work = recordScopedPlanAssent({ listingType: 'plan', listingId: 'plan-a', organizerUserId: 'creator-a', organizerName: 'Amelia', action: 'join' },
    { viewerId: 'alice', isCurrent: () => current });
  const check = expect(work).rejects.toBeInstanceOf(Error); current = false;
  auth.resolve({ data: { user: { id: 'alice' } }, error: null }); await check;
  expect(records()).toHaveLength(0);
});

it('the shared ordinary-notice helper rejects a late recorded response instead of authorizing a join', async () => {
  const result = deferred<Result>(); mockRpc.mockReturnValue(result.promise); let current = true;
  const work = recordScopedPlanAssent({ listingType: 'plan', listingId: 'plan-a', organizerUserId: null, organizerName: 'Someone', action: 'join' },
    { viewerId: 'alice', isCurrent: () => current });
  const check = expect(work).rejects.toBeInstanceOf(Error); await flush(); current = false; result.resolve({ data: null, error: null }); await check;
  expect(records()).toHaveLength(1);
});

it('waits for the optional native notice dismissal before dispatching exception acceptance', async () => {
  mockRpc.mockImplementation(async name => ({ data: name === 'get_participation_notice_status' ? { needs_assent: true } : null, error: null }));
  const dismissal = deferred<void>(), f = mount({ onNoticeComplete: () => dismissal.promise });
  f.accept(); await flush(); let agreement!: Promise<boolean>;
  act(() => { agreement = f.current.agree(f.guard()); }); await flush();
  expect(records()).toHaveLength(1); expect(writes()).toHaveLength(0); expect(f.current.acceptExceptionMutation.isPending).toBe(true);
  await act(async () => dismissal.resolve()); expect(await agreement).toBe(true); expect(writes()).toHaveLength(1);
});

it('a retired exception cannot dispatch after its notice finally dismisses', async () => {
  mockRpc.mockImplementation(async name => ({ data: name === 'get_participation_notice_status' ? { needs_assent: true } : null, error: null }));
  const dismissal = deferred<void>(), f = mount({ onNoticeComplete: () => dismissal.promise });
  f.accept(); await flush(); let agreement!: Promise<boolean>;
  act(() => { agreement = f.current.agree(f.guard()); }); await flush(); act(() => mockBlur?.());
  await act(async () => dismissal.resolve()); expect(await agreement).toBe(false); expect(writes()).toHaveLength(0); expect(f.onError).not.toHaveBeenCalled();
});
