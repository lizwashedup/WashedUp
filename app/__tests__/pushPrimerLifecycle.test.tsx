import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import type { PushRegistrationResult } from '../../hooks/usePushNotifications';

type User = { id: string; phone: string };
const PERSON_A: User = { id: 'person-a', phone: '+12025550100' };
const PERSON_B: User = { id: 'person-b', phone: '+12025550101' };
const SNOOZE_KEY = 'push_primer_snoozed_at';
const PLAN_SNOOZE_KEY = 'plan_push_primer_snoozed_at';
const WEEK = 7 * 24 * 60 * 60 * 1000;
let mockPath = '/(tabs)/plans';
let mockRedraw: (() => void) | undefined;
let mockUser: User | null = PERSON_A;
const mockAuthListeners = new Set<(event: string, session: any) => any>();
const mockClickListeners = new Set<(event: any) => void>();
const mockEligibility = jest.fn();
const mockPromptPermission = jest.fn();
const mockRegister = jest.fn();
const mockLegacyRegister = jest.fn();
const mockNativePermission = jest.fn();
const mockSurveyRpc = jest.fn();
const mockReview = jest.fn();
const mockNothing = () => null;
const mockRouter = {
  push: jest.fn(),
  replace: (href: string) => { mockPath = href; mockRedraw?.(); },
};

jest.mock('../../global.css', () => ({}));
jest.mock('expo-router', () => {
  const Stack = Object.assign(mockNothing, { Screen: mockNothing });
  return { Stack, router: mockRouter, useRouter: () => mockRouter, usePathname: () => mockPath,
    useRootNavigationState: () => ({ key: 'fixture-ready' }) };
});
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('@expo/vector-icons/FontAwesome', () => ({ __esModule: true, default: Object.assign(mockNothing, { font: {} }) }));
jest.mock('@expo/vector-icons/Ionicons', () => ({ __esModule: true, default: Object.assign(mockNothing, { font: {} }) }));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({}));
jest.mock('@expo-google-fonts/dm-sans', () => ({}));
jest.mock('@expo-google-fonts/plus-jakarta-sans', () => ({}));
jest.mock('expo-audio', () => ({ setAudioModeAsync: async () => {} }));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: async () => {}, hideAsync: async () => {}, setOptions: () => {} }));
jest.mock('expo-status-bar', () => ({ StatusBar: mockNothing }));
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: ({ children }: any) => children }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('posthog-react-native', () => ({ PostHogProvider: ({ children }: any) => children, usePostHog: () => null }));
jest.mock('@gorhom/bottom-sheet', () => ({ BottomSheetModalProvider: ({ children }: any) => children }));
jest.mock('@sentry/react-native', () => ({ init: () => {}, wrap: (component: any) => component, captureMessage: () => {} }));
jest.mock('../../constants/LocalDevelopment', () => ({ LOCAL_DEVELOPMENT_ONLY: true }));
jest.mock('../../constants/FeatureFlags', () => ({ PHONE_AUTH_ENABLED: true, YOURS_PAGE_ENABLED: false, COMMUNITIES_ENABLED: true }));
jest.mock('../../lib/oneSignalShim', () => ({ OneSignal: { Notifications: {
  addEventListener: (_event: string, callback: (event: any) => void) => mockClickListeners.add(callback),
  removeEventListener: (_event: string, callback: (event: any) => void) => mockClickListeners.delete(callback),
  requestPermission: (...args: any[]) => mockNativePermission(...args),
} } }));
jest.mock('../../hooks/usePushNotifications', () => ({
  usePushNotifications: () => {}, initOneSignal: async () => true, ensureOneSignalReady: async () => true,
  getPushPermissionStatus: async () => 'undetermined',
  getPushPrimerEligibility: (...args: any[]) => mockEligibility(...args),
  getPushPromptPermission: (...args: any[]) => mockPromptPermission(...args),
  registerPushNotificationsWithResult: (...args: any[]) => mockRegister(...args),
  registerForPushNotifications: (...args: any[]) => mockLegacyRegister(...args),
}));
jest.mock('../../lib/socialAuth', () => ({ isBannedAppleUser: async () => false }));
jest.mock('../../lib/authGate', () => ({ fetchNeedsPhoneMigration: async () => false }));
jest.mock('../../hooks/useProfile', () => ({
  getAuthProfile: async () => ({ onboarding_status: 'complete', referral_source: 'friend' }), seedAuthProfile: () => {},
}));
jest.mock('../../lib/supabase', () => ({ supabase: {
  auth: {
    getSession: async () => ({ data: { session: mockUser ? { user: mockUser } : null } }),
    onAuthStateChange: (callback: (event: string, session: any) => any) => { mockAuthListeners.add(callback); return { data: { subscription: { unsubscribe: () => mockAuthListeners.delete(callback) } } }; },
    signOut: async () => ({ error: null }),
  },
  rpc: (...args: any[]) => mockSurveyRpc(...args),
  from: () => {
    const chain: any = { select: () => chain, eq: () => chain,
      single: async () => ({ data: { onboarding_status: 'complete', referral_source: 'friend' }, error: null }) };
    return chain;
  },
} }));
jest.mock('../../lib/queryClient', () => ({ queryClient: new (require('@tanstack/react-query').QueryClient)({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }) }));
jest.mock('../../hooks/useSessionLogger', () => ({ useSessionLogger: () => {} }));
jest.mock('../../lib/uploadAlbumMedia', () => ({ resumeAllPendingAlbumBatches: async () => {}, registerAlbumUploadResume: () => () => {} }));
jest.mock('../../lib/logger', () => ({ logError: () => {} }));
jest.mock('../../lib/yours/referralLink', () => ({ handleReferralUrl: () => {}, consumePendingReferral: () => {} }));
jest.mock('../../lib/ticketTransfer', () => ({ pendingTransferRoute: async () => null }));
jest.mock('../../lib/knownAccount', () => ({ forgetAccount: () => {}, rememberAccount: () => {} }));
jest.mock('../../lib/reviewAsk', () => ({ maybeRequestReviewAfterTopRating: (...args: any[]) => mockReview(...args) }));
jest.mock('../../lib/giphyInit', () => ({ initGiphySDK: () => {} }));
jest.mock('../../lib/ticketing', () => ({ getOrder: async () => null }));
jest.mock('../../components/albums/AlbumUploadPromptModal', () => ({ AlbumUploadPromptModal: mockNothing }));
jest.mock('../../components/keyboard/KeyboardDoneBar', () => ({ KeyboardDoneBar: mockNothing }));
jest.mock('../../components/keyboard/ChatKeyboard', () => ({ ChatKeyboardProvider: ({ children }: any) => children }));
jest.mock('../../components/PostPlanSurvey', () => ({
  __esModule: true, default: (props: any) => require('react').createElement('SurveyFixture', props),
  isPostPlanSurveyHandled: async () => false,
}));
jest.mock('../../components/marks/MarkEarnedModal', () => ({ __esModule: true, default: mockNothing }));
// Presentation is replaced only to expose callbacks and pending/feedback state.
// All eligibility, auth, sequencing, registration and snooze logic is RootLayout's.
jest.mock('../../components/PushPrimerModal', () => ({ __esModule: true, default: (props: any) => require('react').createElement('PrimerFixture', props) }));
jest.mock('../../components/VideoSplash', () => ({ __esModule: true, default: mockNothing }));
jest.mock('../../components/BrandedAlert', () => ({ BrandedAlert: mockNothing }));

const RootLayout = require('../_layout').default;
import { authedUserIdRef, deliberateSignOutAt, lastUnauthRedirectAt, verifyCodeSelfRoutingRef, cancelVerificationDestination } from '../../lib/navState';
import { queryClient } from '../../lib/queryClient';
import { requestPlanNotificationPrompt } from '../../lib/planNotificationPrompt';

let tree: ReactTestRenderer | undefined;
const originalPlatform = Platform.OS;
function Fixture() { const [, redraw] = React.useState(0); mockRedraw = () => redraw((n) => n + 1); return <RootLayout />; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function flush() { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); }); }
async function tick(ms: number) { await act(async () => { jest.advanceTimersByTime(ms); }); await flush(); }
async function mount() { await act(async () => { tree = create(<Fixture />); }); await flush(); await tick(80); }
async function unmount() { await act(async () => { tree?.unmount(); }); tree = undefined; }
function primers() { return tree?.root.findAllByType('PrimerFixture' as any).filter((item) => item.props.visible) ?? []; }
function primer() { expect(primers()).toHaveLength(1); return primers()[0].props; }
async function enable() { act(() => { void primer().onEnable(); }); await flush(); }
async function dismiss() { act(() => { primer().onDismiss(); }); await flush(); }
async function emitAuth(event: string, user: User | null) {
  act(() => { mockUser = user; for (const callback of mockAuthListeners) void callback(event, user ? { user } : null); });
  await flush(); await tick(80);
}
function surveyPayload() {
  return { data: { plan: { id: 'survey-plan', title: 'A good afternoon', image_url: null, circle_id: null, is_featured: false,
    any_stranger_joined: false, creator_user_id: PERSON_A.id }, members: [] }, error: null };
}

beforeEach(async () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-13T12:00:00Z'));
  await AsyncStorage.clear(); queryClient.clear(); jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  mockPath = '/(tabs)/plans'; mockUser = PERSON_A; mockAuthListeners.clear(); mockClickListeners.clear();
  cancelVerificationDestination(); authedUserIdRef.current = null; deliberateSignOutAt.ts = 0; lastUnauthRedirectAt.ts = 0; verifyCodeSelfRoutingRef.current = false;
  mockEligibility.mockReset().mockResolvedValue('requestable');
  mockPromptPermission.mockReset().mockResolvedValue('requestable');
  mockRegister.mockReset().mockResolvedValue({ status: 'registered', subscriptionId: 'subscription-a' });
  mockLegacyRegister.mockReset().mockResolvedValue(null);
  mockNativePermission.mockReset().mockResolvedValue(true);
  mockSurveyRpc.mockReset().mockResolvedValue({ data: null, error: null });
  mockReview.mockReset().mockResolvedValue(undefined);
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
});
afterEach(async () => {
  await unmount(); mockRedraw = undefined;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
  jest.restoreAllMocks(); jest.clearAllTimers(); jest.useRealTimers();
});

it('waits for the survey/review decision and only reads eligibility on an authenticated native launch', async () => {
  const survey = deferred<any>(); mockSurveyRpc.mockReturnValue(survey.promise);
  await mount();
  expect(mockSurveyRpc).toHaveBeenCalledWith('get_pending_post_plan_survey');
  expect(mockEligibility).not.toHaveBeenCalled(); expect(primers()).toHaveLength(0);
  survey.resolve({ data: null, error: null }); await flush();
  expect(mockEligibility).toHaveBeenCalledTimes(1); expect(primer().pending).toBeFalsy();
  expect(mockRegister).not.toHaveBeenCalled(); expect(mockLegacyRegister).not.toHaveBeenCalled(); expect(mockNativePermission).not.toHaveBeenCalled();
});

it.each(['answered', 'unavailable'])('does not show the primer for %s eligibility', async (eligibility) => {
  mockEligibility.mockResolvedValue(eligibility); await mount();
  expect(mockEligibility).toHaveBeenCalledTimes(1); expect(primers()).toHaveLength(0); expect(mockRegister).not.toHaveBeenCalled();
});

it('does not turn an eligibility read failure into a permission request or a primer', async () => {
  mockEligibility.mockRejectedValue(new Error('native bridge unavailable')); await mount();
  expect(primers()).toHaveLength(0); expect(mockRegister).not.toHaveBeenCalled(); expect(mockNativePermission).not.toHaveBeenCalled();
});

it.each(['signed out', 'web'])('does not evaluate or show the primer when %s', async (mode) => {
  if (mode === 'signed out') mockUser = null;
  else Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  await mount(); expect(primers()).toHaveLength(0); expect(mockEligibility).not.toHaveBeenCalled(); expect(mockRegister).not.toHaveBeenCalled();
});

it.each([[WEEK - 1, false], [WEEK, true]] as const)('respects the seven-day snooze at age %s ms', async (age, expectedVisible) => {
  // Root's authentication handoff advances 80 ms before checking eligibility.
  await AsyncStorage.setItem(SNOOZE_KEY, String(Date.now() + 80 - age));
  await mount(); expect(primers()).toHaveLength(expectedVisible ? 1 : 0); expect(mockRegister).not.toHaveBeenCalled();
});

it('lets a post/join invitation appear after the generic reminder was dismissed and keeps its snooze separate', async () => {
  await mount();
  const coldDismissedAt = Date.now();
  await dismiss();
  expect(await AsyncStorage.getItem(SNOOZE_KEY)).toBe(String(coldDismissedAt));
  expect(await AsyncStorage.getItem(PLAN_SNOOZE_KEY)).toBeNull();

  act(() => requestPlanNotificationPrompt({
    userId: PERSON_A.id,
    planId: 'plan-after-dismissal',
    reason: 'posted',
  }, () => true));
  await flush();
  await tick(400);
  expect(primer().title).toBe('Know when people join');

  const contextualDismissedAt = Date.now();
  await dismiss();
  expect(await AsyncStorage.getItem(PLAN_SNOOZE_KEY)).toBe(String(contextualDismissedAt));
  expect(await AsyncStorage.getItem(SNOOZE_KEY)).toBe(String(coldDismissedAt));
});

it('preflights Enable once despite same-beat taps, then prompts once only for permission-required', async () => {
  const preflight = deferred<PushRegistrationResult>(); const prompted = deferred<PushRegistrationResult>();
  mockRegister.mockReturnValueOnce(preflight.promise).mockReturnValueOnce(prompted.promise);
  await mount(); const onEnable = primer().onEnable;
  act(() => { void onEnable(); void onEnable(); }); await flush();
  expect(mockRegister.mock.calls).toEqual([[{ prompt: false, userId: PERSON_A.id }]]);
  expect(primer().pending).toBe(true);
  preflight.resolve({ status: 'permission-required' }); await flush();
  expect(mockRegister.mock.calls).toEqual([[{ prompt: false, userId: PERSON_A.id }], [{ prompt: true, userId: PERSON_A.id, canPrompt: expect.any(Function) }]]);
  act(() => { void onEnable(); }); await flush(); expect(mockRegister).toHaveBeenCalledTimes(2);
  prompted.resolve({ status: 'registered', subscriptionId: 'subscription-a' }); await flush();
  expect(primers()).toHaveLength(0); expect(await AsyncStorage.getItem(SNOOZE_KEY)).toBeNull();
  await emitAuth('SIGNED_IN', PERSON_A); await tick(WEEK); expect(primers()).toHaveLength(0);
});

it('closes on an already-granted successful preflight without requesting permission', async () => {
  await mount(); await enable();
  expect(mockRegister.mock.calls).toEqual([[{ prompt: false, userId: PERSON_A.id }]]);
  expect(primers()).toHaveLength(0); expect(await AsyncStorage.getItem(SNOOZE_KEY)).toBeNull();
});

it.each([false, true])('closes after a real denial (native request: %s) without opening Settings', async (prompted) => {
  if (prompted) mockRegister.mockResolvedValueOnce({ status: 'permission-required' });
  mockRegister.mockResolvedValueOnce({ status: 'permission-denied' });
  await mount(); await enable();
  expect(primers()).toHaveLength(0); expect(Linking.openSettings).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(SNOOZE_KEY)).toBeNull();
  expect(mockRegister).toHaveBeenCalledTimes(prompted ? 2 : 1);
});

it.each([
  ['pending', /finish|ready|setting|connect/i],
  ['opted-out', /off|enable|turn|subscription|connect|ready/i],
  ['failed', /couldn|unable|try|again/i],
  ['unavailable', /unavailable|available|try|again|device/i],
] as const)('keeps %s registration honest and retryable without a snooze or automatic prompt', async (status, expectedMessage) => {
  mockRegister.mockResolvedValueOnce({ status });
  await mount(); await enable();
  expect(primer().pending).toBeFalsy(); expect(primer().feedback).toEqual(expect.stringMatching(expectedMessage));
  expect(primer().feedback).not.toMatch(/enabled|turned on|all set|success/i);
  expect(await AsyncStorage.getItem(SNOOZE_KEY)).toBeNull();
  expect(mockRegister.mock.calls).toEqual([[{ prompt: false, userId: PERSON_A.id }]]);
  await enable(); expect(mockRegister).toHaveBeenCalledTimes(2); expect(primers()).toHaveLength(0);
});

it('keeps a rejected registration retryable and never reports success', async () => {
  mockRegister.mockRejectedValueOnce(new Error('bridge failed')); await mount(); await enable();
  expect(primer().pending).toBeFalsy(); expect(primer().feedback).toEqual(expect.stringMatching(/couldn|unable|try|again/i));
  expect(await AsyncStorage.getItem(SNOOZE_KEY)).toBeNull();
  await enable(); expect(primers()).toHaveLength(0);
});

it('retries registration after a granted-but-pending native request without prompting again', async () => {
  mockRegister.mockResolvedValueOnce({ status: 'permission-required' }).mockResolvedValueOnce({ status: 'pending' });
  await mount(); await enable();
  expect(primer().pending).toBeFalsy(); expect(primer().feedback).toBeTruthy();
  expect(await AsyncStorage.getItem(SNOOZE_KEY)).toBeNull();
  await enable();
  expect(mockRegister.mock.calls).toEqual([
    [{ prompt: false, userId: PERSON_A.id }],
    [{ prompt: true, userId: PERSON_A.id, canPrompt: expect.any(Function) }],
    [{ prompt: false, userId: PERSON_A.id }],
  ]);
  expect(primers()).toHaveLength(0);
});

it('treats an obsolete result silently, without reporting success or snoozing', async () => {
  mockRegister.mockResolvedValueOnce({ status: 'obsolete' }); await mount(); await enable();
  for (const item of primers()) { expect(item.props.feedback).toBeFalsy(); expect(item.props.pending).toBeFalsy(); }
  expect(await AsyncStorage.getItem(SNOOZE_KEY)).toBeNull();
  expect(mockRegister).toHaveBeenCalledTimes(1); expect(mockNativePermission).not.toHaveBeenCalled();
});

it.each(['before enable', 'pending preflight', 'pending native request'])('Not now closes and snoozes when %s, and delayed work cannot revive it', async (phase) => {
  const result = deferred<PushRegistrationResult>();
  if (phase === 'pending native request') mockRegister.mockResolvedValueOnce({ status: 'permission-required' }).mockReturnValueOnce(result.promise);
  else mockRegister.mockReturnValueOnce(result.promise);
  await mount();
  if (phase !== 'before enable') await enable();
  const dismissAt = Date.now(); await dismiss();
  expect(primers()).toHaveLength(0); expect(await AsyncStorage.getItem(SNOOZE_KEY)).toBe(String(dismissAt));
  const calls = mockRegister.mock.calls.length;
  result.resolve({ status: phase === 'pending preflight' ? 'permission-required' : 'failed' }); await flush();
  expect(mockRegister).toHaveBeenCalledTimes(calls); expect(primers()).toHaveLength(0);
  await emitAuth('SIGNED_IN', PERSON_A); await tick(WEEK + 1);
  expect(primers()).toHaveLength(0);
  await unmount(); await mount(); expect(primers()).toHaveLength(1);
});

it.each(['different account', 'signout then same account', 'A to B to A'])('retires delayed eligibility after %s', async (transition) => {
  const oldEligibility = deferred<string>();
  mockEligibility.mockReturnValueOnce(oldEligibility.promise).mockResolvedValue('answered');
  await mount(); expect(mockEligibility).toHaveBeenCalledTimes(1);
  if (transition === 'signout then same account') { await emitAuth('SIGNED_OUT', null); await emitAuth('SIGNED_IN', PERSON_A); }
  else { await emitAuth('SIGNED_IN', PERSON_B); if (transition === 'A to B to A') await emitAuth('SIGNED_IN', PERSON_A); }
  oldEligibility.resolve('requestable'); await flush();
  expect(primers()).toHaveLength(0); expect(mockRegister).not.toHaveBeenCalled();
  expect(mockEligibility.mock.calls.length).toBeGreaterThan(1);
});

it.each(['different account', 'signout then same account', 'A to B to A'])('retires pending Enable and retained callbacks after %s', async (transition) => {
  const oldPreflight = deferred<PushRegistrationResult>(); mockRegister.mockReturnValueOnce(oldPreflight.promise);
  await mount(); const old = primer(); await enable();
  if (transition === 'signout then same account') { await emitAuth('SIGNED_OUT', null); await emitAuth('SIGNED_IN', PERSON_A); }
  else { await emitAuth('SIGNED_IN', PERSON_B); if (transition === 'A to B to A') await emitAuth('SIGNED_IN', PERSON_A); }
  expect(primer().pending).toBeFalsy();
  act(() => { void old.onEnable(); old.onDismiss(); }); await flush();
  oldPreflight.resolve({ status: 'permission-required' }); await flush();
  expect(mockRegister).toHaveBeenCalledTimes(1); expect(primer().pending).toBeFalsy(); expect(primer().feedback).toBeFalsy();
  expect(await AsyncStorage.getItem(SNOOZE_KEY)).toBeNull();
  mockRegister.mockResolvedValue({ status: 'registered', subscriptionId: 'current-subscription' }); await enable();
  expect(mockRegister).toHaveBeenLastCalledWith({ prompt: false, userId: transition === 'different account' ? PERSON_B.id : PERSON_A.id });
  expect(primers()).toHaveLength(0);
});

it.each(['failed', 'registered', 'obsolete'])('does not apply an old account’s delayed %s result to the new primer', async (status) => {
  const result = deferred<any>(); mockRegister.mockReturnValueOnce(result.promise);
  await mount(); await enable(); await emitAuth('SIGNED_OUT', null); await emitAuth('SIGNED_IN', PERSON_A);
  expect(primer().pending).toBeFalsy();
  result.resolve({ status, subscriptionId: 'old-subscription' }); await flush();
  expect(primer().pending).toBeFalsy(); expect(primer().feedback).toBeFalsy();
  expect(await AsyncStorage.getItem(SNOOZE_KEY)).toBeNull();
});

it('invalidates pending work synchronously when signout and the same login are batched', async () => {
  const result = deferred<PushRegistrationResult>(); mockRegister.mockReturnValueOnce(result.promise);
  await mount(); const old = primer(); await enable();
  act(() => {
    for (const callback of mockAuthListeners) void callback('SIGNED_OUT', null);
    for (const callback of mockAuthListeners) void callback('SIGNED_IN', { user: PERSON_A });
    void old.onEnable(); old.onDismiss();
    result.resolve({ status: 'permission-required' });
  });
  await flush(); await tick(80);
  expect(mockRegister).toHaveBeenCalledTimes(1); expect(await AsyncStorage.getItem(SNOOZE_KEY)).toBeNull();
  expect(primer().pending).toBeFalsy(); expect(primer().feedback).toBeFalsy();
});

it('ignores callbacks from a dismissed visit when a fresh account visit opens after the snooze', async () => {
  await mount(); const old = primer(); const dismissedAt = Date.now(); await dismiss();
  await tick(WEEK); await emitAuth('SIGNED_OUT', null); await emitAuth('SIGNED_IN', PERSON_A);
  expect(primer().pending).toBeFalsy();
  act(() => { void old.onEnable(); old.onDismiss(); }); await flush();
  expect(mockRegister).not.toHaveBeenCalled(); expect(primers()).toHaveLength(1);
  expect(await AsyncStorage.getItem(SNOOZE_KEY)).toBe(String(dismissedAt));
});

it('retires eligibility when RootLayout unmounts', async () => {
  const eligibility = deferred<string>(); mockEligibility.mockReturnValueOnce(eligibility.promise);
  await mount(); await unmount(); eligibility.resolve('requestable'); await flush();
  expect(mockRegister).not.toHaveBeenCalled(); expect(await AsyncStorage.getItem(SNOOZE_KEY)).toBeNull();
  mockEligibility.mockResolvedValue('answered'); await mount(); expect(primers()).toHaveLength(0);
});

it.each(['permission-required', 'failed', 'registered'])('retires an unmounted Enable with delayed %s completion and retained callbacks', async (status) => {
  const result = deferred<any>(); mockRegister.mockReturnValueOnce(result.promise);
  await mount(); const old = primer(); await enable(); await unmount();
  act(() => { void old.onEnable(); old.onDismiss(); });
  result.resolve({ status, subscriptionId: 'old-subscription' }); await flush();
  expect(mockRegister).toHaveBeenCalledTimes(1); expect(await AsyncStorage.getItem(SNOOZE_KEY)).toBeNull();
  await mount(); expect(primer().pending).toBeFalsy(); expect(primer().feedback).toBeFalsy();
});

it('keeps the survey ahead of the primer and a TOP rating defers the primer for this launch', async () => {
  mockSurveyRpc.mockResolvedValueOnce(surveyPayload());
  await mount(); expect(tree!.root.findAllByType('SurveyFixture' as any)).toHaveLength(1); expect(primers()).toHaveLength(0);
  act(() => { tree!.root.findByType('SurveyFixture' as any).props.onComplete(true); }); await flush();
  await tick(460); expect(mockReview).toHaveBeenCalledTimes(1); expect(primers()).toHaveLength(0);
  await tick(2000); expect(primers()).toHaveLength(0); expect(mockRegister).not.toHaveBeenCalled();
});

it('does not revive eligibility that resolves after a TOP survey hands off to review', async () => {
  const eligibility = deferred<string>(); mockEligibility.mockReturnValue(eligibility.promise);
  mockSurveyRpc.mockResolvedValueOnce(surveyPayload()); await mount();
  act(() => { tree!.root.findByType('SurveyFixture' as any).props.onComplete(true); }); await flush();
  eligibility.resolve('requestable'); await flush(); await tick(460);
  expect(primers()).toHaveLength(0); expect(mockRegister).not.toHaveBeenCalled();
});

it.each(['permission-required', 'failed', 'registered'])('suppresses delayed %s when a late TOP survey completion takes review ownership', async (status) => {
  const result = deferred<PushRegistrationResult>(); mockRegister.mockReturnValueOnce(result.promise);
  mockSurveyRpc.mockResolvedValueOnce(surveyPayload()); await mount();
  const completeSurvey = tree!.root.findByType('SurveyFixture' as any).props.onComplete;
  act(() => { completeSurvey(false); }); await flush(); await tick(400);
  await enable(); expect(primer().pending).toBe(true);
  act(() => { completeSurvey(true); }); await flush();
  result.resolve(status === 'registered' ? { status, subscriptionId: 'subscription-a' } : { status: status as 'permission-required' | 'failed' });
  await flush(); await tick(460);
  expect(mockRegister.mock.calls).toEqual([[{ prompt: false, userId: PERSON_A.id }]]);
  expect(primers()).toHaveLength(0); expect(await AsyncStorage.getItem(SNOOZE_KEY)).toBeNull();
});

it.each(['Not now', 'review preemption', 'account change', 'unmount'])('revokes the helper’s native-prompt guard after %s', async (transition) => {
  const prompted = deferred<PushRegistrationResult>();
  mockRegister.mockResolvedValueOnce({ status: 'permission-required' }).mockReturnValueOnce(prompted.promise);
  if (transition === 'review preemption') mockSurveyRpc.mockResolvedValueOnce(surveyPayload());
  await mount();
  let completeSurvey: ((topRated: boolean) => void) | undefined;
  if (transition === 'review preemption') {
    completeSurvey = tree!.root.findByType('SurveyFixture' as any).props.onComplete;
    act(() => { completeSurvey!(false); }); await flush(); await tick(400);
  }
  await enable();
  const options = mockRegister.mock.calls[1][0];
  expect(options).toEqual({ prompt: true, userId: PERSON_A.id, canPrompt: expect.any(Function) });
  const canPrompt = options.canPrompt as () => boolean;
  expect(canPrompt()).toBe(true);
  if (transition === 'unmount') {
    await unmount();
  } else {
    act(() => {
      if (transition === 'Not now') primer().onDismiss();
      else if (transition === 'review preemption') completeSurvey!(true);
      else {
        mockUser = PERSON_B;
        for (const callback of mockAuthListeners) void callback('SIGNED_IN', { user: PERSON_B });
      }
      // The native helper may resume before React renders the dismissal or
      // finishes resolving the next account. Consent is revoked immediately.
      expect(canPrompt()).toBe(false);
    });
    await flush(); await tick(80);
  }
  expect(canPrompt()).toBe(false);
  prompted.resolve({ status: 'obsolete' }); await flush();
  expect(canPrompt()).toBe(false);
  expect(mockRegister).toHaveBeenCalledTimes(2);
  if (transition === 'account change') { expect(primer().pending).toBeFalsy(); expect(primer().feedback).toBeFalsy(); }
  else expect(primers()).toHaveLength(0);
});
