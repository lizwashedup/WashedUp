jest.mock('react-native-keyboard-controller', () => ({
  ...require('react-native-keyboard-controller/jest'),
  useAnimatedKeyboard: () => require('react').useRef({ height: { value: 0 }, state: { value: 4 } }).current,
}));
import LinkifiedText from '../../LinkifiedText';
import { addChatMentionReference } from '../../../lib/chatMentionIdentity';
jest.mock('../../ProfileButton', () => ({ __esModule: true, default: () => null }));
import React from 'react';
import { ChatEditRefusedError } from '../../../lib/chatMessageEdit';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActionSheetIOS, Keyboard, Linking, Modal, Platform, Text, TextInput, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ChatThread from '../ChatThread';
import { MessageActionsMenu } from '../MessageActionsMenu';
import { ReactionDetailsSheet } from '../ReactionDetailsSheet';
jest.mock('../ReactionDetailsSheet', () => ({ ReactionDetailsSheet: () => null }));
import AttachmentPanel from '../AttachmentSheet';
import MediaPanel from '../MediaPanel';
import ReactionEmojiPicker from '../ReactionEmojiPicker';
import { ReactionChips } from '../ReactionChips';
import PhotoPreviewModal from '../PhotoPreviewModal';
import LocationPickerModal from '../LocationPickerModal';
import VoiceRecorder from '../VoiceRecorder';
import { BrandedAlert } from '../../BrandedAlert';
import { ReportModal } from '../../modals/ReportModal';
import MiniProfileCard from '../../MiniProfileCard';
import { GestureDetector } from 'react-native-gesture-handler';

const mockVerifyDraftTarget = jest.fn(), mockCheckOriginal = jest.fn();
jest.mock('../../../lib/chatComposerDraft', () => ({ ...jest.requireActual('../../../lib/chatComposerDraft'), verifyChatComposerTarget: (...args: any[]) => mockVerifyDraftTarget(...args), checkChatComposerAttempt: (...args: any[]) => mockCheckOriginal(...args) }));
const mockSend = jest.fn().mockResolvedValue(undefined), mockTyping = jest.fn();
const mockRead = jest.fn(), mockBlock = jest.fn();
const mockReportMembers = jest.fn(), mockBack = jest.fn();
const mockCameraPermission = jest.fn(), mockCamera = jest.fn(), mockLibrary = jest.fn(), mockManipulate = jest.fn(), mockUpload = jest.fn(), mockUploadAudio = jest.fn();
let mockViewerId = 'account-a', mockEpoch = 1, mockRoomId = 'plan-one';
const mockViewerListeners = new Set<() => void>();
const mockChat = { messages: [], loading: false, currentUserId: 'account-a', sendMessage: mockSend, sendLocation: jest.fn(), sendAudio: jest.fn(), deleteMessage: jest.fn(), editMessage: jest.fn(), toggleReaction: jest.fn(), loadOlder: jest.fn(), refetch: mockRead };
const mockRecorder = { status: 'idle', durationMillis: 0, meterings: [], start: jest.fn(), stop: jest.fn(), cancel: jest.fn() };
let mockGifAvailable = true;

jest.mock('../../../hooks/useChat', () => ({ ObsoleteChatOperationError: class extends Error {}, isObsoleteChatOperation: (error: any) => error?.name === 'ObsoleteChatOperationError', isUnconfirmedChatReaction: jest.requireActual('../../../hooks/useChat').isUnconfirmedChatReaction, useChat: ({ id }: { id: string }) => {
  const React = require('react');
  const [, forceUpdate] = React.useReducer((value: number) => value + 1, 0);
  React.useEffect(() => { mockViewerListeners.add(forceUpdate); return () => { mockViewerListeners.delete(forceUpdate); }; }, []);
  const userId = mockViewerId, epoch = mockEpoch;
  const operationScope = require('react').useMemo(() => ({ userId, isCurrent: () => id === mockRoomId && userId === mockViewerId && epoch === mockEpoch }), [id, userId, epoch]);
  return { ...mockChat, currentUserId: userId, operationScope };
} }));
jest.mock('../../../hooks/useTypingIndicator', () => ({ useTypingIndicator: () => ({ typingUsers: [], broadcastTyping: mockTyping, stopTyping: jest.fn() }) }));
jest.mock('../../../hooks/useVoiceRecorder', () => ({ useVoiceRecorder: () => mockRecorder }));
jest.mock('../../../hooks/useBlock', () => ({ useBlock: () => ({ blockUser: mockBlock }) }));
jest.mock('../../../hooks/usePushNotifications', () => ({ registerForPushNotifications: jest.fn(), getPushPermissionStatus: jest.fn() }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').AfterglowFallbackFonts }) }));
jest.mock('../../../constants/FeatureFlags', () => ({ COMMUNITY_CHAT_GROUPING_ENABLED: true }));
jest.mock('../../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../../lib/uploadPhoto', () => ({ uploadBase64ToStorage: (...args: any[]) => mockUpload(...args) }));
jest.mock('expo-image-picker', () => ({ requestCameraPermissionsAsync: (...args: any[]) => mockCameraPermission(...args), launchCameraAsync: (...args: any[]) => mockCamera(...args), launchImageLibraryAsync: (...args: any[]) => mockLibrary(...args) }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: (...args: any[]) => mockManipulate(...args), SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('../../../lib/uploadAudio', () => ({ uploadAudioToStorage: (...args: any[]) => mockUploadAudio(...args) }));
jest.mock('../../../lib/logger', () => ({ logError: jest.fn() }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn(), hapticMedium: jest.fn(), hapticHeavy: jest.fn(), hapticSelection: jest.fn(), hapticSuccess: jest.fn(), hapticWarning: jest.fn(), hapticError: jest.fn() }));
jest.mock('expo-notifications', () => ({ setBadgeCountAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), back: mockBack }), useFocusEffect: () => {} }));
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

let tree: ReactTestRenderer | undefined;
let readOnly: { text: string } | null;
let nativeMenus: { options: any; choose: (index: number) => void }[];
const baseProps = { kind: 'event' as const, title: 'A walk', subtitle: null, members: [], viewContextLabel: 'View Plan', onViewContext: jest.fn(), headerMenu: { type: 'report' as const }, fetchReportMembers: mockReportMembers };
function screen() { return <ChatThread {...baseProps} id={mockRoomId} readOnly={readOnly} />; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const action = (label: string) => tree!.root.findAllByType(TouchableOpacity).find(button => button.props.accessibilityLabel === label)!;
const input = () => tree!.root.findAllByType(TextInput).find(field => field.props.placeholder === 'Message...')!;
const preview = () => tree!.root.findByType(PhotoPreviewModal).props;
const sendTap = () => tree!.root.findAllByType(GestureDetector).find(node => node.props.gesture?.type === 'exclusive')!.props.gesture.items.find((item: any) => item.type === 'tap').callbacks.onEnd;
function type(text: string) { act(() => input().props.onChangeText(text)); }
async function flush() { await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); }); }
async function mount() { await act(async () => { tree = create(screen()); }); }
async function update() { await act(async () => { for (const notify of mockViewerListeners) notify(); tree!.update(screen()); }); await flush(); }
function attach() { act(() => action('Add attachment').props.onPress()); return tree!.root.findByType(AttachmentPanel).props.onSelect; }
async function pick() { const select = attach(); act(() => select('photos')); await flush(); }
function gif() { const select = attach(); act(() => select('gif')); return tree!.root.findByType(MediaPanel).props.onGifSelect; }
beforeEach(async () => {
  await AsyncStorage.clear();
  mockVerifyDraftTarget.mockReset().mockResolvedValue(undefined); mockCheckOriginal.mockReset().mockResolvedValue(true);
  jest.useFakeTimers(); jest.clearAllMocks();
  nativeMenus = []; mockReportMembers.mockReset(); mockBlock.mockReset();
  mockReportMembers.mockResolvedValue([{ id: 'member-one', name: 'Jamie' }]);
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((options, choose) => { nativeMenus.push({ options, choose }); });
  [mockSend, mockChat.editMessage, mockCameraPermission, mockCamera, mockLibrary, mockManipulate, mockUpload, mockUploadAudio, mockChat.sendAudio, mockChat.sendLocation, mockRecorder.start, mockRecorder.stop, mockRecorder.cancel].forEach(mock => mock.mockReset());
  mockViewerListeners.clear(); mockChat.messages = []; mockViewerId = 'account-a'; mockEpoch = 1; mockRoomId = 'plan-one'; readOnly = null;
  mockSend.mockResolvedValue(true); mockChat.editMessage.mockResolvedValue(true);
  mockChat.sendLocation.mockResolvedValue(true); mockChat.sendAudio.mockResolvedValue(true); mockUploadAudio.mockResolvedValue('https://example.invalid/voice.m4a');
  mockRecorder.start.mockResolvedValue(true); mockRecorder.stop.mockResolvedValue({ uri: 'file:///voice.m4a', durationSeconds: 4 }); mockRecorder.cancel.mockResolvedValue(undefined);
  mockCameraPermission.mockResolvedValue({ status: 'granted' });
  const selection = { canceled: false, assets: [{ uri: 'file:///photo-one.jpg' }] };
  mockCamera.mockResolvedValue(selection); mockLibrary.mockResolvedValue(selection);
  mockManipulate.mockResolvedValue({ base64: 'local-photo' }); mockUpload.mockResolvedValue('https://example.invalid/photo-one.jpg');
  jest.replaceProperty(Platform, 'OS', 'ios');
  jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  jest.spyOn(Keyboard, 'addListener').mockImplementation((() => ({ remove: jest.fn() })) as any);
});
afterEach(() => { act(() => tree?.unmount()); tree = undefined; jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

it.each(['same', 'room', 'account'] as const)('keeps measured menu opening with its %s entry', async change => {
  let measured: ((x: number, y: number, width: number, height: number) => void) | undefined;
  const open = jest.fn();
  await act(async () => {
    tree = create(<ChatThread {...baseProps} id={mockRoomId} headerMenu={{ type: 'plus', onPress: open }} />);
  });
  // RN's mocked native View owns measurement; createNodeMock does not replace
  // that class instance. Defer its native callback, retaining the actual screen.
  tree!.root.findAll(node => jest.isMockFunction(node.instance?.measureInWindow)).forEach(node => {
    node.instance.measureInWindow.mockImplementation((callback: typeof measured) => { measured = callback; });
  });
  act(() => action('Add people or make a plan').props.onPress());
  expect(measured).toBeDefined();
  if (change === 'room') mockRoomId = 'plan-two';
  if (change === 'account') { mockViewerId = 'account-b'; mockEpoch++; }
  if (change !== 'same') await update();
  act(() => measured!(10, 20, 44, 44));
  if (change === 'same') expect(open).toHaveBeenCalledWith({ x: 10, y: 20, width: 44, height: 44 });
  else expect(open).not.toHaveBeenCalled();
});

it('keeps an unconfirmed original separate from newer typing and locks duplicate taps', async () => {
  const pending = deferred<boolean>(); mockSend.mockReturnValueOnce(pending.promise);
  await mount(); type('First draft'); const tap = sendTap(); act(() => { tap({}, true); tap({}, true); });
  await flush(); expect(mockSend).toHaveBeenCalledTimes(1); type('Newer draft');
  await act(async () => pending.resolve(false)); await flush();
  expect(input().props.value).toBe('Newer draft');
  expect(action('Check original message')).toBeDefined();
  expect(tree!.root.findAllByType(Text).some(node => node.props.children === 'First draft')).toBe(true);
});

it.each(['room', 'account'] as const)('clears entry text and photo preview when the %s changes', async change => {
  await mount(); type('Private draft'); await pick(); expect(preview().visible).toBe(true);
  if (change === 'room') mockRoomId = 'plan-two'; else { mockViewerId = 'account-b'; mockEpoch++; }
  await update(); expect(input().props.value).toBe(''); expect(preview().visible).toBe(false); expect(preview().assets).toEqual([]);
});

it('does not launch a camera after its permission request loses the room', async () => {
  const pending = deferred<any>(); mockCameraPermission.mockReturnValueOnce(pending.promise);
  await mount(); const select = attach(); act(() => select('camera'));
  mockRoomId = 'plan-two'; await update(); await act(async () => pending.resolve({ status: 'granted' })); await flush();
  expect(mockCamera).not.toHaveBeenCalled(); expect(preview().visible).toBe(false);
});

it('does not reopen a preview after a library selection loses its account', async () => {
  const pending = deferred<any>(); mockLibrary.mockReturnValueOnce(pending.promise);
  await mount(); const select = attach(); act(() => select('photos'));
  mockViewerId = 'account-b'; mockEpoch++; await update();
  await act(async () => pending.resolve({ canceled: false, assets: [{ uri: 'file:///retired.jpg' }] })); await flush();
  expect(preview().visible).toBe(false); expect(preview().assets).toEqual([]);
});

it('starts only one native picker when an attachment callback fires twice before rerender', async () => {
  const pending = deferred<any>(); mockLibrary.mockReturnValue(pending.promise);
  await mount(); const select = attach(); act(() => { select('photos'); select('photos'); });
  const pickerCalls = mockLibrary.mock.calls.length;
  await act(async () => pending.resolve({ canceled: true, assets: [] })); await flush();
  expect(pickerCalls).toBe(1);
});

it('stops photo preparation before storage after the chat becomes read-only', async () => {
  const pending = deferred<any>(); mockManipulate.mockReturnValueOnce(pending.promise);
  await mount(); await pick(); let work!: Promise<void>; act(() => { work = preview().onSend('Caption'); });
  readOnly = { text: 'This chat is closed' }; await update();
  await act(async () => { pending.resolve({ base64: 'retired' }); await work; });
  expect(mockUpload).not.toHaveBeenCalled(); expect(mockSend).not.toHaveBeenCalled(); expect(preview().visible).toBe(false);
});

it('does not let an old upload send or retire the next room preview', async () => {
  const pending = deferred<string>(); mockUpload.mockReturnValueOnce(pending.promise);
  await mount(); await pick(); const cancelOld = preview().onCancel; let work!: Promise<void>;
  act(() => { work = preview().onSend('Old caption'); }); await flush();
  mockRoomId = 'plan-two'; await update();
  mockLibrary.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///new-room.jpg' }] }); await pick();
  await act(async () => { pending.resolve('https://example.invalid/old-room.jpg'); await work; });
  expect(mockSend).not.toHaveBeenCalled(); expect(preview().visible).toBe(true); expect(preview().assets[0].uri).toBe('file:///new-room.jpg');
  act(() => cancelOld()); expect(preview().visible).toBe(true);
});

it('keeps the original send identity across A to B to A without stale completion replacing newer text', async () => {
  const old = deferred<boolean>(), fresh = deferred<boolean>(); mockSend.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  await mount(); type('Old account text'); act(() => sendTap()({}, true)); await flush();
  const originalId = mockSend.mock.calls[0][3];
  mockViewerId = 'account-b'; mockEpoch++; await update(); expect(input().props.value).toBe('');
  mockViewerId = 'account-a'; mockEpoch++; await update();
  type('New visit text'); act(() => sendTap()({}, true)); await flush(); expect(mockSend).toHaveBeenCalledTimes(1);
  await act(async () => old.resolve(false)); await flush(); expect(input().props.value).toBe('New visit text');
  mockCheckOriginal.mockResolvedValueOnce(false);
  act(() => action('Retry original message').props.onPress()); await flush();
  expect(mockSend.mock.calls[1].slice(0, 4)).toEqual(['Old account text', undefined, undefined, originalId]);
  await act(async () => fresh.resolve(true)); await flush(); expect(input().props.value).toBe('New visit text');
});

it('serializes repeated GIF selections until the first send confirms', async () => {
  const pending = deferred<boolean>(); mockSend.mockReturnValueOnce(pending.promise);
  await mount(); const select = gif(); act(() => { void select('https://example.invalid/a.gif'); void select('https://example.invalid/a.gif'); });
  expect(mockSend).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(true)); await flush();
});

it('rejects retained GIF and attachment callbacks after read-only expiration', async () => {
  await mount(); const selectAttachment = attach(); act(() => selectAttachment('gif')); const selectedGif = tree!.root.findByType(MediaPanel).props.onGifSelect;
  readOnly = { text: 'This chat is closed' }; await update(); act(() => { void selectedGif('https://example.invalid/retired.gif'); selectAttachment('camera'); });
  await flush(); expect(mockCameraPermission).not.toHaveBeenCalled(); expect(mockSend).not.toHaveBeenCalled(); expect(tree!.root.findAllByType(MediaPanel)).toHaveLength(0);
});

it('preserves multi-photo caption placement and sends a failed remainder without duplicating confirmed assets', async () => {
  mockLibrary.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///one.jpg' }, { uri: 'file:///two.jpg' }] });
  mockSend.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await mount(); await pick(); await act(async () => preview().onSend('Shared caption'));
  expect(preview().assets.map((asset: any) => asset.uri)).toEqual(['file:///two.jpg']); expect(preview().captionSent).toBe(true);
  await act(async () => preview().onSend('Shared caption'));
  expect(mockSend.mock.calls.map(call => call[0])).toEqual(['Shared caption', '', '']);
  expect(mockSend.mock.calls[1][3]).toBe(mockSend.mock.calls[2][3]); expect(mockUpload).toHaveBeenCalledTimes(2);
  expect(preview().visible).toBe(false);
});


function fixtureMessage(id: string, content: string) {
  return { id, content, user_id: 'account-a', message_type: 'user', image_url: null, created_at: '2026-09-13T12:00:00Z', reactions: [], sender: { id: 'account-a', first_name: 'Alice', avatar_url: null } };
}
function messageControls(id: string) { return tree!.root.findAll(node => node.props.message?.id === id && typeof node.props.onMessageLongPress === 'function')[0].props; }
function editMessageInUi(id: string) {
  const controls = messageControls(id); act(() => controls.onMessageLongPress(controls.message, true));
  const edit = tree!.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === 'Edit'))!;
  const dismiss = tree!.root.findByType(MessageActionsMenu).findByType(Modal).props.onDismiss;
  act(() => edit.props.onPress());
  act(() => dismiss());
}

it('preserves a newly selected reply while an earlier message confirms', async () => {
  (mockChat as any).messages = [fixtureMessage('reply-target', 'A message to reply to')];
  const pending = deferred<boolean>(); mockSend.mockReturnValueOnce(pending.promise);
  await mount(); type('First message'); act(() => sendTap()({}, true)); await flush();
  act(() => messageControls('reply-target').onStartReply('reply-target'));
  await act(async () => pending.resolve(true)); await flush();
  type('Reply message'); act(() => sendTap()({}, true)); await flush();
  expect(mockSend.mock.calls[1][2]).toBe('reply-target');
});

it('preserves a different selected edit while an earlier edit confirms', async () => {
  (mockChat as any).messages = [fixtureMessage('first-edit', 'First original'), fixtureMessage('second-edit', 'Second original')];
  const pending = deferred<boolean>(); mockChat.editMessage.mockReturnValueOnce(pending.promise);
  await mount(); editMessageInUi('first-edit'); type('First revised'); act(() => sendTap()({}, true)); await flush();
  expect(mockChat.editMessage).toHaveBeenCalledTimes(1);
  editMessageInUi('second-edit'); expect(input().props.value).toBe('Second original');
  await act(async () => pending.resolve(true)); await flush(); expect(input().props.value).toBe('Second original');
  type('Second revised'); act(() => sendTap()({}, true)); await flush();
  expect(mockChat.editMessage.mock.calls[1].slice(0, 2)).toEqual(['second-edit', 'Second revised']);
  expect(mockSend).not.toHaveBeenCalled();
});


const voiceControls = () => tree!.root.findByType(VoiceRecorder).props;
function voiceGesture() { return tree!.root.findAllByType(GestureDetector).find(node => node.props.gesture?.type === 'exclusive')!.props.gesture.items.find((item: any) => item.type === 'pan').callbacks; }
async function makeVoiceDraft() {
  act(() => voiceGesture().onStart()); await flush();
  act(() => voiceGesture().onEnd({ translationX: 0, translationY: -999 }));
  await act(async () => voiceControls().onStop()); expect(voiceControls().mode).toBe('draft');
}

it('does not upload a stopped recording after its room changes', async () => {
  const stopped = deferred<any>(); mockRecorder.stop.mockReturnValueOnce(stopped.promise);
  await mount(); act(() => voiceGesture().onStart()); await flush();
  act(() => voiceGesture().onEnd({ translationX: 0, translationY: 0 })); expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
  mockRoomId = 'plan-two'; await update();
  await act(async () => stopped.resolve({ uri: 'file:///retired.m4a', durationSeconds: 4 })); await flush();
  expect(mockUploadAudio).not.toHaveBeenCalled(); expect(mockChat.sendAudio).not.toHaveBeenCalled();
  expect(tree!.root.findAllByType(VoiceRecorder)).toHaveLength(0);
});

it('keeps a failed voice draft and retries its cached URL and UUID once despite duplicate taps', async () => {
  const retry = deferred<boolean>(); mockChat.sendAudio.mockResolvedValueOnce(false).mockReturnValueOnce(retry.promise);
  await mount(); await makeVoiceDraft(); await act(async () => voiceControls().onSend());
  expect(voiceControls().draftUri).toBe('file:///voice.m4a'); expect(voiceControls().sending).toBe(false);
  expect(mockUploadAudio).toHaveBeenCalledTimes(1);
  const retrySend = voiceControls().onSend; let work!: Promise<void>; act(() => { work = retrySend(); void retrySend(); });
  expect(mockChat.sendAudio).toHaveBeenCalledTimes(2); expect(voiceControls().sending).toBe(true);
  expect(mockChat.sendAudio.mock.calls[1][0]).toBe(mockChat.sendAudio.mock.calls[0][0]);
  expect(mockChat.sendAudio.mock.calls[1][3]).toBe(mockChat.sendAudio.mock.calls[0][3]);
  expect(mockChat.sendAudio.mock.calls[1][2]).toEqual(expect.objectContaining({ userId: 'account-a', isCurrent: expect.any(Function) }));
  expect(mockUploadAudio).toHaveBeenCalledTimes(1);
  await act(async () => { retry.resolve(true); await work; });
  expect(tree!.root.findAllByType(VoiceRecorder)).toHaveLength(0);
});

it('does not insert a failed earlier send into a newly selected existing-message edit', async () => {
  (mockChat as any).messages = [fixtureMessage('different-edit', 'Existing message')];
  const pending = deferred<boolean>(); mockSend.mockReturnValueOnce(pending.promise);
  await mount(); type('Unrelated failed send'); act(() => sendTap()({}, true)); await flush();
  editMessageInUi('different-edit'); expect(input().props.value).toBe('Existing message');
  await act(async () => pending.resolve(false)); await flush();
  expect(input().props.value).toBe('Existing message');
  expect(tree!.root.findByType(BrandedAlert).props.title).toBe('Message not confirmed');
  expect(tree!.root.findAllByType(Text).some(node => node.props.children === 'Unrelated failed send')).toBe(true);
  act(() => sendTap()({}, true)); await flush(); expect(mockChat.editMessage).not.toHaveBeenCalled();
  act(() => action('Check original message').props.onPress()); await flush();
  act(() => sendTap()({}, true)); await flush();
  expect(mockChat.editMessage.mock.calls[0].slice(0, 2)).toEqual(['different-edit', 'Existing message']);
});

it('opens the stored location from the actual shared message, including zero coordinates', async () => {
  (mockChat as any).messages = [{...fixtureMessage('pin-zero', '{"lat":0,"lng":0,"address":"Equator"}'), message_type: 'location'}];
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await mount();
  const target = tree!.root.findAll(node => node.props.accessibilityLabel === 'Open map for Equator' && typeof node.props.onPress === 'function')[0];
  act(() => target.props.onPress());
  expect(open).toHaveBeenCalledWith('maps://app?ll=0,0&q=Equator');
});

it('shows a malformed saved location honestly instead of opening a fabricated zero pin', async () => {
  (mockChat as any).messages = [{...fixtureMessage('pin-invalid', '{malformed'), message_type: 'location'}];
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await mount();
  const targets = tree!.root.findAllByProps({ accessibilityLabel: 'Location unavailable' });
  expect(targets.length).toBeGreaterThan(0);
  expect(targets.every(node => node.props.onPress === undefined)).toBe(true);
  expect(open).not.toHaveBeenCalled();
});

async function moveModerationEntry(change: 'room' | 'account') {
  if (change === 'room') mockRoomId = 'plan-two'; else { mockViewerId = 'account-b'; mockEpoch++; }
  await update();
}
async function advanceModeration(ms: number) { act(() => jest.advanceTimersByTime(ms)); await flush(); }
async function openModeration() { act(() => { void action('More options').props.onPress(); }); await flush(); }
async function openNativeMemberActions() {
  await openModeration(); expect(nativeMenus[0].options.title).toBe('Members');
  act(() => nativeMenus[0].choose(0)); await advanceModeration(300);
  expect(nativeMenus[1].options.title).toBe('Jamie');
  return nativeMenus[1].choose;
}
const alert = () => tree!.root.findByType(BrandedAlert).props;

it.each(['room', 'account'] as const)('discards a full-member lookup that completes after the %s changes', async change => {
  const pending = deferred<{ id: string; name: string }[]>(); mockReportMembers.mockReturnValueOnce(pending.promise);
  await mount(); await openModeration(); await moveModerationEntry(change);
  await act(async () => pending.resolve([{ id: 'old-member', name: 'Old room member' }])); await flush();
  expect(nativeMenus).toHaveLength(0); expect(alert().visible).toBe(false); expect(mockBlock).not.toHaveBeenCalled();
});

it('does not show a retired empty-members result as an alert in a new account', async () => {
  const pending = deferred<{ id: string; name: string }[]>(); mockReportMembers.mockReturnValueOnce(pending.promise);
  await mount(); await openModeration(); await moveModerationEntry('account');
  await act(async () => pending.resolve([])); await flush();
  expect(alert().visible).toBe(false); expect(nativeMenus).toHaveLength(0);
});

it('ignores an old header moderation callback before starting another member read', async () => {
  await mount(); const oldOpen = action('More options').props.onPress;
  await moveModerationEntry('room'); act(() => { void oldOpen(); }); await flush();
  expect(mockReportMembers).not.toHaveBeenCalled(); expect(nativeMenus).toHaveLength(0);
});

it.each(['room', 'account'] as const)('retires the delayed second native menu after its %s changes', async change => {
  await mount(); await openModeration(); act(() => nativeMenus[0].choose(0));
  await moveModerationEntry(change); await advanceModeration(300);
  expect(nativeMenus).toHaveLength(1); expect(mockBlock).not.toHaveBeenCalled();
});

it('ignores a retained member selection after the original native menu loses its entry', async () => {
  await mount(); await openModeration(); const choose = nativeMenus[0].choose;
  await moveModerationEntry('account'); act(() => choose(0)); await advanceModeration(300);
  expect(nativeMenus).toHaveLength(1);
});

it.each([['Report User', 0], ['Block User', 1]] as const)('ignores a retained native %s action after an account change', async (_label, index) => {
  await mount(); const choose = await openNativeMemberActions();
  await moveModerationEntry('account'); act(() => choose(index)); await flush();
  expect(tree!.root.findAllByType(ReportModal)).toHaveLength(0); expect(mockBlock).not.toHaveBeenCalled();
});

it('preserves current reporting in an expired chat', async () => {
  readOnly = { text: 'This chat is closed' }; await mount(); const choose = await openNativeMemberActions();
  act(() => choose(0));
  expect(tree!.root.findByType(ReportModal).props).toMatchObject({ visible: true, reportedUserId: 'member-one', reportedUserName: 'Jamie' });
  expect(mockBlock).not.toHaveBeenCalled();
});

it('passes a live fourth-argument block scope even in expired chats and guards completion navigation', async () => {
  readOnly = { text: 'This chat is closed' }; await mount(); const choose = await openNativeMemberActions();
  act(() => choose(1));
  expect(mockBlock).toHaveBeenCalledTimes(1);
  const [id, name, onBlocked, scope] = mockBlock.mock.calls[0];
  expect([id, name]).toEqual(['member-one', 'Jamie']);
  expect(scope).toEqual(expect.objectContaining({ userId: 'account-a', isCurrent: expect.any(Function) }));
  expect(scope.isCurrent()).toBe(true);
  act(() => onBlocked()); expect(mockBack).toHaveBeenCalledTimes(1);
  await moveModerationEntry('account'); expect(scope.isCurrent()).toBe(false);
  act(() => onBlocked()); expect(mockBack).toHaveBeenCalledTimes(1);
});

it('keeps the initiating block scope retired after returning from account B to account A', async () => {
  await mount(); const choose = await openNativeMemberActions(); act(() => choose(1));
  const scope = mockBlock.mock.calls[0][3];
  expect(scope).toEqual(expect.objectContaining({ userId: 'account-a', isCurrent: expect.any(Function) }));
  await moveModerationEntry('account'); mockViewerId = 'account-a'; mockEpoch++; await update();
  expect(scope.isCurrent()).toBe(false);
});

it('retires a delayed Android member action sheet after a room switch', async () => {
  jest.replaceProperty(Platform, 'OS', 'android'); await mount(); await openModeration();
  expect(alert().title).toBe('Members');
  const choose = alert().buttons.find((button: any) => button.text === 'Jamie').onPress;
  act(() => choose()); await moveModerationEntry('room'); await advanceModeration(100);
  expect(alert().visible).toBe(false); expect(mockBlock).not.toHaveBeenCalled();
});

it('preserves current Android blocking and retires retained report callbacks', async () => {
  jest.replaceProperty(Platform, 'OS', 'android'); readOnly = { text: 'This chat is closed' };
  await mount(); await openModeration(); act(() => alert().buttons.find((button: any) => button.text === 'Jamie').onPress());
  await advanceModeration(100); expect(alert().title).toBe('Jamie');
  const report = alert().buttons.find((button: any) => button.text === 'Report User').onPress;
  act(() => alert().buttons.find((button: any) => button.text === 'Block User').onPress());
  expect(mockBlock.mock.calls[0].slice(0, 2)).toEqual(['member-one', 'Jamie']); expect(mockBlock.mock.calls[0][3].isCurrent()).toBe(true);
  await moveModerationEntry('account'); act(() => report());
  expect(tree!.root.findAllByType(ReportModal)).toHaveLength(0);
});

it('scopes current mini-profile block controls and rejects retained report/block callbacks', async () => {
  await mount(); const profile = tree!.root.findByType(MiniProfileCard).props;
  act(() => profile.onBlock('member-one', 'Jamie'));
  expect(mockBlock).toHaveBeenCalledTimes(1);
  const scope = mockBlock.mock.calls[0][3];
  expect(scope).toEqual(expect.objectContaining({ userId: 'account-a', isCurrent: expect.any(Function) })); expect(scope.isCurrent()).toBe(true);
  await moveModerationEntry('room');
  act(() => { profile.onBlock('member-one', 'Jamie'); profile.onReport('member-one', 'Jamie'); });
  expect(mockBlock).toHaveBeenCalledTimes(1); expect(tree!.root.findAllByType(ReportModal)).toHaveLength(0); expect(scope.isCurrent()).toBe(false);
});

function reactionMessage(id = 'reaction-target') {
  return { ...fixtureMessage(id, 'See you there'), user_id: 'message-author', sender: { id: 'message-author', first_name: 'Jamie', avatar_url: null }, reactions: [
    { reaction: 'heart', user_id: 'account-a' },
    { reaction: '❤️', user_id: 'account-b' },
    { reaction: 'heart', user_id: 'account-c' },
    { reaction: '🪩', user_id: 'account-d' },
  ] };
}
function openMoreReactionAction() {
  const bubble = tree!.root.findAll(node => node.props.delayLongPress === 400 && typeof node.props.onLongPress === 'function')[0];
  act(() => bubble.props.onLongPress());
  const press = action('More reactions').props.onPress;
  const dismiss = tree!.root.findByType(MessageActionsMenu).findByType(Modal).props.onDismiss;
  return () => { press(); dismiss(); };
}
const reactionPicker = () => tree!.root.findByType(ReactionEmojiPicker).props;
const reactionButtons = () => tree!.root.findByType(ReactionChips).findAllByType(TouchableOpacity);

it('adapts actual shared reaction counts and selection while preserving each viewer’s stored alias', async () => {
  (mockChat as any).messages = [reactionMessage()]; await mount();
  let selected = reactionButtons().find(button => button.props.accessibilityState?.selected)!;
  expect(selected.props.accessibilityLabel).toBe('❤️, 3 reactions, your reaction');
  expect(reactionButtons().some(button => button.props.accessibilityLabel === '🪩, 1 reaction')).toBe(true);
  expect(tree!.root.findByType(ReactionChips).props.appearance.fonts).toBeDefined();
  act(() => selected.props.onPress());
  const details = tree!.root.findByType(ReactionDetailsSheet).props;
  expect(details.request.messageId).toBe('reaction-target');
  expect(details.request.scope.userId).toBe('account-a');
  expect(details.request.canRemove()).toBe(true);
  expect(mockChat.toggleReaction).not.toHaveBeenCalled();
  act(() => details.onClose());
  const more = openMoreReactionAction(); act(() => more());
  act(() => reactionPicker().onSelect('❤️'));
  expect(mockChat.toggleReaction.mock.calls[0].slice(0, 2)).toEqual(['reaction-target', 'heart']);
  const firstScope = mockChat.toggleReaction.mock.calls[0][2]; expect(firstScope.isCurrent()).toBe(true);

  mockViewerId = 'account-b'; mockEpoch++; await update();
  expect(firstScope.isCurrent()).toBe(false);
  selected = reactionButtons().find(button => button.props.accessibilityState?.selected)!;
  act(() => selected.props.onPress());
  expect(details.request.scope.isCurrent()).toBe(false);
  const nextDetails = tree!.root.findByType(ReactionDetailsSheet).props;
  expect(nextDetails.request.scope.userId).toBe('account-b');
  act(() => nextDetails.onClose());
  const nextMore = openMoreReactionAction(); act(() => nextMore());
  act(() => reactionPicker().onSelect('❤️'));
  expect(mockChat.toggleReaction.mock.calls[1].slice(0, 2)).toEqual(['reaction-target', '❤️']);
  expect(mockChat.toggleReaction.mock.calls[1][2].userId).toBe('account-b');
  (mockChat as any).messages = [{ ...reactionMessage(), reactions: [{ reaction: '🪩', user_id: 'account-c' }] }]; await update();
  expect(reactionButtons().map(button => button.props.accessibilityLabel)).toEqual(['🪩, 1 reaction']);
  expect(reactionButtons().some(button => button.props.accessibilityState?.selected)).toBe(false);
});

it('shows expired-chat reactions without enabling chip or picker mutations', async () => {
  (mockChat as any).messages = [reactionMessage()]; readOnly = { text: 'This chat is closed' }; await mount();
  const buttons = reactionButtons(); expect(buttons).toHaveLength(2);
  expect(buttons.every(button => !button.props.disabled && !button.props.accessibilityState.disabled)).toBe(true);
  expect(buttons[0].props.accessibilityLabel).toBe('❤️, 3 reactions, your reaction');
  act(() => { buttons[0].props.onPress(); tree!.root.findByType(ReactionChips).props.onAddReaction?.(); });
  expect(tree!.root.findByType(ReactionDetailsSheet).props.request.canRemove()).toBe(false);
  act(() => reactionPicker().onSelect('🔥'));
  expect(mockChat.toggleReaction).not.toHaveBeenCalled(); expect(reactionPicker().visible).toBe(false);
});

it('retires retained reaction chip and picker controls when an open chat expires', async () => {
  (mockChat as any).messages = [reactionMessage()]; await mount();
  const chip = reactionButtons()[0].props.onPress, add = openMoreReactionAction();
  act(() => add()); expect(reactionPicker().visible).toBe(true); const choose = reactionPicker().onSelect;
  readOnly = { text: 'This chat is closed' }; await update();
  act(() => { chip(); add(); choose('🔥'); });
  expect(mockChat.toggleReaction).not.toHaveBeenCalled(); expect(reactionPicker().visible).toBe(false);
  expect(reactionButtons().every(button => !button.props.disabled)).toBe(true);
  expect(tree!.root.findByType(ReactionDetailsSheet).props.request.canRemove()).toBe(false);
});

it.each(['room', 'account', 'account-return'] as const)('keeps retained reaction callbacks out of a fresh %s entry', async change => {
  (mockChat as any).messages = [reactionMessage()]; await mount();
  const chip = reactionButtons()[0].props.onPress, add = openMoreReactionAction();
  act(() => add()); const oldPicker = reactionPicker();
  (mockChat as any).messages = [reactionMessage('fresh-reaction-target')];
  if (change === 'room') mockRoomId = 'plan-two';
  else { mockViewerId = 'account-b'; mockEpoch++; }
  await update();
  if (change === 'account-return') { mockViewerId = 'account-a'; mockEpoch++; await update(); }
  const freshMore = openMoreReactionAction(); act(() => freshMore()); expect(reactionPicker().visible).toBe(true);
  act(() => { chip(); add(); oldPicker.onSelect('🔥'); });
  expect(mockChat.toggleReaction).not.toHaveBeenCalled(); expect(reactionPicker().visible).toBe(true);
  act(() => oldPicker.onClose()); expect(reactionPicker().visible).toBe(true);
  act(() => reactionPicker().onSelect('❤️'));
  expect(mockChat.toggleReaction.mock.calls[0].slice(0, 2)).toEqual(['fresh-reaction-target', mockViewerId === 'account-b' ? '❤️' : 'heart']);
  expect(mockChat.toggleReaction.mock.calls[0][2].userId).toBe(mockViewerId);
  expect(reactionPicker().visible).toBe(false);
});

it('allows reading own-message reactions without enabling the add-reaction picker', async () => {
  (mockChat as any).messages = [{ ...reactionMessage(), user_id: 'account-a', sender: { id: 'account-a', first_name: 'Alice', avatar_url: null } }];
  await mount();
  const buttons = reactionButtons(); expect(buttons).toHaveLength(2);
  expect(buttons.every(button => !button.props.disabled)).toBe(true);
  expect(tree!.root.findByType(ReactionChips).props.onAddReaction).toBeUndefined();
  expect(buttons[0].props.accessibilityLabel).toBe('❤️, 3 reactions, your reaction');
  act(() => buttons[0].props.onPress()); expect(mockChat.toggleReaction).not.toHaveBeenCalled();
  expect(tree!.root.findByType(ReactionDetailsSheet).props.request.messageId).toBe('reaction-target');
  expect(reactionPicker().visible).toBe(false);
});

it.each(['location', 'photo', 'audio'] as const)('leaves %s accessibility to its inner media controls without a second outer button', async kind => {
  const message = fixtureMessage('interactive-media', 'A message');
  (mockChat as any).messages = [{ ...message,
    ...(kind === 'location' ? { message_type: 'location', content: '{"lat":0,"lng":0,"address":"Equator"}' }
      : kind === 'photo' ? { image_url: 'https://example.invalid/photo.jpg' }
      : { message_type: 'audio', audio_url: 'https://example.invalid/audio.m4a', duration_seconds: 8 }),
  }];
  await mount();
  const wrappers = tree!.root.findAll(node => node.props.delayLongPress === 400 && typeof node.props.onLongPress === 'function');
  expect(wrappers.length).toBeGreaterThan(0);
  for (const wrapper of wrappers) {
    expect(wrapper.props.accessible).toBe(false); expect(wrapper.props.accessibilityRole).toBeUndefined();
    expect(wrapper.props.onLongPress).toEqual(expect.any(Function));
  }
  if (kind === 'location') {
    const map = tree!.root.findAll(node => node.props.accessibilityLabel === 'Open map for Equator' && typeof node.props.onPress === 'function');
    expect(map.length).toBeGreaterThan(0); expect(map.every(node => node.props.accessibilityRole === 'button')).toBe(true);
  }
});

it('keeps the accessible tap-to-reply button for an ordinary text message', async () => {
  (mockChat as any).messages = [fixtureMessage('ordinary-text', 'See you soon')]; await mount();
  const wrapper = tree!.root.findAll(node => node.props.delayLongPress === 400 && typeof node.props.onLongPress === 'function')[0];
  expect(wrapper.props.accessible).not.toBe(false); expect(wrapper.props.accessibilityRole).toBe('button');
  act(() => wrapper.props.onPress()); type('A reply'); act(() => sendTap()({}, true)); await flush();
  expect(mockSend.mock.calls[0][2]).toBe('ordinary-text');
});

it('restores unsent text and reply context after the actual composer unmounts', async () => {
  (mockChat as any).messages = [fixtureMessage('return-reply', 'Meet at four?')];
  await mount(); act(() => messageControls('return-reply').onStartReply('return-reply')); type('Four works for me.'); await flush();
  act(() => tree!.unmount()); tree = undefined; await mount(); await flush();
  expect(input().props.value).toBe('Four works for me.'); expect(action('Cancel reply')).toBeDefined();
  act(() => sendTap()({}, true)); await flush(); expect(mockSend.mock.calls[0][2]).toBe('return-reply');
});
it('restores edit identity without sending a new message after remount', async () => {
  (mockChat as any).messages = [fixtureMessage('return-edit', 'Original wording')];
  await mount(); editMessageInUi('return-edit'); type('Revised wording'); await flush();
  act(() => tree!.unmount()); tree = undefined; await mount(); await flush();
  expect(input().props.value).toBe('Revised wording'); expect(action('Cancel edit')).toBeDefined();
  act(() => sendTap()({}, true)); await flush(); expect(mockChat.editMessage.mock.calls[0].slice(0, 2)).toEqual(['return-edit', 'Revised wording']); expect(mockSend).not.toHaveBeenCalled();
});

it('a definitive refusal of a new edit keeps editable text without an uncertain attempt', async () => {
  (mockChat as any).messages = [fixtureMessage('changed-edit', 'Original wording')];
  mockChat.editMessage.mockRejectedValueOnce(new ChatEditRefusedError('changed'));
  await mount(); editMessageInUi('changed-edit'); type('My revision'); act(() => sendTap()({}, true)); await flush();
  expect(input().props.value).toBe('My revision'); expect(action('Cancel edit')).toBeDefined();
  expect(action('Check original message')).toBeUndefined();
  expect(tree!.root.findByType(BrandedAlert).props.title).toBe('Message not sent');
});
it('a refused retry cannot discard a previously uncertain edit or newer typing', async () => {
  (mockChat as any).messages = [fixtureMessage('uncertain-edit', 'Original wording')];
  mockChat.editMessage.mockResolvedValueOnce(false).mockRejectedValueOnce(new ChatEditRefusedError('changed'));
  await mount(); editMessageInUi('uncertain-edit'); type('Attempted revision'); act(() => sendTap()({}, true)); await flush();
  expect(mockChat.editMessage.mock.calls[0][6]).toEqual({ errorPresentation: 'caller' });
  expect(tree!.root.findByType(BrandedAlert).props.title).toBe('Message not confirmed');
  expect(tree!.root.findByType(BrandedAlert).props.message).toBe('Your original message has not been confirmed yet.');
  expect(action('Check original message')).toBeDefined();
  type('Newer revision'); mockCheckOriginal.mockResolvedValueOnce(false);
  act(() => action('Retry original message').props.onPress()); await flush();
  expect(input().props.value).toBe('Newer revision'); expect(action('Check original message')).toBeDefined();
  expect(mockChat.editMessage.mock.calls[1][0]).toBe('uncertain-edit'); expect(mockChat.editMessage.mock.calls[1][1]).toBe('Attempted revision');
  expect(mockChat.editMessage.mock.calls[1][6]).toEqual({ errorPresentation: 'caller' });
});


it('keeps an edit available when its original-message preflight times out without dispatching a write', async () => {
 (mockChat as any).messages=[fixtureMessage('timeout-edit','Before')];
 mockVerifyDraftTarget.mockRejectedValueOnce(new (require('../../../lib/requestWithDeadline').RequestDeadlineError)());
 await mount();editMessageInUi('timeout-edit');type('Keep my revision');act(()=>sendTap()({},true));await flush();
 expect(mockChat.editMessage).not.toHaveBeenCalled();expect(mockSend).not.toHaveBeenCalled();
 expect(input().props.value).toBe('Keep my revision');expect(action('Cancel edit')).toBeDefined();
 expect(tree!.root.findByType(BrandedAlert).props.title).toBe('Message not sent');
 expect(action('Check original message')).toBeUndefined();
});

it.each(['event','circle'] as const)('offers all %s chat members on @ and inserts the selected person',async(kind)=>{
 const members=Array.from({length:9},(_,i)=>({id:`11111111-1111-4111-8111-${String(i).padStart(12,"0")}`,first_name:`Friend${i}`,avatar_url:null}));
 await act(async()=>{tree=create(<ChatThread {...baseProps} kind={kind} id={mockRoomId} members={members}/>);});
 type('@');await flush();
 const choices=tree!.root.findAllByType(TouchableOpacity).filter(node=>node.props.accessibilityLabel?.startsWith('Mention '));
 expect(choices).toHaveLength(9);
 act(()=>choices.find(node=>node.props.accessibilityLabel==='Mention Friend8')!.props.onPress());
 expect(input().props.value).toBe('@Friend8 ');
});

it('opens the selected identical-name identity and rejects a retained previous-room mention',async()=>{
 const first='cccccccc-cccc-4ccc-8ccc-cccccccccccc',second='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 const text='@Alex and @Alex, hello';
 const mentions=addChatMentionReference(text,addChatMentionReference(text,null,first,'Alex',0),second,'Alex',10);
 mockChat.messages=[{id:'message-one',user_id:'member-one',content:text,message_type:'user',created_at:new Date().toISOString(),sender:{id:'member-one',first_name:'Jamie'},mention_data:mentions}] as any;
 await mount();
 const linked=tree!.root.findByType(LinkifiedText).props;
 expect(linked.mentionDocument).toEqual(mentions);
 act(()=>linked.onMentionPress(second));
 expect(tree!.root.findByType(MiniProfileCard).props.userId).toBe(second);
 mockRoomId='plan-two'; await update();
 act(()=>linked.onMentionPress(first));
 expect(tree!.root.findByType(MiniProfileCard).props.userId).toBeNull();
});
it('keeps the chosen duplicate-name member through composer storage and send',async()=>{
 const members=[{id:'11111111-1111-4111-8111-111111111111',first_name:'Alex',avatar_url:null},{id:'22222222-2222-4222-8222-222222222222',first_name:'Alex',avatar_url:null}];
 await act(async()=>{tree=create(<ChatThread {...baseProps} members={members} id={mockRoomId} readOnly={null}/>);});
 type('@Al');const Picker=require('../ChatMentionPicker').ChatMentionPicker;
 act(()=>tree!.root.findByType(Picker).props.onSelect(members[1]));await flush();
 expect(input().props.value).toBe('@Alex ');
 act(()=>sendTap()({},true));await flush();
 expect(mockSend.mock.calls[0][0]).toBe('@Alex');
 expect(mockSend.mock.calls[0][5]).toMatchObject({text:'@Alex',references:[{userId:members[1].id,label:'Alex',start:0,end:5}]});
});
it('retains selected identities when an uncertain send restores its draft',async()=>{
 const member={id:'11111111-1111-4111-8111-111111111111',first_name:'Alex',avatar_url:null};
 mockSend.mockResolvedValue(false);
 await act(async()=>{tree=create(<ChatThread {...baseProps} members={[member]} id={mockRoomId} readOnly={null}/>);});
 type('@Al');act(()=>tree!.root.findByType(require('../ChatMentionPicker').ChatMentionPicker).props.onSelect(member));await flush();
 act(()=>sendTap()({},true));await flush();
 expect(input().props.value).toBe('@Alex');
 const keys=await AsyncStorage.getAllKeys();const saved=JSON.parse((await AsyncStorage.getItem(keys.find(k=>k.startsWith('chat-composer:'))!))!);
 expect(saved.draft.mentions.references[0].userId).toBe(member.id);expect(saved.draft.attempt.mentions.references[0].userId).toBe(member.id);
});


it.each(['prepare', 'upload', 'send'] as const)('recovers a stalled photo %s without late continuation or changing the original attempt', async stage => {
  const pending = deferred<any>();
  if (stage === 'prepare') mockManipulate.mockReturnValueOnce(pending.promise);
  if (stage === 'upload') mockUpload.mockReturnValueOnce(pending.promise);
  if (stage === 'send') mockSend.mockReturnValueOnce(pending.promise);
  await mount(); await pick();
  let work!: Promise<void>; act(() => { work = preview().onSend('Original caption'); }); await flush();
  expect(preview().sending).toBe(true);
  await act(async () => { jest.advanceTimersByTime(stage === 'prepare' ? 12000 : stage === 'upload' ? 30000 : 25000); }); await flush(); await work;
  expect(preview().sending).toBe(false); expect(preview().visible).toBe(true);
  expect(preview().errorMessage).toBeTruthy();
  expect(preview().captionLocked).toBe(stage === 'send');
  const sendId = stage === 'send' ? mockSend.mock.calls[0][3] : undefined;
  const retiredScope = stage === 'send' ? mockSend.mock.calls[0][4] : undefined;
  expect(retiredScope?.isCurrent()).not.toBe(true);
  await act(async () => pending.resolve(stage === 'prepare' ? { base64: 'late' } : stage === 'upload' ? 'https://example.invalid/late.jpg' : true)); await flush();
  expect(mockSend).toHaveBeenCalledTimes(stage === 'send' ? 1 : 0);
  expect(preview().visible).toBe(true);
  await act(async () => preview().onSend('Changed caption'));
  expect(mockSend.mock.calls.at(-1)[0]).toBe(stage === 'send' ? 'Original caption' : 'Changed caption');
  if (stage === 'send') { expect(mockSend.mock.calls[1][3]).toBe(sendId); expect(mockUpload).toHaveBeenCalledTimes(1); }
  expect(preview().visible).toBe(false);
});

it('shows an inline photo failure and keeps the dispatched caption on an explicit retry', async () => {
  mockSend.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await mount(); await pick(); await act(async () => preview().onSend('First caption'));
  expect(preview().errorMessage).toContain('original caption');
  expect(preview().captionLocked).toBe(true);
  await act(async () => preview().onSend('Changed after lost response'));
  expect(mockSend.mock.calls.map(call => call[0])).toEqual(['First caption', 'First caption']);
  expect(mockSend.mock.calls[1][3]).toBe(mockSend.mock.calls[0][3]);
});

it('keeps a rejected caption editable before any photo dispatch', async () => {
  await mount(); await pick();
  jest.spyOn(require('../../../lib/contentFilter'),'checkContent').mockReturnValueOnce({ok:false,reason:'Please revise your caption.'});
  await act(async () => preview().onSend('Rejected caption'));
  expect(preview().captionLocked).toBe(false); expect(preview().errorMessage).toBe('Please revise your caption.');
  expect(mockSend).not.toHaveBeenCalled(); expect(mockUpload).not.toHaveBeenCalled();
  await act(async () => preview().onSend('Updated caption'));
  expect(mockSend.mock.calls[0][0]).toBe('Updated caption'); expect(preview().visible).toBe(false);
});


it.each(['upload', 'send'] as const)('bounds a stalled voice %s and preserves the recording for an explicit retry', async stage => {
  const pending = deferred<any>();
  if (stage === 'upload') mockUploadAudio.mockReturnValueOnce(pending.promise);
  else mockChat.sendAudio.mockReturnValueOnce(pending.promise);
  await mount(); await makeVoiceDraft();
  let work!: Promise<void>; act(() => { work = voiceControls().onSend(); }); await flush();
  const oldScope = stage === 'upload' ? mockUploadAudio.mock.calls[0][3] : mockChat.sendAudio.mock.calls[0][2];
  const firstId = stage === 'send' ? mockChat.sendAudio.mock.calls[0][3] : undefined;
  expect(voiceControls().sending).toBe(true);
  await act(async () => { jest.advanceTimersByTime(stage === 'upload' ? 30000 : 25000); }); await flush(); await work;
  expect(voiceControls().sending).toBe(false); expect(voiceControls().draftUri).toBe('file:///voice.m4a');
  expect(voiceControls().retryAvailable).toBe(true); expect(oldScope.isCurrent()).toBe(false);
  expect(tree!.root.findAllByType(Text).some(t => t.props.accessibilityRole === 'alert' && String(t.props.children).includes('recording'))).toBe(true);
  await act(async () => pending.resolve(stage === 'upload' ? 'late-voice.m4a' : true)); await flush();
  expect(voiceControls().draftUri).toBe('file:///voice.m4a');
  if (stage === 'upload') expect(mockChat.sendAudio).not.toHaveBeenCalled();
  await act(async () => voiceControls().onSend());
  if (stage === 'send') {
    expect(mockChat.sendAudio.mock.calls[1][3]).toBe(firstId);
    expect(mockChat.sendAudio.mock.calls[1].slice(0,2)).toEqual(mockChat.sendAudio.mock.calls[0].slice(0,2));
    expect(mockUploadAudio).toHaveBeenCalledTimes(1);
  }
  expect(tree!.root.findAllByType(VoiceRecorder)).toHaveLength(0);
});

it('retires a timed-out voice retry after the account changes without exposing old feedback', async () => {
  mockChat.sendAudio.mockImplementation(() => new Promise(() => {}));
  await mount(); await makeVoiceDraft(); act(() => { void voiceControls().onSend(); }); await flush();
  const oldScope=mockChat.sendAudio.mock.calls[0][2];
  mockViewerId='account-b';mockEpoch++;await update();
  await act(async () => { jest.advanceTimersByTime(25000); }); await flush();
  expect(oldScope.isCurrent()).toBe(false);expect(tree!.root.findAllByType(VoiceRecorder)).toHaveLength(0);
  expect(tree!.root.findAllByType(Text).some(t => t.props.accessibilityRole==='alert' && String(t.props.children).includes('recording'))).toBe(false);
});

it('hides the covered text composer from accessibility while retaining active voice controls', async () => {
 await mount();await makeVoiceDraft();
 const field=input();let wrapper:any=field;while(wrapper && wrapper.props.importantForAccessibility===undefined)wrapper=wrapper.parent;
 expect(wrapper.props.importantForAccessibility).toBe('no-hide-descendants');expect(wrapper.props['aria-hidden']).toBe(true);
 expect(input().props.editable).toBe(false);expect(input().props.tabIndex).toBe(-1);expect(action('Add attachment').props.disabled).toBe(true);
 expect(voiceControls().draftUri).toBe('file:///voice.m4a');
 await act(async()=>voiceControls().onTrash());
 let restored:any=input();while(restored && restored.props.importantForAccessibility===undefined)restored=restored.parent;
 expect(restored.props.importantForAccessibility).toBe('auto');expect(restored.props['aria-hidden']).toBe(false);
 expect(input().props.editable).toBe(true);expect(input().props.tabIndex).toBe(0);expect(action('Add attachment').props.disabled).toBe(false);
});

const locationControls = () => tree!.root.findByType(LocationPickerModal).props;
function openPin() { const select=attach(); act(()=>select('location')); }
it('bounds a stalled pin delivery and retries its exact message ID without another location lookup', async () => {
  const pending=deferred<boolean>(); mockChat.sendLocation.mockReturnValueOnce(pending.promise);
  await mount(); openPin(); await flush();
  let work!:Promise<boolean>;act(()=>{work=locationControls().onConfirm(34.01,-118.49,'Ocean Park');});await flush();
  const oldScope=mockChat.sendLocation.mock.calls[0][3], id=mockChat.sendLocation.mock.calls[0][4];
  expect(await locationControls().onConfirm(34.01,-118.49,'Ocean Park')).toBe(false);expect(mockChat.sendLocation).toHaveBeenCalledTimes(1);
  await act(async()=>jest.advanceTimersByTime(25000));await flush();expect(await work).toBe(false);expect(oldScope.isCurrent()).toBe(false);
  expect(locationControls().visible).toBe(true);
  await act(async()=>pending.resolve(true));await flush();expect(locationControls().visible).toBe(true);
  await act(async()=>{expect(await locationControls().onConfirm(34.01,-118.49,'Ocean Park')).toBe(true);});
  expect(mockChat.sendLocation.mock.calls[1][4]).toBe(id);expect(mockChat.sendLocation.mock.calls[1].slice(0,3)).toEqual([34.01,-118.49,'Ocean Park']);expect(locationControls().visible).toBe(false);
});
it('keeps an unconfirmed pin ID through preview dismissal but starts a new intent after success',async()=>{
 mockChat.sendLocation.mockResolvedValueOnce(false);await mount();openPin();await flush();
 await act(async()=>{await locationControls().onConfirm(1,2,'Place');});const id=mockChat.sendLocation.mock.calls[0][4];
 act(()=>locationControls().onClose());openPin();await flush();
 await act(async()=>{await locationControls().onConfirm(1,2,'Place');});expect(mockChat.sendLocation.mock.calls[1][4]).toBe(id);
 openPin();await flush();await act(async()=>{await locationControls().onConfirm(1,2,'Place');});
 expect(mockChat.sendLocation.mock.calls[2][4]).not.toBe(id);
});
it.each(['room','account'] as const)('retires delayed location delivery and callbacks after a %s change',async change=>{
 const pending=deferred<boolean>();mockChat.sendLocation.mockReturnValueOnce(pending.promise);await mount();openPin();await flush();
 const oldConfirm=locationControls().onConfirm;act(()=>{void oldConfirm(1,2,'Private place');});await flush();const oldScope=mockChat.sendLocation.mock.calls[0][3];
 if(change==='room')mockRoomId='plan-two';else {mockViewerId='account-b';mockEpoch++;}await update();
 await act(async()=>pending.resolve(false));await flush();expect(oldScope.isCurrent()).toBe(false);expect(locationControls().visible).toBe(false);
 await act(async()=>{expect(await oldConfirm(1,2,'Private place')).toBe(false);});expect(mockChat.sendLocation).toHaveBeenCalledTimes(1);
});


it.each(['false', 'rejected', 'stalled'] as const)('retains the selected GIF and exact message ID after %s delivery', async kind => {
  const pending = deferred<boolean>();
  if (kind === 'false') mockSend.mockResolvedValueOnce(false);
  else if (kind === 'rejected') mockSend.mockRejectedValueOnce(new Error('Lost response'));
  else mockSend.mockReturnValueOnce(pending.promise);
  await mount(); const choose = gif();
  act(() => { void choose('https://example.invalid/original.gif'); }); await flush();
  if (kind === 'stalled') { await act(async () => { jest.advanceTimersByTime(25_001); }); await flush(); }
  expect(alert().title).toBe('GIF not confirmed');
  const original = mockSend.mock.calls[0]; expect(original[3]).toBeTruthy();
  expect(original[4].isCurrent()).toBe(false);
  type('Keep my new message');
  const retry = alert().buttons.find((button: any) => button.text === 'Try again').onPress;
  act(() => { retry(); retry(); }); await flush();
  expect(mockSend).toHaveBeenCalledTimes(2);
  expect(mockSend.mock.calls[1].slice(0,4)).toEqual(original.slice(0,4));
  expect(input().props.value).toBe('Keep my new message');
  expect(alert().visible).toBe(false);
  if (kind === 'stalled') { await act(async () => pending.resolve(true)); await flush(); expect(alert().visible).toBe(false); }
});

it('refuses the retained GIF retry after leaving its room and starts a fresh ID for a confirmed new send', async () => {
  mockSend.mockResolvedValueOnce(false);
  await mount(); const originalSelect = gif(); act(() => { void originalSelect('https://example.invalid/original.gif'); }); await flush();
  const retry = alert().buttons.find((button: any) => button.text === 'Try again').onPress;
  mockRoomId = 'another-plan'; await update(); act(() => retry()); await flush();
  expect(mockSend).toHaveBeenCalledTimes(1);
  const select = gif(); act(() => { void select('https://example.invalid/original.gif'); }); await flush();
  const confirmedId = mockSend.mock.calls[1][3];
  const selectAgain = gif(); act(() => { void selectAgain('https://example.invalid/original.gif'); }); await flush();
  expect(mockSend.mock.calls[2][3]).not.toBe(confirmedId);
});


it('identifies a reply to your newly sent message before its profile enrichment arrives', async () => {
  mockChat.messages = [{ ...fixtureMessage('own-unenriched', 'Just sent'), sender: null }] as any;
  await mount(); type('Existing draft');
  act(() => messageControls('own-unenriched').onStartReply('own-unenriched'));
  expect(tree!.root.findAllByType(Text).some(node => node.props.children === 'You')).toBe(true);
  expect(tree!.root.findAllByType(Text).some(node => node.props.children === 'Someone')).toBe(false);
  expect(input().props.value).toBe('Existing draft');
  act(() => sendTap()({}, true)); await flush();
  expect(mockSend.mock.calls[0][2]).toBe('own-unenriched');
});


it('shows an uncertain shared reaction with its exact Retry continuation instead of toggling again', async () => {
  const { UnconfirmedChatReactionError } = jest.requireActual('../../../hooks/useChat');
  const retry = jest.fn().mockResolvedValue(undefined);
  mockChat.toggleReaction.mockRejectedValueOnce(new UnconfirmedChatReactionError(retry));
  (mockChat as any).messages = [reactionMessage()]; await mount();
  const open = openMoreReactionAction(); act(() => open());
  await act(async () => reactionPicker().onSelect('🔥'));
  expect(alert().title).toBe('Reaction not confirmed'); expect(alert().message).toContain('keeps the same change');
  expect(alert().scrollMessage).toBe(true);
  expect(alert().buttons.map((button: any) => button.text)).toEqual(['Close', 'Retry']);
  await act(async () => alert().buttons.find((button: any) => button.text === 'Retry').onPress());
  expect(retry).toHaveBeenCalledTimes(1); expect(mockChat.toggleReaction).toHaveBeenCalledTimes(1);
});

it.each(['room', 'account', 'account-return', 'expired', 'deleted'] as const)('the shared reaction alert cannot retry after %s retirement', async change => {
  const { UnconfirmedChatReactionError } = jest.requireActual('../../../hooks/useChat');
  const retry = jest.fn().mockResolvedValue(undefined);
  mockChat.toggleReaction.mockRejectedValueOnce(new UnconfirmedChatReactionError(retry));
  (mockChat as any).messages = [reactionMessage()]; await mount();
  const open = openMoreReactionAction(); act(() => open()); await act(async () => reactionPicker().onSelect('🔥'));
  const oldRetry = alert().buttons.find((button: any) => button.text === 'Retry').onPress;
  if (change === 'room') mockRoomId = 'plan-two';
  else if (change === 'account' || change === 'account-return') { mockViewerId = 'account-b'; mockEpoch++; }
  else if (change === 'expired') readOnly = { text: 'This chat is closed' };
  else (mockChat as any).messages = [];
  await update();
  if (change === 'account-return') { mockViewerId = 'account-a'; mockEpoch++; await update(); }
  await act(async () => oldRetry());
  expect(retry).not.toHaveBeenCalled(); expect(mockChat.toggleReaction).toHaveBeenCalledTimes(1);
});

it('surfaces a failed shared reaction preflight instead of silently accepting the tap', async () => {
  mockChat.toggleReaction.mockRejectedValueOnce(Error('Network request failed'));
  (mockChat as any).messages = [reactionMessage()]; await mount();
  const open = openMoreReactionAction(); act(() => open()); await act(async () => reactionPicker().onSelect('🔥'));
  expect(alert().title).toBe('Reaction not confirmed'); expect(alert().message).toBe('Please try again.');
  expect(alert().buttons).toBeUndefined();
});
