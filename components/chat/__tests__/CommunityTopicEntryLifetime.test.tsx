jest.mock('react-native-keyboard-controller', () => ({
  ...require('react-native-keyboard-controller/jest'),
  useAnimatedKeyboard: () => require('react').useRef({ height: { value: 0 }, state: { value: 4 } }).current,
}));
import LinkifiedText from '../../LinkifiedText';
import MiniProfileCard from '../../MiniProfileCard';
import { addChatMentionReference } from '../../../lib/chatMentionIdentity';
import { ChatMentionPicker } from '../ChatMentionPicker';
import { MessageActionsMenu } from '../MessageActionsMenu';
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState, FlatList, Text, TextInput, TouchableOpacity } from 'react-native';
import CommunityTopicScreen from '../../../app/community-topic/[id]';
import { BrandedAlert } from '../../BrandedAlert';
import { CommunityChatComposer } from '../CommunityChatComposer';
import LocationPickerModal from '../LocationPickerModal';
import PhotoPreviewModal from '../PhotoPreviewModal';

let mockRoomId: string, mockViewerId: string, mockMembership: string;
let mockMembersError = false, mockMembersLoading = false;
let mockIntroError=false, mockIntroFetching=false, mockIntroQuery:any;
const mockIntroRefetch=jest.fn(),mockHasSaidHi=jest.fn();
let mockFocusCleanup:(()=>void)|undefined;
const mockRetryMembers = jest.fn().mockResolvedValue(undefined);
let mockMessages: any[], mockFirstMessage: any, mockMembers: any[];
let mockSaidHi: boolean | undefined, mockLedCommunities: { id: string }[];
let mockArchived = false;
let mockMessagesLoading = false;
const mockPush = jest.fn(), mockInvalidate = jest.fn().mockResolvedValue(undefined);
const mockRefresh = jest.fn().mockResolvedValue(undefined);
const mockConfirmed = new Set<string>();
const mockVerifyTarget = jest.fn();
const mockCheckAttempt = jest.fn();
jest.mock('../../../lib/topicComposerDraft', () => ({ ...jest.requireActual('../../../lib/topicComposerDraft'), verifyTopicComposerTarget: (...args:any[]) => mockVerifyTarget(...args), checkTopicComposerAttempt: (...args:any[]) => mockCheckAttempt(...args) }));
const mockReact = jest.fn();
const mockEdit = jest.fn();
const mockLocation = jest.fn();
const mockSend = jest.fn(), mockDeleteOwn = jest.fn(), mockBlock = jest.fn();
const mockCameraPermission = jest.fn(), mockCamera = jest.fn();
const mockPermission = jest.fn(), mockPick = jest.fn(), mockManipulate = jest.fn(), mockUpload = jest.fn();
const mockTyping = jest.fn(), mockStopTyping = jest.fn();
let mockEpoch = 1;
let mockLiveVisit: object | null = null;
jest.mock('expo-image-picker', () => ({ requestCameraPermissionsAsync: (...args: any[]) => mockCameraPermission(...args), launchCameraAsync: (...args: any[]) => mockCamera(...args), requestMediaLibraryPermissionsAsync: (...args: any[]) => mockPermission(...args), launchImageLibraryAsync: (...args: any[]) => mockPick(...args) }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: (...args: any[]) => mockManipulate(...args), SaveFormat: { JPEG: 'jpeg' } }));

jest.mock('expo-router', () => ({ useFocusEffect: (callback: any) => require('react').useEffect(() => { const cleanup=callback(); mockFocusCleanup=cleanup; return cleanup; }, [callback]), useRouter: () => ({ push: mockPush, back: jest.fn() }), useLocalSearchParams: () => ({ id: mockRoomId }), Stack: { Screen: () => null } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({top:0,bottom:0,left:0,right:0}) }));
jest.mock('../../../constants/FeatureFlags', () => ({ COMMUNITY_CHAT_GROUPING_ENABLED: true }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').AfterglowFallbackFonts }) }));
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => ({ viewerId: mockViewerId, epoch: mockEpoch, isCurrent: () => true, isLoading: false, error: null, retry: async () => {} }) }));
jest.mock('../../../hooks/useCommunityTopicMute', () => ({ useCommunityTopicMute: () => ({ muted: false, ready: true, isChecking: false, toggle: jest.fn(), isCurrent: () => true }) }));
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ online: true }) }));
jest.mock('../../../hooks/useBlock', () => ({ useBlock: () => ({ blockUser: mockBlock }) }));
jest.mock('../../../hooks/useTypingIndicator', () => ({ useTypingIndicator: () => ({ typingUsers: [], stopTyping: mockStopTyping, broadcastTyping: mockTyping }) }));
jest.mock('../../../hooks/useTopicChat', () => ({
  isObsoleteTopicOperation: (error: any) => error?.name === 'ObsoleteTopicOperationError',
  isUnconfirmedTopicReaction: jest.requireActual('../../../hooks/useTopicChat').isUnconfirmedTopicReaction,
  useTopicChat: () => {
    const React = require('react');
    const visit = React.useMemo(() => ({}), [mockRoomId, mockViewerId, mockEpoch]);
    React.useLayoutEffect(() => { mockLiveVisit = visit; return () => { if (mockLiveVisit === visit) mockLiveVisit = null; }; }, [visit]);
    const isCurrent = React.useCallback(() => mockLiveVisit === visit, [visit]);
    return { messages: mockMessages, loading: mockMessagesLoading, currentUserId: mockViewerId, currentUserName: 'Alice', refresh: mockRefresh,
      sendLocation: (...args: any[]) => mockLocation(...args),
      sendMessage: async (...args: any[]) => { await mockSend(...args); mockConfirmed.add(args[4]); }, editMessage: async (...args:any[])=>{await mockEdit(...args);mockConfirmed.add(args[0]);}, deleteMessage: mockDeleteOwn, toggleReaction: mockReact, isCurrent };
  },
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate, cancelQueries: jest.fn().mockResolvedValue(undefined) }),
  useQuery: (query: any) => {
    const {queryKey}=query;
    if(queryKey[0]==='topic-said-hi')mockIntroQuery=query;
    const data: Record<string, unknown> = {
      'topic-my-membership': { status: mockMembership },
      'community-chat-cards': {
        cards: [{ community_id: 'community-a', name: 'Sunset Club LA', main_chat_name: 'After Glow', topics: [] }],
        attendee_topics: [{ id: mockRoomId, name: 'Event room', explore_event_id: 'event-a' }],
      },
      'topic-meta': { id: mockRoomId, community_id: 'community-a', explore_event_id: 'event-a', archived: mockArchived, explore_events: { title: 'Sunset volleyball', host_user_id: 'creator-a' } },
      'topic-first-message': mockFirstMessage,
      'topic-said-hi': mockSaidHi,
      'creator-access': { ledCommunities: mockLedCommunities },
      'topic-chat-members': mockMembers,
    };
    if(queryKey[0]==='topic-said-hi') return {data:mockSaidHi,isError:mockIntroError,isFetching:mockIntroFetching,refetch:mockIntroRefetch};
    return { data: data[queryKey[0]], isSuccess: true, isLoading: queryKey[0]==='topic-chat-members' && mockMembersLoading, isError: queryKey[0]==='topic-chat-members' && mockMembersError, refetch: mockRetryMembers };
  },
}));
jest.mock('../../../lib/communityChat', () => ({
  markTopicRead: jest.fn().mockResolvedValue(undefined),
  hasSaidHiInTopic:(...args:any[])=>mockHasSaidHi(...args),
  computeEventRoomExpiry: () => null, isEventRoomClosed: (meta: any) => !!meta?.archived,
  deleteTopicMessage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../lib/communityJoin', () => ({}));
jest.mock('../../../lib/creatorMode', () => ({ isLeaderAccess: () => mockLedCommunities.length > 0 }));
jest.mock('../../../lib/creatorEvents', () => ({}));
jest.mock('../../../lib/uploadPhoto', () => ({ uploadBase64ToStorage: (...args: any[]) => mockUpload(...args) }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn() }));
jest.mock('../../../lib/logger', () => ({ logError: jest.fn() }));
jest.mock('../../../lib/addToCalendar', () => ({}));
jest.mock('../../../lib/supabase', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: () => ({}) }) }), removeChannel: jest.fn() } }));
jest.mock('../../BrandedAlert', () => ({ BrandedAlert: () => null }));
jest.mock('../../modals/ReportModal', () => ({ ReportModal: () => null }));
jest.mock('../../MiniProfileCard', () => () => null);
jest.mock('../LocationPickerModal', () => () => null);
jest.mock('../PhotoPreviewModal', () => () => null);
jest.mock('../ReactionEmojiPicker', () => () => null);
// Keep the actual selection hook; this suite owns entry callbacks, not display.
jest.mock('../ChatPhotoAttachment', () => ({ ChatPhotoAttachment: () => null }));
jest.mock('../ChatPhotoViewer', () => ({
  ...jest.requireActual('../ChatPhotoViewer'),
  ChatPhotoViewer: () => null,
}));

let tree: ReactTestRenderer;
function deferred<T = void>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return {promise,resolve,reject}; }
const composer = () => tree.root.findByType(CommunityChatComposer).props;
const input = () => tree.root.findByType(TextInput);
const alert = () => tree.root.findByType(BrandedAlert).props;
const location = () => tree.root.findByType(LocationPickerModal).props;
const preview = () => tree.root.findByType(PhotoPreviewModal).props;
const mention = () => tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Mention Amelia');
async function mount() { await act(async () => { tree = create(<CommunityTopicScreen />); }); }
async function update() { await act(async () => tree.update(<CommunityTopicScreen />)); }
async function flush() { await act(async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); }); }
function type(text: string) { act(() => input().props.onChangeText(text)); }
beforeEach(async () => {
  mockLocation.mockReset().mockResolvedValue(undefined);
  await AsyncStorage.clear(); mockConfirmed.clear(); mockCheckAttempt.mockReset().mockImplementation(async (_room: string, attempt: {id:string}) => mockConfirmed.has(attempt.id));
  jest.clearAllMocks(); mockIntroError=false; mockIntroFetching=false; mockIntroQuery=undefined; mockIntroRefetch.mockReset().mockResolvedValue({}); mockHasSaidHi.mockReset().mockResolvedValue(true); mockMembersError=false; mockMembersLoading=false; mockRoomId='11111111-1111-4111-8111-111111111111'; mockViewerId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; mockEpoch=1; mockMembership='active'; mockSaidHi=true;
  mockMessagesLoading=false;mockLedCommunities=[];mockFirstMessage=null;mockMessages=[];mockMembers=[];mockArchived=false;
  mockSend.mockResolvedValue(undefined); mockRefresh.mockResolvedValue(undefined); mockVerifyTarget.mockResolvedValue(undefined);
  mockCameraPermission.mockResolvedValue({status:'granted'}); mockCamera.mockResolvedValue({canceled:false,assets:[{uri:'file:///camera.jpg'}]});
  mockPermission.mockResolvedValue({status:'granted'});
  mockPick.mockResolvedValue({canceled:false,assets:[{uri:'file:///sample-photo.jpg',width:1200,height:1600}]});
  mockManipulate.mockResolvedValue({base64:'sample'}); mockUpload.mockResolvedValue('https://example.test/photo.jpg');
});
afterEach(() => { act(() => tree?.unmount()); });

it('keeps a new draft typed while the previous message is sending', async () => {
  const request=deferred();mockSend.mockReturnValue(request.promise);await mount();type('First message');
  let sending!:Promise<void>;act(()=>{sending=composer().onSend();});type('Next message');
  await act(async()=>{request.resolve();await sending;});
  expect(input().props.value).toBe('Next message');
});

it('a retired send cannot clear a new room draft or release its active send lock', async () => {
  const old=deferred(),fresh=deferred();mockSend.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  await mount();type('A message');let oldSend!:Promise<void>;act(()=>{oldSend=composer().onSend();});await flush();expect(mockSend).toHaveBeenCalledTimes(1);
  mockRoomId='22222222-2222-4222-8222-222222222222';await update();expect(composer().sending).toBe(false);type('B message');
  let freshSend!:Promise<void>;act(()=>{freshSend=composer().onSend();});
  await act(async()=>{old.resolve();await oldSend;});
  expect(input().props.value).toBe('');expect(composer().sending).toBe(true);
  await act(async()=>{fresh.resolve();await freshSend;});expect(composer().sending).toBe(false);
});

it('suppresses a retired failure after an account change and clears the old account draft', async () => {
  const request=deferred();mockSend.mockReturnValue(request.promise);await mount();type('Alice message');
  let sending!:Promise<void>;act(()=>{sending=composer().onSend();});await flush();expect(mockSend).toHaveBeenCalledTimes(1);
  mockViewerId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';mockEpoch++;await update();expect(input().props.value).toBe('');type('Bob draft');
  await act(async()=>{request.reject(new Error('Old request failed'));await sending;});
  expect(input().props.value).toBe('Bob draft');expect(alert().visible).toBe(false);
});

it('does not preview a picked photo when its result returns after leaving the room', async () => {
  const permission=deferred<any>();mockPick.mockReturnValue(permission.promise);await mount();
  let picking!:Promise<void>;act(()=>{picking=composer().photo.onPress();});
  mockRoomId='22222222-2222-4222-8222-222222222222';await update();
  await act(async()=>{permission.resolve({canceled:false,assets:[{uri:'file:///selected.jpg'}]});await picking;});
  expect(mockPick).toHaveBeenCalledTimes(1);expect(tree.root.findByType(PhotoPreviewModal).props.visible).toBe(false);
});

it('does not upload or send when photo preparation completes in a retired room', async () => {
  const preparing=deferred<any>();mockManipulate.mockReturnValue(preparing.promise);await mount();
  await act(async()=>{await composer().photo.onPress();});
  expect(tree.root.findByType(PhotoPreviewModal).props.visible).toBe(true);
  let sending!:Promise<void>;act(()=>{sending=tree.root.findByType(PhotoPreviewModal).props.onSend('Caption');});
  mockRoomId='22222222-2222-4222-8222-222222222222';await update();type('New room draft');
  await act(async()=>{preparing.resolve({base64:'sample'});await sending;});
  expect(mockUpload).not.toHaveBeenCalled();expect(mockSend).not.toHaveBeenCalled();expect(input().props.value).toBe('New room draft');
});

const closingGates = ['archived', 'removed', 'veiled', 'checking'] as const;
type ClosingGate = typeof closingGates[number];
function closeGate(gate: ClosingGate) {
  if (gate === 'archived') mockArchived = true;
  else if (gate === 'removed') mockMembership = 'removed';
  else mockSaidHi = gate === 'veiled' ? false : undefined;
}

describe.each(['picker', 'preparation', 'upload'] as const)('a same-visit gate change during photo %s', stage => {
  it.each(closingGates)('stops the next step when the current room becomes %s', async gate => {
    const pending = deferred<any>();
    if (stage === 'picker') mockPick.mockReturnValue(pending.promise);
    else if (stage === 'preparation') mockManipulate.mockReturnValue(pending.promise);
    else mockUpload.mockReturnValue(pending.promise);
    await mount();
    let work!: Promise<void>;
    if (stage === 'picker') {
      act(() => { work = composer().photo.onPress(); });
    } else {
      await act(async () => { await composer().photo.onPress(); });
      expect(preview().visible).toBe(true);
      act(() => { work = preview().onSend('A photo caption'); });
      await flush();
      expect(preview().sending).toBe(true);
    }
    closeGate(gate); await update();
    await act(async () => {
      pending.resolve(stage === 'picker' ? { canceled: false, assets: [{ uri: 'file:///selected.jpg' }] } : stage === 'preparation' ? { base64: 'sample' } : 'https://example.test/photo.jpg');
      await work;
    });
    if (stage === 'picker') {
      expect(mockPick).toHaveBeenCalledTimes(1);
      expect(preview().visible).toBe(false);
    }
    expect(mockUpload).toHaveBeenCalledTimes(stage === 'upload' ? 1 : 0);
    expect(mockSend).not.toHaveBeenCalled();
    expect(preview().sending).toBe(false);
  });
});

it('starts only one text send when the same callback fires twice before rerender', async () => {
  const pending = deferred(); mockSend.mockReturnValue(pending.promise);
  await mount(); type('One message');
  const send = composer().onSend;
  let first!: Promise<void>, duplicate!: Promise<void>;
  act(() => { first = send(); duplicate = send(); });
  await flush();
  expect(mockSend).toHaveBeenCalledTimes(1);
  await act(async () => { await duplicate; });
  expect(composer().sending).toBe(true);
  await act(async () => { pending.resolve(); await first; });
  expect(composer().sending).toBe(false);
  expect(input().props.value).toBe('');
});

it('owns one photo preparation/upload/send when a retained callback fires twice before rerender', async () => {
  const preparing = deferred<any>(), sending = deferred();
  mockManipulate.mockReturnValue(preparing.promise); mockSend.mockReturnValue(sending.promise);
  await mount(); await act(async () => { await composer().photo.onPress(); });
  const send = preview().onSend;
  let first!: Promise<void>, duplicate!: Promise<void>;
  act(() => { first = send('One caption'); duplicate = send('One caption'); });
  expect(mockManipulate).toHaveBeenCalledTimes(1);
  await act(async () => { await duplicate; });
  expect(preview().sending).toBe(true);
  await act(async () => { preparing.resolve({ base64: 'sample' }); }); await flush();
  expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(preview().sending).toBe(true);
  await act(async () => { sending.resolve(); await first; });
  expect(preview().sending).toBe(false);
  expect(preview().visible).toBe(false);
});

it('rejects queued old input and selection callbacks without changing the new draft, mentions or typing', async () => {
  mockMembers = [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', first_name: 'Amelia', avatar_url: null }];
  await mount(); type('A draft');
  const oldInput = input().props;
  mockRoomId = '22222222-2222-4222-8222-222222222222'; await update(); type('@Amelia');
  expect(mention()).toBeDefined();
  mockTyping.mockClear(); mockStopTyping.mockClear();
  act(() => {
    oldInput.onChangeText('Queued text from A');
    oldInput.onSelectionChange({ nativeEvent: { selection: { start: 0, end: 0 } } });
  });
  expect(input().props.value).toBe('@Amelia');
  expect(mention()).toBeDefined();
  expect(mockTyping).not.toHaveBeenCalled();
  expect(mockStopTyping).not.toHaveBeenCalled();
});

it('keeps a mention chosen during an earlier text send', async () => {
  mockMembers = [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', first_name: 'Amelia', avatar_url: null }];
  const pending = deferred(); mockSend.mockReturnValue(pending.promise);
  await mount(); type('@A');
  let work!: Promise<void>; act(() => { work = composer().onSend(); });
  type('@A'); // A new mention belongs to the next draft after the original detaches.
  act(() => mention()!.props.onPress());
  expect(input().props.value).toBe('@Amelia ');
  await act(async () => { pending.resolve(); await work; });
  expect(input().props.value).toBe('@Amelia ');
});

it.each(['picker', 'preparation', 'upload'] as const)('does not revive photo %s when a gate closes and reopens before its result', async stage => {
  const pending = deferred<any>();
  if (stage === 'picker') mockPick.mockReturnValueOnce(pending.promise);
  else if (stage === 'preparation') mockManipulate.mockReturnValueOnce(pending.promise);
  else mockUpload.mockReturnValueOnce(pending.promise);
  await mount();
  let work!: Promise<void>;
  if (stage === 'picker') act(() => { work = composer().photo.onPress(); });
  else {
    await act(async () => { await composer().photo.onPress(); });
    act(() => { work = preview().onSend('Old gated attempt'); }); await flush();
  }
  mockSaidHi = undefined; await update();
  mockSaidHi = true; await update();
  await act(async () => {
    pending.resolve(stage === 'picker' ? { canceled: false, assets: [{ uri: 'file:///selected.jpg' }] } : stage === 'preparation' ? { base64: 'sample' } : 'https://example.test/old.jpg');
    await work;
  });
  expect(mockSend).not.toHaveBeenCalled();
  expect(preview().visible).toBe(false);
  expect(preview().sending).toBe(false);
  await act(async () => { await composer().photo.onPress(); });
  expect(preview().visible).toBe(true);
});

it('opens only one system picker for two retained photo-button callbacks before rerender', async () => {
  const pending = deferred<any>(); mockPick.mockReturnValueOnce(pending.promise);
  await mount();
  const pick = composer().photo.onPress;
  let first!: Promise<void>, duplicate!: Promise<void>;
  act(() => { first = pick(); duplicate = pick(); });
  expect(mockPick).toHaveBeenCalledTimes(1);
  await act(async () => { await duplicate; });
  await act(async () => { pending.resolve({ canceled: false, assets: [{ uri: 'file:///selected.jpg' }] }); await first; });
  expect(mockPick).toHaveBeenCalledTimes(1);
  expect(preview().visible).toBe(true);
});

it.each([false, undefined])('still allows the original first text message while said-hi is %s', async saidHi => {
  mockSaidHi = saidHi; await mount();
  await act(async () => { await composer().photo.onPress(); });
  expect(mockPick).not.toHaveBeenCalled();
  type('Hi from Venice');
  await act(async () => { await composer().onSend(); });
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(mockSend.mock.calls[0][0]).toBe('Hi from Venice');
  await act(async () => { await composer().photo.onPress(); });
  expect(mockPick).toHaveBeenCalledTimes(1);
  expect(preview().visible).toBe(true);
});

const historyMessage = (id: string, minute: number, sender = 'jamie') => ({ id, sender_id: sender, sender_name: 'Jamie', body: id, created_at: new Date(Date.UTC(2026, 8, 19, 12, minute)).toISOString(), image_url: null, reply_to: null, reactions: [] });
const messageList = () => tree.root.findByType(FlatList);
const latestControl = () => tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel?.startsWith('Scroll to latest messages'))!;
it('keeps the mounted topic history during refresh but still hides it while admission is being checked', async () => {
  mockMessages=[historyMessage('first',1)];await mount();
  const list=messageList();mockMessagesLoading=true;await update();
  expect(messageList()).toBe(list);
  mockSaidHi=undefined;await update();
  expect(tree.root.findAllByType(FlatList)).toHaveLength(0);
});
it('counts incoming topic messages without counting older history, own sends or reaction updates', async () => {
  mockMessages=[historyMessage('first',1),historyMessage('latest',2)];await mount();
  act(()=>messageList().props.onScroll({nativeEvent:{contentOffset:{y:1000},layoutMeasurement:{height:400},contentSize:{height:1800}}}));
  mockMessages=[historyMessage('older',0),...mockMessages];await update();
  expect(latestControl().findAllByType(Text)).toHaveLength(0);
  expect(latestControl().props.accessibilityLabel).toBe('Scroll to latest messages');
  mockMessages=[...mockMessages,historyMessage('mine',3,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')];await update();
  expect(latestControl().props.accessibilityLabel).toBe('Scroll to latest messages');
  mockMessages=[...mockMessages,historyMessage('new',4)];await update();
  expect(latestControl().props.accessibilityLabel).toBe('Scroll to latest messages, 1 new message');
  mockMessages=mockMessages.map(row=>({...row,reactions:[]}));await update();
  expect(latestControl().props.accessibilityLabel).toBe('Scroll to latest messages, 1 new message');
  mockMessages=[...mockMessages.slice(1),historyMessage('replacement',5)];await update();
  expect(latestControl().props.accessibilityLabel).toBe('Scroll to latest messages, 2 new messages');
  mockRoomId='22222222-2222-4222-8222-222222222222';mockMessages=[historyMessage('other-room',6)];await update();
  act(()=>messageList().props.onScroll({nativeEvent:{contentOffset:{y:1000},layoutMeasurement:{height:400},contentSize:{height:1800}}}));
  expect(latestControl().props.accessibilityLabel).toBe('Scroll to latest messages');
});

const topicBubble=()=>tree.root.findAllByType(TouchableOpacity).find(node=>node.props.accessibilityHint==='hold for message actions')!;
const topicMenu=()=>tree.root.findByType(MessageActionsMenu).props.menu;
it('opens the same topic menu through accessibility and resolves the latest reaction alias',async()=>{
 mockMessages=[{...historyMessage('message-a',1),reactions:[]}];await mount();
 act(()=>topicBubble().props.onAccessibilityAction({nativeEvent:{actionName:'messageActions'}}));
 const choose=topicMenu().onReact;
 mockMessages=[{...mockMessages[0],reactions:[{reaction:'heart',user_id:mockViewerId}]}];await update();
 await act(async()=>choose('❤️'));expect(mockReact).toHaveBeenCalledWith('message-a','heart');
});
it.each(['room','deleted','archived','removed'] as const)('retires topic quick reactions when %s changes',async(change)=>{
 mockMessages=[historyMessage('message-a',1)];await mount();act(()=>topicBubble().props.onLongPress());const choose=topicMenu().onReact;
 if(change==='room')mockRoomId='22222222-2222-4222-8222-222222222222';
 if(change==='deleted')mockMessages=[];
 if(change==='archived')mockArchived=true;
 if(change==='removed')mockMembership='removed';
 await update();await act(async()=>choose('👍'));expect(mockReact).not.toHaveBeenCalled();expect(topicMenu()).toBeNull();
});

it('focuses the existing composer when replying after the menu closes',async()=>{
 mockMessages=[historyMessage('33333333-3333-4333-8333-333333333333',1)];await mount();const focus=jest.fn();composer().composerInputRef.current={focus};
 act(()=>topicBubble().props.onLongPress());await act(async()=>{topicMenu().buttons.find((button:any)=>button.text==='reply').onPress();for(let i=0;i<12;i++)await Promise.resolve();});
 await act(async()=>{await new Promise(requestAnimationFrame);});
 expect(focus).toHaveBeenCalledTimes(1);
});

it('keeps report and block available on archived messages without offering writes',async()=>{
 mockMessages=[historyMessage('message-a',1)];mockArchived=true;await mount();act(()=>topicBubble().props.onLongPress());
 expect(topicMenu().onReact).toBeUndefined();expect(topicMenu().buttons.map((button:any)=>button.text)).toEqual(['report','block','cancel']);
});

it('releases the composer after a target-read deadline and keeps the reply without sending',async()=>{
 const {RequestDeadlineError}=require('../../../lib/requestWithDeadline');
 const wait=deferred();mockVerifyTarget.mockReturnValueOnce(wait.promise);
 mockMessages=[historyMessage('33333333-3333-4333-8333-333333333333',1)];await mount();
 act(()=>topicBubble().props.onLongPress());
 await act(async()=>{topicMenu().buttons.find((button:any)=>button.text==='reply').onPress();});
 type('I’ll bring a blanket');await flush();
 let sending!:Promise<void>;act(()=>{sending=composer().onSend();});await flush();
 expect(composer().sending).toBe(true);
 await act(async()=>{wait.reject(new RequestDeadlineError());await sending;});
 expect(composer().sending).toBe(false);expect(input().props.value).toBe('I’ll bring a blanket');
 expect(mockSend).not.toHaveBeenCalled();expect(alert().title).toBe('Message not sent');
 // An explicit retry uses the retained reply target and message.
 await act(async()=>{await composer().onSend();});
 expect(mockSend).toHaveBeenCalledTimes(1);
 expect(mockSend.mock.calls[0][0]).toBe('I’ll bring a blanket');
 expect(mockSend.mock.calls[0][2]).toBe(mockMessages[0].id);
});

it('lets @ browse every named chat member, including those after the first six',async()=>{
 mockMembers=Array.from({length:9},(_,i)=>({id:`11111111-1111-4111-8111-${String(i).padStart(12,"0")}`,first_name:`Friend${i}`,avatar_url:null}));
 await mount();type('@');await flush();
 const mentions=tree.root.findAllByType(TouchableOpacity).filter(node=>node.props.accessibilityLabel?.startsWith('Mention '));
 expect(mentions).toHaveLength(9);
 act(()=>mentions.find(node=>node.props.accessibilityLabel==='Mention Friend8')!.props.onPress());
 expect(input().props.value).toBe('@Friend8 ');
});


it('shows member lookup feedback and permits an explicit retry without losing the draft', async()=>{
 mockMembersLoading=true;await mount();type('Hello @');
 expect(tree.root.findByType(ChatMentionPicker).props.loading).toBe(true);
 mockMembersLoading=false;mockMembersError=true;await update();
 act(()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Retry chat members')!.props.onPress());
 expect(mockRetryMembers).toHaveBeenCalledTimes(1);
 expect(input().props.value).toBe('Hello @');
 mockMembersError=false;mockMembers=[{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',first_name:'Mary Jane',avatar_url:null}];await update();
 act(()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Mention Mary Jane')!.props.onPress());
 expect(input().props.value).toBe('Hello @Mary Jane ');
});

it('ignores a retired room’s member retry and selection callbacks',async()=>{
 mockMembersError=true;mockMembers=[{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',first_name:'Mary Jane',avatar_url:null}];
 await mount();type('@');const old=tree.root.findByType(ChatMentionPicker).props;
 mockRoomId='22222222-2222-4222-8222-222222222222';await update();type('New room draft');
 act(()=>{old.onRetry();old.onSelect(mockMembers[0]);old.onClose();});
 expect(mockRetryMembers).not.toHaveBeenCalled();expect(input().props.value).toBe('New room draft');
});


it('routes a stored mention to its selected person and rejects a retired route callback',async()=>{
 const first='cccccccc-cccc-4ccc-8ccc-cccccccccccc',second='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 const body='@Alex and @Alex';
 const mention_data=addChatMentionReference(body,addChatMentionReference(body,null,first,'Alex',0),second,'Alex',10);
 mockMessages=[{id:'33333333-3333-4333-8333-333333333333',body,mention_data,sender_id:mockViewerId,sender_name:'Alice',sender_photo:null,kind:'message',payload:null,image_url:null,created_at:'2026-09-19T19:00:00Z',reactions:[],reply_count:0,reply_to:null}];
 await mount();const props=tree.root.findByType(LinkifiedText).props;
 expect(props.mentionDocument).toEqual(mention_data);
 act(()=>props.onMentionPress(second));
 expect(tree.root.findByType(MiniProfileCard).props.userId).toBe(second);
 mockRoomId='22222222-2222-4222-8222-222222222222';await update();
 act(()=>props.onMentionPress(first));
 expect(tree.root.findByType(MiniProfileCard).props.userId).toBeNull();
});


it('captures a camera image into the existing preview without sending it automatically', async () => {
  await mount(); await act(async () => { await composer().camera.onPress(); });
  expect(mockCameraPermission).toHaveBeenCalledTimes(1); expect(mockCamera).toHaveBeenCalledTimes(1);
  expect(mockPick).not.toHaveBeenCalled(); expect(preview().visible).toBe(true);
  expect(mockUpload).not.toHaveBeenCalled();
});
it.each(['denied','cancelled'])('does not open a photo preview when camera is %s', async outcome => {
  if (outcome === 'denied') mockCameraPermission.mockResolvedValueOnce({status:'denied'});
  else mockCamera.mockResolvedValueOnce({canceled:true});
  await mount(); await act(async () => { await composer().camera.onPress(); });
  expect(preview().visible).toBe(false); expect(mockUpload).not.toHaveBeenCalled();
  if (outcome === 'denied') expect(mockCamera).not.toHaveBeenCalled();
});
it('shares the picker admission lock between camera and library', async () => {
  const permission=deferred<any>(); mockCameraPermission.mockReturnValueOnce(permission.promise);
  await mount(); let work!:Promise<void>; const actions=composer();
  act(()=>{work=actions.camera.onPress();}); await act(async()=>{await actions.photo.onPress();});
  expect(mockPermission).not.toHaveBeenCalled();
  await act(async()=>{permission.resolve({status:'granted'});await work;});
  expect(mockCamera).toHaveBeenCalledTimes(1);
});

it('carries the selected duplicate-name identity through the durable topic send',async()=>{
 mockMembers=[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',first_name:'Alex',avatar_url:null},{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',first_name:'Alex',avatar_url:null}];
 await mount();type('@Al');act(()=>tree.root.findByType(ChatMentionPicker).props.onSelect(mockMembers[1]));await flush();
 expect(input().props.value).toBe('@Alex ');
 await act(async()=>{await composer().onSend();});
 expect(mockSend.mock.calls[0][5]).toMatchObject({text:'@Alex',references:[{userId:mockMembers[1].id,label:'Alex',start:0,end:5}]});
 expect(input().props.value).toBe('');
});
it('keeps the selected topic mention and UUID in an uncertain send attempt',async()=>{
 mockMembers=[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',first_name:'Alex',avatar_url:null}];mockSend.mockRejectedValueOnce(Error('Offline'));
 await mount();type('@Al');act(()=>tree.root.findByType(ChatMentionPicker).props.onSelect(mockMembers[0]));await flush();
 await act(async()=>{await composer().onSend();});
 const raw=await AsyncStorage.getItem(`topic-composer:v1:${mockViewerId}:${mockRoomId}`);const stored=JSON.parse(raw!);
 expect(stored.draft.attempt.mentions.references[0].userId).toBe(mockMembers[0].id);
 expect(stored.draft.mentions).toBeNull();expect(stored.draft.attemptDetached).toBe(true);
 await act(async()=>{await composer().onSend();});
 expect(mockSend.mock.calls[1][4]).toBe(mockSend.mock.calls[0][4]);expect(mockSend.mock.calls[1][5]).toEqual(mockSend.mock.calls[0][5]);
});

it('retains original identity for a topic edit and removes it when its tag is manually replaced',async()=>{
 const memberId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',body='@Alex';const mention_data=addChatMentionReference(body,null,memberId,'Alex',0);
 const id='33333333-3333-4333-8333-333333333333';mockMessages=[{...historyMessage(id,1),sender_id:mockViewerId,body,mention_data,edited_at:null}];
 await mount();act(()=>topicBubble().props.onLongPress());act(()=>topicMenu().buttons.find((button:any)=>button.text==='edit').onPress());await flush();
 type('Hello everyone');await act(async()=>{await composer().onSend();});
 expect(mockEdit.mock.calls[0]).toEqual([id,'Hello everyone',{version:1,text:'Hello everyone',references:[]},{id,body:'@Alex',edited_at:null,mentions:mention_data}]);
});


it.each(['preparation', 'upload', 'send'] as const)('ends stalled photo %s and retries the selected image without late completion closing the preview', async stage => {
  jest.useFakeTimers();
  try {
    const pending = deferred<any>();
    await mount(); await act(async () => { await composer().photo.onPress(); });
    (stage === 'preparation' ? mockManipulate : stage === 'upload' ? mockUpload : mockSend).mockReturnValueOnce(pending.promise);
    let work!: Promise<void>; act(() => { work = preview().onSend('Original caption'); }); await flush();
    await act(async () => { jest.advanceTimersByTime(stage === 'preparation' ? 12_001 : stage === 'upload' ? 30_001 : 35_001); }); await flush(); await work;
    expect(preview().visible).toBe(true); expect(preview().sending).toBe(false); expect(preview().errorMessage).toBeTruthy();
    expect(preview().captionLocked).toBe(stage === 'send');
    const original = mockSend.mock.calls[0];
    await act(async () => { await preview().onSend(stage === 'send' ? 'Changed caption' : 'Original caption'); });
    expect(preview().visible).toBe(false);
    if (stage === 'send') {
      expect(mockSend.mock.calls[1][0]).toBe('Original caption');
      expect(mockSend.mock.calls[1][4]).toBe(original[4]);
      expect(mockUpload).toHaveBeenCalledTimes(1);
      expect(original[6].isCurrent()).toBe(false);
    }
    await act(async () => { pending.resolve(stage === 'preparation' ? { base64: 'late' } : stage === 'upload' ? 'https://example.test/late.jpg' : undefined); });
    expect(preview().visible).toBe(false);
    expect(mockSend).toHaveBeenCalledTimes(stage === 'send' ? 2 : 1);
  } finally { jest.useRealTimers(); }
});

it('keeps the exact pin identity after an uncertain send, close/reopen and explicit retry', async () => {
  jest.useFakeTimers();
  try {
    await mount(); act(() => composer().location.onPress());
    mockLocation.mockReturnValueOnce(new Promise(() => {}));
    let work!: Promise<boolean>; act(() => { work = location().onConfirm(34, -118, 'Ocean Park'); }); await flush();
    const original = mockLocation.mock.calls[0];
    await act(async () => { jest.advanceTimersByTime(25001); }); await flush();
    expect(await work).toBe(false); expect(location().visible).toBe(true); expect(location().retryPreservesMessage).toBe(true);
    act(() => location().onClose()); act(() => composer().location.onPress());
    await act(async () => { expect(await location().onConfirm(34, -118, 'Ocean Park')).toBe(true); });
    expect(mockLocation.mock.calls[1][3]).toBe(original[3]);
    expect(location().visible).toBe(false);
    expect(original[4].isCurrent()).toBe(false);
  } finally { jest.useRealTimers(); }
});


const introRetry=()=>tree.root.findAllByType(TouchableOpacity).find(node=>node.props.accessibilityLabel==='Retry checking your chat introduction');
const introCopy=()=>tree.root.findAllByType(Text).map(node=>React.Children.toArray(node.props.children).join(''));
it('replaces an unknown failed introduction read with explicit recovery, preserving the draft and locking duplicate retries',async()=>{
 mockSaidHi=undefined;mockIntroError=true;const pending=deferred<any>();mockIntroRefetch.mockReturnValue(pending.promise);await mount();
 type('Hi from Venice');expect(introCopy()).toContain('Couldn’t open this chat');expect(tree.root.findAllByType(FlatList)).toHaveLength(0);
 expect(composer().photo.disabled).toBe(true);expect(composer().camera.disabled).toBe(true);expect(composer().location.disabled).toBe(true);
 const retry=introRetry()!.props.onPress;act(()=>{retry();retry();});expect(mockIntroRefetch).toHaveBeenCalledTimes(1);expect(introRetry()!.props.disabled).toBe(true);expect(input().props.value).toBe('Hi from Venice');
 mockIntroError=false;mockIntroFetching=true;await update();expect(introRetry()!.props.disabled).toBe(true);expect(introCopy()).toContain('Checking…');
 mockIntroFetching=false;
 await act(async()=>{pending.resolve({});});mockIntroError=false;mockSaidHi=true;await update();
 expect(introRetry()).toBeUndefined();expect(tree.root.findAllByType(FlatList)).toHaveLength(1);expect(input().props.value).toBe('Hi from Venice');
});
it('preserves first-text entry when an introduction lookup fails',async()=>{
 mockSaidHi=undefined;mockIntroError=true;await mount();type('Hello from Venice');await act(async()=>composer().onSend());
 expect(mockSend).toHaveBeenCalledTimes(1);expect(introRetry()).toBeUndefined();expect(tree.root.findAllByType(FlatList)).toHaveLength(1);
});
it.each([true,false])('retains confirmed introduction status %s through a background read failure',async status=>{
 mockSaidHi=status;mockIntroError=true;await mount();expect(introRetry()).toBeUndefined();
 expect(tree.root.findAllByType(FlatList)).toHaveLength(status?1:0);if(!status)expect(introCopy()).toContain('say hi first');
});
it.each(['room','account','blur','unmount'] as const)('retires introduction retry callbacks on %s',async retirement=>{
 mockSaidHi=undefined;mockIntroError=true;await mount();const retry=introRetry()!.props.onPress;
 if(retirement==='room'){mockRoomId='new-room';await update();}
 else if(retirement==='account'){mockViewerId='new-viewer';mockEpoch++;await update();}
 else if(retirement==='blur')act(()=>mockFocusCleanup?.());
 else act(()=>tree.unmount());
 retry();expect(mockIntroRefetch).not.toHaveBeenCalled();
});
it('bounds a stalled introduction read without query retries and isolates its account cache key',async()=>{
 jest.useFakeTimers();try{
  mockSaidHi=undefined;await mount();const stalled=deferred<boolean>();mockHasSaidHi.mockReturnValueOnce(stalled.promise);
  expect(mockIntroQuery.retry).toBe(false);expect(mockIntroQuery.queryKey.slice(-2)).toEqual([mockViewerId,mockEpoch]);
  const outcome=mockIntroQuery.queryFn({signal:new AbortController().signal}).then(()=>false,()=>true);
  await act(async()=>{jest.advanceTimersByTime(12001);});expect(await outcome).toBe(true);
  stalled.resolve(true);await flush();expect(mockHasSaidHi).toHaveBeenCalledTimes(1);
 }finally{jest.useRealTimers();}
});
it('rejects an introduction result after the original account visit ends',async()=>{
 mockSaidHi=undefined;await mount();const pending=deferred<boolean>();mockHasSaidHi.mockReturnValueOnce(pending.promise);
 const result=mockIntroQuery.queryFn({signal:new AbortController().signal}).then(()=>false,()=>true);
 mockViewerId='another-viewer';mockEpoch++;await update();pending.resolve(true);expect(await result).toBe(true);
});


it('ignores a retired room scroll event when positioning the next community conversation', async () => {
  await mount();
  const list = () => tree.root.findByType(FlatList);
  const oldScroll = list().props.onScroll;
  mockRoomId = '22222222-2222-4222-8222-222222222222'; await update();
  const scroll = jest.spyOn(list().instance, 'scrollToOffset').mockImplementation(() => {});
  act(() => oldScroll({ nativeEvent: { contentOffset: { y: 600 }, contentSize: { height: 1000 }, layoutMeasurement: { height: 200 } } }));
  act(() => list().props.onContentSizeChange(390, 1000));
  expect(scroll).toHaveBeenLastCalledWith({ offset: 0, animated: false });
});


it('starts topic history at newest and preserves a reader above the live edge through arrivals', async () => {
  mockMessages = Array.from({ length: 60 }, (_, index) => historyMessage(`message-${index+1}`, index+1));
  await mount();
  expect(messageList().props.inverted).toBe(true);
  expect(messageList().props.data.slice(0, 3).map((message: any) => message.id)).toEqual(['message-60', 'message-59', 'message-58']);
  const scroll = jest.spyOn(messageList().instance, 'scrollToOffset').mockImplementation(() => {});
  act(() => messageList().props.onLayout());
  expect(scroll).toHaveBeenLastCalledWith({ offset: 0, animated: false });
  act(() => messageList().props.onScroll({ nativeEvent: { contentOffset: { y: 600 } } }));
  expect(messageList().props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 });
  scroll.mockClear();
  mockMessages = [...mockMessages, historyMessage('message-61', 61)];
  await update();
  act(() => messageList().props.onContentSizeChange(390, 5000));
  expect(scroll).not.toHaveBeenCalled();
  expect(latestControl().props.accessibilityLabel).toBe('Scroll to latest messages, 1 new message');
  act(() => messageList().props.onScroll({ nativeEvent: { contentOffset: { y: 0 } } }));
  expect(messageList().props.maintainVisibleContentPosition).toBeUndefined();
  act(() => messageList().props.onLayout());
  expect(scroll).toHaveBeenLastCalledWith({ offset: 0, animated: false });
});


it('shows truthful uncertain reaction recovery and invokes the exact intent retry instead of toggling again', async () => {
  const { UnconfirmedTopicReactionError } = jest.requireActual('../../../hooks/useTopicChat');
  const retry = jest.fn().mockResolvedValue(undefined);
  mockReact.mockRejectedValueOnce(new UnconfirmedTopicReactionError(retry));
  mockMessages = [historyMessage('message-a', 1)]; await mount();
  act(() => topicBubble().props.onLongPress());
  await act(async () => topicMenu().onReact('❤️'));
  expect(alert().title).toBe('Reaction not confirmed');
  expect(alert().message).toContain('keeps the same change');
  expect(alert().buttons.map((button: any) => button.text)).toEqual(['Close', 'Retry']);
  await act(async () => alert().buttons.find((button: any) => button.text === 'Retry').onPress());
  expect(retry).toHaveBeenCalledTimes(1);
  expect(mockReact).toHaveBeenCalledTimes(1);
});

it.each(['room', 'account', 'deleted', 'archived', 'removed'] as const)('the uncertain reaction alert cannot retry after %s changes', async change => {
  const { UnconfirmedTopicReactionError } = jest.requireActual('../../../hooks/useTopicChat');
  const retry = jest.fn().mockResolvedValue(undefined);
  mockReact.mockRejectedValueOnce(new UnconfirmedTopicReactionError(retry));
  mockMessages = [historyMessage('message-a', 1)]; await mount();
  act(() => topicBubble().props.onLongPress()); await act(async () => topicMenu().onReact('❤️'));
  const oldRetry = alert().buttons.find((button: any) => button.text === 'Retry').onPress;
  if (change === 'room') mockRoomId = '22222222-2222-4222-8222-222222222222';
  if (change === 'account') { mockViewerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; mockEpoch++; }
  if (change === 'deleted') mockMessages = [];
  if (change === 'archived') mockArchived = true;
  if (change === 'removed') mockMembership = 'removed';
  await update(); await act(async () => oldRetry());
  expect(retry).not.toHaveBeenCalled();
  expect(mockReact).toHaveBeenCalledTimes(1);
});


it('opens selected-photo preview when broad library access is denied, without requesting that access', async () => {
  mockPermission.mockResolvedValue({ status: 'denied' });
  await mount();
  await act(async () => { await composer().photo.onPress(); });
  expect(mockPermission).not.toHaveBeenCalled();
  expect(mockPick).toHaveBeenCalledWith({ mediaTypes: ['images'], quality: 0.8 });
  expect(preview().visible).toBe(true);
  expect(mockUpload).not.toHaveBeenCalled();
  expect(mockSend).not.toHaveBeenCalled();
});


it('leaves the current draft intact when the system photo picker is cancelled', async () => {
  mockPick.mockResolvedValueOnce({ canceled: true, assets: null });
  await mount(); type('Keep this draft');
  await act(async () => { await composer().photo.onPress(); });
  expect(preview().visible).toBe(false);
  expect(input().props.value).toBe('Keep this draft');
  await act(async () => { await composer().photo.onPress(); });
  expect(preview().visible).toBe(true);
  expect(mockPick).toHaveBeenCalledTimes(2);
});

it('does not open the camera when camera permission returns after the account changes', async () => {
  const permission = deferred<any>(); mockCameraPermission.mockReturnValueOnce(permission.promise);
  await mount(); let work!: Promise<void>;
  act(() => { work = composer().camera.onPress(); });
  mockViewerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; mockEpoch++; await update();
  await act(async () => { permission.resolve({ status: 'granted' }); await work; });
  expect(mockCamera).not.toHaveBeenCalled();
  expect(preview().visible).toBe(false);
});


it('finishes a confirmed new topic send without duplicate receipt reads or waiting for history refresh', async () => {
 mockCheckAttempt.mockReturnValue(new Promise(()=>{}));
 mockRefresh.mockReturnValue(new Promise(()=>{}));
 await mount();type('A new topic message');let done=false;
 act(()=>{void composer().onSend().then(()=>{done=true;});});await flush();await flush();
 expect(mockSend).toHaveBeenCalledTimes(1);
 expect(mockCheckAttempt).not.toHaveBeenCalled();
 expect(done).toBe(true);expect(composer().sending).toBe(false);expect(input().props.value).toBe('');
});


it('catches up an ordinary topic on foreground return and ignores later returns after blur', async () => {
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
    await mount(); await flush(); mockRefresh.mockClear();
    emit('background'); emit('active'); await flush();
    expect(mockRefresh).toHaveBeenCalledTimes(1); expect(mockRefresh).toHaveBeenCalledWith(true);
    emit('active'); await flush(); expect(mockRefresh).toHaveBeenCalledTimes(1);
    act(() => mockFocusCleanup?.()); emit('background'); emit('active'); await flush();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  } finally {
    act(() => tree?.unmount()); spy.mockRestore();
    // spyOn reuses the preset's jest.fn; restore its subscription contract.
    if (originalListener && jest.isMockFunction(AppState.addEventListener)) jest.mocked(AppState.addEventListener).mockImplementation(originalListener);
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: originalState });
  }
});

it('describes an owned-message delete timeout as unconfirmed instead of a definite refusal', async () => {
  const { RequestDeadlineError } = jest.requireActual('../../../lib/requestWithDeadline');
  mockDeleteOwn.mockRejectedValueOnce(new RequestDeadlineError());
  mockMessages = [{...historyMessage('message-a',1),sender_id:mockViewerId}]; await mount();
  act(() => topicBubble().props.onLongPress());
  const remove = topicMenu().buttons.find((button:any) => button.text === 'delete this message');
  expect(remove).toBeDefined();
  await act(async () => remove.onPress());
  expect(alert().title).toBe('Removal not confirmed');
  expect(alert().message).toContain('Reopen this chat');
  expect(mockDeleteOwn).toHaveBeenCalledTimes(1);
});


it('does not snap back during a drag or a same-turn near-edge scroll and layout', async () => {
  mockMessages = Array.from({ length: 60 }, (_, index) => historyMessage(`message-${index+1}`, index+1));
  await mount();
  const scroll = jest.spyOn(messageList().instance, 'scrollToOffset').mockImplementation(() => {});
  act(() => {
    messageList().props.onScrollBeginDrag?.();
    messageList().props.onContentSizeChange(390, 5000);
    messageList().props.onScroll({ nativeEvent: { contentOffset: { y: 10 } } });
    messageList().props.onLayout();
  });
  expect(scroll).not.toHaveBeenCalled();
});


it.each(['text', 'photo', 'location'] as const)('respects a newer reading position during delayed topic %s delivery', async kind => {
  const pending = deferred();
  (kind === 'location' ? mockLocation : mockSend).mockReturnValueOnce(pending.promise);
  mockMessages = [historyMessage('message-a', 1)];
  await mount();
  let work!: Promise<unknown>;
  if (kind === 'text') { type('Delayed message'); act(() => { work = composer().onSend(); }); }
  if (kind === 'photo') { await act(async () => composer().photo.onPress()); act(() => { work = preview().onSend('Caption'); }); }
  if (kind === 'location') act(() => { work = location().onConfirm(34, -118, 'Ocean Park'); });
  await flush();
  const list = () => tree.root.findByType(FlatList);
  const scroll = jest.spyOn(list().instance, 'scrollToOffset').mockImplementation(() => {});
  act(() => {
    list().props.onScrollBeginDrag();
    list().props.onScroll({ nativeEvent: { contentOffset: { y: 600 } } });
    list().props.onScrollEndDrag({ nativeEvent: { contentOffset: { y: 600 } } });
  });
  await act(async () => { pending.resolve(); await work; }); await flush();
  expect(scroll).not.toHaveBeenCalled();
  expect(composer().sending).toBe(false);
});
