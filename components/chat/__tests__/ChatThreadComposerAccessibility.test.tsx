jest.mock('../../ProfileButton', () => ({ __esModule: true, default: () => null }));
import { MessageActionsMenu } from '../MessageActionsMenu';
import ReactionEmojiPicker from '../ReactionEmojiPicker';
import { Modal } from 'react-native';
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Alert, Animated as NativeAnimated, FlatList, Keyboard, Platform, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ChatThread from '../ChatThread';
import AttachmentPanel from '../AttachmentSheet';
import MediaPanel from '../MediaPanel';
import VoiceRecorder from '../VoiceRecorder';
import ScrollToBottomButton from '../ScrollToBottomButton';
import { ChatContextHeader } from '../ChatContextHeader';
import { GestureDetector } from 'react-native-gesture-handler';

let mockRunFocus = false;
const mockFocusCleanups = new Set<() => void>();
let mockScopeCurrent = true;
const mockOperationScope = { userId: 'account-a', isCurrent: () => mockScopeCurrent };
jest.mock('../../../lib/chatComposerDraft', () => ({ ...jest.requireActual('../../../lib/chatComposerDraft'), verifyChatComposerTarget: async () => undefined, checkChatComposerAttempt: async () => true }));
const mockSend = jest.fn().mockResolvedValue(undefined), mockTyping = jest.fn();
const mockRead = jest.fn(), mockBlock = jest.fn();
const mockNavigate = jest.fn(), mockReplace = jest.fn();
const mockChat = { messages: [] as any[], loading: false, operationScope: mockOperationScope, currentUserId: 'account-a', sendMessage: mockSend, sendLocation: jest.fn(), sendAudio: jest.fn(), deleteMessage: jest.fn(), editMessage: jest.fn(), toggleReaction: jest.fn(), loadOlder: jest.fn(), refetch: mockRead };
const mockRecorder = { status: 'idle', durationMillis: 0, meterings: [], start: jest.fn(), stop: jest.fn(), cancel: jest.fn(), pause: jest.fn(), resume: jest.fn() };
let mockGifAvailable = true;
let mockNativeKeyboardHeight = 0;
let mockPanelAnimationPending = false;

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
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace, navigate: mockNavigate, back: jest.fn() }), useFocusEffect: (callback: any) => require('react').useEffect(() => {
  if (!mockRunFocus) return;
  const cleanup = callback();
  if (cleanup) mockFocusCleanups.add(cleanup);
  return () => { if (cleanup) { mockFocusCleanups.delete(cleanup); cleanup(); } };
}, [callback]) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }) }));
jest.mock('react-native-keyboard-controller', () => {
  const height = new (require('react-native').Animated.Value)(0);
  return {
    ...require('react-native-keyboard-controller/jest'),
    useKeyboardAnimation: () => ({ height }),
    useAnimatedKeyboard: () => ({ height: { value: mockNativeKeyboardHeight }, state: { value: 4 } }),
    __testHeight: height,
  };
});
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native'), { useRef } = require('react');
  return { __esModule: true, default: { View }, FadeIn: { duration: () => undefined },
    useSharedValue: (value: unknown) => useRef({ value }).current,
    useAnimatedStyle: (fn: () => unknown) => fn(), withSpring: (value: unknown) => value,
    withTiming: (value: unknown) => mockPanelAnimationPending ? 0 : value, useAnimatedKeyboard: () => ({ height: { value: mockNativeKeyboardHeight } }),
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

let tree: ReactTestRenderer | undefined;
let roomId = 'plan-one';
let readOnly: { text: string } | null = null;
const baseProps = { kind: 'event' as const, title: 'A walk', subtitle: null, members: [], viewContextLabel: 'View Plan', onViewContext: jest.fn(), headerMenu: { type: 'report' as const } };
function screen() { return <ChatThread {...baseProps} id={roomId} readOnly={readOnly} />; }
const input = () => tree!.root.findAllByType(TextInput).find(field => field.props.placeholder === 'Message...')!;
const control = (label: string) => tree!.root.findAll(node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label)[0];
const voice = () => tree!.root.findByType(VoiceRecorder).props;
const morph = () => tree!.root.findAllByType(GestureDetector).find(node => node.props.gesture?.type === 'exclusive')!;
const gesture = (kind: string) => morph().props.gesture.items.find((item: any) => item.type === kind).callbacks;
const message = (id: string) => ({ id, event_id: 'plan-one', user_id: 'account-a', content: 'Original message', created_at: new Date().toISOString(), message_type: 'user', sender: { id: 'account-a', first_name: 'Alex', avatar_url: null }, reactions: [] });
const messageControls = (id: string) => tree!.root.findAll(node => node.props.message?.id === id && typeof node.props.onMessageLongPress === 'function')[0].props;
function type(text: string) { act(() => input().props.onChangeText(text)); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function flush() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); }
async function mount(platform: 'ios' | 'android' | 'web' = 'ios', staged = true) {
  jest.replaceProperty(Platform, 'OS', platform);
  jest.requireMock('../../../constants/FeatureFlags').COMMUNITY_CHAT_GROUPING_ENABLED = staged;
  await act(async () => { tree = create(screen()); });
}
async function update() { await act(async () => tree!.update(screen())); }
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.requireMock('react-native-keyboard-controller').__testHeight.setValue(0);
  jest.useFakeTimers(); jest.clearAllMocks(); roomId = 'plan-one'; readOnly = null; mockScopeCurrent = true; mockChat.messages = []; mockChat.loading = false; mockNativeKeyboardHeight = 0; mockPanelAnimationPending = false;
  mockSend.mockReset().mockResolvedValue(true); mockChat.sendAudio.mockReset().mockResolvedValue(true); mockChat.editMessage.mockReset().mockResolvedValue(true);
  mockRecorder.start.mockReset().mockResolvedValue(true);
  mockRecorder.stop.mockReset().mockResolvedValue({ uri: 'file:///local.m4a', durationSeconds: 4 }); mockRecorder.cancel.mockReset().mockResolvedValue(undefined);
  jest.requireMock('../../../lib/uploadAudio').uploadAudioToStorage.mockResolvedValue('https://example.invalid/local.m4a');
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  jest.spyOn(Keyboard, 'addListener').mockImplementation((() => ({ remove: jest.fn() })) as any);
});
afterEach(() => { act(() => tree?.unmount()); tree = undefined; jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

it.each(['ios', 'android'] as const)('exposes one named %s voice activation that starts controllable recording without sending', async platform => {
  await mount(platform);
  const button = control('Record voice message');
  expect(button).toBeDefined();
  expect(button.props.accessible).toBe(true);
  expect(button.props.accessibilityHint).toContain('stop');
  await act(async () => { if (platform === 'ios') button.props.onAccessibilityTap(); else button.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } }); });
  expect(mockRecorder.start).toHaveBeenCalledTimes(1);
  expect(voice().mode).toBe('locked');
  expect(mockRecorder.stop).not.toHaveBeenCalled(); expect(mockChat.sendAudio).not.toHaveBeenCalled(); expect(mockSend).not.toHaveBeenCalled();
});

it('exposes text send and preserves the synchronous send lock', async () => {
  const pending = deferred<boolean>(); mockSend.mockReturnValueOnce(pending.promise);
  await mount(); type('Hello');
  const activate = control('Send message')?.props.onAccessibilityTap;
  expect(activate).toEqual(expect.any(Function));
  act(() => { activate(); activate(); }); await flush();
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(mockSend.mock.calls[0][0]).toBe('Hello');
  expect(mockRecorder.start).not.toHaveBeenCalled();
  await act(async () => pending.resolve(true));
});

it('exposes a labeled 44-point reply cancel that preserves the typed draft', async () => {
  mockChat.messages = [message('reply')]; await mount();
  act(() => messageControls('reply').onStartReply('reply')); type('My draft');
  const cancel = control('Cancel reply'); expect(cancel).toBeDefined();
  const size = StyleSheet.flatten(cancel.props.style);
  expect(size.minWidth).toBeGreaterThanOrEqual(44); expect(size.minHeight).toBeGreaterThanOrEqual(44);
  act(() => cancel.props.onPress());
  expect(control('Cancel reply')).toBeUndefined(); expect(input().props.value).toBe('My draft');
});

it('exposes a labeled 44-point edit cancel with the existing clear behavior', async () => {
  mockChat.messages = [message('edit')]; await mount();
  const controls = messageControls('edit'); act(() => controls.onMessageLongPress(controls.message, true));
  const edit = tree!.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === 'Edit'))!;
  act(() => edit.props.onPress());
  act(() => tree!.root.findByType(MessageActionsMenu).findByType(Modal).props.onDismiss()); expect(input().props.value).toBe('Original message');
  const cancel = control('Cancel edit'); expect(cancel).toBeDefined();
  const size = StyleSheet.flatten(cancel.props.style);
  expect(size.minWidth).toBeGreaterThanOrEqual(44); expect(size.minHeight).toBeGreaterThanOrEqual(44);
  act(() => cancel.props.onPress()); expect(input().props.value).toBe(''); expect(control('Cancel edit')).toBeUndefined();
});

it.each(['Enter', ' '] as const)('supports web %s without sending an initial voice recording or repeating held keys', async key => {
  await mount('web');
  const button = control('Record voice message'); const preventDefault = jest.fn();
  expect(button.props.tabIndex).toBe(0);
  await act(async () => {
    button.props.onKeyDown({ key, repeat: false, preventDefault });
    button.props.onKeyDown({ key, repeat: true, preventDefault });
  });
  expect(preventDefault).toHaveBeenCalledTimes(2);
  expect(mockRecorder.start).toHaveBeenCalledTimes(1); expect(voice().mode).toBe('locked');
  expect(mockRecorder.stop).not.toHaveBeenCalled(); expect(mockChat.sendAudio).not.toHaveBeenCalled();
});

it('sends web text with Enter, ignores other keys and does not route pointer clicks twice', async () => {
  await mount('web'); type('Keyboard draft');
  const button = control('Send message'); const preventDefault = jest.fn();
  act(() => {
    button.props.onKeyDown({ key: 'a', preventDefault });
    button.props.onKeyDown({ key: 'Enter', ctrlKey: true, preventDefault });
  });
  expect(mockSend).not.toHaveBeenCalled(); expect(preventDefault).not.toHaveBeenCalled();
  await act(async () => button.props.onKeyDown({ key: 'Enter', repeat: false, preventDefault }));
  expect(mockSend).toHaveBeenCalledTimes(1); expect(mockRecorder.start).not.toHaveBeenCalled();
});

it.each([0, 1])('handles web clicks with detail=%s once and opens deliberate recording controls', async detail => {
  await mount('web');
  const button = control('Record voice message');
  await act(async () => { button.props.onClick({ detail }); button.props.onClick({ detail }); });
  expect(mockRecorder.start).toHaveBeenCalledTimes(1); expect(voice().mode).toBe('locked');
});

it('requires an explicit recording control before stop, preview, upload or send', async () => {
  await mount(); await act(async () => control('Record voice message').props.onAccessibilityTap());
  expect(control('Record voice message').props).toMatchObject({ accessible: false, 'aria-hidden': true, tabIndex: -1 });
  expect(jest.requireMock('../../../lib/uploadAudio').uploadAudioToStorage).not.toHaveBeenCalled();
  act(() => voice().onPauseResume()); expect(mockRecorder.pause).toHaveBeenCalledTimes(1);
  await act(async () => voice().onStop()); expect(voice().mode).toBe('draft');
  expect(mockChat.sendAudio).not.toHaveBeenCalled();
  await act(async () => voice().onSend());
  expect(mockChat.sendAudio).toHaveBeenCalledTimes(1);
  expect(mockChat.sendAudio.mock.calls[0][2]).toEqual(expect.objectContaining({ userId: 'account-a', isCurrent: expect.any(Function) }));
});

it('retains the existing microphone permission failure without sending', async () => {
  mockRecorder.start.mockResolvedValueOnce(false);
  await mount(); await act(async () => control('Record voice message').props.onAccessibilityTap());
  expect(tree!.root.findAllByType(VoiceRecorder)).toHaveLength(0);
  expect(Alert.alert).toHaveBeenCalledWith('Microphone needed', expect.any(String));
  expect(mockChat.sendAudio).not.toHaveBeenCalled();
  expect(control('Record voice message').props.accessibilityState.disabled).toBe(false);
});

it('serializes accessible activations while microphone preparation is pending', async () => {
  const pending = deferred<boolean>(); mockRecorder.start.mockReturnValueOnce(pending.promise);
  await mount(); const button = control('Record voice message');
  act(() => { button.props.onAccessibilityTap(); button.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } }); });
  expect(mockRecorder.start).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(true));
  expect(voice().mode).toBe('locked'); expect(mockRecorder.stop).not.toHaveBeenCalled();
});

it.each(['room', 'account', 'closed'] as const)('retires accessible callbacks when the %s changes', async change => {
  await mount(); type('Private text'); const oldText = control('Send message').props.onAccessibilityTap;
  type(''); const oldVoice = control('Record voice message').props.onAccessibilityTap;
  if (change === 'room') roomId = 'plan-two';
  if (change === 'account') mockScopeCurrent = false;
  if (change === 'closed') readOnly = { text: 'This chat is closed' };
  await update();
  await act(async () => { oldText(); oldVoice(); });
  expect(mockSend).not.toHaveBeenCalled(); expect(mockRecorder.start).not.toHaveBeenCalled();
});

it('does not finish microphone preparation into a different room', async () => {
  const pending = deferred<boolean>(); mockRecorder.start.mockReturnValueOnce(pending.promise);
  await mount(); act(() => control('Record voice message').props.onAccessibilityTap());
  roomId = 'plan-two'; await update(); await act(async () => pending.resolve(true));
  expect(tree!.root.findAllByType(VoiceRecorder)).toHaveLength(0); expect(mockChat.sendAudio).not.toHaveBeenCalled();
});

it.each([true, false])('preserves physical hold, swipe lock and preview with staged=%s', async staged => {
  await mount('ios', staged);
  act(() => gesture('tap').onEnd({}, true)); expect(mockRecorder.start).not.toHaveBeenCalled();
  expect(gesture('pan').activateAfterLongPress).toBeGreaterThan(0);
  await act(async () => gesture('pan').onStart()); expect(voice().mode).toBe('holding');
  act(() => gesture('pan').onEnd({ translationX: 0, translationY: -999 })); expect(voice().mode).toBe('locked');
  await act(async () => voice().onStop()); expect(voice().mode).toBe('draft'); expect(mockChat.sendAudio).not.toHaveBeenCalled();
});

it('preserves physical release-to-send and swipe-to-cancel outcomes', async () => {
  await mount(); await act(async () => gesture('pan').onStart());
  act(() => gesture('pan').onEnd({ translationX: 0, translationY: 0 })); await flush();
  expect(mockChat.sendAudio).toHaveBeenCalledTimes(1);
  await act(async () => gesture('pan').onStart());
  act(() => gesture('pan').onEnd({ translationX: -999, translationY: 0 })); await flush();
  expect(mockRecorder.cancel).toHaveBeenCalled(); expect(mockChat.sendAudio).toHaveBeenCalledTimes(1);
});

it('keeps a retained reply cancel from changing the next room draft', async () => {
  mockChat.messages = [message('reply')]; await mount();
  act(() => messageControls('reply').onStartReply('reply')); const cancel = control('Cancel reply').props.onPress;
  roomId = 'plan-two'; await update(); type('New room draft'); act(() => cancel());
  expect(input().props.value).toBe('New room draft');
});

it('leaves iOS multiline height native while drafts change without content-size events', async () => {
  await mount('ios', true);
  for (const draft of ['One line', 'One\nTwo\nThree\nFour\nFive\nSix\nSeven\nEight', '']) {
    type(draft);
    const style = require('react-native').StyleSheet.flatten(input().props.style);
    expect(style.height).toBeUndefined();
    expect(style.minHeight).toBe(44);
    expect(style.maxHeight).toBe(100);
    expect(input().props.value).toBe(draft);
  }
});

async function updateMessages(){await act(async()=>tree!.update(<ChatThread {...baseProps} members={[...baseProps.members]} id={roomId} readOnly={readOnly}/>));}
const historyMessage=(id:string,minutes:number,user='account-b')=>({...message(id),user_id:user,created_at:new Date(Date.UTC(2026,8,19,17,minutes)).toISOString()});
it('keeps visible history mounted through a foreground refresh',async()=>{
 mockChat.messages=[historyMessage('latest',30)];await mount();
 const list=tree!.root.findByType(FlatList);mockChat.loading=true;await updateMessages();
 expect(tree!.root.findByType(FlatList)).toBe(list);
});
it('counts only newly arrived messages below, never older pagination or own messages',async()=>{
 mockChat.messages=[historyMessage('latest',30)];await mount();
 act(()=>tree!.root.findByType(FlatList).props.onScroll({nativeEvent:{contentOffset:{y:500}}}));
 mockChat.messages=[historyMessage('older',10),...mockChat.messages];await updateMessages();
 expect(tree!.root.findByType(ScrollToBottomButton).props.count).toBe(0);
 mockChat.messages=[...mockChat.messages,historyMessage('incoming',31)];await updateMessages();
 expect(tree!.root.findByType(ScrollToBottomButton).props.count).toBe(1);
 // Deletion plus arrival leaves the array length unchanged.
 mockChat.messages=[...mockChat.messages.filter(m=>m.id!=='older'),historyMessage('incoming-two',32)];await updateMessages();
 expect(tree!.root.findByType(ScrollToBottomButton).props.count).toBe(2);
 mockChat.messages=[...mockChat.messages,historyMessage('own',33,'account-a')];await updateMessages();
 expect(tree!.root.findByType(ScrollToBottomButton).props.count).toBe(2);
 act(()=>tree!.root.findByType(FlatList).props.onScroll({nativeEvent:{contentOffset:{y:0}}}));
 expect(tree!.root.findByType(ScrollToBottomButton).props.count).toBe(0);
});
it('preserves an older reading position when the keyboard opens and follows the latest only at the bottom',async()=>{
 mockChat.messages=[historyMessage('latest',30)];await mount();
 const list=tree!.root.findByType(FlatList);const scroll=jest.spyOn(list.instance,'scrollToOffset').mockImplementation(()=>{});
 const show=(Keyboard.addListener as jest.Mock).mock.calls.find(([name])=>name==='keyboardWillShow')[1];
 act(()=>list.props.onScroll({nativeEvent:{contentOffset:{y:500}}}));
 act(()=>show({endCoordinates:{height:300}}));expect(scroll).not.toHaveBeenCalled();
 act(()=>list.props.onScroll({nativeEvent:{contentOffset:{y:0}}}));
 act(()=>show({endCoordinates:{height:300}}));expect(scroll).toHaveBeenCalledWith({offset:0,animated:false});
 scroll.mockClear();mockScopeCurrent=false;act(()=>show({endCoordinates:{height:300}}));expect(scroll).not.toHaveBeenCalled();
});

function nativeKeyboardStyle(kind: 'dock' | 'viewport') {
  const nodes = tree!.root.findAllByType(NativeAnimated.View);
  const node = kind === 'dock'
    ? nodes.find(candidate => candidate.props.testID === 'chat-bottom-dock')!
    : nodes.find(candidate => StyleSheet.flatten(candidate.props.style)?.paddingTop !== undefined
      && StyleSheet.flatten(candidate.props.style)?.transform)!;
  return StyleSheet.flatten(node.props.style) as any;
}
function nativeTranslation(kind: 'dock' | 'viewport') {
  const value = nativeKeyboardStyle(kind).transform[0].translateY;
  return typeof value === 'number' ? value : value.__getValue();
}
function nativeKeyboardEvent(name: string, height: number) {
  act(() => (Keyboard.addListener as jest.Mock).mock.calls.filter(([event]) => event === name)
    .forEach(([, listener]) => listener({ endCoordinates: { height } })));
}
function nativeKeyboardMotion(height: number) {
  act(() => jest.requireMock('react-native-keyboard-controller').__testHeight.setValue(-height));
}

it('keeps the iOS message viewport and dock aligned to intermediate native keyboard heights without moving history', async () => {
  mockChat.messages = [historyMessage('latest', 30)]; await mount('ios');
  const list = () => tree!.root.findByType(FlatList);
  const dock = () => tree!.root.findAll(node => node.props.testID === 'chat-bottom-dock')[0];
  act(() => dock().props.onLayout({ nativeEvent: { layout: { height: 64 } } }));
  act(() => list().props.onScroll({ nativeEvent: { contentOffset: { y: 500 } } }));
  const scroll = jest.spyOn(list().instance, 'scrollToOffset').mockImplementation(() => {});
  const dockGraph = nativeKeyboardStyle('dock').transform[0].translateY;
  const viewportGraph = nativeKeyboardStyle('viewport').transform[0].translateY;
  // The JS event reports the final target. Native graph motion must follow
  // intermediate frames without a React layout commit or a history scroll.
  nativeKeyboardEvent('keyboardWillShow', 300);
  for (const height of [0, 140, 300]) {
    nativeKeyboardMotion(height);
    expect([nativeTranslation('dock'), nativeTranslation('viewport')]).toEqual([-Math.max(height, 34), -Math.max(height, 34)]);
    expect(nativeKeyboardStyle('viewport').paddingTop).toBe(34);
    expect(nativeKeyboardStyle('dock').transform[0].translateY).toBe(dockGraph);
    expect(nativeKeyboardStyle('viewport').transform[0].translateY).toBe(viewportGraph);
    expect(StyleSheet.flatten(list().props.contentContainerStyle).paddingTop).toBe(72);
    expect(list().props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 });
    act(() => list().props.onLayout());
  }
  nativeKeyboardEvent('keyboardDidShow', 300);
  expect(nativeKeyboardStyle('viewport').paddingTop).toBe(300);
  nativeKeyboardEvent('keyboardWillHide', 0);
  for (const height of [90, 0]) {
    nativeKeyboardMotion(height);
    expect([nativeTranslation('dock'), nativeTranslation('viewport')]).toEqual([-Math.max(height, 34), -Math.max(height, 34)]);
    expect(nativeKeyboardStyle('viewport').paddingTop).toBe(34);
  }
  expect(scroll).not.toHaveBeenCalled();
});

it('reserves the full iOS attachment panel immediately while a panel animation is pending', async () => {
  mockPanelAnimationPending = true;
  await mount('ios');
  act(() => control('Add attachment').props.onPress());
  const height = tree!.root.findByType(AttachmentPanel).props.height;
  expect(height).toBeGreaterThan(0);
  expect([nativeTranslation('dock'), nativeTranslation('viewport')]).toEqual([-height, -height]);
  expect(nativeKeyboardStyle('viewport').paddingTop).toBe(height);
  expect(nativeKeyboardStyle('dock').bottom).toBe(0);
});

it('waits for the shared menu to dismiss before opening More reactions',async()=>{
 mockChat.messages=[{...message('other'),user_id:'account-b'}];await mount();const controls=messageControls('other');
 act(()=>controls.onMessageLongPress(controls.message,false));const menu=()=>tree!.root.findByType(MessageActionsMenu);
 const more=menu().findAllByType(TouchableOpacity).find(node=>node.props.accessibilityLabel==='More reactions')!;
 act(()=>more.props.onPress());expect(menu().findByType(Modal).props.visible).toBe(false);
 const dismiss=menu().findByType(Modal).props.onDismiss;roomId='plan-two';await update();act(()=>dismiss());
 expect(menu().props.menu).toBeNull();
});
it('retires a queued shared edit when the selected message disappears',async()=>{
 mockChat.messages=[message('edit')];await mount();expect(input().props.value).toBe('');const controls=messageControls('edit');act(()=>controls.onMessageLongPress(controls.message,true));
 const menu=()=>tree!.root.findByType(MessageActionsMenu);const edit=menu().findAllByType(TouchableOpacity).find(node=>node.props.accessibilityLabel==='Edit')!;
 act(()=>edit.props.onPress());const dismiss=menu().findByType(Modal).props.onDismiss;
 mockChat.messages=[];await act(async()=>tree!.update(<ChatThread {...baseProps} title="Updated walk" id={roomId} readOnly={readOnly}/>));act(()=>dismiss());expect(input().props.value).toBe('');expect(menu().props.menu).toBeNull();
});

it('opens the full picker only after the shared menu has dismissed',async()=>{
 mockChat.messages=[{...message('other'),user_id:'account-b'}];await mount();const controls=messageControls('other');
 act(()=>controls.onMessageLongPress(controls.message,false));const menu=tree!.root.findByType(MessageActionsMenu);
 act(()=>menu.findAllByType(TouchableOpacity).find(node=>node.props.accessibilityLabel==='More reactions')!.props.onPress());
 expect(tree!.root.findByType(ReactionEmojiPicker).props.visible).toBe(false);
 act(()=>menu.findByType(Modal).props.onDismiss());expect(tree!.root.findByType(ReactionEmojiPicker).props.visible).toBe(true);
 expect(tree!.root.findByType(MessageActionsMenu).props.menu).toBeNull();
});


it('sends a web pointer draft once without relying on the native gesture recognizer', async () => {
 await mount('web'); type('A pointer draft');
 const button=control('Send message');
 const gestures=tree!.root.findAllByType(GestureDetector).find(node=>node.props.gesture?.type==='exclusive')!.props.gesture.items;
 expect(gestures.every((gesture:any)=>gesture.callbacks.enabled===false)).toBe(true);
 await act(async()=>{button.props.onClick({detail:1});button.props.onClick({detail:1});});
 expect(mockSend).toHaveBeenCalledTimes(1);expect(mockRecorder.start).not.toHaveBeenCalled();
});

// September 26 recording: optimistic bubbles must enter above the composer,
// while someone reading older messages retains their position.
it.each(['ios', 'android'] as const)('keeps the live %s edge unpinned and preserves history reading', async platform => {
  mockChat.messages = [message('existing')]; await mount(platform);
  const list = () => tree!.root.findByType(FlatList);
  const scroll = jest.spyOn(list().instance, 'scrollToOffset').mockImplementation(() => {});
  expect(list().props.maintainVisibleContentPosition).toBeUndefined();
  act(() => list().props.onContentSizeChange(390, 700));
  expect(scroll).toHaveBeenLastCalledWith({ offset: 0, animated: false });
  scroll.mockClear();
  act(() => list().props.onScroll({ nativeEvent: { contentOffset: { y: 400 } } }));
  expect(list().props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 });
  mockChat.messages = [...mockChat.messages, message('new-arrival')]; await update();
  act(() => { list().props.onContentSizeChange(390, 900); list().props.onLayout(); });
  expect(scroll).not.toHaveBeenCalled();
  act(() => list().props.onScroll({ nativeEvent: { contentOffset: { y: 0 } } }));
  expect(list().props.maintainVisibleContentPosition).toBeUndefined();
  act(() => list().props.onLayout());
  expect(scroll).toHaveBeenLastCalledWith({ offset: 0, animated: false });
  scroll.mockClear(); mockScopeCurrent = false;
  act(() => { list().props.onContentSizeChange(390, 950); list().props.onLayout(); });
  expect(scroll).not.toHaveBeenCalled();
});


it.each(['ios', 'android'] as const)('starts a reopened %s room at its live edge after reading another room’s history', async platform => {
  mockChat.messages = [message('first-room')]; await mount(platform);
  const list = () => tree!.root.findByType(FlatList);
  act(() => list().props.onScroll({ nativeEvent: { contentOffset: { y: 400 } } }));
  expect(list().props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 });
  const oldScroll = list().props.onScroll;
  roomId = 'plan-two'; mockChat.messages = [message('second-room')]; await update();
  act(() => oldScroll({ nativeEvent: { contentOffset: { y: 400 } } }));
  expect(list().props.maintainVisibleContentPosition).toBeUndefined();
  const scroll = jest.spyOn(list().instance, 'scrollToOffset').mockImplementation(() => {});
  act(() => list().props.onLayout());
  expect(scroll).toHaveBeenLastCalledWith({ offset: 0, animated: false });
});


it.each(['ios', 'android'] as const)('reveals %s messages only with the measured dock reservation', async platform => {
  mockChat.messages = [message('latest')]; await mount(platform);
  const list = () => tree!.root.findByType(FlatList);
  const dock = () => tree!.root.findAll(node => node.props.testID === 'chat-bottom-dock')[0];
  expect(StyleSheet.flatten(list().props.style).opacity).toBe(0);
  expect(list().props.accessibilityElementsHidden).toBe(true);
  expect(list().props.pointerEvents).toBe('none');
  act(() => dock().props.onLayout({ nativeEvent: { layout: { height: 0 } } }));
  expect(StyleSheet.flatten(list().props.style).opacity).toBe(0);
  // Includes safe-area and expanded content instead of assuming a 70pt dock.
  act(() => dock().props.onLayout({ nativeEvent: { layout: { height: 118 } } }));
  expect(StyleSheet.flatten(list().props.style).opacity).toBe(1);
  expect(list().props.contentContainerStyle.paddingTop).toBe(126);
  expect(list().props.accessibilityElementsHidden).toBe(false);
  expect(list().props.pointerEvents).toBe('auto');
  act(() => dock().props.onLayout({ nativeEvent: { layout: { height: 64 } } }));
  expect(list().props.contentContainerStyle.paddingTop).toBe(72);
  // Reusing a mounted dock for another room must not wait for a layout event
  // that native is not obliged to emit when geometry is unchanged.
  roomId = 'another-room'; await update();
  expect(StyleSheet.flatten(list().props.style).opacity).toBe(1);
  expect(list().props.contentContainerStyle.paddingTop).toBe(72);
});


it.each([true, false])('returns to the retained Chats tab and dismisses the keyboard (refined=%s)', async staged => {
  await mount('ios', staged);
  const back = staged
    ? tree!.root.findByType(ChatContextHeader).props.onBack
    : control('Back to Chats').props.onPress;
  expect(back).toBeDefined();
  act(() => back());
  expect(Keyboard.dismiss).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith('/(tabs)/chats');
  expect(mockReplace).not.toHaveBeenCalled();
});


it.each(['ios', 'android'] as const)('uses supported drag-to-dismiss keyboard behavior on %s', async platform => {
  await mount(platform);
  expect(tree!.root.findByType(FlatList).props.keyboardDismissMode).toBe(platform === 'ios' ? 'interactive' : 'on-drag');
});


it.each(['ios', 'android'] as const)('refreshes the visible %s shared chat after suspension without waiting for a socket event', async platform => {
  const callbacks = new Set<(state: any) => void>();
  const originalState = AppState.currentState;
  const originalListener = jest.isMockFunction(AppState.addEventListener) ? jest.mocked(AppState.addEventListener).getMockImplementation() : undefined;
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    callbacks.add(callback); return { remove: () => { callbacks.delete(callback); } };
  });
  const emit = (state: string) => {
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: state });
    act(() => callbacks.forEach(callback => callback(state)));
  };
  try {
    mockRunFocus = true; await mount(platform); mockRead.mockClear();
    emit('background'); emit('active'); await act(async () => { await Promise.resolve(); });
    expect(mockRead).toHaveBeenCalledTimes(1); expect(mockRead).toHaveBeenCalledWith(true);
    emit('active'); await act(async () => { await Promise.resolve(); }); expect(mockRead).toHaveBeenCalledTimes(1);
    act(() => mockFocusCleanups.forEach(cleanup => cleanup()));
    emit('background'); emit('active'); await act(async () => { await Promise.resolve(); });
    expect(mockRead).toHaveBeenCalledTimes(1);
  } finally {
    act(() => tree?.unmount()); tree = undefined; mockRunFocus = false; mockFocusCleanups.clear(); spy.mockRestore();
    if (originalListener && jest.isMockFunction(AppState.addEventListener)) jest.mocked(AppState.addEventListener).mockImplementation(originalListener);
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: originalState });
  }
});


it('lets a finger drag win over content and keyboard changes before the first scroll event', async () => {
  mockChat.messages = [message('existing')]; await mount('ios');
  const list = () => tree!.root.findByType(FlatList);
  const scroll = jest.spyOn(list().instance, 'scrollToOffset').mockImplementation(() => {});
  act(() => {
    list().props.onScrollBeginDrag?.();
    const show = (Keyboard.addListener as jest.Mock).mock.calls.find(([name]) => name === 'keyboardWillShow')[1];
    show({ endCoordinates: { height: 300 } });
    list().props.onContentSizeChange(390, 900);
    list().props.onLayout();
  });
  expect(scroll).not.toHaveBeenCalled();
  act(() => list().props.onScroll({ nativeEvent: { contentOffset: { y: 10 } } }));
  act(() => list().props.onContentSizeChange(390, 950));
  expect(scroll).not.toHaveBeenCalled();
});
