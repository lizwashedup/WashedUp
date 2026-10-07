import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

let mockLocal = false;
let mockPlatform = 'ios';
const mockInitialize = jest.fn(), mockLogin = jest.fn(), mockLogout = jest.fn();
const mockGetId = jest.fn(), mockOptedIn = jest.fn(), mockPermission = jest.fn(), mockPrompt = jest.fn();
const mockOptIn = jest.fn(), mockOptOut = jest.fn();
const mockNativePermission = jest.fn(), mockCanRequest = jest.fn(), mockProvisional = jest.fn();
const mockNativeStatuses = { NotDetermined: 0, Denied: 1, Authorized: 2, Provisional: 3, Ephemeral: 4 } as const;
let mockCachedPermission = false;
const mockUpsert = jest.fn(), mockAdd = jest.fn(), mockRemove = jest.fn(), mockAuthUnsubscribe = jest.fn();
const mockClaim = jest.fn(), mockPermissionAdd = jest.fn(), mockPermissionRemove = jest.fn();
const mockUserAdd = jest.fn(), mockUserRemove = jest.fn(), mockAppStateAdd = jest.fn();
const mockTelemetry = jest.fn();
const mockAuthListeners = new Set<(...args: any[]) => void>();
const mockOnAuth = jest.fn((callback: (...args: any[]) => void) => {
  mockAuthListeners.add(callback);
  return { data: { subscription: { unsubscribe: () => { mockAuthListeners.delete(callback); mockAuthUnsubscribe(); } } } };
});
jest.mock('react-native', () => ({
  Platform: { get OS() { return mockPlatform; } },
  AppState: { addEventListener: (...args: any[]) => mockAppStateAdd(...args) },
}));
jest.mock('react-native-css-interop', () => ({ createInteropElement: (...args: any[]) => require('react').createElement(...args) }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { oneSignalAppId: 'fixture-only-app-id' } } } }));
jest.mock('../../constants/LocalDevelopment', () => ({ get LOCAL_DEVELOPMENT_ONLY() { return mockLocal; } }));
jest.mock('../../lib/pushRegistrationTelemetry', () => ({
  recordPushRegistrationState: (...args: any[]) => mockTelemetry(...args),
}));
jest.mock('../../lib/oneSignalShim', () => ({
  OneSignal: {
    initialize: (...args: any[]) => mockInitialize(...args), login: (...args: any[]) => mockLogin(...args), logout: () => mockLogout(),
    User: {
      addEventListener: (...args: any[]) => mockUserAdd(...args),
      removeEventListener: (...args: any[]) => mockUserRemove(...args),
      pushSubscription: {
      getIdAsync: () => mockGetId(), getOptedInAsync: () => mockOptedIn(),
      optIn: () => mockOptIn(), optOut: () => mockOptOut(),
      addEventListener: (...args: any[]) => mockAdd(...args), removeEventListener: (...args: any[]) => mockRemove(...args),
    } },
    Notifications: {
      // Deliberately stale, matching installed SDK's initial cached value.
      hasPermission: () => mockCachedPermission, getPermissionAsync: () => mockPermission(),
      requestPermission: (...args: any[]) => mockPrompt(...args), permissionNative: () => mockNativePermission(), canRequestPermission: () => mockCanRequest(),
      registerForProvisionalAuthorization: (...args: any[]) => mockProvisional(...args),
      addEventListener: (...args: any[]) => mockPermissionAdd(...args),
      removeEventListener: (...args: any[]) => mockPermissionRemove(...args),
    },
  },
  OSNotificationPermission: mockNativeStatuses,
}));
jest.mock('../../lib/supabase', () => ({ supabase: {
  auth: { onAuthStateChange: (...args: any[]) => mockOnAuth(...args as [any]) },
  from: (table: string) => { if (table !== 'device_tokens') throw new Error('Unexpected table'); return { upsert: (...args: any[]) => mockUpsert(...args) }; },
  functions: { invoke: (...args: any[]) => mockClaim(...args) },
} }));

type PushModule = typeof import('../usePushNotifications');
let api: PushModule, tree: ReactTestRenderer | undefined;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function settle() { await act(async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); jest.advanceTimersByTime(1); for (let i = 0; i < 16; i++) await Promise.resolve(); }); }
function Harness({ id, resolved = true }: { id: string | null; resolved?: boolean }) {
  (api.usePushNotifications as any)(id, { identityResolved: resolved }); return null;
}
async function render(id: string | null, resolved = true) {
  await act(async () => { const node = React.createElement(Harness, { id, resolved }); tree ? tree.update(node) : tree = create(node); });
  await settle();
}
function emit(id: string | null) { for (const callback of mockAuthListeners) callback(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null); }
function subscription(index = 0) { return mockAdd.mock.calls[index][1] as (event: any) => void; }
const changed = (id = 'device-one') => ({ current: { id, optedIn: true } });

beforeEach(() => {
  jest.resetModules(); jest.doMock('react', () => React); jest.clearAllMocks(); jest.useFakeTimers();
  mockLocal = false; mockPlatform = 'ios'; mockCachedPermission = false; mockAuthListeners.clear(); tree = undefined;
  mockInitialize.mockImplementation(() => {}); mockLogin.mockImplementation(() => {}); mockLogout.mockImplementation(() => {});
  mockGetId.mockResolvedValue('device-one'); mockOptedIn.mockResolvedValue(true); mockPermission.mockResolvedValue(true);
  mockNativePermission.mockResolvedValue(mockNativeStatuses.Authorized); mockCanRequest.mockResolvedValue(true);
  mockProvisional.mockImplementation((done: (accepted: boolean) => void) => done(true));
  mockPrompt.mockResolvedValue(true); mockUpsert.mockResolvedValue({ error: null });
  mockClaim.mockResolvedValue({ data: { status: 'claimed' }, error: null });
  mockAppStateAdd.mockReturnValue({ remove: jest.fn() });
  api = require('../usePushNotifications');
});
afterEach(async () => { await act(async () => tree?.unmount()); jest.clearAllTimers(); jest.useRealTimers(); });

it('waits for resolved identity, then unlinks the SDK on a confirmed signed-out startup', async () => {
  await render(null, false); expect(mockInitialize).not.toHaveBeenCalled(); expect(mockLogout).not.toHaveBeenCalled();
  await render(null, true); expect(mockLogout).toHaveBeenCalledTimes(1); expect(mockLogin).not.toHaveBeenCalled(); expect(mockPrompt).not.toHaveBeenCalled();
});

it('unlinks account A on sign-out without requesting or revoking permission', async () => {
  await render('alice'); await render(null);
  expect(mockLogin).toHaveBeenCalledWith('alice'); expect(mockLogout).toHaveBeenCalledTimes(1); expect(mockPrompt).not.toHaveBeenCalled();
});

it('retains the current payload and conflict key for an opted-in identified subscription', async () => {
  await render('alice');
  expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'alice', platform: 'ios', onesignal_player_id: 'device-one', last_seen_at: expect.any(String) }), { onConflict: 'onesignal_player_id' });
  expect(mockPrompt).not.toHaveBeenCalled();
});

it('silently requests provisional authorization for an unasked iOS account', async () => {
  mockNativePermission.mockResolvedValue(mockNativeStatuses.NotDetermined);
  await render('alice');
  expect(mockProvisional).toHaveBeenCalledTimes(1);
  expect(mockPrompt).not.toHaveBeenCalled();
});

it('does not claim provisional permission when the native SDK rejects it', async () => {
  mockNativePermission.mockResolvedValue(mockNativeStatuses.NotDetermined);
  mockProvisional.mockImplementation((done: (accepted: boolean) => void) => done(false));
  await render('alice');
  expect(mockTelemetry).toHaveBeenCalledWith(
    'alice', 'failed', 'not_determined', 'provisional_not_granted',
  );
  expect(mockTelemetry).not.toHaveBeenCalledWith('alice', 'provisional_granted', 'provisional');
});

it('never requests provisional authorization on Android', async () => {
  mockPlatform = 'android'; mockPermission.mockResolvedValue(false);
  await render('alice');
  expect(mockProvisional).not.toHaveBeenCalled();
});

it('retires a queued subscription callback through A → B → A and unmount', async () => {
  await render('alice'); const old = subscription(); await render('bob'); await render('alice'); mockUpsert.mockClear();
  await act(async () => old(changed())); expect(mockUpsert).not.toHaveBeenCalled();
  const latest = subscription(mockAdd.mock.calls.length - 1); await act(async () => tree!.unmount()); tree = undefined;
  await act(async () => latest(changed())); expect(mockUpsert).not.toHaveBeenCalled();
});

it('retires old work synchronously on an auth event before root props rerender', async () => {
  await render('alice'); const old = subscription(); mockUpsert.mockClear();
  act(() => { emit('bob'); old(changed()); }); await settle();
  expect(mockUpsert).not.toHaveBeenCalled();
  expect(await api.registerForPushNotifications({ prompt: true, userId: 'alice' })).toBeNull(); expect(mockPrompt).not.toHaveBeenCalled();
});

it('recovers a fresh A binding after auth-only A → B → A while the old A callback stays retired', async () => {
  await render('alice'); const old = subscription();
  act(() => { emit('bob'); emit('alice'); }); await render('alice'); mockUpsert.mockClear();
  await act(async () => old(changed())); expect(mockUpsert).not.toHaveBeenCalled();
  expect(await api.registerForPushNotifications({ prompt: false, userId: 'alice' })).toBe('device-one');
});

it('does not register when a late initial subscription read belongs to the previous account', async () => {
  const pending = deferred<string>(); mockGetId.mockReturnValueOnce(pending.promise);
  await render('alice'); await render('bob'); mockUpsert.mockClear();
  await act(async () => { pending.resolve('old-device'); }); await settle(); expect(mockUpsert).not.toHaveBeenCalled();
});

it('uses native permission instead of the SDK cached false value on passive registration', async () => {
  await render('alice'); mockUpsert.mockClear();
  expect(await api.registerForPushNotifications({ prompt: false, userId: 'alice' })).toBe('device-one');
  expect(mockPermission).toHaveBeenCalled(); expect(mockPrompt).not.toHaveBeenCalled(); expect(mockUpsert).toHaveBeenCalledTimes(1);
});

it('does not request a prompt during passive registration when permission is absent', async () => {
  await render('alice'); mockPermission.mockResolvedValue(false); mockUpsert.mockClear();
  expect(await api.registerForPushNotifications({ prompt: false, userId: 'alice' })).toBeNull(); expect(mockPrompt).not.toHaveBeenCalled(); expect(mockUpsert).not.toHaveBeenCalled();
});

it('does not enable or report an opted-out subscription as registered', async () => {
  mockOptedIn.mockResolvedValue(false); await render('alice');
  expect(mockUpsert).not.toHaveBeenCalled();
  expect(await api.registerForPushNotifications({ prompt: false, userId: 'alice' })).toBeNull(); expect(mockPrompt).not.toHaveBeenCalled();
});

it('shares one in-flight explicit permission request and registration for double taps', async () => {
  await render('alice'); mockPermission.mockResolvedValue(false); const pending = deferred<boolean>(); mockPrompt.mockReturnValue(pending.promise); mockUpsert.mockClear();
  const first = api.registerForPushNotifications({ prompt: true, userId: 'alice' });
  const second = api.registerForPushNotifications({ prompt: true, userId: 'alice' }); await settle(); expect(mockPrompt).toHaveBeenCalledTimes(1);
  pending.resolve(true); expect(await first).toBe('device-one'); expect(await second).toBe('device-one'); expect(mockUpsert).toHaveBeenCalledTimes(1);
});

it('uses a deliberate CTA to upgrade provisional iOS permission', async () => {
  await render('alice'); mockUpsert.mockClear(); mockPrompt.mockClear();
  mockNativePermission.mockResolvedValue(mockNativeStatuses.Provisional);
  mockPermission.mockResolvedValue(true);
  expect(await api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice' }))
    .toEqual({ status: 'registered', subscriptionId: 'device-one' });
  expect(mockPrompt).toHaveBeenCalledWith(true);
  expect(mockUpsert).toHaveBeenCalledTimes(1);
});

it.each(['permission', 'native', 'requestability', 'opted-in', 'subscription', 'token'] as const)('releases stalled %s registration into an explicit retry without accepting its late result', async stage => {
  await render('alice'); mockUpsert.mockClear();
  const pending = deferred<any>();
  const read = stage === 'permission' ? mockPermission : stage === 'native' ? mockNativePermission : stage === 'requestability' ? mockCanRequest : stage === 'opted-in' ? mockOptedIn : stage === 'subscription' ? mockGetId : mockUpsert;
  if (stage === 'native' || stage === 'requestability') mockPermission.mockResolvedValue(false);
  if (stage === 'requestability') mockPlatform = 'android';
  read.mockReturnValueOnce(pending.promise);
  const first = api.registerPushNotificationsWithResult({ prompt: false, userId: 'alice' }); await settle();
  await act(async () => { await jest.advanceTimersByTimeAsync(12_000); });
  expect(await first).toEqual({ status: 'failed' });
  expect(mockPrompt).not.toHaveBeenCalled();
  mockPermission.mockResolvedValue(true);
  expect(await api.registerPushNotificationsWithResult({ prompt: false, userId: 'alice' })).toEqual({ status: 'registered', subscriptionId: 'device-one' });
  const writes = mockUpsert.mock.calls.length;
  pending.resolve(stage === 'token' ? { error: null } : stage === 'subscription' ? 'old-device' : true); await settle();
  expect(mockUpsert).toHaveBeenCalledTimes(writes);
});

it('does not time out the person’s native permission decision', async () => {
  await render('alice'); mockPermission.mockResolvedValue(false);
  const pending = deferred<boolean>(); mockPrompt.mockReturnValueOnce(pending.promise);
  let settled = false;
  const work = api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice' }).then(result => { settled = true; return result; });
  await settle(); await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
  expect(settled).toBe(false); expect(mockPrompt).toHaveBeenCalledTimes(1);
  pending.resolve(true); await settle();
  expect(await work).toEqual({ status: 'registered', subscriptionId: 'device-one' });
});

it.each(['permission', 'subscription'] as const)('drops manual registration after switching accounts during %s', async stage => {
  await render('alice'); const pending = deferred<any>();
  if (stage === 'permission') { mockPermission.mockResolvedValue(false); mockPrompt.mockReturnValueOnce(pending.promise); }
  else mockGetId.mockReturnValueOnce(pending.promise);
  const work = api.registerForPushNotifications({ prompt: true, userId: 'alice' }); await settle(); await render('bob'); mockUpsert.mockClear();
  pending.resolve(stage === 'permission' ? true : 'late-device'); expect(await work).toBeNull(); expect(mockUpsert).not.toHaveBeenCalled();
});

it('returns null when both the owner write and verified ownership claim fail', async () => {
  mockCachedPermission = true; await render('alice'); mockUpsert.mockClear(); mockUpsert.mockResolvedValue({ error: { message: 'rejected' } });
  mockClaim.mockResolvedValue({ data: { status: 'identity-pending' }, error: null });
  expect(await api.registerForPushNotifications({ prompt: false, userId: 'alice' })).toBeNull();
  expect(mockUpsert).toHaveBeenCalledTimes(1); expect(mockClaim).toHaveBeenCalledTimes(1);
});

it('repairs an account-switch ownership conflict through the authenticated claim function', async () => {
  await render('alice'); mockUpsert.mockClear(); mockUpsert.mockResolvedValue({ error: { message: 'conflict', code: '23505' } });
  expect(await api.registerForPushNotifications({ prompt: false, userId: 'alice' })).toBe('device-one');
  expect(mockClaim).toHaveBeenCalledWith('claim-push-subscription', {
    body: { subscriptionId: 'device-one', platform: 'ios' },
  });
});

it('does not register when native login throws', async () => {
  mockLogin.mockImplementation(() => { throw new Error('bridge unavailable'); }); await render('alice'); expect(mockUpsert).not.toHaveBeenCalled();
});

it.each(['local', 'web'] as const)('%s gate prevents SDK, permission and database calls', async mode => {
  mockLocal = mode === 'local'; mockPlatform = mode === 'web' ? 'web' : 'ios'; await render('alice');
  expect(await api.registerForPushNotifications({ prompt: true, userId: 'alice' })).toBeNull();
  expect(mockInitialize).not.toHaveBeenCalled(); expect(mockLogin).not.toHaveBeenCalled(); expect(mockPrompt).not.toHaveBeenCalled(); expect(mockUpsert).not.toHaveBeenCalled(); expect(mockOnAuth).not.toHaveBeenCalled();
});

it('does not let an initial opted-in snapshot overwrite a newer opt-out event', async () => {
  const initial = deferred<boolean>(); mockOptedIn.mockReturnValueOnce(initial.promise); await render('alice');
  await act(async () => subscription()({ current: { id: 'device-one', optedIn: false } }));
  initial.resolve(true); await settle(); expect(mockUpsert).not.toHaveBeenCalled();
});

it('does not register from a subscription ID read that completes after an opt-out', async () => {
  await render('alice'); const pending = deferred<string>(); mockGetId.mockReturnValueOnce(pending.promise); mockUpsert.mockClear();
  const work = api.registerForPushNotifications({ prompt: false, userId: 'alice' }); await settle();
  act(() => subscription()({ current: { id: 'device-one', optedIn: false } })); pending.resolve('device-one');
  expect(await work).toBeNull(); expect(mockUpsert).not.toHaveBeenCalled();
});

it('serializes duplicate subscription callbacks while their write is pending', async () => {
  await render('alice'); const write = deferred<any>(); mockUpsert.mockReturnValue(write.promise); mockUpsert.mockClear();
  const callback = subscription(); act(() => { callback(changed()); callback(changed()); }); await settle();
  expect(mockUpsert).toHaveBeenCalledTimes(1); write.resolve({ error: null }); await settle();
});

it('reconciles a changed subscription when native permission changes', async () => {
  await render('alice'); mockUpsert.mockClear(); mockGetId.mockResolvedValue('device-after-permission');
  const observer = mockPermissionAdd.mock.calls.find(call => call[0] === 'permissionChange')?.[1];
  expect(observer).toEqual(expect.any(Function));
  await act(async () => { observer(true); await Promise.resolve(); }); await settle();
  expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
    user_id: 'alice', onesignal_player_id: 'device-after-permission',
  }), expect.anything());
});

it('reconciles after returning from device Settings without opening a prompt', async () => {
  await render('alice'); mockUpsert.mockClear(); mockPrompt.mockClear(); mockGetId.mockResolvedValue('device-after-settings');
  const observer = mockAppStateAdd.mock.calls.at(-1)?.[1];
  expect(observer).toEqual(expect.any(Function));
  await act(async () => { observer('active'); await Promise.resolve(); }); await settle();
  expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
    user_id: 'alice', onesignal_player_id: 'device-after-settings',
  }), expect.anything());
  expect(mockPrompt).not.toHaveBeenCalled();
});

it('does not register during foreground reconciliation when OS permission is off', async () => {
  await render('alice'); mockUpsert.mockClear(); mockPermission.mockResolvedValue(false);
  const observer = mockAppStateAdd.mock.calls.at(-1)?.[1];
  await act(async () => { observer('active'); await Promise.resolve(); }); await settle();
  expect(mockUpsert).not.toHaveBeenCalled();
});

it('returns null after an already-dispatched manual write loses its account', async () => {
  await render('alice'); const write = deferred<any>(); mockUpsert.mockReturnValueOnce(write.promise); mockUpsert.mockClear();
  const work = api.registerForPushNotifications({ prompt: false, userId: 'alice' }); await settle(); expect(mockUpsert).toHaveBeenCalledTimes(1);
  await render(null); write.resolve({ error: null }); expect(await work).toBeNull();
});

it('retires permission work before it can open an OS prompt', async () => {
  await render('alice'); const permission = deferred<boolean>(); mockPermission.mockReturnValueOnce(permission.promise);
  const work = api.registerForPushNotifications({ prompt: true, userId: 'alice' }); await settle();
  act(() => emit(null)); permission.resolve(false); expect(await work).toBeNull(); expect(mockPrompt).not.toHaveBeenCalled();
});

it('shares an already-open permission prompt across an account change without registering A', async () => {
  await render('alice'); mockPermission.mockResolvedValue(false); const permission = deferred<boolean>(); mockPrompt.mockReturnValue(permission.promise);
  const old = api.registerForPushNotifications({ prompt: true, userId: 'alice' }); await settle(); await render('bob'); mockUpsert.mockClear();
  const next = api.registerForPushNotifications({ prompt: true, userId: 'bob' }); await settle(); expect(mockPrompt).toHaveBeenCalledTimes(1);
  permission.resolve(true); expect(await old).toBeNull(); expect(await next).toBe('device-one');
  expect(mockUpsert).toHaveBeenCalledTimes(1); expect(mockUpsert.mock.calls[0][0].user_id).toBe('bob');
});

it('allows a later caller to retry a thrown initializer without a background loop', async () => {
  mockInitialize.mockImplementationOnce(() => { throw new Error('not ready'); });
  expect(await api.ensureOneSignalReady()).toBe(false); await settle(); expect(mockInitialize).toHaveBeenCalledTimes(1);
  const next = api.ensureOneSignalReady(); const same = api.ensureOneSignalReady(); expect(next).toBe(same);
  await settle(); expect(await next).toBe(true); expect(mockInitialize).toHaveBeenCalledTimes(2);
});

it('does not apply queued sign-out after a replacement account has bound', async () => {
  await render('alice'); act(() => { emit(null); emit('bob'); }); await render('bob'); const logouts = mockLogout.mock.calls.length;
  await settle(); expect(mockLogin).toHaveBeenLastCalledWith('bob'); expect(mockLogout).toHaveBeenCalledTimes(logouts);
  expect(await api.registerForPushNotifications({ prompt: false, userId: 'bob' })).toBe('device-one');
});

describe('structured registration feedback', () => {
  it('waits for the subscription observer after accepted permission instead of using a fixed retry', async () => {
    await render('alice'); mockPermission.mockResolvedValue(false); mockGetId.mockResolvedValue(null); mockUpsert.mockClear(); mockGetId.mockClear();
    const work = api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice' }); await settle();
    expect(mockPrompt).toHaveBeenCalledWith(true); expect(mockGetId).toHaveBeenCalledTimes(1);
    await act(async () => subscription()(changed('ready-later'))); await settle();
    expect(await work).toEqual({ status: 'registered', subscriptionId: 'ready-later' });
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ onesignal_player_id: 'ready-later', user_id: 'alice' }), expect.anything());
    expect(mockPrompt).toHaveBeenCalledTimes(1);
  });

  it('reports pending when no subscription event or bridge ID arrives before the deadline', async () => {
    await render('alice'); mockPermission.mockResolvedValue(false); mockGetId.mockResolvedValue(null); mockUpsert.mockClear();
    const work = api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice' }); await settle();
    await act(async () => { await jest.advanceTimersByTimeAsync(6_000); });
    expect(await work).toEqual({ status: 'pending' });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it.each(['read', 'prompt', 'write'] as const)('reports %s failure as retryable failure, never denial', async stage => {
    await render('alice'); mockUpsert.mockClear();
    if (stage === 'read') mockPermission.mockRejectedValueOnce(new Error('bridge failed'));
    if (stage === 'prompt') { mockPermission.mockResolvedValue(false); mockPrompt.mockRejectedValueOnce(new Error('bridge failed')); }
    if (stage === 'write') {
      mockPermission.mockResolvedValue(false);
      mockUpsert.mockResolvedValueOnce({ error: { message: 'write rejected' } });
      mockClaim.mockResolvedValueOnce({ data: { status: 'identity-pending' }, error: null });
    }
    expect(await api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice' })).toEqual({ status: 'failed' });
    if (stage === 'read') expect(mockPrompt).not.toHaveBeenCalled();
    if (stage !== 'write') expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('reports denial only when the explicit native request actually returns false', async () => {
    await render('alice'); mockPermission.mockResolvedValue(false); mockPrompt.mockResolvedValue(false); mockUpsert.mockClear();
    expect(await api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice' })).toEqual({ status: 'permission-denied' });
    expect(mockPrompt).toHaveBeenCalledTimes(1); expect(mockUpsert).not.toHaveBeenCalled();
  });

  it.each([[mockNativeStatuses.NotDetermined, 'permission-required'], [mockNativeStatuses.Denied, 'permission-denied'], [null, 'failed']] as const)('classifies passive iOS status %s without requesting a prompt', async (native, status) => {
    await render('alice'); mockPermission.mockResolvedValue(false); mockNativePermission.mockResolvedValue(native); mockUpsert.mockClear();
    expect(await api.registerPushNotificationsWithResult({ prompt: false, userId: 'alice' })).toEqual({ status });
    expect(mockPrompt).not.toHaveBeenCalled(); expect(mockUpsert).not.toHaveBeenCalled();
  });

  it.each([true, false])('checks Android prompt availability (%s) before interpreting its coarse Denied enum', async canRequest => {
    mockPlatform = 'android'; await render('alice'); mockPermission.mockResolvedValue(false); mockNativePermission.mockResolvedValue(mockNativeStatuses.Denied); mockCanRequest.mockResolvedValue(canRequest);
    expect(await api.registerPushNotificationsWithResult({ prompt: false, userId: 'alice' })).toEqual({ status: canRequest ? 'permission-required' : 'permission-denied' });
    expect(mockCanRequest).toHaveBeenCalledTimes(1); expect(mockPrompt).not.toHaveBeenCalled();
  });

  it('reports the SDK inactive opt-in separately from OS permission denial', async () => {
    await render('alice'); mockOptedIn.mockResolvedValue(false); mockUpsert.mockClear();
    expect(await api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice' })).toEqual({ status: 'opted-out' });
    expect(mockPermission).toHaveBeenCalled(); expect(mockPrompt).not.toHaveBeenCalled(); expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('does not present a late inactive snapshot as current when a newer subscription event activated it', async () => {
    await render('alice'); const optedIn = deferred<boolean>(); mockOptedIn.mockReturnValueOnce(optedIn.promise);
    const work = api.registerPushNotificationsWithResult({ prompt: false, userId: 'alice' }); await settle();
    await act(async () => subscription()(changed())); optedIn.resolve(false);
    expect(await work).toEqual({ status: 'pending' }); expect(mockPrompt).not.toHaveBeenCalled();
  });

  it('reports an unavailable bridge ID response as failure rather than an ordinary not-ready ID', async () => {
    await render('alice'); mockGetId.mockResolvedValueOnce(undefined); mockUpsert.mockClear();
    expect(await api.registerPushNotificationsWithResult({ prompt: false, userId: 'alice' })).toEqual({ status: 'failed' });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('returns obsolete after a deferred token write completes under another account', async () => {
    await render('alice'); const write = deferred<any>(); mockUpsert.mockReturnValueOnce(write.promise);
    const work = api.registerPushNotificationsWithResult({ prompt: false, userId: 'alice' }); await settle(); await render('bob');
    write.resolve({ error: null }); expect(await work).toEqual({ status: 'obsolete' });
  });

  it('shares work between the structured API and its existing string-or-null wrapper', async () => {
    await render('alice'); mockPermission.mockResolvedValue(false); const grant = deferred<boolean>(); mockPrompt.mockReturnValueOnce(grant.promise); mockUpsert.mockClear();
    const result = api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice' });
    const legacy = api.registerForPushNotifications({ prompt: true, userId: 'alice' }); await settle(); grant.resolve(true);
    expect(await result).toEqual({ status: 'registered', subscriptionId: 'device-one' }); expect(await legacy).toBe('device-one');
    expect(mockPrompt).toHaveBeenCalledTimes(1); expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it('separates unavailable initialization context from a wrong-account action', async () => {
    await render(null, false);
    expect(await api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice' })).toEqual({ status: 'unavailable' });
    expect(mockInitialize).not.toHaveBeenCalled(); await render('alice');
    expect(await api.registerPushNotificationsWithResult({ prompt: true, userId: 'bob' })).toEqual({ status: 'obsolete' }); expect(mockPrompt).not.toHaveBeenCalled();
  });
});

describe('caller-owned prompt lifetime', () => {
  it('does not open a new prompt after its caller retires during initialization and binding', async () => {
    mockOptedIn.mockResolvedValue(false); mockPermission.mockResolvedValue(false);
    await act(async () => { tree = create(React.createElement(Harness, { id: 'alice' })); });
    let current = true;
    const work = api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice', canPrompt: () => current });
    expect(mockLogin).not.toHaveBeenCalled();
    current = false; await settle();
    expect(await work).toEqual({ status: 'obsolete' });
    expect(mockPrompt).not.toHaveBeenCalled(); expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('does not open a new prompt after its caller retires during the native permission read', async () => {
    await render('alice'); mockUpsert.mockClear();
    const permission = deferred<boolean>(); mockPermission.mockReturnValueOnce(permission.promise);
    let current = true;
    const work = api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice', canPrompt: () => current });
    await settle(); expect(mockPermission).toHaveBeenCalledTimes(1);
    current = false; permission.resolve(false);
    expect(await work).toEqual({ status: 'obsolete' });
    expect(mockPrompt).not.toHaveBeenCalled(); expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('honors a caller retirement queued after the permission read and before the OS request', async () => {
    await render('alice'); mockUpsert.mockClear();
    const permission = deferred<boolean>(); mockPermission.mockReturnValueOnce(permission.promise);
    let current = true;
    const work = api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice', canPrompt: () => current });
    await settle(); permission.resolve(false);
    await Promise.resolve().then(() => { current = false; });
    expect(await work).toEqual({ status: 'obsolete' });
    expect(mockPrompt).not.toHaveBeenCalled(); expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('keeps different guarded visits separate while sharing duplicate calls from the same visit', async () => {
    await render('alice'); mockUpsert.mockClear();
    const permission = deferred<boolean>(); mockPermission.mockReturnValue(permission.promise);
    let oldCurrent = true; const oldGuard = () => oldCurrent; const newGuard = () => true;
    const old = api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice', canPrompt: oldGuard });
    const oldDuplicate = api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice', canPrompt: oldGuard });
    const next = api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice', canPrompt: newGuard });
    expect(oldDuplicate).toBe(old); expect(next).not.toBe(old);
    await settle(); expect(mockPermission).toHaveBeenCalledTimes(2);
    oldCurrent = false; permission.resolve(false);
    expect(await old).toEqual({ status: 'obsolete' });
    expect(await next).toEqual({ status: 'registered', subscriptionId: 'device-one' });
    expect(mockPrompt).toHaveBeenCalledTimes(1); expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it('shares one native OS request across distinct current guarded callers', async () => {
    await render('alice'); mockPermission.mockResolvedValue(false); mockUpsert.mockClear();
    const permission = deferred<boolean>(); mockPrompt.mockReturnValue(permission.promise);
    const first = api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice', canPrompt: () => true });
    const second = api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice', canPrompt: () => true });
    expect(first).not.toBe(second); await settle(); expect(mockPrompt).toHaveBeenCalledTimes(1);
    permission.resolve(true);
    expect(await first).toEqual({ status: 'registered', subscriptionId: 'device-one' });
    expect(await second).toEqual({ status: 'registered', subscriptionId: 'device-one' });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it('does not let a cancelled guarded caller borrow an unguarded caller’s registration', async () => {
    await render('alice'); mockPermission.mockResolvedValue(false); mockUpsert.mockClear();
    const permission = deferred<boolean>(); mockPrompt.mockReturnValue(permission.promise);
    const active = api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice' });
    await settle(); expect(mockPrompt).toHaveBeenCalledTimes(1);
    const cancelled = api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice', canPrompt: () => false });
    expect(await cancelled).toEqual({ status: 'obsolete' });
    permission.resolve(true);
    expect(await active).toEqual({ status: 'registered', subscriptionId: 'device-one' });
    expect(mockPrompt).toHaveBeenCalledTimes(1); expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it('allows an already-open request to finish after its caller retires', async () => {
    await render('alice'); mockPermission.mockResolvedValue(false); mockUpsert.mockClear();
    const permission = deferred<boolean>(); mockPrompt.mockReturnValueOnce(permission.promise);
    let current = true; const canPrompt = jest.fn(() => current);
    const work = api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice', canPrompt });
    await settle(); expect(mockPrompt).toHaveBeenCalledTimes(1);
    current = false; permission.resolve(true);
    expect(await work).toEqual({ status: 'registered', subscriptionId: 'device-one' });
    expect(canPrompt).toHaveBeenCalledTimes(1); expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it('retains the account guard after a guarded OS request has opened', async () => {
    await render('alice'); mockPermission.mockResolvedValue(false);
    const permission = deferred<boolean>(); mockPrompt.mockReturnValueOnce(permission.promise);
    const work = api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice', canPrompt: () => true });
    await settle(); expect(mockPrompt).toHaveBeenCalledTimes(1);
    await render('bob'); mockUpsert.mockClear(); permission.resolve(true);
    expect(await work).toEqual({ status: 'obsolete' }); expect(mockUpsert).not.toHaveBeenCalled();
  });

  it.each([false, undefined, null, 'true', 1])('fails closed for non-true caller guard result %s', async allowed => {
    await render('alice'); mockPermission.mockResolvedValue(false); mockUpsert.mockClear();
    const canPrompt = jest.fn(() => allowed) as unknown as () => boolean;
    expect(await api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice', canPrompt })).toEqual({ status: 'obsolete' });
    expect(mockPrompt).not.toHaveBeenCalled(); expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('reports a throwing caller guard as failure without opening a prompt', async () => {
    await render('alice'); mockPermission.mockResolvedValue(false); mockUpsert.mockClear();
    const canPrompt = () => { throw new Error('visit unavailable'); };
    expect(await api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice', canPrompt })).toEqual({ status: 'failed' });
    expect(mockPrompt).not.toHaveBeenCalled(); expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('does not consult a prompt guard during passive registration or when permission is already granted', async () => {
    await render('alice'); const canPrompt = jest.fn(() => false);
    const passive = api.registerPushNotificationsWithResult({ prompt: false, userId: 'alice', canPrompt });
    const samePassive = api.registerPushNotificationsWithResult({ prompt: false, userId: 'alice' });
    expect(passive).toBe(samePassive);
    expect(await passive).toEqual({ status: 'registered', subscriptionId: 'device-one' });
    expect(await api.registerPushNotificationsWithResult({ prompt: true, userId: 'alice', canPrompt })).toEqual({ status: 'registered', subscriptionId: 'device-one' });
    mockPermission.mockResolvedValue(false); mockNativePermission.mockResolvedValue(mockNativeStatuses.NotDetermined);
    expect(await api.registerPushNotificationsWithResult({ prompt: false, userId: 'alice', canPrompt })).toEqual({ status: 'permission-required' });
    expect(canPrompt).not.toHaveBeenCalled(); expect(mockPrompt).not.toHaveBeenCalled();
  });
});

describe('read-only primer eligibility', () => {
  async function eligibility() {
    const work = api.getPushPrimerEligibility();
    await settle();
    return work;
  }

  afterEach(() => {
    for (const mutation of [mockPrompt, mockLogin, mockLogout, mockOptIn, mockOptOut, mockUpsert]) {
      expect(mutation).not.toHaveBeenCalled();
    }
    for (const subscriptionAccess of [mockOnAuth, mockAdd, mockRemove, mockGetId, mockOptedIn]) {
      expect(subscriptionAccess).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['unasked', mockNativeStatuses.NotDetermined, 'requestable'],
    ['denied', mockNativeStatuses.Denied, 'answered'],
    ['authorized', mockNativeStatuses.Authorized, 'answered'],
    ['provisional', mockNativeStatuses.Provisional, 'answered'],
    ['ephemeral', mockNativeStatuses.Ephemeral, 'answered'],
  ] as const)('classifies the iOS %s native status without registering an identity', async (_label, native, expected) => {
    mockNativePermission.mockResolvedValue(native);
    expect(await eligibility()).toBe(expected);
    expect(mockNativePermission).toHaveBeenCalledTimes(1);
    expect(mockPermission).not.toHaveBeenCalled();
    expect(mockCanRequest).not.toHaveBeenCalled();
  });

  it.each([undefined, null, false, true, '0', 'NotDetermined', 'not-determined', -1, 5, NaN])(
    'treats malformed or mismatched iOS enum response %s as unavailable', async native => {
      mockNativePermission.mockResolvedValue(native);
      expect(await eligibility()).toBe('unavailable');
    },
  );

  it('treats a thrown iOS permission read as unavailable', async () => {
    mockNativePermission.mockRejectedValueOnce(new Error('bridge unavailable'));
    expect(await eligibility()).toBe('unavailable');
  });

  it('treats granted Android permission as answered without reading prompt availability', async () => {
    mockPlatform = 'android'; mockCachedPermission = false;
    expect(await eligibility()).toBe('answered');
    expect(mockPermission).toHaveBeenCalledTimes(1);
    expect(mockCanRequest).not.toHaveBeenCalled();
    expect(mockNativePermission).not.toHaveBeenCalled();
  });

  it.each([true, false])('classifies Android requestability %s despite its coarse Denied enum', async canRequest => {
    mockPlatform = 'android'; mockPermission.mockResolvedValue(false);
    mockNativePermission.mockResolvedValue(mockNativeStatuses.Denied); mockCanRequest.mockResolvedValue(canRequest);
    expect(await eligibility()).toBe(canRequest ? 'requestable' : 'answered');
    expect(mockPermission).toHaveBeenCalledTimes(1);
    expect(mockCanRequest).toHaveBeenCalledTimes(1);
    expect(mockNativePermission).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 0, 1, 'false', 'true'])('treats non-boolean Android permission %s as unavailable', async permission => {
    mockPlatform = 'android'; mockPermission.mockResolvedValue(permission);
    expect(await eligibility()).toBe('unavailable');
    expect(mockCanRequest).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 0, 1, 'false', 'true'])('treats non-boolean Android requestability %s as unavailable', async canRequest => {
    mockPlatform = 'android'; mockPermission.mockResolvedValue(false); mockCanRequest.mockResolvedValue(canRequest);
    expect(await eligibility()).toBe('unavailable');
  });

  it.each(['permission', 'requestability'] as const)('treats a thrown Android %s read as unavailable', async stage => {
    mockPlatform = 'android'; mockPermission.mockResolvedValue(false);
    (stage === 'permission' ? mockPermission : mockCanRequest).mockRejectedValueOnce(new Error('bridge unavailable'));
    expect(await eligibility()).toBe('unavailable');
    if (stage === 'permission') expect(mockCanRequest).not.toHaveBeenCalled();
  });

  it.each(['local', 'web', 'windows'])('skips all SDK reads in %s mode', async mode => {
    mockLocal = mode === 'local'; mockPlatform = mode === 'local' ? 'ios' : mode;
    expect(await eligibility()).toBe('unavailable');
    expect(mockInitialize).not.toHaveBeenCalled();
    expect(mockPermission).not.toHaveBeenCalled();
    expect(mockNativePermission).not.toHaveBeenCalled();
    expect(mockCanRequest).not.toHaveBeenCalled();
  });

  it('waits for initialization to settle before reading the native permission', async () => {
    const work = api.getPushPrimerEligibility();
    await act(async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); });
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockNativePermission).not.toHaveBeenCalled();
    await settle();
    expect(await work).toBe('answered');
  });

  it('treats failed initialization as unavailable without reading native permission', async () => {
    mockInitialize.mockImplementationOnce(() => { throw new Error('bridge unavailable'); });
    expect(await eligibility()).toBe('unavailable');
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockNativePermission).not.toHaveBeenCalled();
  });
});
