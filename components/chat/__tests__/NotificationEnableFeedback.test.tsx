jest.mock('../../ProfileButton', () => ({ __esModule: true, default: () => null }));
import React from 'react';
import { AppState, Keyboard, Linking, Text, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ChatThread from '../ChatThread';
import ProfileScreen from '../../../app/(tabs)/profile';
import { BrandedAlert } from '../../BrandedAlert';

const mockRegister = jest.fn();
const mockPermission = jest.fn();
const mockSend = jest.fn();
const mockTyping = jest.fn();
const mockBlock = jest.fn();
const mockBack = jest.fn();
const mockCameraPermission = jest.fn(), mockCamera = jest.fn(), mockLibrary = jest.fn();
const mockManipulate = jest.fn(), mockUpload = jest.fn(), mockUploadAudio = jest.fn();
const mockRecorder = { status: 'idle', durationMillis: 0, meterings: [], start: jest.fn(), stop: jest.fn(), cancel: jest.fn() };
const mockGifAvailable = true;
let mockViewerId = 'account-a';
let mockEpoch = 1;
let mockRoomId = 'plan-one';
let mockFocused = true;
const mockFocusContext = React.createContext(true);
const mockFocusCleanups = new Set<() => void>();
function mockUseFocusEffect(callback: () => (() => void) | void) {
  const focused = React.useContext(mockFocusContext);
  React.useEffect(() => {
    if (!focused) return;
    const cleanup = callback();
    if (cleanup) mockFocusCleanups.add(cleanup);
    return () => { cleanup?.(); if (cleanup) mockFocusCleanups.delete(cleanup); };
  }, [callback, focused]);
}
const mockSupabase: any = {
  auth: { getUser: jest.fn(async () => ({ data: { user: { id: mockViewerId } } })) },
  from: jest.fn(() => {
    const query: any = {
      select: () => query,
      eq: () => query,
      single: async () => ({ data: { id: mockViewerId, first_name_display: 'Liz', handle: 'liz' } }),
    };
    return query;
  }),
};
jest.mock('../../../hooks/useChat', () => ({
  isObsoleteChatOperation: () => false,
  useChat: ({ id }: { id: string }) => {
    const React = require('react');
    const userId = mockViewerId;
    const epoch = mockEpoch;
    const operationScope = React.useMemo(() => ({
      userId,
      isCurrent: () => id === mockRoomId && userId === mockViewerId && epoch === mockEpoch,
    }), [id, userId, epoch]);
    return {
      currentUserId: userId, operationScope, loading: false,
      messages: [{ id: 'message-one', user_id: 'other', message_type: 'system', content: 'Joined', created_at: '2026-09-13T12:00:00Z' }],
      sendMessage: mockSend, sendLocation: jest.fn(), sendAudio: jest.fn(), deleteMessage: jest.fn(),
      editMessage: jest.fn(), toggleReaction: jest.fn(), loadOlder: jest.fn(), refetch: jest.fn(),
    };
  },
}));
jest.mock('../../../hooks/useTypingIndicator', () => ({ useTypingIndicator: () => ({ typingUsers: [], broadcastTyping: mockTyping, stopTyping: jest.fn() }) }));
jest.mock('../../../hooks/useVoiceRecorder', () => ({ useVoiceRecorder: () => mockRecorder }));
jest.mock('../../../hooks/useBlock', () => ({ useBlock: () => ({ blockUser: mockBlock }) }));
jest.mock('../../../hooks/usePushNotifications', () => ({
  registerPushNotificationsWithResult: (...args: any[]) => mockRegister(...args),
  registerForPushNotifications: async (...args: any[]) => {
    const result = await mockRegister(...args);
    return result.status === 'registered' ? result.subscriptionId : null;
  },
  getPushPermissionStatus: (...args: any[]) => mockPermission(...args),
}));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').AfterglowFallbackFonts }) }));
jest.mock('../../../constants/FeatureFlags', () => ({ COMMUNITY_CHAT_GROUPING_ENABLED: true }));
jest.mock('../../../lib/supabase', () => ({ get supabase() { return mockSupabase; } }));
jest.mock('../../../lib/uploadPhoto', () => ({ uploadBase64ToStorage: (...args: any[]) => mockUpload(...args) }));
jest.mock('expo-image-picker', () => ({ requestCameraPermissionsAsync: (...args: any[]) => mockCameraPermission(...args), launchCameraAsync: (...args: any[]) => mockCamera(...args), launchImageLibraryAsync: (...args: any[]) => mockLibrary(...args) }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: (...args: any[]) => mockManipulate(...args), SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('../../../lib/uploadAudio', () => ({ uploadAudioToStorage: (...args: any[]) => mockUploadAudio(...args) }));
jest.mock('../../../lib/logger', () => ({ logError: jest.fn() }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn(), hapticMedium: jest.fn(), hapticHeavy: jest.fn(), hapticSelection: jest.fn(), hapticSuccess: jest.fn(), hapticWarning: jest.fn(), hapticError: jest.fn() }));
jest.mock('expo-notifications', () => ({ setBadgeCountAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), back: mockBack }), useLocalSearchParams: () => ({}), useFocusEffect: (callback: () => (() => void) | void) => mockUseFocusEffect(callback) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }) }));
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native'), { useRef } = require('react');
  return { __esModule: true, default: { View }, FadeIn: { duration: () => undefined },
    useSharedValue: (value: unknown) => useRef({ value }).current,
    useAnimatedStyle: (fn: () => unknown) => fn(), withSpring: (value: unknown) => value,
    withTiming: (value: unknown) => value, useAnimatedKeyboard: () => ({ height: { value: 0 } }),
    useAnimatedReaction: () => {}, runOnJS: (fn: unknown) => fn };
});
jest.mock('react-native-gesture-handler', () => {
  const chain = (type: string) => { const value: any = { type, callbacks: {} }; for (const name of ['onBegin', 'onFinalize', 'onEnd', 'enabled', 'activateAfterLongPress', 'onStart', 'activeOffsetX', 'failOffsetY', 'onUpdate']) value[name] = (arg: unknown) => { value.callbacks[name] = arg; return value; }; return value; };
  return { Gesture: { Tap: () => chain('tap'), Pan: () => chain('pan'), Exclusive: (...items: any[]) => ({ type: 'exclusive', items }) }, GestureDetector: ({ children }: any) => children };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialIcons: () => null }));
jest.mock('../MediaPanel', () => ({ __esModule: true, default: () => null, isChatGifPickerAvailable: () => mockGifAvailable }));
jest.mock('../ChatPhotoViewer', () => ({ ChatPhotoViewer: () => null, useChatPhotoSelection: () => ({ selectedId: null, onSelect: jest.fn(), onClose: jest.fn(), onChange: jest.fn() }) }));
jest.mock('../ChatPhotoAttachment', () => ({ ChatPhotoAttachment: () => null }));
jest.mock('../ChatPlanCard', () => ({ __esModule: true, default: () => null }));
jest.mock('../../MiniProfileCard', () => ({ __esModule: true, default: () => null }));
jest.mock('../LocationPickerModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../PhotoPreviewModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../ReactionEmojiPicker', () => ({ __esModule: true, default: () => null }));
jest.mock('../LinkPreviewCard', () => ({ __esModule: true, default: () => null }));
jest.mock('../TypingIndicator', () => ({ __esModule: true, default: () => null }));
jest.mock('../ScrollToBottomButton', () => ({ __esModule: true, default: () => null }));
jest.mock('../VoicePlayer', () => ({ __esModule: true, default: () => null }));
jest.mock('../VoiceRecorder', () => ({ __esModule: true, default: () => null }));
jest.mock('../../modals/ReportModal', () => ({ ReportModal: () => null }));
jest.mock('../../BrandedAlert', () => ({ BrandedAlert: () => null }));
jest.mock('../../yours/icons/SunriseIcon', () => ({ __esModule: true, default: () => null }));


jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => (() => void) | void) => mockUseFocusEffect(callback),
}));
jest.mock('../../../hooks/useActiveChatPresence', () => ({ useActiveChatPresence: jest.fn() }));
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => {
  const React = require('react');
  const viewerId = mockViewerId;
  const epoch = mockEpoch;
  const isCurrent = React.useCallback(() => viewerId === mockViewerId && epoch === mockEpoch, [viewerId, epoch]);
  return { viewerId, epoch, isCurrent, error: null, isLoading: false };
} }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('../../SkeletonCard', () => ({ SkeletonProfile: () => null }));
jest.mock('../../../lib/creatorMode', () => ({ getCreatorAccess: jest.fn().mockResolvedValue(null), hasCreatorAccess: () => false }));
jest.mock('../../../lib/organizerProfile', () => ({ getMyOrganizerProfile: jest.fn() }));
jest.mock('../../../lib/operatorApplications', () => ({ fetchMyGrants: jest.fn().mockResolvedValue([]) }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));

let tree: ReactTestRenderer | undefined;
let surface: 'chat' | 'profile';
let appStateCallbacks: ((state: string) => unknown)[];
const props = {
  kind: 'event' as const, title: 'A walk', subtitle: null, members: [],
  viewContextLabel: 'View Plan', onViewContext: jest.fn(),
  headerMenu: { type: 'report' as const }, fetchReportMembers: jest.fn().mockResolvedValue([]),
};
function screen() {
  return <mockFocusContext.Provider value={mockFocused}>
    {surface === 'profile' ? <ProfileScreen /> : <ChatThread {...props} id={mockRoomId} />}
  </mockFocusContext.Provider>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function flush() {
  await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
}
async function mount(target: typeof surface) {
  surface = target;
  await act(async () => { tree = create(screen()); });
  await flush();
}
async function update() {
  await act(async () => tree!.update(screen()));
  await flush();
}
function button(label: string) {
  return tree!.root.findAllByType(TouchableOpacity).find(node =>
    node.findAllByType(Text).some(text => text.props.children === label));
}
function enable() {
  return button(surface === 'profile' ? 'Enable notifications' : 'Enable')!;
}
function alert() { return tree!.root.findByType(BrandedAlert).props; }
async function pressEnable() {
  act(() => { enable().props.onPress(); });
  await flush();
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockViewerId = 'account-a'; mockEpoch = 1; mockRoomId = 'plan-one';
  mockFocused = true;
  mockFocusCleanups.clear(); appStateCallbacks = [];
  mockPermission.mockReset().mockResolvedValue('undetermined');
  mockRegister.mockReset().mockResolvedValue({ status: 'registered', subscriptionId: 'subscription-one' });
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  jest.spyOn(Keyboard, 'addListener').mockImplementation((() => ({ remove: jest.fn() })) as any);
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((event: string, callback: any) => {
    appStateCallbacks.push(callback);
    return { remove: () => { appStateCallbacks = appStateCallbacks.filter(item => item !== callback); } };
  }) as any);
});
afterEach(() => {
  act(() => tree?.unmount()); tree = undefined;
  jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks();
});

it.each(['profile', 'chat'] as const)('%s keeps failed registration retryable without cooldown or Settings claims', async target => {
  mockRegister.mockResolvedValue({ status: 'failed' });
  await mount(target);
  await pressEnable();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(Linking.openSettings).not.toHaveBeenCalled();
  if (target === 'profile') {
    expect(alert().title).not.toMatch(/enabled|are on/i);
    expect(alert().message).toContain('Try again');
    expect(alert().buttons?.some((item: any) => item.text === 'Open Settings')).not.toBe(true);
  } else {
    expect(enable()).toBeDefined();
    expect(tree!.root.findAllByType(Text).some(node => String(node.props.children).includes('Try again'))).toBe(true);
  }
  mockRegister.mockResolvedValue({ status: 'registered', subscriptionId: 'subscription-one' });
  await pressEnable();
  expect(mockRegister).toHaveBeenCalledTimes(2);
  if (target === 'profile') expect(alert().title).toBe('Notifications enabled');
  else expect(enable()).toBeUndefined();
});

it('profile does not announce success merely because OS permission is granted', async () => {
  mockPermission.mockResolvedValue('granted');
  mockRegister.mockResolvedValue({ status: 'pending' });
  await mount('profile');
  await pressEnable();
  expect(alert().title).not.toMatch(/enabled|are on/i);
  expect(alert().message).toContain('ready');
});

it.each(['profile', 'chat'] as const)('%s owns one synchronous enable attempt', async target => {
  const pending = deferred<any>();
  mockRegister.mockReturnValue(pending.promise);
  await mount(target);
  const press = enable().props.onPress;
  act(() => { press(); press(); });
  await flush();
  expect(mockRegister).toHaveBeenCalledTimes(1);
  expect(button('Turning on…')).toBeDefined();
  await act(async () => pending.resolve({ status: 'registered', subscriptionId: 'one' }));
});

it.each(['profile', 'chat'] as const)('%s cannot prompt after a pending passive result crosses account ABA', async target => {
  await mount(target);
  const pending = deferred<any>();
  mockRegister.mockReturnValueOnce(pending.promise);
  act(() => { enable().props.onPress(); });
  mockViewerId = 'account-b'; mockEpoch++;
  await update();
  mockViewerId = 'account-a'; mockEpoch++;
  await update();
  await act(async () => pending.resolve({ status: 'permission-required' }));
  await flush();
  expect(mockRegister).toHaveBeenCalledTimes(1);
  expect(mockRegister).toHaveBeenCalledWith({ prompt: false, userId: 'account-a' });
  expect(alert().visible).toBe(false);
});

it.each(['profile', 'chat'] as const)('%s ignores late registration after leaving the visible screen', async target => {
  const pending = deferred<any>();
  mockRegister.mockReturnValueOnce(pending.promise);
  await mount(target);
  await pressEnable();
  act(() => { for (const cleanup of mockFocusCleanups) cleanup(); });
  await act(async () => pending.resolve({ status: 'permission-denied' }));
  await flush();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(Linking.openSettings).not.toHaveBeenCalled();
  expect(alert().visible).toBe(false);
});

it.each(['profile', 'chat'] as const)('%s retires the prompt at the SDK boundary after leaving its visit', async target => {
  const pending = deferred<any>();
  mockRegister.mockResolvedValueOnce({ status: 'permission-required' }).mockReturnValueOnce(pending.promise);
  await mount(target); await pressEnable();
  const prompt = mockRegister.mock.calls[1][0];
  expect(prompt.prompt).toBe(true); expect(prompt.canPrompt()).toBe(true);
  mockFocused = false; await update();
  expect(prompt.canPrompt()).toBe(false);
  mockFocused = true; await update();
  expect(prompt.canPrompt()).toBe(false);
  pending.resolve({ status: 'obsolete' }); await flush();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(Linking.openSettings).not.toHaveBeenCalled();
  expect(enable()).toBeDefined();
});

it('dismissed chat notification invitation cannot open a delayed permission prompt', async () => {
  const pending = deferred<any>();
  mockRegister.mockResolvedValueOnce({ status: 'permission-required' }).mockReturnValueOnce(pending.promise);
  await mount('chat'); await pressEnable();
  const prompt = mockRegister.mock.calls[1][0];
  const dismiss = tree!.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Dismiss notification reminder')!;
  act(() => dismiss.props.onPress());
  expect(prompt.canPrompt()).toBe(false);
  pending.resolve({ status: 'obsolete' }); await flush();
  expect(enable()).toBeUndefined();
  expect(Linking.openSettings).not.toHaveBeenCalled();
});

it.each(['pending', 'opted-out', 'unavailable', 'permission-required'] as const)('chat does not mistake %s for a user denial', async status => {
  mockRegister.mockResolvedValue({ status });
  await mount('chat');
  await pressEnable();
  expect(enable()).toBeDefined();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(Linking.openSettings).not.toHaveBeenCalled();
});

it('chat keeps current denial cooldown and Settings action', async () => {
  await mount('chat');
  mockRegister.mockResolvedValue({ status: 'permission-denied' });
  await pressEnable();
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('push_banner_dismissed_at', expect.any(String));
  expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  expect(mockRegister).toHaveBeenCalledWith({ prompt: false, userId: 'account-a' });
});

it.each(['profile', 'chat'] as const)('%s uses the structured passive result when Android coarse status reports denied before a first prompt', async target => {
  // The installed Android bridge reports permissionNative=Denied for any
  // false permission. The hook's structured result also checks canRequest.
  mockPermission.mockResolvedValue('denied');
  mockRegister.mockResolvedValueOnce({ status: 'permission-required' })
    .mockResolvedValueOnce({ status: 'registered', subscriptionId: 'one' });
  await mount(target);
  await pressEnable();
  expect(mockRegister.mock.calls).toEqual([
    [{ prompt: false, userId: 'account-a' }],
    [{ prompt: true, userId: 'account-a', canPrompt: expect.any(Function) }],
  ]);
  expect(Linking.openSettings).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  if (target === 'profile') expect(alert().title).toBe('Notifications enabled');
  else expect(enable()).toBeUndefined();
});

it('chat snoozes a just-declined native prompt without immediately opening Settings', async () => {
  mockRegister.mockResolvedValueOnce({ status: 'permission-required' })
    .mockResolvedValueOnce({ status: 'permission-denied' });
  await mount('chat');
  await pressEnable();
  expect(mockRegister.mock.calls).toEqual([
    [{ prompt: false, userId: 'account-a' }],
    [{ prompt: true, userId: 'account-a', canPrompt: expect.any(Function) }],
  ]);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('push_banner_dismissed_at', expect.any(String));
  expect(Linking.openSettings).not.toHaveBeenCalled();
  expect(enable()).toBeUndefined();
});

it('chat rechecks registration without prompting when returning from its Settings action', async () => {
  mockRegister.mockResolvedValueOnce({ status: 'permission-denied' })
    .mockResolvedValueOnce({ status: 'pending' });
  await mount('chat');
  await pressEnable();
  act(() => { for (const callback of [...appStateCallbacks]) callback('active'); });
  await flush();
  expect(mockRegister.mock.calls).toEqual([
    [{ prompt: false, userId: 'account-a' }],
    [{ prompt: false, userId: 'account-a' }],
  ]);
  expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  expect(enable()).toBeDefined();
  act(() => { for (const callback of [...appStateCallbacks]) callback('active'); });
  await flush();
  expect(mockRegister).toHaveBeenCalledTimes(2);
});

it('chat keeps an early Settings return until the opening attempt has released its lock', async () => {
  mockRegister.mockResolvedValueOnce({ status: 'permission-denied' })
    .mockResolvedValueOnce({ status: 'registered', subscriptionId: 'one' });
  (Linking.openSettings as jest.Mock).mockImplementation(() => {
    for (const callback of [...appStateCallbacks]) callback('active');
    return Promise.resolve();
  });
  await mount('chat');
  await pressEnable();
  expect(mockRegister).toHaveBeenCalledTimes(2);
  expect(mockRegister.mock.calls.every(([options]) => options.prompt === false)).toBe(true);
  expect(enable()).toBeUndefined();
});

it('profile does not replace a newer result with a late Settings-open failure', async () => {
  const opening = deferred<void>();
  (Linking.openSettings as jest.Mock).mockReturnValue(opening.promise);
  mockRegister.mockResolvedValueOnce({ status: 'permission-denied' });
  await mount('profile');
  await pressEnable();
  act(() => { alert().buttons.find((item: any) => item.text === 'Open Settings').onPress(); });
  mockRegister.mockResolvedValue({ status: 'registered', subscriptionId: 'one' });
  await pressEnable();
  await act(async () => opening.reject(new Error('settings unavailable')));
  await flush();
  expect(alert().title).toBe('Notifications enabled');
});

it('profile offers Settings only for confirmed denial and guards its deferred button', async () => {
  mockRegister.mockResolvedValue({ status: 'permission-denied' });
  await mount('profile');
  await pressEnable();
  const open = alert().buttons.find((item: any) => item.text === 'Open Settings').onPress;
  mockViewerId = 'account-b'; mockEpoch++;
  await update();
  await act(async () => open());
  expect(Linking.openSettings).not.toHaveBeenCalled();
});

it.each(['profile', 'chat'] as const)('%s starts a fresh focused attempt while keeping the previous visit result retired', async target => {
  const pending = deferred<any>();
  mockRegister.mockReturnValueOnce(pending.promise);
  await mount(target);
  await pressEnable();
  mockFocused = false;
  await update();
  mockFocused = true;
  await update();
  await pressEnable();
  expect(mockRegister).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve({ status: 'permission-denied' }));
  await flush();
  expect(Linking.openSettings).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  if (target === 'profile') expect(alert().title).toBe('Notifications enabled');
  else expect(enable()).toBeUndefined();
});

it.each(['profile', 'chat'] as const)('%s keeps an unexpected registration rejection retryable', async target => {
  mockRegister.mockRejectedValueOnce(new Error('SDK unavailable'));
  await mount(target);
  await pressEnable();
  expect(Linking.openSettings).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(enable()).toBeDefined();
  if (target === 'profile') expect(alert().title).toBe('Couldn’t turn on alerts');
});

it('chat does not add a new permission prompt when returning from Settings still unasked', async () => {
  mockRegister.mockResolvedValueOnce({ status: 'permission-denied' })
    .mockResolvedValueOnce({ status: 'permission-required' });
  await mount('chat');
  await pressEnable();
  act(() => { for (const callback of [...appStateCallbacks]) callback('active'); });
  await flush();
  expect(mockRegister).toHaveBeenCalledTimes(2);
  expect(mockRegister.mock.calls.every(([options]) => options.prompt === false)).toBe(true);
  expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  expect(enable()).toBeDefined();
});

it('a retained Settings-return listener cannot register after leaving and returning to the same room', async () => {
  mockRegister.mockResolvedValueOnce({ status: 'permission-denied' });
  await mount('chat');
  await pressEnable();
  const retained = [...appStateCallbacks];
  mockRoomId = 'plan-two';
  await update();
  mockRoomId = 'plan-one';
  await update();
  act(() => { for (const callback of retained) callback('active'); });
  await flush();
  expect(mockRegister).toHaveBeenCalledTimes(1);
  expect(Linking.openSettings).toHaveBeenCalledTimes(1);
});
