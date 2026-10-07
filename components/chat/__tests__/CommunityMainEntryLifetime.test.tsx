jest.mock('react-native-keyboard-controller', () => ({
  ...require('react-native-keyboard-controller/jest'),
  useAnimatedKeyboard: () => require('react').useRef({ height: { value: 0 }, state: { value: 4 } }).current,
}));
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CommunityMessageActions } from '../../communities/CommunityMessageActions';
import LinkifiedText from '../../LinkifiedText';
import MiniProfileCard from '../../MiniProfileCard';
import { addChatMentionReference } from '../../../lib/chatMentionIdentity';
import { ChatMentionPicker } from '../ChatMentionPicker';
import { MessageActionsMenu } from '../MessageActionsMenu';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FlatList, Text, TextInput, TouchableOpacity } from 'react-native';
import { formatChatDay } from '../../../lib/communityChatUi';
import CommunityThreadScreen from '../../../app/community-thread/[id]';
import { CommunityChatComposer } from '../CommunityChatComposer';
import { BrandedAlert } from '../../BrandedAlert';
import PhotoPreviewModal from '../PhotoPreviewModal';
import LocationPickerModal from '../LocationPickerModal';
import ReactionEmojiPicker from '../ReactionEmojiPicker';

let mockRoomId: string, mockViewerId: string | null, mockEpoch: number, mockMembership: string;
let mockMembersError = false, mockMembersLoading = false;
const mockRetryMembers = jest.fn().mockResolvedValue(undefined);
let mockMessages: any[], mockMembers: any[];
const mockCheckAttempt = jest.fn(), mockVerifyTarget = jest.fn();
jest.mock('../../../lib/topicComposerDraft', () => ({ ...jest.requireActual('../../../lib/topicComposerDraft'), verifyTopicComposerTarget: (...args:any[]) => mockVerifyTarget(...args), checkTopicComposerAttempt: (...args:any[]) => mockCheckAttempt(...args) }));
const mockSend = jest.fn(), mockEdit = jest.fn(), mockDelete = jest.fn(), mockReact = jest.fn(), mockRead = jest.fn();
const mockCameraPermission = jest.fn(), mockCamera = jest.fn();
const mockPermission = jest.fn(), mockPick = jest.fn(), mockManipulate = jest.fn(), mockUpload = jest.fn();
const mockInvalidate = jest.fn().mockResolvedValue(undefined), mockCancel = jest.fn().mockResolvedValue(undefined);
const mockQueryClient = { invalidateQueries: mockInvalidate, cancelQueries: mockCancel };
const mockRealtime: (() => void)[] = [];
jest.mock('expo-router', () => ({ useFocusEffect: (callback: any) => require('react').useEffect(callback, [callback]), useRouter: () => ({ push: jest.fn(), back: jest.fn() }), useLocalSearchParams: () => ({ id: mockRoomId }), Stack: { Screen: () => null } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({top:0,bottom:0,left:0,right:0}) }));
jest.mock('../../../constants/FeatureFlags', () => ({ COMMUNITY_CHAT_GROUPING_ENABLED: true }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').AfterglowFallbackFonts }) }));
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => {
  const { useCallback } = require('react');
  const id = mockViewerId, epoch = mockEpoch;
  const isCurrent = useCallback(() => id === mockViewerId && epoch === mockEpoch, [id, epoch]);
  return { viewerId: id, epoch, isCurrent, isLoading: false, error: null, retry: jest.fn() };
} }));
jest.mock('../../../hooks/useCommunityBroadcastMute', () => ({ useCommunityBroadcastMute: () => ({ muted: false, ready: true, isChecking: false, toggle: jest.fn() }) }));
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ online: true }) }));
jest.mock('../../../hooks/useBlock', () => ({ useBlock: () => ({ blockUser: jest.fn() }) }));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mockQueryClient,
  useInfiniteQuery: () => ({ data: { pages: [{ messages: mockMessages }] }, isLoading: false, isError: false, refetch: jest.fn() }),
  useQuery: ({ queryKey }: any) => ({ data: ({
    'community-my-membership': { status: mockMembership },
    'community-chat-cards': { cards: [{ community_id: mockRoomId, name: 'Sunset Club', main_chat_name: 'After Glow' }] },
    'community-chat-members': mockMembers,
  } as Record<string, unknown>)[queryKey[0] as string], isLoading: queryKey[0]==='community-chat-members' && mockMembersLoading, isError: queryKey[0]==='community-chat-members' && mockMembersError, refetch: mockRetryMembers }),
}));
jest.mock('../../../lib/communityChat', () => ({
  markBroadcastsRead: (...args: any[]) => mockRead(...args),
  sendCommunityMessage: (...args: any[]) => mockSend(...args),
  editCommunityMessage: (...args: any[]) => mockEdit(...args),
  deleteCommunityMessage: (...args: any[]) => mockDelete(...args),
  toggleBroadcastReaction: (...args: any[]) => mockReact(...args),
  ObsoleteCommunityOperationError: class extends Error {},
  isObsoleteCommunityOperation: (error: any) => error?.name === 'ObsoleteCommunityOperationError',
}));
jest.mock('../../../lib/communityJoin', () => ({}));
jest.mock('expo-image-picker', () => ({ requestCameraPermissionsAsync: (...args: any[]) => mockCameraPermission(...args), launchCameraAsync: (...args: any[]) => mockCamera(...args), requestMediaLibraryPermissionsAsync: (...args: any[]) => mockPermission(...args), launchImageLibraryAsync: (...args: any[]) => mockPick(...args) }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: (...args: any[]) => mockManipulate(...args), SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('../../../lib/uploadPhoto', () => ({ uploadBase64ToStorage: (...args: any[]) => mockUpload(...args) }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn() }));
jest.mock('../../../lib/supabase', () => ({ supabase: { realtime: { isDisconnecting: () => false }, channel: () => { const channel = { on: (kind: any, filter: any, callback: () => void) => { if (kind === 'postgres_changes' && filter.table === 'community_broadcasts' && filter.filter) mockRealtime.push(callback); return channel; }, subscribe: () => channel }; return channel; }, removeChannel: jest.fn() } }));
jest.mock('../../BrandedAlert', () => ({ BrandedAlert: () => null }));
jest.mock('../../modals/ReportModal', () => ({ ReportModal: () => null }));
jest.mock('../../MiniProfileCard', () => () => null);
jest.mock('../../communities/BroadcastCard', () => ({ BroadcastCard: () => null }));
jest.mock('../../communities/CommunityMessageActions', () => ({ CommunityMessageActions: () => null }));
jest.mock('../PhotoPreviewModal', () => () => null);
jest.mock('../LocationPickerModal', () => () => null);
jest.mock('../ReactionEmojiPicker', () => () => null);
jest.mock('../ChatPhotoAttachment', () => ({ ChatPhotoAttachment: () => null }));
jest.mock('../ChatPhotoViewer', () => ({ ...jest.requireActual('../ChatPhotoViewer'), ChatPhotoViewer: () => null }));

let tree: ReactTestRenderer;
function deferred<T = void>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const composer = () => tree.root.findByType(CommunityChatComposer).props;
const input = () => tree.root.findByType(TextInput);
const preview = () => tree.root.findByType(PhotoPreviewModal).props;
const location = () => tree.root.findByType(LocationPickerModal).props;
const alert = () => tree.root.findByType(BrandedAlert).props;
const bubble = () => tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityHint === 'hold for message actions')!;
function type(text: string) { act(() => input().props.onChangeText(text)); }
async function mount() { await act(async () => { tree = create(<CommunityThreadScreen />); }); }
async function update() { await act(async () => tree.update(<CommunityThreadScreen />)); }
async function flush() { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); }
function openMenuAction(label: string) { act(() => bubble().props.onLongPress()); return tree.root.findByType(MessageActionsMenu).props.menu.buttons.find((button: any) => button.text === label).onPress; }
beforeEach(async () => {
  await AsyncStorage.clear(); mockCheckAttempt.mockResolvedValue(false); mockVerifyTarget.mockResolvedValue(undefined);
  jest.clearAllMocks(); mockMembersError=false; mockMembersLoading=false; mockRealtime.length = 0; mockRoomId = '11111111-1111-4111-8111-111111111111'; mockViewerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; mockEpoch = 1; mockMembership = 'active'; mockMembers = [];
  mockMessages = [{ id: '33333333-3333-4333-8333-333333333333', sender_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sender_name: 'Alice', body: 'Original text', kind: 'message', reactions: [], image_url: null, created_at: '2026-09-13T10:00:00Z' }];
  [mockSend, mockEdit, mockDelete, mockReact, mockRead].forEach(mock => mock.mockResolvedValue(undefined));
  mockCameraPermission.mockResolvedValue({status:'granted'}); mockCamera.mockResolvedValue({canceled:false,assets:[{uri:'file:///camera.jpg'}]});
  mockPermission.mockResolvedValue({ status: 'granted' }); mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///photo.jpg' }] });
  mockManipulate.mockResolvedValue({ base64: 'sample' }); mockUpload.mockResolvedValue('https://example.test/photo.jpg');
});
afterEach(async () => { await act(async () => tree?.unmount()); });

it.each(['send', 'edit'] as const)('keeps a newer draft when an earlier %s completes', async kind => {
  const pending = deferred(); (kind === 'send' ? mockSend : mockEdit).mockReturnValue(pending.promise);
  await mount(); if (kind === 'edit') { const edit = openMenuAction('edit'); act(() => edit()); }
  type('Submitted'); let work!: Promise<void>; act(() => { work = composer().onSend(); }); await flush(); type('New unsent draft');
  await act(async () => { pending.resolve(); await work; });
  expect(input().props.value).toBe('New unsent draft');
});

it('retires a room send without clearing the new draft or releasing its current send lock', async () => {
  const old = deferred(), fresh = deferred(); mockSend.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  await mount(); type('A draft'); let first!: Promise<void>; act(() => { first = composer().onSend(); }); await flush();
  mockRoomId = '22222222-2222-4222-8222-222222222222'; await update(); expect(input().props.value).toBe(''); expect(composer().sending).toBe(false);
  type('B draft'); let second!: Promise<void>; act(() => { second = composer().onSend(); }); await flush();
  await act(async () => { old.resolve(); await first; });
  expect(input().props.value).toBe(''); expect(composer().sending).toBe(true);
  await act(async () => { fresh.resolve(); await second; }); expect(composer().sending).toBe(false);
});

it('retires account A to B to A work even when the final room and account IDs match', async () => {
  const pending = deferred(); mockSend.mockReturnValue(pending.promise);
  await mount(); type('Original account draft'); let work!: Promise<void>; act(() => { work = composer().onSend(); }); await flush();
  mockViewerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; mockEpoch++; await update(); expect(input().props.value).toBe('');
  mockViewerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; mockEpoch++; await update(); type('New visit draft');
  await act(async () => { pending.reject(new Error('old request failed')); await work; });
  expect(input().props.value).toBe('New visit draft'); expect(alert().visible).toBe(false);
});

it('rejects retained send and input callbacks before an auth change commits to React', async () => {
  await mount(); type('Alice text'); const oldSend = composer().onSend, oldInput = input().props;
  mockViewerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; mockEpoch++;
  await act(async () => { await oldSend(); oldInput.onChangeText('queued old text'); });
  expect(mockSend).not.toHaveBeenCalled();
  await update(); expect(input().props.value).toBe('');
});

it('starts one text attempt when a retained callback fires twice before rerender', async () => {
  const pending = deferred(); mockSend.mockReturnValue(pending.promise); await mount(); type('One message');
  const send = composer().onSend; let first!: Promise<void>, second!: Promise<void>;
  act(() => { first = send(); second = send(); }); await flush(); expect(mockSend).toHaveBeenCalledTimes(1);
  await act(async () => { await second; }); expect(composer().sending).toBe(true);
  await act(async () => { pending.resolve(); await first; }); expect(composer().sending).toBe(false);
});

it.each(['picker', 'preparation', 'upload'] as const)('retires pending photo %s on removal, including after access returns', async stage => {
  const pending = deferred<any>();
  if (stage === 'picker') mockPick.mockReturnValueOnce(pending.promise);
  else if (stage === 'preparation') mockManipulate.mockReturnValueOnce(pending.promise);
  else mockUpload.mockReturnValueOnce(pending.promise);
  await mount(); let work!: Promise<void>;
  if (stage === 'picker') act(() => { work = composer().photo.onPress(); });
  else { await act(async () => composer().photo.onPress()); act(() => { work = preview().onSend('Caption'); }); await flush(); }
  mockMembership = 'removed'; await update(); expect(preview().visible).toBe(false);
  mockMembership = 'active'; await update();
  await act(async () => { pending.resolve(stage === 'picker' ? { canceled: false, assets: [{ uri: 'file:///selected.jpg' }] } : stage === 'preparation' ? { base64: 'sample' } : 'https://example.test/late.jpg'); await work; });
  expect(mockSend).not.toHaveBeenCalled(); expect(preview().visible).toBe(false);
  expect(preview().sending).toBe(false);
});

it('starts one system picker and one photo pipeline for retained duplicate callbacks', async () => {
  const permission = deferred<any>(); mockPick.mockReturnValueOnce(permission.promise);
  await mount(); const pick = composer().photo.onPress; let first!: Promise<void>, duplicate!: Promise<void>;
  act(() => { first = pick(); duplicate = pick(); }); expect(mockPick).toHaveBeenCalledTimes(1);
  await act(async () => { await duplicate; permission.resolve({ canceled: false, assets: [{ uri: 'file:///selected.jpg' }] }); await first; });
  const pending = deferred(); mockSend.mockReturnValueOnce(pending.promise); const send = preview().onSend;
  act(() => { first = send('Caption'); duplicate = send('Caption'); }); await flush();
  expect(mockManipulate).toHaveBeenCalledTimes(1); expect(mockUpload).toHaveBeenCalledTimes(1); expect(mockSend).toHaveBeenCalledTimes(1);
  await act(async () => { await duplicate; pending.resolve(); await first; });
});

it('does not erase new text when a pending photo confirms', async () => {
  const pending = deferred(); mockSend.mockReturnValueOnce(pending.promise);
  await mount(); type('Photo caption'); await act(async () => composer().photo.onPress());
  let work!: Promise<void>; act(() => { work = preview().onSend('Photo caption'); }); await flush(); type('Another message');
  await act(async () => { pending.resolve(); await work; }); expect(input().props.value).toBe('Another message');
});

it('retires stored delete, edit and location callbacks after changing rooms', async () => {
  await mount(); const remove = openMenuAction('delete this message'), edit = openMenuAction('edit'), share = location().onConfirm;
  mockRoomId = '22222222-2222-4222-8222-222222222222'; await update(); type('New room draft');
  await act(async () => { await remove(); edit(); await share(34, -118, 'Old place'); });
  expect(mockDelete).not.toHaveBeenCalled(); expect(mockSend).not.toHaveBeenCalled(); expect(input().props.value).toBe('New room draft');
});

it('stops a two-stage reaction after its account is retired and serializes per-message taps', async () => {
  mockMessages[0].reactions = [{ emoji: '❤️', mine: true, count: 1 }];
  const pending = deferred(); mockReact.mockReturnValueOnce(pending.promise);
  await mount(); const react = openMenuAction('react'); act(() => react());
  const pick = tree.root.findByType(ReactionEmojiPicker).props.onSelect;
  act(() => { pick('👍'); pick('🔥'); }); expect(mockReact).toHaveBeenCalledTimes(1);
  mockViewerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; mockEpoch++; await update();
  await act(async () => { pending.resolve(); }); await flush();
  expect(mockReact).toHaveBeenCalledTimes(1);
});

it('retires realtime/read-marker callbacks on account change and reopens the stream for the new account', async () => {
  await mount(); const stale = mockRealtime[0]; expect(mockRead).toHaveBeenCalledTimes(1);
  mockViewerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; mockEpoch++; await update(); expect(mockRead).toHaveBeenCalledTimes(2);
  await act(async () => stale()); expect(mockRead).toHaveBeenCalledTimes(2);
});

it('keeps unknown membership delegated to the existing server gate', async () => {
  mockMembership = 'unknown'; await mount(); type('Hello'); await act(async () => composer().onSend());
  expect(mockSend).toHaveBeenCalledTimes(1);
});

it('keeps the same client UUID for an unchanged failed draft and retires it after confirmation', async () => {
  mockSend.mockRejectedValueOnce(new Error('unconfirmed')).mockResolvedValue(undefined);
  await mount(); type('Try this once'); await act(async () => composer().onSend());
  expect(input().props.value).toBe('');
  expect(tree.root.findByType(FlatList).props.data[0]).toMatchObject({ body: 'Try this once', localDelivery: 'unconfirmed' });
  const failedId = mockSend.mock.calls[0][3]; expect(typeof failedId).toBe('string');
  await act(async () => composer().onSend());
  expect(mockSend.mock.calls[1][3]).toBe(failedId); expect(input().props.value).toBe('');
  type('Try this once'); await act(async () => composer().onSend());
  expect(mockSend.mock.calls[2][3]).not.toBe(failedId);
});

it('retires a confirmed UUID even when the draft changed during that send', async () => {
  const pending = deferred(); mockSend.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
  await mount(); type('Hello again'); let first!: Promise<void>; act(() => { first = composer().onSend(); }); await flush();
  await flush(); const confirmedId = mockSend.mock.calls[0][3]; type('Another draft');
  await act(async () => { pending.resolve(); await first; });
  expect(input().props.value).toBe('Another draft');
  type('Hello again'); await act(async () => composer().onSend());
  expect(mockSend.mock.calls[1][3]).not.toBe(confirmedId);
});

it('uses the current main-room reaction when selecting from a previously opened menu',async()=>{
 await mount();act(()=>bubble().props.onLongPress());const choose=tree.root.findByType(MessageActionsMenu).props.menu.onReact;
 mockMessages=[{...mockMessages[0],reactions:[{emoji:'heart',mine:true,count:1}]}];await update();
 await act(async()=>choose('❤️'));expect(mockReact).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333','heart',false,expect.anything());
});
it('retires main-room quick reactions when the selected message is deleted',async()=>{
 await mount();act(()=>bubble().props.onLongPress());const choose=tree.root.findByType(MessageActionsMenu).props.menu.onReact;
 mockMessages=[];await update();await act(async()=>choose('👍'));expect(mockReact).not.toHaveBeenCalled();
 expect(tree.root.findByType(MessageActionsMenu).props.menu).toBeNull();
});

it('offers every community chat member after @ instead of stopping at six',async()=>{
 mockMembers=Array.from({length:9},(_,i)=>({id:`dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12,'0')}`,first_name:`Friend${i}`,avatar_url:null}));
 await mount();act(()=>tree.root.findByType(TextInput).props.onChangeText('@'));await flush();
 const choices=tree.root.findAllByType(TouchableOpacity).filter(node=>node.props.accessibilityLabel?.startsWith('Mention '));
 expect(choices).toHaveLength(9);
 act(()=>choices.find(node=>node.props.accessibilityLabel==='Mention Friend8')!.props.onPress());
 expect(tree.root.findByType(TextInput).props.value).toBe('@Friend8 ');
});


it('shows member lookup feedback and permits an explicit retry without losing the draft', async()=>{
 mockMembersLoading=true;await mount();type('Hello @');
 expect(tree.root.findByType(ChatMentionPicker).props.loading).toBe(true);
 mockMembersLoading=false;mockMembersError=true;await update();
 act(()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Retry chat members')!.props.onPress());
 expect(mockRetryMembers).toHaveBeenCalledTimes(1);
 expect(input().props.value).toBe('Hello @');
 mockMembersError=false;mockMembers=[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',first_name:'Mary Jane',avatar_url:null}];await update();
 act(()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Mention Mary Jane')!.props.onPress());
 expect(input().props.value).toBe('Hello @Mary Jane ');
});

it('ignores a retired room’s member retry and selection callbacks',async()=>{
 mockMembersError=true;mockMembers=[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',first_name:'Mary Jane',avatar_url:null}];
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

it.each(['own','other'])('opens replies for the exact %s message and rejects the old menu after navigation',async kind=>{
 if(kind==='other')mockMessages[0].sender_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 await mount();const reply=openMenuAction('reply');act(()=>reply());
 expect(tree.root.findByType(CommunityMessageActions).props.compactReplies).toBe(true);
 expect(tree.root.findByType(CommunityMessageActions).props.replyRequest.messageId).toBe('33333333-3333-4333-8333-333333333333');
 const close=tree.root.findByType(CommunityMessageActions).props.onRepliesClose;act(()=>close());
 expect(tree.root.findByType(CommunityMessageActions).props.replyRequest).toBeUndefined();
 mockRoomId='22222222-2222-4222-8222-222222222222';await update();act(()=>reply());
 expect(tree.root.findByType(CommunityMessageActions).props.replyRequest).toBeUndefined();
});

it('separates messages on different days even when they are more than five minutes apart', async () => {
  mockMessages = [
    { ...mockMessages[0], id: 'older', created_at: '2026-09-12T18:00:00Z' },
    { ...mockMessages[0], id: 'newer', created_at: '2026-09-13T18:00:00Z' },
  ];
  await mount();
  const text = tree.root.findAllByType(Text).map(node => node.props.children);
  expect(text).toContain(formatChatDay(mockMessages[0].created_at));
  expect(text).toContain(formatChatDay(mockMessages[1].created_at));
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

it('sends the exact selected member when two main-chat members share a name',async()=>{
 mockMembers=[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',first_name:'Alex',avatar_url:null},{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',first_name:'Alex',avatar_url:null}];
 await mount();type('@Al');act(()=>tree.root.findByType(ChatMentionPicker).props.onSelect(mockMembers[1]));await flush();
 await act(async()=>{await composer().onSend();});
 expect(mockSend.mock.calls[0][5]).toMatchObject({text:'@Alex',references:[{userId:mockMembers[1].id,label:'Alex',start:0,end:5}]});expect(input().props.value).toBe('');
});
it('restores an uncertain main send with its original UUID and identity while preserving later typing',async()=>{
 mockMembers=[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',first_name:'Alex',avatar_url:null}];mockSend.mockRejectedValueOnce(Error('Response lost'));
 await mount();type('@Al');act(()=>tree.root.findByType(ChatMentionPicker).props.onSelect(mockMembers[0]));await flush();
 await act(async()=>{await composer().onSend();});
 const original=mockSend.mock.calls[0];type('Later message');await flush();
 const saved=JSON.parse((await AsyncStorage.getItem(`community-main-composer:v1:${mockViewerId}:${mockRoomId}`))!);
 expect(saved.draft.attempt.mentions.references[0].userId).toBe(mockMembers[0].id);
 await act(async()=>tree.unmount());await mount();expect(input().props.value).toBe('Later message');
 expect(composer().photo.disabled).toBe(true);expect(composer().sendDisabled).toBe(true);
 await act(async()=>{await composer().onSend();});
 expect(mockSend.mock.calls[1][3]).toBe(original[3]);expect(mockSend.mock.calls[1][5]).toEqual(original[5]);expect(input().props.value).toBe('Later message');
});
it('reconciles a saved main attempt without resending or erasing newer text',async()=>{
 mockSend.mockRejectedValueOnce(Error('Response lost'));await mount();type('Original');await act(async()=>{await composer().onSend();});type('Newer');await flush();mockCheckAttempt.mockResolvedValue(true);
 await act(async()=>{tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Check original message')!.props.onPress();});
 expect(mockSend).toHaveBeenCalledTimes(1);expect(input().props.value).toBe('Newer');expect(composer().sendDisabled).toBe(false);
});
it('keeps original mention identity when editing and clears the selected tag when it is removed',async()=>{
 const body='@Alex',mention_data=addChatMentionReference(body,null,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','Alex',0);
 mockMessages=[{...mockMessages[0],body,mention_data}];await mount();const edit=openMenuAction('edit');act(()=>edit());type('Hello everyone');await flush();
 await act(async()=>{await composer().onSend();});
 expect(mockEdit.mock.calls[0][3]).toMatchObject({communityId:mockRoomId,mentions:{text:'Hello everyone',references:[]},original:{id:mockMessages[0].id,body,mentions:mention_data}});
 expect(input().props.value).toBe('');
});

it('ends a stalled main send and retains the original attempt for an explicit retry',async()=>{
 jest.useFakeTimers();
 try {
  const wait=deferred();mockSend.mockReturnValueOnce(wait.promise);
  await mount();type('Keep this original');let work!:Promise<void>;act(()=>{work=composer().onSend();});await flush();
  const original=mockSend.mock.calls[0];expect(original).toBeDefined();
  await act(async()=>{await jest.advanceTimersByTimeAsync(35_000);await work;});
  expect(composer().sending).toBe(false);expect(input().props.value).toBe('');expect(tree.root.findByType(FlatList).props.data[0]).toMatchObject({body:'Keep this original',localDelivery:'unconfirmed'});expect(original[4].isCurrent()).toBe(false);
  expect(tree.root.findAllByType(TouchableOpacity).some(n=>n.props.accessibilityLabel==='Retry original message')).toBe(true);
  await act(async()=>{await composer().onSend();});expect(mockSend.mock.calls[1][3]).toBe(original[3]);expect(input().props.value).toBe('');
  await act(async()=>{wait.resolve();});
 } finally {jest.useRealTimers();}
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
      expect(mockSend.mock.calls[1][1]).toBe('Original caption');
      expect(mockSend.mock.calls[1][3]).toBe(original[3]);
      expect(mockUpload).toHaveBeenCalledTimes(1);
      expect(original[4].isCurrent()).toBe(false);
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
    mockSend.mockReturnValueOnce(new Promise(() => {}));
    let work!: Promise<boolean>; act(() => { work = location().onConfirm(34, -118, 'Ocean Park'); }); await flush();
    const original = mockSend.mock.calls[0];
    await act(async () => { jest.advanceTimersByTime(35001); }); await flush();
    expect(await work).toBe(false); expect(location().visible).toBe(true); expect(location().retryPreservesMessage).toBe(true);
    act(() => location().onClose()); act(() => composer().location.onPress());
    await act(async () => { expect(await location().onConfirm(34, -118, 'Ocean Park')).toBe(true); });
    expect(mockSend.mock.calls[1][3]).toBe(original[3]);
    expect(location().visible).toBe(false);
    expect(original[4].isCurrent()).toBe(false);
  } finally { jest.useRealTimers(); }
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


it('starts the virtualized main-room window with newest messages and keeps history readers in place', async () => {
  const base = mockMessages[0];
  mockMessages = Array.from({ length: 60 }, (_, index) => ({ ...base, id: `message-${60-index}`, body: `Message ${60-index}`, created_at: new Date(Date.UTC(2026, 8, 26, 12, 60-index)).toISOString() }));
  await mount();
  const list = () => tree.root.findByType(FlatList);
  expect(list().props.inverted).toBe(true);
  expect(list().props.data.slice(0, 3).map((message: any) => message.id)).toEqual(['message-60', 'message-59', 'message-58']);
  const scroll = jest.spyOn(list().instance, 'scrollToOffset').mockImplementation(() => {});
  act(() => list().props.onLayout());
  expect(scroll).toHaveBeenLastCalledWith({ offset: 0, animated: false });
  act(() => list().props.onScroll({ nativeEvent: { contentOffset: { y: 600 } } }));
  expect(list().props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 });
  scroll.mockClear();
  mockMessages = [{ ...base, id: 'message-61', body: 'New arrival' }, ...mockMessages];
  await update();
  act(() => list().props.onContentSizeChange(390, 5000));
  expect(scroll).not.toHaveBeenCalled();
  act(() => list().props.onScroll({ nativeEvent: { contentOffset: { y: 0 } } }));
  expect(list().props.maintainVisibleContentPosition).toBeUndefined();
  act(() => list().props.onLayout());
  expect(scroll).toHaveBeenLastCalledWith({ offset: 0, animated: false });
});


it.each(['send', 'edit'] as const)('refreshes the hub preview immediately after a confirmed %s', async kind => {
  const pending = deferred(); (kind === 'send' ? mockSend : mockEdit).mockReturnValueOnce(pending.promise);
  await mount(); if (kind === 'edit') { const edit = openMenuAction('edit'); act(() => edit()); }
  type('New preview'); mockInvalidate.mockClear();
  let work!: Promise<void>; act(() => { work = composer().onSend(); }); await flush();
  expect(mockInvalidate).not.toHaveBeenCalledWith({ queryKey: ['community-chat-rows'] });
  await act(async () => { pending.resolve(); await work; });
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['community-chat-rows'] });
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['community-chat-cards'] });
});

it('does not refresh inbox previews from a retired send completion', async () => {
  const pending = deferred(); mockSend.mockReturnValueOnce(pending.promise);
  await mount(); type('Earlier account'); let work!: Promise<void>;
  act(() => { work = composer().onSend(); }); await flush();
  mockViewerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; mockEpoch++; await update();
  mockInvalidate.mockClear();
  await act(async () => { pending.resolve(); await work; });
  expect(mockInvalidate).not.toHaveBeenCalled();
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


it('allows a confirmed main send to finish recovery after twelve seconds', async () => {
 jest.useFakeTimers(); const wait=deferred(); mockSend.mockReturnValueOnce(wait.promise);
 let work: Promise<void> | undefined;
 try {
  await mount(); type('Recover original'); act(()=>{work=composer().onSend();}); await flush();
  await act(async()=>{await jest.advanceTimersByTimeAsync(14_000);});
  expect(composer().sending).toBe(true);
  expect(mockSend.mock.calls[0][4].isCurrent()).toBe(true);
  await act(async()=>{wait.resolve();await work;});
  expect(composer().sending).toBe(false);expect(input().props.value).toBe('');expect(mockSend).toHaveBeenCalledTimes(1);
 } finally {wait.resolve();await work;jest.useRealTimers();}
});
