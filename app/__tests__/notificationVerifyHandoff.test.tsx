import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockPath = '/phone-entry';
let mockRedraw: (() => void) | undefined;
let mockUser: { id: string; phone: string } | null = null;
let mockProfile = { onboarding_status: 'complete', referral_source: 'friend' };
let mockNeedsPhone = false;
let mockBanned = false;
let mockMode = 'signup';
let mockVerifyEvent = 'SIGNED_IN';
const mockBanCheck = jest.fn();
const mockMigrationRead = jest.fn();
const mockProfileRead = jest.fn();
const mockAuthProfileRead = jest.fn();
const mockPhoneSync = jest.fn();
const mockVerifyOtp = jest.fn();
const mockGetUser = jest.fn();
const mockGetSession = jest.fn();
const mockAuthListeners = new Set<(event: string, session: any) => any>();
const mockClickListeners = new Set<(event: any) => void>();
const mockExpoListeners = new Set<(data: Record<string, unknown>) => void>();
const mockRoutes: Array<{ method: string; href: string }> = [];
const mockGetOrder = jest.fn();
const mockPushHook = jest.fn();
const mockNavigate = (method: string, href: string) => {
  mockRoutes.push({ method, href }); mockPath = href; mockRedraw?.();
};
const mockRouter = { push: (href: string) => mockNavigate('push', href), replace: (href: string) => mockNavigate('replace', href), back: jest.fn() };
const mockNothing = () => null;

jest.mock('../../global.css', () => ({}));
jest.mock('expo-router', () => {
  const Stack = () => {
    if (mockPath === '/verify-code') return require('react').createElement(require('../(auth)/verify-code').default);
    if (mockPath.startsWith('/(tabs)/plans')) return require('react').createElement(require('../(tabs)/_layout').default);
    return null;
  };
  Stack.Screen = mockNothing;
  const Tabs = mockNothing as any; Tabs.Screen = mockNothing;
  return { Stack, Tabs, router: mockRouter, useRouter: () => mockRouter, usePathname: () => mockPath,
    useRootNavigationState: () => ({ key: 'fixture-ready' }), useLocalSearchParams: () => ({ phone: '2025550100', mode: mockMode }) };
});
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('@expo/vector-icons/FontAwesome', () => ({ __esModule: true, default: Object.assign(mockNothing, { font: {} }) }));
jest.mock('@expo/vector-icons/Ionicons', () => ({ __esModule: true, default: Object.assign(mockNothing, { font: {} }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: mockNothing }));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({}));
jest.mock('@expo-google-fonts/dm-sans', () => ({}));
jest.mock('@expo-google-fonts/plus-jakarta-sans', () => ({}));
jest.mock('expo-audio', () => ({ setAudioModeAsync: async () => {} }));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: async () => {}, hideAsync: async () => {}, setOptions: () => {} }));
jest.mock('expo-status-bar', () => ({ StatusBar: mockNothing }));
jest.mock('expo-image', () => ({ Image: mockNothing }));
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: ({ children }: any) => children }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'));
jest.mock('react-native-reanimated', () => ({ ...require('react-native-reanimated/mock'), useAnimatedKeyboard: () => ({ height: { value: 0 } }), useAnimatedReaction: () => {} }));
jest.mock('posthog-react-native', () => ({ PostHogProvider: ({ children }: any) => children, usePostHog: () => null }));
jest.mock('@gorhom/bottom-sheet', () => ({ BottomSheetModalProvider: ({ children }: any) => children }));
jest.mock('@sentry/react-native', () => ({ init: () => {}, wrap: (component: any) => component, captureMessage: () => {} }));
jest.mock('../../constants/LocalDevelopment', () => ({ LOCAL_DEVELOPMENT_ONLY: true }));
jest.mock('../../constants/FeatureFlags', () => ({ PHONE_AUTH_ENABLED: true, YOURS_PAGE_ENABLED: false, COMMUNITIES_ENABLED: true }));
jest.mock('../../lib/expoNotificationResponses', () => ({ subscribeExpoNotificationResponses: (callback: (data: Record<string, unknown>) => void) => {
  mockExpoListeners.add(callback); return () => mockExpoListeners.delete(callback);
} }));
jest.mock('../../lib/oneSignalShim', () => ({ OneSignal: { Notifications: {
  addEventListener: (_event: string, callback: (event: any) => void) => mockClickListeners.add(callback),
  removeEventListener: (_event: string, callback: (event: any) => void) => mockClickListeners.delete(callback),
} } }));
jest.mock('../../hooks/usePushNotifications', () => ({
  usePushNotifications: (...args: any[]) => mockPushHook(...args), initOneSignal: async () => true,
  ensureOneSignalReady: async () => true, getPushPrimerEligibility: async () => 'answered', getPushPermissionStatus: async () => 'granted', registerForPushNotifications: async () => null,
}));
jest.mock('../../lib/socialAuth', () => ({ isBannedAppleUser: (...args: any[]) => mockBanCheck(...args) }));
jest.mock('../../lib/authGate', () => ({ fetchNeedsPhoneMigration: () => mockMigrationRead() }));
jest.mock('../../hooks/useProfile', () => ({
  getAuthProfile: (...args: any[]) => mockAuthProfileRead(...args), seedAuthProfile: () => {}, invalidateAuthProfile: () => {}, AUTH_PROFILE_KEY: (id: string) => ['profile', id],
}));
jest.mock('../../lib/supabase', () => ({ supabase: {
  auth: {
    getSession: (...args: any[]) => mockGetSession(...args),
    getUser: (...args: any[]) => mockGetUser(...args),
    onAuthStateChange: (callback: (event: string, session: any) => any) => { mockAuthListeners.add(callback); return { data: { subscription: { unsubscribe: () => mockAuthListeners.delete(callback) } } }; },
    verifyOtp: (...args: any[]) => mockVerifyOtp(...args),
    signOut: async () => { mockUser = null; for (const callback of mockAuthListeners) void callback('SIGNED_OUT', null); return { error: null }; },
  },
  rpc: async () => ({ data: [], error: null }),
  from: () => {
    let updating = false;
    const chain: any = { select: () => chain, eq: () => chain, neq: () => chain, in: () => chain, order: () => chain, limit: () => chain,
      update: () => { updating = true; return chain; },
      single: async () => ({ data: { ...mockProfile }, error: null }),
      maybeSingle: () => mockProfileRead(),
      then: (resolve: any, reject: any) => (updating ? mockPhoneSync() : Promise.resolve({ data: [], count: 0, error: null })).then(resolve, reject) };
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
jest.mock('../../lib/reviewAsk', () => ({ maybeRequestReviewAfterTopRating: async () => {} }));
jest.mock('../../lib/giphyInit', () => ({ initGiphySDK: () => {} }));
jest.mock('../../lib/haptics', () => ({ hapticLight: () => {}, hapticSuccess: () => {}, hapticError: () => {} }));
jest.mock('../../lib/ticketing', () => ({ getOrder: (...args: any[]) => mockGetOrder(...args) }));
jest.mock('../../components/auth/OtpInput', () => ({ __esModule: true, default: (props: any) => require('react').createElement('OtpFixture', props) }));
jest.mock('../../components/albums/AlbumUploadPromptModal', () => ({ AlbumUploadPromptModal: mockNothing }));
jest.mock('../../components/keyboard/KeyboardDoneBar', () => ({ KeyboardDoneBar: mockNothing }));
jest.mock('../../components/PostPlanSurvey', () => ({ __esModule: true, default: mockNothing, isPostPlanSurveyHandled: async () => true }));
jest.mock('../../components/marks/MarkEarnedModal', () => ({ __esModule: true, default: mockNothing }));
jest.mock('../../components/PushPrimerModal', () => ({ __esModule: true, default: mockNothing }));
jest.mock('../../components/VideoSplash', () => ({ __esModule: true, default: mockNothing }));
jest.mock('../../components/BrandedAlert', () => ({ BrandedAlert: (props: any) => require('react').createElement('AlertFixture', props) }));
jest.mock('../../components/legal/TermsReacceptance', () => ({ TermsReacceptance: mockNothing }));
jest.mock('../../components/yours/icons/SunriseIcon', () => ({ __esModule: true, default: mockNothing }));

const RootLayout = require('../_layout').default;
import { Linking } from 'react-native';
import { authedUserIdRef, deliberateSignOutAt, verifyCodeSelfRoutingRef, cancelVerificationDestination, getVerificationDestination } from '../../lib/navState';
import { queryClient } from '../../lib/queryClient';
import { stashPendingCheckout, stashPendingDestination } from '../../lib/pendingLink';

let tree: ReactTestRenderer | undefined;
function Fixture() { const [, redraw] = React.useState(0); mockRedraw = () => redraw((n) => n + 1); return <RootLayout />; }
async function flush() { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); }); }
async function tick(ms: number) { await act(async () => jest.advanceTimersByTime(ms)); await flush(); }
async function mount() { await act(async () => { tree = create(<Fixture />); }); await flush(); await tick(80); }
async function tapNotification() { act(() => { for (const callback of mockClickListeners) callback({ notification: { additionalData: { type: 'new_message', topicId: '22222222-2222-4222-8222-222222222222' } } }); }); await flush(); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function emitAuth(event: string, user: typeof mockUser) {
  act(() => { mockUser = user; for (const callback of mockAuthListeners) void callback(event, user ? { user } : null); });
  await flush();
}
const topicRoutes = () => mockRoutes.filter((route) => route.href === '/community-topic/22222222-2222-4222-8222-222222222222');
async function verify() {
  act(() => mockNavigate('replace', '/verify-code')); await flush();
  await act(async () => { await tree!.root.findByType('OtpFixture' as any).props.onComplete('123456'); }); await flush();
}

beforeEach(async () => {
  jest.useFakeTimers(); await AsyncStorage.clear(); queryClient.clear();
  mockPath = '/phone-entry'; mockUser = null; mockProfile = { onboarding_status: 'complete', referral_source: 'friend' }; mockNeedsPhone = false; mockBanned = false; mockMode = 'signup'; mockVerifyEvent = 'SIGNED_IN';
  mockRoutes.length = 0; mockAuthListeners.clear(); mockClickListeners.clear(); mockExpoListeners.clear(); mockGetOrder.mockReset(); mockPushHook.mockClear();
  cancelVerificationDestination();
  authedUserIdRef.current = null; deliberateSignOutAt.ts = 0; verifyCodeSelfRoutingRef.current = false;
  mockBanCheck.mockReset().mockImplementation(async () => mockBanned);
  mockMigrationRead.mockReset().mockImplementation(async () => mockNeedsPhone);
  mockProfileRead.mockReset().mockImplementation(async () => ({ data: { ...mockProfile }, error: null }));
  mockAuthProfileRead.mockReset().mockImplementation(async () => ({ ...mockProfile }));
  mockPhoneSync.mockReset().mockResolvedValue({ error: null });
  mockGetUser.mockReset().mockImplementation(async () => ({ data: { user: mockUser } }));
  mockGetSession.mockReset().mockImplementation(async () => ({ data: { session: mockUser ? { user: mockUser } : null } }));
  mockVerifyOtp.mockReset().mockImplementation(async () => {
    mockUser = { id: 'person-a', phone: '+12025550100' };
    for (const callback of mockAuthListeners) void callback(mockVerifyEvent, { user: mockUser });
    return { error: null };
  });
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
});
afterEach(async () => { await act(async () => tree?.unmount()); tree = undefined; mockRedraw = undefined; jest.restoreAllMocks(); jest.clearAllTimers(); jest.useRealTimers(); });

it('resumes the exact signed-out notification after the verification animation and only once', async () => {
  await mount(); await tapNotification(); expect(mockRoutes.some((r) => r.href === '/community-topic/22222222-2222-4222-8222-222222222222')).toBe(false);
  await verify(); await tick(599); expect(mockRoutes.some((r) => r.href === '/community-topic/22222222-2222-4222-8222-222222222222')).toBe(false);
  await tick(1);
  expect(mockRoutes.filter((r) => r.href === '/community-topic/22222222-2222-4222-8222-222222222222')).toEqual([{ method: 'push', href: '/community-topic/22222222-2222-4222-8222-222222222222' }]);
  expect(mockRoutes.findIndex((r) => r.href === '/(tabs)/plans')).toBeLessThan(mockRoutes.findIndex((r) => r.href === '/community-topic/22222222-2222-4222-8222-222222222222'));
  act(() => { for (const callback of mockAuthListeners) void callback('SIGNED_IN', { user: mockUser }); }); await flush();
  expect(mockRoutes.filter((r) => r.href === '/community-topic/22222222-2222-4222-8222-222222222222')).toHaveLength(1);
});


it('gives a completed checkout priority over both a saved link and the notification', async () => {
  await mount(); await tapNotification(); await stashPendingDestination('/plan/saved-plan'); await stashPendingCheckout('order-a');
  mockGetOrder.mockResolvedValue({ status: 'paid' });
  await verify(); await tick(600);
  expect(mockRoutes.filter((route) => route.href === '/tickets/order/order-a')).toEqual([{ method: 'replace', href: '/tickets/order/order-a' }]);
  expect(topicRoutes()).toHaveLength(0);
  expect(mockRoutes.some((route) => route.href === '/plan/saved-plan')).toBe(false);
  expect(await AsyncStorage.getItem('pendingLinkDestination')).toBeNull();
  await emitAuth('SIGNED_IN', mockUser);
  expect(mockRoutes.filter((route) => route.href === '/tickets/order/order-a')).toHaveLength(1);
});

it('does not let an unfinished checkout mask the saved link', async () => {
  await mount(); await tapNotification(); await stashPendingDestination('/plan/saved-plan'); await stashPendingCheckout('order-a');
  mockGetOrder.mockResolvedValue({ status: 'pending' });
  await verify(); await tick(600);
  expect(mockRoutes.filter((route) => route.href === '/plan/saved-plan')).toEqual([{ method: 'push', href: '/plan/saved-plan' }]);
  expect(topicRoutes()).toHaveLength(0);
});

it('keeps the notification through incomplete onboarding and resumes after the tabs guard approves', async () => {
  mockProfile.onboarding_status = 'photo';
  await mount(); await tapNotification(); await verify(); await tick(600);
  expect(mockPath).toBe('/onboarding/photo'); expect(topicRoutes()).toHaveLength(0);
  mockProfile.onboarding_status = 'complete';
  act(() => mockNavigate('replace', '/(tabs)/plans')); await flush();
  expect(topicRoutes()).toHaveLength(1);
});

it('waits for the actual tabs profile/phone guard before resuming a notification', async () => {
  const profile = deferred<any>(); mockAuthProfileRead.mockReturnValue(profile.promise);
  await mount(); await tapNotification(); await verify(); await tick(600);
  expect(mockPath).toBe('/(tabs)/plans'); expect(topicRoutes()).toHaveLength(0);
  profile.resolve({ ...mockProfile }); await flush(); expect(topicRoutes()).toHaveLength(1);
});

it('does not resume when the tabs gate still requires phone migration', async () => {
  mockNeedsPhone = true;
  await mount(); await tapNotification(); await verify(); await tick(600);
  expect(topicRoutes()).toHaveLength(0); expect(getVerificationDestination()?.entryApproved).toBe(false);
});

it('completes migration with USER_UPDATED and no SIGNED_IN event', async () => {
  mockUser = { id: 'person-a', phone: '' }; mockNeedsPhone = true; mockMode = 'migration'; mockVerifyEvent = 'USER_UPDATED';
  await mount(); expect(mockPath).toBe('/migration-gate'); await tapNotification();
  mockNeedsPhone = false; await verify(); await tick(600);
  expect(mockVerifyOtp).toHaveBeenCalledWith(expect.objectContaining({ type: 'phone_change' }));
  expect(mockPhoneSync).toHaveBeenCalledTimes(1); expect(topicRoutes()).toHaveLength(1);
});

it('does not route before a slow ban check finishes, and rejects a banned verification', async () => {
  const ban = deferred<boolean>(); mockBanCheck.mockReturnValue(ban.promise);
  await mount(); await tapNotification(); await verify(); await tick(600);
  expect(mockPath).toBe('/verify-code'); expect(topicRoutes()).toHaveLength(0);
  ban.resolve(true); await flush();
  expect(mockPath).toBe('/phone-entry'); expect(topicRoutes()).toHaveLength(0); expect(getVerificationDestination()).toBeNull();
});

it('does not revive the verified account when an old ban check resolves after signout', async () => {
  const ban = deferred<boolean>(); mockBanCheck.mockReturnValue(ban.promise);
  await mount(); await tapNotification(); await verify();
  await emitAuth('SIGNED_OUT', null); ban.resolve(false); await flush(); await tick(600);
  expect(authedUserIdRef.current).toBeNull(); expect(mockPath).toBe('/phone-entry'); expect(topicRoutes()).toHaveLength(0);
});

it.each(['SIGNED_OUT', 'PASSWORD_RECOVERY'])('retires verification on %s during the success hold', async (event) => {
  await mount(); await tapNotification(); await verify();
  await emitAuth(event, event === 'SIGNED_OUT' ? null : mockUser); await tick(600);
  expect(mockPath).toBe(event === 'SIGNED_OUT' ? '/phone-entry' : '/reset-password');
  expect(topicRoutes()).toHaveLength(0); expect(getVerificationDestination()).toBeNull();
});

it('does not resume an old notification after an A to B to A account change during checkout lookup', async () => {
  const order = deferred<any>(); mockGetOrder.mockReturnValue(order.promise);
  await mount(); await tapNotification(); await stashPendingCheckout('order-a'); await verify(); await tick(600);
  await emitAuth('SIGNED_IN', { id: 'person-b', phone: '+12025550101' });
  await emitAuth('SIGNED_IN', { id: 'person-a', phone: '+12025550100' });
  order.resolve({ status: 'paid' }); await flush();
  expect(topicRoutes()).toHaveLength(0); expect(mockRoutes.some((route) => route.href === '/tickets/order/order-a')).toBe(false);
});

it('keeps a durable destination when signout occurs during its storage read', async () => {
  const saved = deferred<string | null>();
  await mount(); await tapNotification(); await stashPendingDestination('/plan/saved-plan');
  const originalGet = (AsyncStorage.getItem as jest.Mock).getMockImplementation()!;
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => key === 'pendingLinkDestination' ? saved.promise : originalGet(key));
  await verify(); await tick(600); await emitAuth('SIGNED_OUT', null);
  saved.resolve('/plan/saved-plan'); await flush();
  (AsyncStorage.getItem as jest.Mock).mockImplementation(originalGet);
  expect(await AsyncStorage.getItem('pendingLinkDestination')).toBe('/plan/saved-plan');
  expect(mockRoutes.some((route) => route.href === '/plan/saved-plan')).toBe(false); expect(topicRoutes()).toHaveLength(0);
});

it.each(['hold', 'profile'])('ignores verification completion after the screen unmounts during %s', async (phase) => {
  const profile = deferred<any>();
  await mount(); await tapNotification();
  if (phase === 'profile') mockProfileRead.mockReturnValue(profile.promise);
  await verify(); if (phase === 'profile') await tick(600);
  act(() => mockNavigate('replace', '/phone-entry')); await flush();
  profile.resolve({ data: { ...mockProfile } }); await tick(600);
  expect(mockPath).toBe('/phone-entry'); expect(topicRoutes()).toHaveLength(0); expect(getVerificationDestination()).toBeNull();
});

it('ignores OTP completion after the verification screen unmounts', async () => {
  const otp = deferred<any>(); mockVerifyOtp.mockReturnValue(otp.promise);
  await mount(); await tapNotification();
  act(() => mockNavigate('replace', '/verify-code')); await flush();
  act(() => { void tree!.root.findByType('OtpFixture' as any).props.onComplete('123456'); });
  act(() => mockNavigate('replace', '/phone-entry')); await flush();
  otp.resolve({ error: null }); await tick(600);
  expect(mockPath).toBe('/phone-entry'); expect(topicRoutes()).toHaveLength(0); expect(getVerificationDestination()).toBeNull();
});

it('does not resume after the root unmounts during checkout lookup', async () => {
  const order = deferred<any>(); mockGetOrder.mockReturnValue(order.promise);
  await mount(); await tapNotification(); await stashPendingCheckout('order-a'); await verify(); await tick(600);
  await act(async () => tree?.unmount()); tree = undefined; const routeCount = mockRoutes.length;
  order.resolve({ status: 'paid' }); await flush();
  expect(mockRoutes).toHaveLength(routeCount); expect(getVerificationDestination()).toBeNull();
});

it('holds a migration visit behind the sync failure alert and resumes only after dismissal', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const sync = deferred<any>(); mockPhoneSync.mockReturnValue(sync.promise); mockMode = 'migration'; mockVerifyEvent = 'USER_UPDATED';
  await mount(); await tapNotification(); await verify(); await tick(600);
  expect(mockPath).toBe('/verify-code'); expect(topicRoutes()).toHaveLength(0);
  sync.resolve({ error: { message: 'offline' } }); await flush(); await tick(600);
  expect(mockPath).toBe('/verify-code'); expect(topicRoutes()).toHaveLength(0); expect(getVerificationDestination()?.destination).toBeNull();
  expect(verifyCodeSelfRoutingRef.current).toBe(false);
  const alert = tree!.root.findAllByType('AlertFixture' as any).find((node) => node.props.visible && node.props.title === "couldn't save your number")!;
  act(() => alert.props.onClose()); await flush();
  expect(topicRoutes()).toHaveLength(1); expect(getVerificationDestination()).toBeNull();
});

it('still resumes the buffered notification when durable storage is unavailable', async () => {
  await mount(); await tapNotification();
  (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await verify(); await tick(600);
  expect(topicRoutes()).toHaveLength(1); expect(getVerificationDestination()).toBeNull();
});


it('does not approve a stale tabs profile after an A to B to A account change', async () => {
  const profile = deferred<any>(); mockAuthProfileRead.mockReturnValue(profile.promise);
  await mount(); await tapNotification(); await verify(); await tick(600);
  await emitAuth('SIGNED_IN', { id: 'person-b', phone: '+12025550101' });
  await emitAuth('SIGNED_IN', { id: 'person-a', phone: '+12025550100' });
  profile.resolve({ ...mockProfile }); await flush();
  expect(topicRoutes()).toHaveLength(0); expect(getVerificationDestination()).toBeNull();
});

it('retires an unexpectedly rejected handoff read and releases the buffered notification safely', async () => {
  const pending = require('../../lib/pendingLink');
  await mount(); await tapNotification();
  jest.spyOn(pending, 'peekPendingCheckout').mockRejectedValueOnce(new Error('unavailable'));
  await verify(); await tick(600);
  expect(topicRoutes()).toHaveLength(1); expect(getVerificationDestination()).toBeNull();
});


it('does not route a completed proposal after leaving Verify while ban approval is pending', async () => {
  const ban = deferred<boolean>(); mockBanCheck.mockReturnValue(ban.promise);
  await mount(); await tapNotification(); await verify(); await tick(600);
  expect(getVerificationDestination()?.destination).toBe('/(tabs)/plans');
  act(() => mockNavigate('replace', '/phone-entry')); await flush();
  ban.resolve(false); await flush();
  expect(mockPath).toBe('/phone-entry'); expect(topicRoutes()).toHaveLength(0); expect(getVerificationDestination()).toBeNull();
});

it('retries a timed-out verification entry gate on auth recovery', async () => {
  mockAuthProfileRead.mockReturnValue(new Promise(() => {}));
  await mount(); await tapNotification(); await verify(); await tick(4600);
  expect(topicRoutes()).toHaveLength(0); expect(getVerificationDestination()?.entryApproved).toBe(false);
  mockAuthProfileRead.mockResolvedValue({ ...mockProfile });
  await emitAuth('TOKEN_REFRESHED', mockUser);
  expect(topicRoutes()).toHaveLength(1); expect(getVerificationDestination()).toBeNull();
});

it('lets the cold-start auth check finish when INITIAL_SESSION arrives first', async () => {
  const session = deferred<any>(); mockGetSession.mockReturnValue(session.promise);
  await mount(); mockUser = { id: 'person-a', phone: '+12025550100' };
  await emitAuth('INITIAL_SESSION', mockUser);
  session.resolve({ data: { session: { user: mockUser } } }); await flush(); await tick(80);
  expect(mockPath).toBe('/(tabs)/plans'); expect(authedUserIdRef.current).toBe('person-a');
});


it('still clears the account when signout follows password recovery', async () => {
  await mount(); await verify(); await emitAuth('PASSWORD_RECOVERY', mockUser);
  await emitAuth('SIGNED_OUT', null); await tick(600);
  expect(authedUserIdRef.current).toBeNull(); expect(mockPath).toBe('/phone-entry'); expect(getVerificationDestination()).toBeNull();
});

it('does not reuse a sync failure alert after the verified account changes', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockMode = 'migration'; mockVerifyEvent = 'USER_UPDATED'; mockPhoneSync.mockResolvedValue({ error: { message: 'offline' } });
  await mount(); await tapNotification(); await verify();
  const closeAlert = tree!.root.findAllByType('AlertFixture' as any).find((node) => node.props.visible && node.props.title === "couldn't save your number")!.props.onClose;
  await emitAuth('SIGNED_OUT', null); act(() => closeAlert()); await flush(); await tick(600);
  expect(mockPath).toBe('/phone-entry'); expect(topicRoutes()).toHaveLength(0); expect(getVerificationDestination()).toBeNull();
});

const reactionMessage = '33333333-3333-4333-8333-333333333333';
const expoReactionRoute = `/community-topic/22222222-2222-4222-8222-222222222222?reactionMessageId=${reactionMessage}&reactionMessageSource=topic`;
async function tapExpoReaction() {
  act(() => { for (const callback of mockExpoListeners) callback({ type: 'new_message', topicId: '22222222-2222-4222-8222-222222222222', reactionMessageId: reactionMessage, reactionMessageSource: 'topic' }); });
  await flush();
}
it('resumes an Expo reaction at the exact message only after verification and the tabs gate', async () => {
  await mount(); await tapExpoReaction(); expect(mockRoutes.some(r => r.href === expoReactionRoute)).toBe(false);
  await verify(); await tick(599); expect(mockRoutes.some(r => r.href === expoReactionRoute)).toBe(false);
  await tick(1); expect(mockRoutes.filter(r => r.href === expoReactionRoute)).toEqual([{ method: 'push', href: expoReactionRoute }]);
});
it('does not let an Expo reaction bypass incomplete onboarding', async () => {
  mockProfile.onboarding_status = 'photo'; await mount(); await tapExpoReaction(); await verify(); await tick(600);
  expect(mockPath).toBe('/onboarding/photo'); expect(mockRoutes.some(r => r.href === expoReactionRoute)).toBe(false);
  mockProfile.onboarding_status = 'complete'; act(() => mockNavigate('replace', '/(tabs)/plans')); await flush();
  expect(mockRoutes.filter(r => r.href === expoReactionRoute)).toHaveLength(1);
});
it('discards a buffered Expo reaction when the verification account changes', async () => {
  const profile = deferred<any>(); mockAuthProfileRead.mockReturnValue(profile.promise);
  await mount(); await tapExpoReaction(); await verify(); await tick(600);
  await emitAuth('SIGNED_IN', { id: 'person-b', phone: '+12025550101' });
  await emitAuth('SIGNED_IN', { id: 'person-a', phone: '+12025550100' }); profile.resolve({ ...mockProfile }); await flush();
  expect(mockRoutes.some(r => r.href === expoReactionRoute)).toBe(false);
});
it('detaches the Expo entry and ignores its retired callback after root unmount', async () => {
  await mount(); const callback = [...mockExpoListeners][0]; await act(async () => tree!.unmount()); tree = undefined; const count = mockRoutes.length;
  expect(mockExpoListeners.size).toBe(0);
  callback({ type: 'new_message', topicId: '22222222-2222-4222-8222-222222222222' }); await flush(); expect(mockRoutes).toHaveLength(count);
});

it.each(['eventId', 'circleId'])('preserves a member reaction %s through real verification gating', async parent => {
  const room = '11111111-1111-4111-8111-111111111111';
  const route = `/(tabs)/chats/${parent === 'circleId' ? 'circle/' : ''}${room}?reactionMessageId=${reactionMessage}&reactionMessageSource=chat`;
  await mount();
  act(() => { for (const callback of mockExpoListeners) callback({ type: 'new_message', [parent]: room, reactionMessageId: reactionMessage, reactionMessageSource: 'chat' }); });
  await flush(); expect(mockRoutes.some(r => r.href === route)).toBe(false);
  await verify(); await tick(600); expect(mockRoutes.filter(r => r.href === route)).toEqual([{ method: 'push', href: route }]);
});
it.each(['eventId', 'circleId'])('retires a member reaction %s when the verified account changes', async parent => {
  const profile = deferred<any>(); mockAuthProfileRead.mockReturnValue(profile.promise);
  await mount();
  act(() => { for (const callback of mockExpoListeners) callback({ type: 'new_message', [parent]: '11111111-1111-4111-8111-111111111111', reactionMessageId: reactionMessage, reactionMessageSource: 'chat' }); });
  await flush(); await verify(); await tick(600);
  await emitAuth('SIGNED_IN', { id: 'person-b', phone: '+12025550101' });
  await emitAuth('SIGNED_IN', { id: 'person-a', phone: '+12025550100' }); profile.resolve({ ...mockProfile }); await flush();
  expect(mockRoutes.some(r => r.href.includes('reactionMessageSource=chat'))).toBe(false);
});


describe('auth callback lock handoff', () => {
  function signal(event: string, user: typeof mockUser) {
    const returns: unknown[] = [];
    act(() => {
      mockUser = user;
      for (const callback of mockAuthListeners) returns.push(callback(event, user ? { user } : null));
    });
    return returns;
  }
  it('returns synchronously before any authenticated read starts, then completes fresh sign-in', async () => {
    await mount(); mockBanCheck.mockClear(); mockAuthProfileRead.mockClear(); mockMigrationRead.mockClear();
    const returned = signal('SIGNED_IN', { id: 'person-a', phone: '+12025550100' });
    expect(returned.length).toBeGreaterThan(0); expect(returned.every(value => value === undefined)).toBe(true);
    expect(mockBanCheck).not.toHaveBeenCalled(); expect(mockAuthProfileRead).not.toHaveBeenCalled(); expect(mockMigrationRead).not.toHaveBeenCalled();
    await tick(0); await tick(80);
    expect(mockBanCheck).toHaveBeenCalledTimes(1); expect(mockPath).toBe('/(tabs)/plans');
    expect(authedUserIdRef.current).toBe('person-a');
  });
  it('does not start queued work from an earlier A to B to A account visit', async () => {
    await mount(); mockBanCheck.mockClear();
    signal('SIGNED_IN', { id: 'person-a', phone: '+12025550100' });
    signal('SIGNED_IN', { id: 'person-b', phone: '+12025550101' });
    signal('SIGNED_IN', { id: 'person-a', phone: '+12025550100' });
    await tick(0); await tick(80);
    expect(mockBanCheck).toHaveBeenCalledTimes(1);
    expect(mockBanCheck).toHaveBeenCalledWith(expect.objectContaining({ id: 'person-a' }));
    expect(authedUserIdRef.current).toBe('person-a');
  });
  it.each(['SIGNED_OUT', 'PASSWORD_RECOVERY'])('immediately applies %s and retires queued sign-in work', async event => {
    await mount(); mockBanCheck.mockClear();
    const user = { id: 'person-a', phone: '+12025550100' };
    signal('SIGNED_IN', user); signal(event, event === 'SIGNED_OUT' ? null : user);
    expect(mockPath).toBe(event === 'SIGNED_OUT' ? '/phone-entry' : '/reset-password');
    await tick(80); expect(mockBanCheck).not.toHaveBeenCalled();
    expect(authedUserIdRef.current).toBeNull();
  });
  it('cancels queued auth work when the root unmounts', async () => {
    await mount(); mockBanCheck.mockClear();
    signal('SIGNED_IN', { id: 'person-a', phone: '+12025550100' });
    await act(async () => tree?.unmount()); tree = undefined; await tick(80);
    expect(mockBanCheck).not.toHaveBeenCalled(); expect(authedUserIdRef.current).toBeNull();
  });
  it('rechecks an existing migration gate only after releasing the refresh callback', async () => {
    mockUser = { id: 'person-a', phone: '' }; mockNeedsPhone = true;
    await mount(); expect(mockPath).toBe('/migration-gate');
    mockNeedsPhone = false; mockMigrationRead.mockClear(); mockAuthProfileRead.mockClear();
    const returned = signal('TOKEN_REFRESHED', mockUser);
    expect(returned.every(value => value === undefined)).toBe(true);
    expect(mockMigrationRead).not.toHaveBeenCalled(); expect(mockAuthProfileRead).not.toHaveBeenCalled();
    await tick(0); expect(mockMigrationRead).toHaveBeenCalled(); expect(mockPath).toBe('/(tabs)/plans');
  });
});


describe('cold-start session recovery', () => {
  it('does not turn a slow session read into signout and accepts its late valid result', async () => {
    const pending = deferred<any>(); mockGetSession.mockReturnValueOnce(pending.promise);
    await mount(); await tick(6000);
    expect(mockRoutes).toEqual([]);
    expect(tree!.root.findAllByProps({ accessibilityLabel: 'Retry account check' }).length).toBeGreaterThan(0);
    mockUser = { id: 'person-a', phone: '+12025550100' };
    pending.resolve({ data: { session: { user: mockUser } }, error: null });
    await flush(); await tick(80);
    expect(mockPath).toBe('/(tabs)/plans');
    expect(tree!.root.findAllByProps({ accessibilityLabel: 'Retry account check' })).toHaveLength(0);
  });
  it.each(['rejection', 'returned error'])('offers recovery for a failed account read (%s) and routes only after retry succeeds', async failure => {
    if (failure === 'rejection') mockGetSession.mockRejectedValueOnce(new Error('Offline'));
    else mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: new Error('Offline') });
    await mount(); expect(mockRoutes).toEqual([]);
    mockUser = { id: 'person-a', phone: '+12025550100' };
    act(() => tree!.root.findAllByProps({ accessibilityLabel: 'Retry account check' })[0].props.onPress());
    await flush(); await tick(80); expect(mockPath).toBe('/(tabs)/plans');
  });
  it('accepts a recovered token during unresolved startup without doing reads inside the auth callback', async () => {
    const pending = deferred<any>(); mockGetSession.mockReturnValueOnce(pending.promise);
    await mount(); await tick(6000); mockBanCheck.mockClear();
    await emitAuth('TOKEN_REFRESHED', { id: 'person-a', phone: '+12025550100' });
    expect(mockBanCheck).not.toHaveBeenCalled();
    await tick(0); await tick(80); expect(mockPath).toBe('/(tabs)/plans');
    pending.resolve({ data: { session: null }, error: null });
    await flush(); await tick(80); expect(mockPath).toBe('/(tabs)/plans');
  });
  it('ignores the old slow session after a retry confirms signout', async () => {
    const pending = deferred<any>(); mockGetSession.mockReturnValueOnce(pending.promise);
    await mount(); await tick(6000);
    act(() => tree!.root.findAllByProps({ accessibilityLabel: 'Retry account check' })[0].props.onPress());
    await flush(); await tick(80); expect(mockPath).toBe('/phone-entry');
    pending.resolve({ data: { session: { user: { id: 'retired-account' } } } });
    await flush(); await tick(80); expect(mockPath).toBe('/phone-entry'); expect(authedUserIdRef.current).toBeNull();
  });
  it('keeps an explicit signout authoritative over a delayed startup read', async () => {
    const pending = deferred<any>(); mockGetSession.mockReturnValueOnce(pending.promise);
    await mount(); await tick(6000); await emitAuth('SIGNED_OUT', null);
    pending.resolve({ data: { session: { user: { id: 'retired-account' } } } });
    await flush(); await tick(80); expect(mockPath).toBe('/phone-entry'); expect(authedUserIdRef.current).toBeNull();
    expect(tree!.root.findAllByProps({ accessibilityLabel: 'Retry account check' })).toHaveLength(0);
  });
});
