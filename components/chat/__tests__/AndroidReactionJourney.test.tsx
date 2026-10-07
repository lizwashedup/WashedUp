jest.mock('../../ProfileButton', () => ({ __esModule: true, default: () => null }));
import { MessageActionsMenu } from '../MessageActionsMenu';
import ReactionEmojiPicker from '../ReactionEmojiPicker';
import { Modal } from 'react-native';
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, FlatList, Keyboard, Platform, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ChatThread from '../ChatThread';
import AttachmentPanel from '../AttachmentSheet';
import MediaPanel from '../MediaPanel';
import VoiceRecorder from '../VoiceRecorder';
import ScrollToBottomButton from '../ScrollToBottomButton';
import { GestureDetector } from 'react-native-gesture-handler';

let mockScopeCurrent = true;
const mockOperationScope = { userId: 'account-a', isCurrent: () => mockScopeCurrent };
jest.mock('../../../lib/chatComposerDraft', () => ({ ...jest.requireActual('../../../lib/chatComposerDraft'), verifyChatComposerTarget: async () => undefined, checkChatComposerAttempt: async () => true }));
const mockSend = jest.fn().mockResolvedValue(undefined), mockTyping = jest.fn();
const mockRead = jest.fn(), mockBlock = jest.fn();
const mockChat = { messages: [] as any[], loading: false, operationScope: mockOperationScope, currentUserId: 'account-a', sendMessage: mockSend, sendLocation: jest.fn(), sendAudio: jest.fn(), deleteMessage: jest.fn(), editMessage: jest.fn(), toggleReaction: jest.fn(), loadOlder: jest.fn(), refetch: mockRead };
const mockRecorder = { status: 'idle', durationMillis: 0, meterings: [], start: jest.fn(), stop: jest.fn(), cancel: jest.fn(), pause: jest.fn(), resume: jest.fn() };
let mockGifAvailable = true;

const mockUseChat = jest.fn((..._args: any[]) => mockChat);
jest.mock('../../../hooks/useChat', () => ({ useChat: (...args: any[]) => mockUseChat(...args) }));
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
jest.mock('@shopify/flash-list',()=>({FlashList:({data,renderItem}:any)=>{const React=require('react');return <>{data.map((item:any,index:number)=><React.Fragment key={item}>{renderItem({item,index})}</React.Fragment>)}</>;}}));
const mockReactionPeople=jest.fn(),mockRemoveReaction=jest.fn();
jest.mock('../../../lib/messageReactionDetails',()=>({loadMessageReactionDetails:(...args:any[])=>mockReactionPeople(...args),removeMessageReaction:(...args:any[])=>mockRemoveReaction(...args),isMessageReactionRemoved:jest.fn()}));
jest.mock('../LinkPreviewCard', () => ({ __esModule: true, default: () => null }));
jest.mock('../TypingIndicator', () => ({ __esModule: true, default: () => null }));
jest.mock('../ScrollToBottomButton', () => ({ __esModule: true, default: () => null }));
jest.mock('../VoicePlayer', () => ({ __esModule: true, default: () => null }));
jest.mock('../VoiceRecorder', () => ({ __esModule: true, default: () => null }));
jest.mock('../../modals/ReportModal', () => ({ ReportModal: () => null }));
jest.mock('../../BrandedAlert', () => ({ BrandedAlert: () => null }));
jest.mock('../../yours/icons/SunriseIcon', () => ({ __esModule: true, default: () => null }));

let tree: ReactTestRenderer | undefined;
let reactionTarget: string | undefined;
let roomId = 'plan-one';
let renderVersion=0;
let readOnly: { text: string } | null = null;
const baseProps = { kind: 'event' as const, title: 'A walk', subtitle: null, members: [], viewContextLabel: 'View Plan', onViewContext: jest.fn(), headerMenu: { type: 'report' as const } };
function screen() { return <ChatThread reactionMessageId={reactionTarget} reactionMessageSource={reactionTarget ? "chat" : undefined} {...baseProps} title={`A walk ${renderVersion}`} id={roomId} readOnly={readOnly} />; }
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
  reactionTarget=undefined; await AsyncStorage.clear();
  jest.useFakeTimers(); jest.clearAllMocks(); roomId = 'plan-one'; readOnly = null; mockScopeCurrent = true; mockChat.messages = []; mockChat.loading = false;
  mockSend.mockReset().mockResolvedValue(true); mockChat.sendAudio.mockReset().mockResolvedValue(true); mockChat.editMessage.mockReset().mockResolvedValue(true);
  mockRecorder.start.mockReset().mockResolvedValue(true);
  mockRecorder.stop.mockReset().mockResolvedValue({ uri: 'file:///local.m4a', durationSeconds: 4 }); mockRecorder.cancel.mockReset().mockResolvedValue(undefined);
  jest.requireMock('../../../lib/uploadAudio').uploadAudioToStorage.mockResolvedValue('https://example.invalid/local.m4a');
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  jest.spyOn(Keyboard, 'addListener').mockImplementation((() => ({ remove: jest.fn() })) as any);
});
afterEach(() => { act(() => tree?.unmount()); tree = undefined; jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

it('Android keeps stationary holds and touch jitter outside swipe-to-reply activation', async () => {
  mockChat.messages = [{ ...message('incoming'), user_id: 'account-b' }];
  await mount('android');
  const swipe = tree!.root.findAllByType(GestureDetector)
    .find(node => node.props.gesture?.type === 'pan' && node.props.gesture.callbacks.activeOffsetX !== undefined)!
    .props.gesture.callbacks;
  // Use the installed gesture builder's actual scalar/range conversion. The
  // native handler activates outside these bounds, even before a long press.
  const { PanGesture } = jest.requireActual('react-native-gesture-handler/lib/commonjs/handlers/gestures/panGesture');
  const native = new PanGesture().activeOffsetX(swipe.activeOffsetX).config;
  const activates = (dx: number) =>
    (native.activeOffsetXStart !== undefined && dx < native.activeOffsetXStart)
    || (native.activeOffsetXEnd !== undefined && dx > native.activeOffsetXEnd);
  for (const dx of [-5, 0, 5, 19]) expect(activates(dx)).toBe(false);
  expect(activates(21)).toBe(true);
  expect(activates(-80)).toBe(false);

  act(() => { swipe.onBegin(); swipe.onUpdate({ translationX: 79 }); swipe.onEnd(); swipe.onFinalize(); });
  expect(input().props.value).toBe('');
  expect(control('Cancel reply')).toBeUndefined();
  act(() => { swipe.onBegin(); swipe.onUpdate({ translationX: 81 }); swipe.onEnd(); swipe.onFinalize(); });
  expect(control('Cancel reply')).toBeDefined();
});


// Connected Android component paths: the real menu, searchable picker, attached
// chip and details sheet run together. Native gesture dispatch remains a device gate.
const openMessage=()=>{
 const bubble=tree!.root.findAll(node=>node.props.delayLongPress===400 && typeof node.props.onLongPress==='function')[0];
 act(()=>bubble.props.onLongPress());
};
const choose=async(label:string)=>{
 act(()=>control(label).props.onPress());
 expect(tree!.root.findByType(MessageActionsMenu).findByType(Modal).props.onDismiss).toBeUndefined();
 await act(async()=>{await jest.advanceTimersByTimeAsync(20);});
};
beforeEach(()=>{
 renderVersion=0;mockChat.toggleReaction.mockReset().mockResolvedValue(undefined);
 mockReactionPeople.mockReset().mockResolvedValue({people:[],nextOffset:null});mockRemoveReaction.mockReset().mockResolvedValue(undefined);
 mockChat.messages=[{...message('other'),user_id:'account-b'}];
});
it('Android long-press sends one quick reaction, and selected reactions retain their storage identity',async()=>{
 await mount('android');openMessage();await choose('React with ❤️');
 expect(mockChat.toggleReaction).toHaveBeenCalledTimes(1);expect(mockChat.toggleReaction.mock.calls[0].slice(0,2)).toEqual(['other','heart']);
 expect(tree!.root.findByType(MessageActionsMenu).props.menu).toBeNull();
 mockChat.messages=[{...mockChat.messages[0],reactions:[{user_id:'account-a',reaction:'❤️'}]}];renderVersion++;await update();
 openMessage();expect(control('React with ❤️').props.accessibilityState.selected).toBe(true);await choose('React with ❤️');
 expect(mockChat.toggleReaction.mock.calls[1].slice(0,2)).toEqual(['other','❤️']);
});
it('Android More opens the real searchable picker and a selection closes it without an iOS callback',async()=>{
 await mount('android');openMessage();await choose('More reactions');
 expect(tree!.root.findByType(ReactionEmojiPicker).props.visible).toBe(true);
 const search=tree!.root.findAllByType(TextInput).find(node=>node.props.accessibilityLabel==='Search emoji')!;
 act(()=>search.props.onChangeText('waving hand'));
 await act(async()=>control('React with waving hand').props.onPress());
 expect(mockChat.toggleReaction.mock.calls[0].slice(0,2)).toEqual(['other','👋']);
 expect(tree!.root.findByType(ReactionEmojiPicker).props.visible).toBe(false);
});
it('Android reaction badge opens details and only the member’s own reaction can be removed',async()=>{
 mockChat.messages=[{...mockChat.messages[0],reactions:[{user_id:'account-a',reaction:'heart'},{user_id:'account-b',reaction:'heart'}]}];
 mockReactionPeople.mockResolvedValue({people:[{userId:'account-a',storageKey:'heart',emoji:'❤️',name:'Me',photo:null,mine:true},{userId:'account-b',storageKey:'heart',emoji:'❤️',name:'Alex',photo:null,mine:false}],nextOffset:null});
 await mount('android');await act(async()=>control('❤️, 2 reactions, your reaction').props.onPress());
 const removals=tree!.root.findAll(node=>node.props.accessibilityLabel==='Remove your ❤️ reaction'&&typeof node.props.onPress==='function');
 expect(removals.length).toBeGreaterThan(0);
 await act(async()=>removals[0].props.onPress());
 expect(mockRemoveReaction).toHaveBeenCalledTimes(1);expect(mockRemoveReaction.mock.calls[0][0].messageId).toBe('other');expect(mockRemoveReaction.mock.calls[0][2].userId).toBe('account-a');
 expect(mockRead).toHaveBeenCalled();
});
it('Android back closes reactions without dispatch and a retired room cannot receive a saved selection',async()=>{
 await mount('android');openMessage();await choose('More reactions');
 const picker=tree!.root.findByType(ReactionEmojiPicker),saved=picker.props.onSelect;
 act(()=>picker.findByType(Modal).props.onRequestClose());expect(picker.props.visible).toBe(false);expect(mockChat.toggleReaction).not.toHaveBeenCalled();
 roomId='next-room';await update();act(()=>saved('👍'));expect(mockChat.toggleReaction).not.toHaveBeenCalled();
});

it('Android preserves a composed reply while returning from a reaction target to Latest',async()=>{
 reactionTarget='33333333-3333-4333-8333-000000000100';
 mockChat.messages=[{...message(reactionTarget),user_id:'account-b'}];
 await mount('android');await flush();
 type('I’ll bring a blanket too.');
 const bubble=messageControls(reactionTarget);
 act(()=>bubble.onStartReply(reactionTarget));await flush();
 expect(mockUseChat.mock.calls.at(-1)?.[1]).toBe(reactionTarget);
 act(()=>tree!.root.findByType(FlatList).props.onScroll({nativeEvent:{contentOffset:{y:800}}}));
 mockChat.messages=[{...message('newest'),user_id:'account-b',created_at:'2026-09-22T00:00:00Z'}];
 act(()=>control('Return to latest messages').props.onPress());await flush();
 expect(tree!.root.findByType(ScrollToBottomButton).props.visible).toBe(false);
 expect(tree!.root.findByType(ScrollToBottomButton).props.count).toBe(0);
 expect(mockUseChat.mock.calls.at(-1)?.[1]).toBeNull();
 expect(input().props.value).toBe('I’ll bring a blanket too.');
 expect(tree!.root.findAllByType(Text).some(node=>node.props.children==='Original message')).toBe(true);
 expect(mockChat.toggleReaction).not.toHaveBeenCalled();
});
