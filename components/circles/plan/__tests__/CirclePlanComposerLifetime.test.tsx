const mockNotificationRequest = jest.fn();
jest.mock('../../../../lib/planNotificationPrompt', () => ({ requestPlanNotificationPrompt: (...args: any[]) => mockNotificationRequest(...args) }));
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TouchableOpacity, TextInput, StyleSheet, ScrollView, AccessibilityInfo } from 'react-native';
import { Image } from 'expo-image';
import { AfterglowFonts } from '../../../../constants/Typography';
import Colors, { AfterglowColors } from '../../../../constants/Colors';
import TimePicker from '../../../composer/TimePicker';
import CategoryChips from '../../../composer/CategoryChips';
import CirclePlanComposer from '../CirclePlanComposer';
import BottomSheet from '../../../yours/primitives/BottomSheet';
import EditorialTitleField from '../../../composer/EditorialTitleField';
import CollapsibleCalendar from '../../../composer/CollapsibleCalendar';
import PlacePicker from '../../../composer/place/PlacePicker';
import InlineNudge from '../../../composer/InlineNudge';
import { COPY } from '../../../yours/state/constants';

let mockViewer: string | null = 'alice', mockEpoch = 1;
const mockPermission = jest.fn(), mockPicker = jest.fn(), mockPrepare = jest.fn(), mockUpload = jest.fn();
const mockGetUser = jest.fn(), mockRefresh = jest.fn();
jest.mock('expo-image-picker', () => ({ requestMediaLibraryPermissionsAsync: (...a:any[])=>mockPermission(...a), launchImageLibraryAsync: (...a:any[])=>mockPicker(...a) }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: (...a:any[])=>mockPrepare(...a), SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('../../../../lib/uploadPhoto', () => ({ uploadBase64ToStorage: (...a:any[])=>mockUpload(...a) }));
jest.mock('../../../../lib/supabase', () => ({ supabase: { auth: { getUser: (...a:any[])=>mockGetUser(...a), refreshSession: (...a:any[])=>mockRefresh(...a) } } }));
const mockMutate = jest.fn();
const mockInvalidate = jest.fn().mockResolvedValue(undefined);
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));
jest.mock('../../../yours/state/useAuthUserId', () => ({ useAuthUserId: () => ({ data: mockViewer }) }));
jest.mock('../../../../hooks/useObservedUser', () => ({ useObservedUser: () => {
 const React = require('react'); const viewerId = mockViewer, epoch = mockEpoch;
 return React.useMemo(() => ({ viewerId, epoch, isLoading: false, error: null, isCurrent: () => viewerId === mockViewer && epoch === mockEpoch }), [viewerId, epoch]);
} }));
jest.mock('../../../../hooks/useCreateCirclePlan', () => ({ useCreateCirclePlan: () => ({ mutateAsync: mockMutate, isPending: false }), isObsoleteCirclePlanOperation: () => false, isUnconfirmedCirclePlanCreation: (error: Error) => error?.name === 'UnconfirmedCirclePlanCreationError' }));
jest.mock('../../../yours/primitives/BottomSheet', () => ({ __esModule: true, default: ({children}: any) => children }));
jest.mock('../../../composer/EditorialTitleField', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../composer/CollapsibleCalendar', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../composer/TimePicker', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../composer/CategoryChips', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../composer/place/PlacePicker', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../composer/InlineNudge', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../composer/nudgeArbiter', () => ({ useNudgeArbiter: ({ recoveryActive }: any) => recoveryActive ? 'recovery' : null }));
jest.mock('../../../../lib/haptics', () => ({ hapticSelection: jest.fn() }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('lucide-react-native', () => ({ Check: () => null, ImagePlus: () => null, X: () => null, Minus: () => null, Plus: () => null }));
jest.mock('react-native-reanimated', () => {
 const chain: any = {}; for (const name of ['springify', 'mass', 'damping', 'stiffness']) chain[name] = () => chain;
 return { __esModule: true, default: { View: require('react-native').View }, FadeInDown: chain, ZoomIn: chain };
});
function deferred<T>() { let resolve!: (v:T)=>void, reject!: (e:unknown)=>void; const promise = new Promise<T>((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject}; }
const receipt = { event_id: 'plan-new', has_own_chat: true };
let tree: ReactTestRenderer;
let props: React.ComponentProps<typeof CirclePlanComposer>;
const field = () => tree.root.findByType(EditorialTitleField).props;
const sheet = () => tree.root.findByType(BottomSheet).props;
const press = (label: string) => tree.root.findAllByType(TouchableOpacity).filter(n => n.findAllByType(Text).some(t => t.props.children === label)).pop()!.props.onPress;
const post = () => press(COPY.circlePlanPostToCircle('Friends'));
async function render() { await act(async()=>{ if(tree) tree.update(<CirclePlanComposer {...props}/>); else tree=create(<CirclePlanComposer {...props}/>); }); }
const messageField = () => tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel==='Your message')!.props;
const descriptionField = () => tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel===COPY.circlePlanDescriptionLabel)!.props;
function fill(title='Beach day') { act(()=>{field().onChangeText(title);messageField().onChangeText('Come along for a sunset walk.'); tree.root.findByType(CollapsibleCalendar).props.onSelect({year:2040,month:8,day:15});}); }
async function settle(work: () => void) { await act(async()=>{work(); await Promise.resolve();}); }
beforeEach(()=>{
 jest.clearAllMocks(); mockViewer='alice';mockEpoch=1;
 for(const mock of [mockPermission,mockPicker,mockPrepare,mockUpload,mockGetUser,mockRefresh])mock.mockReset();
 mockPermission.mockResolvedValue({status:'granted'});mockPicker.mockResolvedValue({canceled:false,assets:[{uri:'file:///picked.jpg'}]});
 mockPrepare.mockResolvedValue({uri:'file:///prepared.jpg',base64:'photo-bytes'});
 mockUpload.mockResolvedValue('https://example.test/event-images/alice/photo.jpg');
 mockGetUser.mockResolvedValue({data:{user:{id:'alice'}},error:null});mockRefresh.mockResolvedValue({error:null});
 props={visible:true,onClose:jest.fn(),onPosted:jest.fn(),circleId:'circle-a',circleName:'Friends',isDm:false,members:[{user_id:'alice',first_name_display:'Me',profile_photo_url:null},{user_id:'bob',first_name_display:'Bob',profile_photo_url:null},{user_id:'cara',first_name_display:'Cara',profile_photo_url:null}]};
});
afterEach(()=>{act(()=>tree?.unmount());tree=undefined as any;});
it('submits once for two immediate presses and preserves close before posted',async()=>{
 const pending=deferred<any>();mockMutate.mockReturnValue(pending.promise);const order:string[]=[];
 props.onClose=()=>order.push('close');props.onPosted=()=>order.push('posted');await render();fill();const submit=post();act(()=>{void submit();void submit();});
 expect(mockMutate).toHaveBeenCalledTimes(1);await settle(()=>pending.resolve(receipt));expect(order).toEqual(['close','posted']);expect(field().value).toBe('');
});
it.each(['close-reopen','room','account','account-aba'] as const)('retires old success after %s without touching a new draft',async(change)=>{
 const pending=deferred<any>();mockMutate.mockReturnValue(pending.promise);await render();fill();act(()=>void post()());
 if(change==='close-reopen'){act(()=>sheet().onClose());props.visible=false;await render();props.visible=true;}
 if(change==='room')props.circleId='circle-b';
 if(change==='account'){mockViewer='dana';mockEpoch++;}
 if(change==='account-aba'){mockEpoch+=2;}
 await render();fill('New draft');(props.onClose as jest.Mock).mockClear();await settle(()=>pending.resolve(receipt));
 expect(field().value).toBe('New draft');expect(props.onClose).not.toHaveBeenCalled();expect(props.onPosted).not.toHaveBeenCalled();
});
it('suppresses a late failure after reopening while preserving new controls',async()=>{
 const pending=deferred<any>();mockMutate.mockReturnValue(pending.promise);await render();fill();const oldPost=post(),oldPlace=tree.root.findByType(PlacePicker).props.onChange;
 act(()=>void oldPost());act(()=>sheet().onClose());props.visible=false;await render();props.visible=true;await render();fill('New draft');
 act(()=>{void oldPost();oldPlace({name:'Old place'});});await settle(()=>pending.reject(new Error('old request failed')));
 expect(mockMutate).toHaveBeenCalledTimes(1);expect(tree.root.findByType(PlacePicker).props.value).toBeNull();expect(tree.root.findAllByType(Text).some(t=>t.props.children===COPY.circlePlanRecovery)).toBe(false);
});
it('does not clear or navigate away from edits made during a current save',async()=>{
 const pending=deferred<any>();mockMutate.mockReturnValue(pending.promise);await render();fill();act(()=>void post()());act(()=>field().onChangeText('Next idea'));
 await settle(()=>pending.resolve(receipt));expect(field().value).toBe('Next idea');expect(props.onClose).not.toHaveBeenCalled();expect(props.onPosted).not.toHaveBeenCalled();
 expect(tree.root.findAllByType(InlineNudge).some(n=>String(n.props.text).includes('posted'))).toBe(true);
});
it('sends the chosen recipient snapshot and keeps later choices in the new draft',async()=>{
 const pending=deferred<any>();mockMutate.mockReturnValue(pending.promise);await render();fill();act(()=>press(COPY.circlePlanPickPeople)());
 act(()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Bob')!.props.onPress());act(()=>void post()());
 act(()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Cara')!.props.onPress());
 expect(mockMutate.mock.calls[0][0]).toMatchObject({circleId:'circle-a',visibility:'circle_only',memberUserIds:['bob'],description:null,strangerCap:null});
 await settle(()=>pending.resolve(receipt));expect(props.onPosted).not.toHaveBeenCalled();expect(tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Cara')!.props.accessibilityState.checked).toBe(true);
});
it('preserves subset and open-description gates even when a callback is invoked directly',async()=>{
 await render();fill();act(()=>press(COPY.circlePlanPickPeople)());act(()=>void post()());expect(mockMutate).not.toHaveBeenCalled();
 act(()=>press(COPY.circlePlanOpenUp)());act(()=>void press(COPY.circlePlanPostToFeed)());expect(mockMutate).not.toHaveBeenCalled();
});
it('keeps DM plans whole-circle and allows retry after a current failure',async()=>{
 props.isDm=true;mockMutate.mockRejectedValueOnce(new Error('failure')).mockResolvedValueOnce(receipt);await render();fill();
 expect(tree.root.findAllByType(Text).some(t=>t.props.children===COPY.circlePlanPickPeople)).toBe(false);await act(async()=>void post()());expect(field().value).toBe('Beach day');
 await act(async()=>void post()());expect(mockMutate.mock.calls[1][0]).toMatchObject({memberUserIds:null,visibility:'circle_only'});expect(props.onPosted).toHaveBeenCalledWith(receipt);
});
it('never applies completion after account ABA before rerender',async()=>{
 const pending=deferred<any>();mockMutate.mockReturnValue(pending.promise);await render();fill();act(()=>void post()());mockEpoch+=2;
 await settle(()=>pending.resolve(receipt));expect(props.onClose).not.toHaveBeenCalled();expect(props.onPosted).not.toHaveBeenCalled();
});
it('still calls posted after its own close renders the sheet hidden synchronously',async()=>{
 mockMutate.mockResolvedValue(receipt);props.onClose=()=>{props.visible=false;tree.update(<CirclePlanComposer {...props}/>);};await render();fill();await act(async()=>void post()());expect(props.onPosted).toHaveBeenCalledWith(receipt);
});

it('retires completion and retained submit on unmount',async()=>{
 const pending=deferred<any>();mockMutate.mockReturnValue(pending.promise);await render();fill();const submit=post();act(()=>void submit());act(()=>tree.unmount());
 act(()=>void submit());await settle(()=>pending.resolve(receipt));expect(mockMutate).toHaveBeenCalledTimes(1);expect(props.onClose).not.toHaveBeenCalled();expect(props.onPosted).not.toHaveBeenCalled();
});
it('does not navigate when its close callback changes the account',async()=>{
 mockMutate.mockResolvedValue(receipt);props.onClose=()=>{mockViewer='dana';mockEpoch++;};await render();fill();await act(async()=>void post()());expect(props.onPosted).not.toHaveBeenCalled();
});
it('honors explicit parent unavailability and revocation before render',async()=>{
 let allowed=true;props.scope={userId:'alice',isCurrent:()=>allowed};await render();fill();const submit=post();allowed=false;act(()=>void submit());expect(mockMutate).not.toHaveBeenCalled();
 props.scope=null;await render();act(()=>void post()());expect(mockMutate).not.toHaveBeenCalled();
});
it('posts a valid open plan with its description and original capacity',async()=>{
 mockMutate.mockResolvedValue(receipt);await render();fill();act(()=>press(COPY.circlePlanOpenUp)());act(()=>descriptionField().onChangeText('Meet us at the beach'));
 await act(async()=>void press(COPY.circlePlanPostToFeed)());expect(mockMutate.mock.calls[0][0]).toMatchObject({visibility:'open',strangerCap:4,description:'Meet us at the beach',memberUserIds:null});expect(props.onPosted).toHaveBeenCalledWith(receipt);
});

it('allows dismissal during identity unavailability without permitting a write',async()=>{
 mockViewer=null;props.scope=null;await render();const dismiss=sheet().onClose;act(()=>{dismiss();dismiss();});expect(props.onClose).toHaveBeenCalledTimes(1);expect(mockMutate).not.toHaveBeenCalled();
});


describe('staged composer presentation and audience preservation', () => {
 const appearance = { fonts: AfterglowFonts };
 const button = (label: string) => tree.root.findAllByType(TouchableOpacity).find(n => n.props.accessibilityLabel === label)!;
 const postButton = () => tree.root.findAllByType(TouchableOpacity).find(n => n.findAllByType(Text).some(t => t.props.children === 'Post plan' || t.props.children === 'Posting…'))!;
 const staged = async () => { props.appearance=appearance; await render(); };
 it('keeps the default palette and long audience CTA without optional appearance', async () => {
  await render();
  expect(sheet().appearance).toBeUndefined();
  const action=tree.root.findAllByType(TouchableOpacity).find(n=>n.props.onPress===post())!;
  expect(StyleSheet.flatten(action.props.style).backgroundColor).toBe(Colors.terracotta);
 });
 it('uses the reviewed appearance, reachable controls and one scrollable content surface', async () => {
  await staged();
  expect(sheet().appearance).toBe(appearance);
  expect(StyleSheet.flatten(tree.root.findByType(ScrollView).props.style)).toMatchObject({flex:1,minHeight:0});
  const title=tree.root.findAllByType(Text).find(n=>n.props.children===COPY.circlePlanComposerTitle)!;
  expect(StyleSheet.flatten(title.props.style)).toMatchObject({fontFamily:AfterglowFonts.display,color:AfterglowColors.ink});
  expect(StyleSheet.flatten(postButton().props.style)).toMatchObject({minHeight:48,borderRadius:6,backgroundColor:AfterglowColors.clay});
  expect(postButton().props.accessibilityState.disabled).toBe(true);
  const quick=tree.root.findAllByType(TouchableOpacity).find(n=>n.findAllByType(Text).some(t=>t.props.children==='Tomorrow'))!;
  expect(StyleSheet.flatten(quick.props.style).minHeight).toBeGreaterThanOrEqual(44);
 });
 it('keeps each staged audience selector separate from its child controls', async () => {
  await staged(); act(()=>press(COPY.circlePlanPickPeople)());
  const member=button('Bob');
  let ancestor=member.parent;
  while(ancestor){expect(ancestor.type).not.toBe(TouchableOpacity);ancestor=ancestor.parent;}
  expect(button(COPY.circlePlanJustUs).props.accessibilityState.checked).toBe(true);
  expect(StyleSheet.flatten(member.props.style).minHeight).toBeGreaterThanOrEqual(44);
  act(()=>button(COPY.circlePlanOpenUp).props.onPress());
  expect(button(COPY.circlePlanOpenUp).props.accessibilityState.checked).toBe(true);
  expect(StyleSheet.flatten(button('More people').props.style)).toMatchObject({width:44,height:44});
 });
 it.each([[true,6],[false,7]] as const)('clamps open capacity to the saved audience rule (DM=%s)', async(isDm,max)=>{
  props.isDm=isDm; if(isDm)props.members=props.members.slice(0,2);
  mockMutate.mockResolvedValue(receipt);await staged();fill();
  act(()=>button(COPY.circlePlanOpenUp).props.onPress());
  // Retained rapid presses must not bypass the maximum, even before rerender.
  const add=button('More people').props.onPress;
  act(()=>{for(let n=0;n<12;n++)add();});
  expect(button('More people').props.accessibilityState.disabled).toBe(true);
  expect(tree.root.findAllByType(Text).some(n=>n.props.children===`2 to ${max}`)).toBe(true);
  act(()=>descriptionField().onChangeText('Come along with us.'));
  await act(async()=>{await postButton().props.onPress();});
  expect(mockMutate.mock.calls[0][0]).toMatchObject({visibility:'open',strangerCap:max,memberUserIds:null});
 });
 it('keeps the open minimum at two and restores private whole-circle payload', async()=>{
  mockMutate.mockResolvedValue(receipt);await staged();fill();
  act(()=>button(COPY.circlePlanOpenUp).props.onPress());
  const less=button('Fewer people').props.onPress;
  act(()=>{for(let n=0;n<10;n++)less();});
  expect(button('Fewer people').props.accessibilityState.disabled).toBe(true);
  act(()=>button(COPY.circlePlanJustUs).props.onPress());
  await act(async()=>{await postButton().props.onPress();});
  expect(mockMutate.mock.calls[0][0]).toMatchObject({visibility:'circle_only',strangerCap:null,memberUserIds:null,description:null});
 });
 it('preserves the chosen category, place-name and arbitrary minute payload', async()=>{
  mockMutate.mockResolvedValue(receipt);await staged();fill();
  act(()=>{tree.root.findByType(CategoryChips).props.onSelect('Outdoors');tree.root.findByType(TimePicker).props.onChange(6,'37','PM');tree.root.findByType(PlacePicker).props.onChange({name:'Ocean Park',lat:34,lng:-118,neighborhood:'Santa Monica'});});
  await act(async()=>{await postButton().props.onPress();});
  expect(mockMutate.mock.calls[0][0]).toMatchObject({title:'Beach day',primaryVibe:'outdoors',locationText:'Ocean Park',startTime:'2040-09-16T01:37:00.000Z'});
  expect(mockMutate.mock.calls[0][0]).not.toHaveProperty('lat');
 });
 it('shows current posting progress and keeps the same draft after failure for retry', async()=>{
  const pending=deferred<any>();mockMutate.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(receipt);
  await staged();fill();const submit=postButton().props.onPress;act(()=>{void submit();void submit();});
  expect(mockMutate).toHaveBeenCalledTimes(1);expect(postButton().props.accessibilityState).toMatchObject({busy:true,disabled:true});
  await settle(()=>pending.reject(new Error('offline')));
  expect(field().value).toBe('Beach day');expect(postButton().props.accessibilityState.busy).toBe(false);
  await act(async()=>{await postButton().props.onPress();});expect(props.onPosted).toHaveBeenCalledWith(receipt);
 });
 it('keeps recipient photos full color and recovers from failed or replaced image URLs', async()=>{
  props.members[1].profile_photo_url='https://example.test/bob-old.jpg';
  await staged();act(()=>press(COPY.circlePlanPickPeople)());
  const first=tree.root.findByType(Image),oldError=first.props.onError;
  expect(StyleSheet.flatten(first.props.style).opacity).toBeUndefined();
  expect(first.props.contentFit).toBe('cover');
  act(()=>oldError());expect(tree.root.findAllByType(Image)).toHaveLength(0);
  act(()=>button('Bob').props.onPress());expect(button('Bob').props.accessibilityState.checked).toBe(true);
  props.members=props.members.map(m=>m.user_id==='bob'?{...m,profile_photo_url:'https://example.test/bob-new.jpg'}:m);await render();
  act(()=>oldError());expect(tree.root.findByType(Image).props.source.uri).toBe('https://example.test/bob-new.jpg');
  expect(button('Bob').props.accessibilityState.checked).toBe(true);
 });
});


it('keeps an unconfirmed draft and blocks retained Post callbacks before checking the circle', async () => {
 props.appearance={fonts:AfterglowFonts};props.onCheckPlans=jest.fn();
 const uncertain=new Error('Lost response');uncertain.name='UnconfirmedCirclePlanCreationError';
 mockMutate.mockRejectedValueOnce(uncertain);await render();fill('Keep this draft');
 const submit=press('Post plan');await act(async()=>{await submit();});
 expect(field().value).toBe('Keep this draft');expect(props.onClose).not.toHaveBeenCalled();expect(props.onPosted).not.toHaveBeenCalled();
 expect(tree.root.findAllByType(Text).some(t=>t.props.children==='Check before posting again')).toBe(true);
 expect(tree.root.findAllByType(Text).some(t=>t.props.children==='Post plan')).toBe(false);
 await act(async()=>{await submit();});expect(mockMutate).toHaveBeenCalledTimes(1);
 const check=press('View circle');act(()=>check());
 expect(mockInvalidate).toHaveBeenCalledWith({queryKey:['circle-plans','circle-a']});
 expect(props.onClose).toHaveBeenCalledTimes(1);expect(props.onCheckPlans).toHaveBeenCalledTimes(1);
 act(()=>check());expect(props.onCheckPlans).toHaveBeenCalledTimes(1);
});

it('retires unconfirmed outcomes after a later account opens a plan', async () => {
 props.appearance={fonts:AfterglowFonts};const pending=deferred<any>();mockMutate.mockReturnValue(pending.promise);
 await render();fill();act(()=>void press('Post plan')());mockViewer='dana';mockEpoch++;await render();fill('New account draft');
 const uncertain=new Error('Lost response');uncertain.name='UnconfirmedCirclePlanCreationError';await settle(()=>pending.reject(uncertain));
 expect(field().value).toBe('New account draft');expect(tree.root.findAllByType(Text).some(t=>t.props.children==='Check before posting again')).toBe(false);
});


describe('Circle plan photo and creator-message parity', () => {
 const button = (label:string) => tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===label)!;
 const photos = () => tree.root.findAllByType(Image).filter(n=>n.props.accessibilityLabel==='Plan photo');
 const add = () => button('Add photo').props.onPress;
 const flush = async () => { await act(async()=>{for(let n=0;n<10;n++)await Promise.resolve();}); };
 it('uses the system image picker and crop without requesting broad library access',async()=>{
  mockPermission.mockResolvedValue({status:'denied',granted:false,canAskAgain:false});
  await render();fill();await act(async()=>{await add()();});await flush();
  expect(mockPermission).not.toHaveBeenCalled();
  expect(mockPicker).toHaveBeenCalledWith({mediaTypes:['images'],allowsEditing:true,aspect:[16,10],quality:1});
  expect(mockPrepare).toHaveBeenCalledWith('file:///picked.jpg',[{resize:{width:1200}}],{compress:0.85,format:'jpeg',base64:true});
  expect(mockUpload).toHaveBeenCalledTimes(1);expect(photos()[0].props.source.uri).toMatch(/^https:/);
 });
 it('opens the same normal-plan picker and submits trimmed message plus remote image in one create',async()=>{
  mockMutate.mockResolvedValue(receipt);await render();fill();act(()=>messageField().onChangeText('  Bring your stories for a sunset walk.  '));
  await act(async()=>{await add()();});await flush();
  expect(mockPicker).toHaveBeenCalledWith({mediaTypes:['images'],allowsEditing:true,aspect:[16,10],quality:1});
  expect(mockPrepare).toHaveBeenCalledWith('file:///picked.jpg',[{resize:{width:1200}}],{compress:0.85,format:'jpeg',base64:true});
  expect(mockUpload).toHaveBeenCalledWith('event-images',expect.stringMatching(/^alice\/.*\.jpg$/),'photo-bytes',{existingIsSuccess:true});
  expect(photos()[0].props.source.uri).toBe('https://example.test/event-images/alice/photo.jpg');
  await act(async()=>{await post()();});expect(mockMutate).toHaveBeenCalledTimes(1);
  expect(mockMutate.mock.calls[0][0]).toMatchObject({creatorMessage:'Bring your stories for a sunset walk.',imageUrl:'https://example.test/event-images/alice/photo.jpg'});
 });
 it('removes the photo and posts without an image while preserving the message',async()=>{
  mockMutate.mockResolvedValue(receipt);await render();fill();await act(async()=>{await add()();});await flush();
  act(()=>button('Remove photo').props.onPress());expect(photos()).toHaveLength(0);expect(button('Add photo')).toBeDefined();
  await act(async()=>{await post()();});expect(mockMutate.mock.calls[0][0]).toMatchObject({imageUrl:null,creatorMessage:'Come along for a sunset walk.'});
 });
 it('cancels the picker without uploading or clearing the written message',async()=>{
  mockPicker.mockResolvedValue({canceled:true,assets:null});await render();fill();await act(async()=>{await add()();});await flush();
  expect(mockPrepare).not.toHaveBeenCalled();expect(mockUpload).not.toHaveBeenCalled();expect(button('Add photo').props.disabled).toBe(false);
  expect(messageField().value).toBe('Come along for a sunset walk.');
 });
 it('keeps an upload failure visible and retries the same prepared photo and object path',async()=>{
  mockUpload.mockRejectedValueOnce(new Error('offline'));await render();fill();await act(async()=>{await add()();});await flush();
  expect(photos()[0].props.source.uri).toBe('file:///prepared.jpg');
  expect(tree.root.findAllByType(Text).some(n=>n.props.children==='Could not upload your photo. Try again or remove it.')).toBe(true);
  await act(async()=>{await post()();});expect(mockMutate).not.toHaveBeenCalled();
  await act(async()=>{await button('Retry photo').props.onPress();});await flush();
  expect(mockPicker).toHaveBeenCalledTimes(1);expect(mockPrepare).toHaveBeenCalledTimes(1);expect(mockUpload.mock.calls[1]).toEqual(mockUpload.mock.calls[0]);
  expect(photos()[0].props.source.uri).toMatch(/^https:/);
 });
 it.each(['picker','prepare'])('keeps a %s failure retryable without dispatching an upload',async stage=>{
  if(stage==='picker')mockPicker.mockRejectedValueOnce(new Error('picker unavailable'));else mockPrepare.mockRejectedValueOnce(new Error('invalid'));
  await render();fill();await act(async()=>{await add()();});await flush();expect(mockUpload).not.toHaveBeenCalled();
  expect(button('Retry photo')).toBeDefined();await act(async()=>{await button('Retry photo').props.onPress();});await flush();expect(mockUpload).toHaveBeenCalledTimes(1);
 });
 it('locks both picker and Post immediately, before React paints upload progress',async()=>{
  const selection=deferred<any>();mockPicker.mockReturnValueOnce(selection.promise);await render();fill();const pick=add(),submit=post();
  act(()=>{void pick();void pick();void submit();});expect(mockPicker).toHaveBeenCalledTimes(1);expect(mockPermission).not.toHaveBeenCalled();expect(mockMutate).not.toHaveBeenCalled();
  expect(button('Adding photo').props.accessibilityState).toMatchObject({disabled:true,busy:true});
  await settle(()=>selection.resolve({canceled:false,assets:[{uri:'file:///picked.jpg'}]}));await flush();expect(photos()[0].props.source.uri).toMatch(/^https:/);
 });
 it.each(['picker','upload'])('ignores stale %s completion after close and reopening with a fresh draft',async stage=>{
  const pending=deferred<any>();if(stage==='picker')mockPicker.mockReturnValueOnce(pending.promise);else mockUpload.mockReturnValueOnce(pending.promise);
  await render();fill();act(()=>void add()());await flush();
  act(()=>sheet().onClose());props.visible=false;await render();props.visible=true;await render();fill('Fresh plan');
  await settle(()=>pending.resolve(stage==='picker'?{canceled:false,assets:[{uri:'file:///old.jpg'}]}:'https://example.test/old.jpg'));await flush();
  expect(photos()).toHaveLength(0);expect(field().value).toBe('Fresh plan');expect(button('Add photo').props.disabled).toBe(false);
  if(stage==='picker')expect(mockUpload).not.toHaveBeenCalled();
 });
 it.each(['account','account-aba','parent','unmount'])('discards a pending upload on %s retirement',async change=>{
  const pending=deferred<any>();mockUpload.mockReturnValueOnce(pending.promise);let allowed=true;props.scope={userId:'alice',isCurrent:()=>allowed};
  await render();fill();act(()=>void add()());await flush();expect(mockUpload).toHaveBeenCalledTimes(1);
  if(change==='account'){mockViewer='dana';mockEpoch++;await render();}
  if(change==='account-aba'){mockEpoch+=2;await render();}
  if(change==='parent')allowed=false;
  if(change==='unmount')act(()=>tree.unmount());
  await settle(()=>pending.resolve('https://example.test/old.jpg'));await flush();
  if(change!=='unmount')expect(photos().some(n=>n.props.source.uri==='https://example.test/old.jpg')).toBe(false);
  expect(mockMutate).not.toHaveBeenCalled();expect(props.onPosted).not.toHaveBeenCalled();
 });
 it('rechecks identity after refresh before uploading and permits explicit retry',async()=>{
  mockGetUser.mockResolvedValueOnce({data:{user:{id:'alice'}},error:null}).mockResolvedValueOnce({data:{user:{id:'bob'}},error:null});
  await render();fill();await act(async()=>{await add()();});await flush();expect(mockUpload).not.toHaveBeenCalled();expect(button('Retry photo')).toBeDefined();
  await act(async()=>{await button('Retry photo').props.onPress();});await flush();expect(mockUpload).toHaveBeenCalledTimes(1);
 });
 it('retires a removed upload before accepting a new photo',async()=>{
  const pending=deferred<any>();mockUpload.mockReturnValueOnce(pending.promise);await render();fill();act(()=>void add()());await flush();
  act(()=>button('Remove photo').props.onPress());await act(async()=>{await add()();});await flush();
  await settle(()=>pending.resolve('https://example.test/removed.jpg'));expect(photos()[0].props.source.uri).toBe('https://example.test/event-images/alice/photo.jpg');
 });
 it.each(['','short',' '.repeat(12),'a'.repeat(151)])('shows inline required-message feedback for invalid input %# instead of posting',async value=>{
  await render();fill();act(()=>messageField().onChangeText(value));await act(async()=>{await post()();});
  expect(mockMutate).not.toHaveBeenCalled();expect(messageField().accessibilityHint).toMatch(/message/);
  expect(tree.root.findAllByType(Text).some(n=>n.props.accessibilityRole==='alert' && String(n.props.children).includes('message'))).toBe(true);
  act(()=>messageField().onChangeText('A valid invitation for our group.'));expect(messageField().accessibilityHint).toBeUndefined();
 });
});


it('focuses and scrolls to the measured creator message after a blocked Post',async()=>{
 await render();fill();act(()=>messageField().onChangeText('short'));
 const input=tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel==='Your message')!;
 const focus=jest.fn(),scrollTo=jest.fn();
 // Native handles are absent in react-test-renderer; attach only their public
 // imperative methods so the assertion covers measured recovery behavior.
 input.props.ref.current={focus};tree.root.findByType(ScrollView).props.ref.current={scrollTo};
 let section=input.parent;while(section&&!section.props.onLayout)section=section.parent;
 act(()=>section!.props.onLayout({nativeEvent:{layout:{y:284}}}));
 const announce=jest.spyOn(AccessibilityInfo,'announceForAccessibility');
 await act(async()=>{await post()();});
 expect(focus).toHaveBeenCalledTimes(1);expect(scrollTo).toHaveBeenCalledWith({y:272,animated:true});
 expect(announce).toHaveBeenCalledWith('Add a message with at least 10 characters.');expect(mockMutate).not.toHaveBeenCalled();
 announce.mockRestore();
});


it('does not submit a removed photo through a retained Post callback before rerender',async()=>{
 mockMutate.mockResolvedValue(receipt);await render();fill();
 const add=tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Add photo')!.props.onPress;
 await act(async()=>{void add();for(let n=0;n<12;n++)await Promise.resolve();});
 const remove=tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Remove photo')!.props.onPress;
 const submit=post();await act(async()=>{remove();await submit();});
 expect(mockMutate).toHaveBeenCalledTimes(1);expect(mockMutate.mock.calls[0][0].imageUrl).toBeNull();
});

it('hands off a notification reminder after confirmed Circle creation and close', async () => {
  const order: string[] = []; props.onClose = () => order.push('close'); props.onPosted = () => order.push('posted');
  mockNotificationRequest.mockImplementationOnce(() => order.push('reminder')); mockMutate.mockResolvedValue(receipt);
  await render(); fill(); await act(async () => void post()());
  expect(order).toEqual(['close', 'reminder', 'posted']);
  expect(mockNotificationRequest.mock.calls[0][0]).toEqual({ userId: 'alice', planId: 'plan-new', reason: 'posted' });
});
it.each(['failure', 'uncertain', 'abandoned'])('does not request notifications for a %s Circle post', async mode => {
  const pending = deferred<any>(); mockMutate.mockReturnValue(pending.promise); await render(); fill(); act(() => void post()());
  if (mode === 'abandoned') { act(() => sheet().onClose()); await settle(() => pending.resolve(receipt)); }
  else await settle(() => pending.reject(Object.assign(new Error('not confirmed'), { name: mode === 'uncertain' ? 'UnconfirmedCirclePlanCreationError' : 'Error' })));
  expect(mockNotificationRequest).not.toHaveBeenCalled();
});

it.each(['owner', 'refresh', 'owner-after-refresh', 'upload'] as const)('bounds Circle photo %s, keeps prepared retry and retires the old response', async stage => {
  jest.useFakeTimers();
  try {
    await render(); fill();
    const button = (label: string) => tree.root.findAllByType(TouchableOpacity).find(n => n.props.accessibilityLabel === label)!;
    const flush = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); };
    const stalled = deferred<any>();
    if (stage === 'upload') mockUpload.mockReturnValueOnce(stalled.promise);
    else if (stage === 'refresh') mockRefresh.mockReturnValueOnce(stalled.promise);
    else { if (stage === 'owner-after-refresh') mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'alice' } }, error: null }); mockGetUser.mockReturnValueOnce(stalled.promise); }
    act(() => { button('Add photo').props.onPress(); }); await flush();
    await act(async () => { jest.advanceTimersByTime(stage === 'upload' ? 30_000 : 12_000); }); await flush();
    expect(button('Retry photo')).toBeDefined();
    expect(messageField().value).toBe('Come along for a sunset walk.');
    await act(async () => { await post()(); }); expect(mockMutate).not.toHaveBeenCalled();
    await act(async () => { await button('Retry photo').props.onPress(); }); await flush();
    expect(mockPicker).toHaveBeenCalledTimes(1); expect(mockPrepare).toHaveBeenCalledTimes(1);
    if (stage === 'upload') expect(mockUpload.mock.calls[1]).toEqual(mockUpload.mock.calls[0]);
    const writes = mockUpload.mock.calls.length;
    await act(async () => { stalled.resolve(stage === 'upload' ? 'https://example.test/retired.jpg' : { data: { user: { id: 'alice' } }, error: null }); }); await flush();
    expect(mockUpload).toHaveBeenCalledTimes(writes);
    expect(tree.root.findAllByType(Image).filter(n => n.props.accessibilityLabel === 'Plan photo')[0].props.source.uri).toBe('https://example.test/event-images/alice/photo.jpg');
  } finally { jest.useRealTimers(); }
});

it.each(['circle', 'hidden'] as const)('keeps the visible photo completion and controls during a suspended %s render', async change => {
 const never = new Promise(() => {}), upload = deferred<string>();
 function Pending({ suspend }: { suspend: boolean }) { if (suspend) throw never; return null; }
 const view = (suspend: boolean) => <React.Suspense fallback={null}><CirclePlanComposer {...props}
  circleId={suspend && change === 'circle' ? 'other-circle' : props.circleId}
  visible={!(suspend && change === 'hidden')} /><Pending suspend={suspend} /></React.Suspense>;
 mockUpload.mockReturnValueOnce(upload.promise);
 await act(async () => { tree=create(view(false)); });fill();
 const title = tree.root.findByType(EditorialTitleField), dismiss = sheet().onClose;
 await act(async () => { void tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Add photo')!.props.onPress(); });
 expect(mockUpload).toHaveBeenCalledTimes(1);
 await act(async () => { React.startTransition(()=>tree.update(view(true))); });
 expect(tree.root.findByType(EditorialTitleField)).toBe(title);
 await settle(()=>upload.resolve('https://example.test/committed-photo.jpg'));
 expect(tree.root.findAllByType(Image).find(n=>n.props.accessibilityLabel==='Plan photo')!.props.source.uri).toBe('https://example.test/committed-photo.jpg');
 expect(tree.root.findAllByType(TouchableOpacity).some(n=>n.props.accessibilityLabel==='Adding photo')).toBe(false);
 act(()=>field().onChangeText('Still my visible draft'));expect(field().value).toBe('Still my visible draft');
 act(()=>dismiss());expect(props.onClose).toHaveBeenCalledTimes(1);
});

it.each(['circle-roundtrip', 'visibility-roundtrip'] as const)('retires a photo and retained callbacks after committed %s', async change => {
 const upload=deferred<string>();mockUpload.mockReturnValueOnce(upload.promise);
 await render();fill();const oldTitle=field().onChangeText,oldClose=sheet().onClose,oldPost=post();
 await act(async()=>{void tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Add photo')!.props.onPress();});
 expect(mockUpload).toHaveBeenCalledTimes(1);
 if(change==='circle-roundtrip')props.circleId='other-circle';else props.visible=false;await render();
 props.circleId='circle-a';props.visible=true;await render();fill('Current new draft');
 act(()=>{oldTitle('Obsolete draft');oldClose();void oldPost();});
 await settle(()=>upload.resolve('https://example.test/obsolete-photo.jpg'));
 expect(field().value).toBe('Current new draft');expect(props.onClose).not.toHaveBeenCalled();expect(mockMutate).not.toHaveBeenCalled();
 expect(tree.root.findAllByType(Image).filter(n=>n.props.accessibilityLabel==='Plan photo')).toHaveLength(0);
 expect(tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Add photo')!.props.disabled).toBe(false);
 const currentPost=tree.root.findAllByType(TouchableOpacity).find(n=>n.props.onPress===post())!;expect(currentPost.props.disabled).toBe(false);
});
