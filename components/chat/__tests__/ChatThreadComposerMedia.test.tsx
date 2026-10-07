jest.mock('../../ProfileButton', () => ({ __esModule: true, default: () => null }));
import React from 'react';
import { Keyboard, Platform, TextInput, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ChatThread from '../ChatThread';
import AttachmentPanel from '../AttachmentSheet';
import MediaPanel from '../MediaPanel';
import ReactionEmojiPicker from '../ReactionEmojiPicker';

const mockSend = jest.fn().mockResolvedValue(undefined), mockTyping = jest.fn();
const mockRead = jest.fn(), mockBlock = jest.fn();
const mockChat = { messages: [], loading: false, currentUserId: 'account-a', sendMessage: mockSend, sendLocation: jest.fn(), sendAudio: jest.fn(), deleteMessage: jest.fn(), editMessage: jest.fn(), toggleReaction: jest.fn(), loadOlder: jest.fn(), refetch: mockRead };
const mockRecorder = { status: 'idle', durationMillis: 0, meterings: [], start: jest.fn(), stop: jest.fn(), cancel: jest.fn() };
let mockGifAvailable = true;

jest.mock('../../../hooks/useChat', () => ({ useChat: () => mockChat }));
jest.mock('../../../hooks/useTypingIndicator', () => ({ useTypingIndicator: () => ({ typingUsers: [], broadcastTyping: mockTyping, stopTyping: jest.fn() }) }));
jest.mock('../../../hooks/useVoiceRecorder', () => ({ useVoiceRecorder: () => mockRecorder }));
jest.mock('../../../hooks/useBlock', () => ({ useBlock: () => ({ blockUser: mockBlock }) }));
jest.mock('../../../hooks/usePushNotifications', () => ({ registerForPushNotifications: jest.fn(), getPushPermissionStatus: jest.fn() }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').AfterglowFallbackFonts }) }));
jest.mock('../../../constants/FeatureFlags', () => ({ COMMUNITY_CHAT_GROUPING_ENABLED: true }));
jest.mock('../../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../../lib/uploadPhoto', () => ({ uploadBase64ToStorage: jest.fn() }));
jest.mock('../../../lib/uploadAudio', () => ({ uploadAudioToStorage: jest.fn() }));
jest.mock('../../../lib/logger', () => ({ logError: jest.fn() }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn(), hapticMedium: jest.fn(), hapticHeavy: jest.fn(), hapticSelection: jest.fn(), hapticSuccess: jest.fn(), hapticWarning: jest.fn(), hapticError: jest.fn() }));
jest.mock('expo-notifications', () => ({ setBadgeCountAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), back: jest.fn() }), useFocusEffect: () => {} }));
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
  const chain = () => { const value: any = {}; for (const name of ['onEnd', 'enabled', 'activateAfterLongPress', 'onStart', 'activeOffsetX', 'failOffsetY', 'onUpdate']) value[name] = () => value; return value; };
  return { Gesture: { Tap: chain, Pan: chain, Exclusive: () => ({}) }, GestureDetector: ({ children }: any) => children };
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

let tree: ReactTestRenderer | undefined;
const keyboardEvents = new Map<string, (event: any) => void>();
const baseProps = { kind: 'event' as const, id: 'plan-one', title: 'A walk', subtitle: null, members: [], viewContextLabel: 'View Plan', onViewContext: jest.fn(), headerMenu: { type: 'report' as const } };
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks(); mockGifAvailable = true; keyboardEvents.clear();
  jest.requireMock('../../../constants/FeatureFlags').COMMUNITY_CHAT_GROUPING_ENABLED = true;
  jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((name: string, callback: (event: any) => void) => { keyboardEvents.set(name, callback); return { remove: jest.fn() }; }) as any);
});
afterEach(() => { act(() => tree?.unmount()); tree = undefined; jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });
const action = (label: string) => tree!.root.findAllByType(TouchableOpacity).find(button => button.props.accessibilityLabel === label);
const input = () => tree!.root.findAllByType(TextInput).find(field => field.props.placeholder === 'Message...')!;
async function mount(platform: 'ios' | 'android' | 'web', staged = true, readOnly = false) {
  jest.replaceProperty(Platform, 'OS', platform);
  jest.requireMock('../../../constants/FeatureFlags').COMMUNITY_CHAT_GROUPING_ENABLED = staged;
  await act(async () => { tree = create(<ChatThread {...baseProps} readOnly={readOnly ? { text: 'This chat is closed' } : null} />); });
}

it.each(['ios', 'android'] as const)('uses the normal multiline keyboard for staged %s emoji entry', async platform => {
  await mount(platform);
  expect(action('Open emoji picker')).toBeUndefined();
  expect(action('Add attachment')).toBeDefined();
  expect(input().props).toMatchObject({ keyboardType: 'default', returnKeyType: 'default', multiline: true, autoCorrect: true });
  expect(input().props.numberOfLines).toBeUndefined();
  act(() => input().props.onChangeText('Hello 👋🏽'));
  expect(input().props.value).toBe('Hello 👋🏽');
  expect(mockSend).not.toHaveBeenCalled();
  expect(tree!.root.findByType(ReactionEmojiPicker)).toBeDefined();
});

it.each([['ios', false], ['android', false], ['web', true]] as const)('retains the emoji fallback on %s with staged=%s', async (platform, staged) => {
  await mount(platform, staged);
  expect(action('Open emoji picker')).toBeDefined();
  act(() => action('Open emoji picker')!.props.onPress());
  expect(tree!.root.findByType(MediaPanel).props.mode).toBeUndefined();
  expect(tree!.root.findByType(MediaPanel).props.onSelect).toEqual(expect.any(Function));
  expect(action('Show keyboard')).toBeDefined();
});

it.each(['ios', 'android'] as const)('opens the available GIF destination from attachments on %s and hands its space back to the keyboard', async platform => {
  await mount(platform);
  act(() => action('Add attachment')!.props.onPress());
  const attachment = tree!.root.findByType(AttachmentPanel);
  expect(attachment.props.showGif).toBe(true);
  const height = attachment.props.height;
  act(() => attachment.props.onSelect('gif'));
  const media = tree!.root.findByType(MediaPanel);
  expect(media.props).toMatchObject({ mode: 'gif-only', height, bottomInset: 34 });
  expect(tree!.root.findAllByType(AttachmentPanel)).toHaveLength(0);
  expect(mockSend).not.toHaveBeenCalled();
  const focus = jest.spyOn(input().instance, 'focus');
  act(() => action('Show keyboard')!.props.onPress());
  expect(focus).toHaveBeenCalledTimes(1);
  expect(tree!.root.findByType(MediaPanel)).toBeDefined(); // Retain inset until keyboard takes over.
  jest.spyOn(input().instance, 'isFocused').mockReturnValue(true);
  act(() => keyboardEvents.get(platform === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow')!({ endCoordinates: { height: 300 } }));
  if (platform === 'ios') {
    expect(tree!.root.findByType(MediaPanel).props.height).toBe(height);
    act(() => keyboardEvents.get('keyboardDidShow')!({ endCoordinates: { height: 300 } }));
  }
  expect(tree!.root.findAllByType(MediaPanel)).toHaveLength(0);
});

it.each([['ios', true, false], ['web', true, true], ['android', false, true]] as const)('does not add an unavailable or non-staged attachment GIF destination (%s, %s, %s)', async (platform, staged, available) => {
  mockGifAvailable = available;
  await mount(platform, staged);
  act(() => action('Add attachment')!.props.onPress());
  const attachment = tree!.root.findByType(AttachmentPanel);
  expect(attachment.props.showGif).toBe(false);
  act(() => attachment.props.onSelect('gif'));
  expect(tree!.root.findAllByType(MediaPanel)).toHaveLength(0);
  expect(mockSend).not.toHaveBeenCalled();
});

it('keeps the existing GIF send callback and closed-chat composer gate', async () => {
  await mount('ios');
  act(() => action('Add attachment')!.props.onPress());
  act(() => tree!.root.findByType(AttachmentPanel).props.onSelect('gif'));
  await act(async () => { await tree!.root.findByType(MediaPanel).props.onGifSelect('https://example.invalid/local.gif'); });
  expect(mockSend).toHaveBeenCalledWith('', 'https://example.invalid/local.gif', undefined, expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i), expect.objectContaining({ userId: 'account-a', isCurrent: expect.any(Function) }));
  expect(tree!.root.findAllByType(MediaPanel)).toHaveLength(0);
  act(() => tree!.update(<ChatThread {...baseProps} readOnly={{ text: 'This chat is closed' }} />));
  expect(action('Add attachment')).toBeUndefined();
  expect(input()).toBeUndefined();
});


it.each(['cancelled', 'blurred'] as const)('keeps the iOS attachment reservation after a %s keyboard handoff', async reason => {
  await mount('ios');
  act(() => action('Add attachment')!.props.onPress());
  const height = tree!.root.findByType(AttachmentPanel).props.height;
  const focused = jest.spyOn(input().instance, 'isFocused').mockReturnValue(true);
  act(() => action('Show keyboard')!.props.onPress());
  act(() => keyboardEvents.get('keyboardWillShow')!({ endCoordinates: { height: 300 } }));
  expect(tree!.root.findByType(AttachmentPanel).props.height).toBe(height);
  if (reason === 'cancelled') act(() => keyboardEvents.get('keyboardWillHide')!({}));
  else focused.mockReturnValue(false);
  act(() => keyboardEvents.get('keyboardDidShow')!({ endCoordinates: { height: 300 } }));
  expect(tree!.root.findByType(AttachmentPanel).props.height).toBe(height);
  expect(mockSend).not.toHaveBeenCalled();
});
