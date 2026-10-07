jest.mock('../../ProfileButton', () => ({ __esModule: true, default: () => null }));
import React from 'react';
import { AppState, FlatList, Keyboard, Linking, Text, TextInput, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ChatThread from '../ChatThread';
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
let mockMembers: any[] = [];
let mockFontScale = 1;
const mockFontListeners = new Set<(value: number) => void>();
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => {
  const React = require('react'); const [fontScale, setScale] = React.useState(mockFontScale);
  React.useEffect(() => { mockFontListeners.add(setScale); return () => { mockFontListeners.delete(setScale); }; }, []);
  return { width: 390, height: 844, scale: 3, fontScale };
} }));
function resizeFont(scale: number) { act(() => { mockFontScale = scale; mockFontListeners.forEach(update => update(scale)); }); }
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
    {<ChatThread {...props} members={mockMembers} id={mockRoomId} />}
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
  mockViewerId = 'account-a'; mockEpoch = 1; mockRoomId = 'plan-one'; mockMembers = []; mockFontScale = 1;
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


it('refreshes member names and overflow without collapsing expanded members or replacing the chat list/draft', async () => {
  mockMembers = ['Juniper', 'Rowan', 'Fern', 'Hazel', 'Wren', 'Iris'].map((name, i) => ({ id: `member-${i}`, first_name: name, avatar_url: null }));
  await mount('chat');
  const input = () => tree!.root.findAllByType(TextInput).find(node => node.props.placeholder === 'Message...')!;
  act(() => input().props.onChangeText('Keep my words'));
  const list = tree!.root.findByType(FlatList), field = input();
  const label = () => tree!.root.findAllByType(Text).find(node => node.props.children === 'Juniper')!;
  const overflow = () => tree!.root.findAllByType(Text).find(node => Array.isArray(node.props.children) && node.props.children.join('') === '+2')!;
  const member = tree!.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'View Juniper profile')!;
  const oldName = label(), oldOverflow = overflow();
  resizeFont(2); await flush();
  expect(label()).not.toBe(oldName); expect(overflow()).not.toBe(oldOverflow);
  act(() => tree!.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Show 2 more members')!.props.onPress());
  const expandedName = label(); resizeFont(1); await flush();
  expect(label()).not.toBe(expandedName);
  expect(tree!.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'View Iris profile')).toBeDefined();
  expect(tree!.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'View Juniper profile')).toBe(member);
  expect(tree!.root.findByType(FlatList)).toBe(list); expect(input()).toBe(field); expect(input().props.value).toBe('Keep my words');
});

it('refreshes notification body and pending Enable label without retrying registration or dropping the pending lock', async () => {
  const pending = deferred<any>(); mockRegister.mockReturnValue(pending.promise);
  await mount('chat');
  const body = () => tree!.root.findAllByType(Text).find(node => node.props.children === 'Get alerts for new messages.')!;
  const label = () => tree!.root.findAllByType(Text).find(node => node.props.children === 'Turning on…')!;
  await pressEnable(); const button = enable() ?? tree!.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityState?.busy)!;
  const list = tree!.root.findByType(FlatList); let oldBody = body(), oldLabel = label();
  for (const scale of [2, 1]) {
    resizeFont(scale); await flush();
    expect(body()).not.toBe(oldBody); expect(label()).not.toBe(oldLabel); oldBody = body(); oldLabel = label();
    expect(tree!.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityState?.busy)).toBe(button);
    expect(button.props.disabled).toBe(true); expect(tree!.root.findByType(FlatList)).toBe(list);
    expect(mockRegister).toHaveBeenCalledTimes(1);
  }
  await act(async () => pending.resolve({ status: 'registered', subscriptionId: 'saved' })); await flush();
  expect(tree!.root.findAllByType(Text).find(node => node.props.children === 'Turning on…')).toBeUndefined();
});
