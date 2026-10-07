import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {Text} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
const mockEvent=jest.fn(),mockAudience=jest.fn(),mockReview=jest.fn(),mockSubmit=jest.fn(),mockStatus=jest.fn(),mockTest=jest.fn(),mockBack=jest.fn(),mockReplace=jest.fn(),mockPrevent=jest.fn();
const eventId='22222222-2222-4222-8222-222222222222',accountId='11111111-1111-4111-8111-111111111111',pageId='55555555-5555-4555-8555-555555555555',mockRequestId='33333333-3333-4333-8333-333333333333';
let mockParams:any={id:eventId,pageId},mockScope={userId:accountId,isCurrent:()=>true},mockCanBack=false,mockEnabled=true;
const storage=new Map<string,string>();
jest.mock('expo-router',()=>({useLocalSearchParams:()=>mockParams,router:{canGoBack:()=>mockCanBack,back:()=>mockBack(),replace:(...a:any[])=>mockReplace(...a)}}));
jest.mock('expo-crypto',()=>({randomUUID:()=>mockRequestId}));
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{isLoading:false,error:null,isCurrent:()=>true}})}));
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:require('../../../constants/Typography').AfterglowFonts})}));
jest.mock('@react-navigation/native',()=>({usePreventRemove:(...a:any[])=>mockPrevent(...a),useNavigation:()=>({dispatch:jest.fn()})}));
jest.mock('../../../lib/supabase',()=>({supabase:{}}));
jest.mock('../../../lib/creatorCommunications',()=>({...jest.requireActual('../../../lib/creatorCommunications'),getCommunicationEvent:(...a:any[])=>mockEvent(...a),getCommunicationAudienceSources:(...a:any[])=>mockAudience(...a)}));
jest.mock('../../../lib/attendeeMessageSend',()=>({...jest.requireActual('../../../lib/attendeeMessageSend'),reviewAttendeeMessage:(...a:any[])=>mockReview(...a),submitAttendeeMessage:(...a:any[])=>mockSubmit(...a),readAttendeeMessageStatus:(...a:any[])=>mockStatus(...a)}));
jest.mock('../../../lib/attendeeMessaging',()=>({...jest.requireActual('../../../lib/attendeeMessaging'),sendAttendeeMessageTestToSelf:(...a:any[])=>mockTest(...a)}));
jest.mock('../../../constants/FeatureFlags',()=>({get ATTENDEE_MESSAGE_SEND_ENABLED(){return mockEnabled;},MESSAGE_TEST_SEND_ENABLED:true}));
jest.mock('../../../lib/haptics',()=>({hapticLight:jest.fn()}));
jest.mock('expo-linear-gradient',()=>({LinearGradient:require('react-native').View}));
jest.mock('../pages/PageFrame',()=>({PageFrame:({children}:any)=>children,PageAction:()=>null}));
import Screen from '../../../app/creator/attendee-message';
import {PageFrame,PageAction} from '../pages/PageFrame';
import {CommunicationAudienceDenied} from '../../../lib/creatorCommunications';
let tree:ReactTestRenderer,alive=false;
const event={id:eventId,title:'Sunday Table',image:null,venue:'By the water'};
const audience={seats:[{orderId:'order1',tierName:'Picnic',checkedInAt:null,refunded:false},{orderId:'order1',tierName:'Picnic',checkedInAt:null,refunded:false},{orderId:'order2',tierName:'Dinner',checkedInAt:null,refunded:false}],rsvps:3};
const review={eventId,recipientCount:2,reviewHash:'a'.repeat(64),channel:'in_app_push',providerDeliveryConfirmed:false};
const receipt={id:'44444444-4444-4444-8444-444444444444',eventId,requestId:mockRequestId,recipientCount:2,pushQueuedCount:2,deliveryStatus:'queued',createdAt:'2026-09-16T17:00:00Z',providerDeliveryConfirmed:false};
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(v:any)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};}
const action=(label:string)=>tree.root.findAllByType(PageAction).find(n=>n.props.title===label)??tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0];
const input=(label='Message subject')=>tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onChangeText==='function')[0];
const frame=()=>tree.root.findByType(PageFrame);
function flat(v:any):string{return Array.isArray(v)?v.map(flat).join(''):String(v??'');}
const words=()=>tree.root.findAllByType(Text).map(n=>flat(n.props.children)).join(' ');
async function flush(){await act(async()=>{for(let i=0;i<60;i++)await Promise.resolve();});}
async function mount(){act(()=>{tree=create(<Screen/>);alive=true;});await flush();}
function unmount(){if(alive)act(()=>{tree.unmount();alive=false;});}
async function compose(){await mount();await act(async()=>input().props.onChangeText('Meet by the water'));await act(async()=>input('Your message').props.onChangeText('Bring your picnic.'));}
async function prepare(){await compose();await act(async()=>action('Review update').props.onPress());}
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();storage.clear();mockParams={id:eventId,pageId};mockScope={userId:accountId,isCurrent:()=>true};mockCanBack=false;mockEnabled=true;mockEvent.mockReset().mockResolvedValue(event);mockAudience.mockReset().mockResolvedValue(audience);mockReview.mockReset().mockResolvedValue(review);mockSubmit.mockReset().mockResolvedValue(receipt);mockStatus.mockReset().mockResolvedValue(null);mockTest.mockReset().mockResolvedValue(undefined);(AsyncStorage.getItem as jest.Mock).mockImplementation(async k=>storage.get(k)??null);(AsyncStorage.setItem as jest.Mock).mockImplementation(async(k,v)=>{storage.set(k,v);});(AsyncStorage.removeItem as jest.Mock).mockImplementation(async k=>{storage.delete(k);});});
afterEach(()=>{unmount();jest.clearAllTimers();jest.useRealTimers();});
it.each(['event','audience'])('bounds initial %s stall and ignores late response after locked retry',async part=>{
 const pending=deferred<any>();(part==='event'?mockEvent:mockAudience).mockReturnValue(pending.promise);await mount();expect(input()).toBeUndefined();if(part==='event')expect(mockAudience).not.toHaveBeenCalled();await act(async()=>jest.advanceTimersByTime(12000));await flush();expect(words()).toContain('Couldn’t load this message');const owned=(part==='event'?mockEvent:mockAudience).mock.calls[0][1];expect(owned.isCurrent()).toBe(false);mockEvent.mockResolvedValue(event);mockAudience.mockResolvedValue(audience);const again=action('Try again').props.onPress;act(()=>{again();again();});await flush();expect(mockEvent).toHaveBeenCalledTimes(2);expect(words()).toContain('2 ticket purchases · 3 RSVPs');pending.resolve(part==='event'?{...event,title:'Retired'}:{seats:[],rsvps:99});await flush();expect(words()).not.toContain('Retired');expect(words()).not.toContain('99 RSVPs');
});
it('bounds the complete event→audience chain at12s without restarting the clock',async()=>{
 const first=deferred<any>(),second=deferred<any>();mockEvent.mockReturnValue(first.promise);mockAudience.mockReturnValue(second.promise);await mount();await act(async()=>jest.advanceTimersByTime(8000));first.resolve(event);await flush();await act(async()=>jest.advanceTimersByTime(4000));await flush();expect(words()).toContain('Couldn’t load this message');expect(mockAudience.mock.calls[0][1].isCurrent()).toBe(false);second.resolve(audience);await flush();expect(input()).toBeUndefined();
});
it('retains confirmed audience, draft and expanded filters; old callbacks are inert during refresh/error',async()=>{
 await compose();act(()=>action('Filter message audience').props.onPress());await flush();await act(async()=>action('Picnic').props.onPress());const subject=input().props.onChangeText,filter=action('Dinner').props.onPress,toggle=action('Filter message audience').props.onPress,reviewIt=action('Review update').props.onPress,pending=deferred<any>();mockAudience.mockReturnValue(pending.promise);const again=frame().props.onRefresh,writes=(AsyncStorage.setItem as jest.Mock).mock.calls.length;act(()=>{again();again();subject('Lost');filter();toggle();reviewIt();});await flush();expect(mockEvent).toHaveBeenCalledTimes(2);expect(input().props.value).toBe('Meet by the water');expect(action('Picnic').props.accessibilityState.checked).toBe(true);expect(action('Filter message audience').props.accessibilityState.expanded).toBe(true);expect(words()).toContain('1 ticket purchase · 0 RSVPs');expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);expect(mockReview).not.toHaveBeenCalled();pending.reject(Error('offline'));await flush();expect(words()).toContain('last checked counts');expect(input().props.editable).toBe(false);mockAudience.mockResolvedValue(audience);act(()=>action('Try again').props.onPress());await flush();expect(input().props.editable).toBe(true);expect(action('Picnic').props.accessibilityState.checked).toBe(true);
});
it.each(['null','audience'])('authoritative %s denial hides private review and retires old actions permanently',async kind=>{
 await prepare();const send=action('Send update').props.onPress,edit=action('Back to editing').props.onPress,test=action('Test to me').props.onPress,back=frame().props.onBack;kind==='null'?mockEvent.mockResolvedValue(null):mockAudience.mockRejectedValue(new CommunicationAudienceDenied());act(()=>frame().props.onRefresh());await flush();expect(words()).toContain('Event unavailable');expect(words()).not.toContain('Sunday Table');expect(words()).not.toContain('Bring your picnic');act(()=>{send();edit();test();back();});expect(mockSubmit).not.toHaveBeenCalled();expect(mockTest).not.toHaveBeenCalled();expect(mockReplace).not.toHaveBeenCalled();mockEvent.mockResolvedValue(event);mockAudience.mockResolvedValue(audience);act(()=>action('Try again').props.onPress());await flush();act(()=>{send();test();});expect(mockSubmit).not.toHaveBeenCalled();expect(mockTest).not.toHaveBeenCalled();
});
it('refresh between durable attempt save and dispatch prevents submit but keeps status reconciliation',async()=>{
 await prepare();const pending=deferred<void>(),original=(AsyncStorage.setItem as jest.Mock).getMockImplementation()!;(AsyncStorage.setItem as jest.Mock).mockImplementation(async(k,v)=>{await original(k,v);if(k.startsWith('attendee-message-attempt:'))await pending.promise;});act(()=>action('Send update').props.onPress());await flush();const access=deferred<any>();mockEvent.mockReturnValue(access.promise);act(()=>frame().props.onRefresh());await flush();pending.resolve();await flush();expect(mockSubmit).not.toHaveBeenCalled();expect(action('Check status')).toBeTruthy();await act(async()=>action('Check status').props.onPress());expect(mockStatus).toHaveBeenCalledTimes(1);const retry=action('Retry original').props.onPress;act(()=>retry());expect(mockSubmit).not.toHaveBeenCalled();access.resolve(event);await flush();await act(async()=>action('Retry original').props.onPress());expect(mockSubmit).toHaveBeenCalledTimes(1);
});
it('pending review and test cannot complete into newly unverified access',async()=>{
 await compose();const reviewPending=deferred<any>();mockReview.mockReturnValue(reviewPending.promise);act(()=>action('Review update').props.onPress());await flush();const access=deferred<any>();mockEvent.mockReturnValue(access.promise);act(()=>frame().props.onRefresh());await flush();reviewPending.resolve(review);await flush();expect(action('Send update')).toBeUndefined();access.resolve(event);await flush();mockReview.mockResolvedValue(review);await act(async()=>action('Review update').props.onPress());const testPending=deferred<void>();mockTest.mockReturnValue(testPending.promise);act(()=>action('Test to me').props.onPress());await flush();const owned=mockTest.mock.calls[0][3],again=deferred<any>();mockAudience.mockReturnValue(again.promise);act(()=>frame().props.onRefresh());await flush();expect(owned.isCurrent()).toBe(false);testPending.resolve();await flush();expect(words()).not.toContain('Test notification queued');again.resolve(audience);await flush();expect(words()).not.toContain('Test notification queued');
});
it('same-frame stale review controls cannot send/test/finish while unknown; Back can escape',async()=>{
 await prepare();const send=action('Send update').props.onPress,test=action('Test to me').props.onPress,edit=action('Back to editing').props.onPress,pending=deferred<any>();mockEvent.mockReturnValue(pending.promise);act(()=>{frame().props.onRefresh();send();test();edit();});await flush();expect(mockSubmit).not.toHaveBeenCalled();expect(mockTest).not.toHaveBeenCalled();expect(words()).toContain('Review your update');act(()=>frame().props.onBack());expect(mockReplace).toHaveBeenLastCalledWith(`/creator/event-messages?id=${eventId}&pageId=${pageId}`);pending.reject(Error('offline'));await flush();mockCanBack=true;act(()=>frame().props.onBack());expect(mockBack).toHaveBeenCalledTimes(1);
});
it.each(['account','event','page','focus','unmount'])('retires old draft/retry/Back callbacks on %s change',async reason=>{
 await compose();const change=input().props.onChangeText,reviewIt=action('Review update').props.onPress,back=frame().props.onBack,again=frame().props.onRefresh,pending=deferred<any>();mockAudience.mockReturnValue(pending.promise);act(()=>again());await flush();if(reason==='unmount')unmount();else{if(reason==='event')mockParams={id:'66666666-6666-4666-8666-666666666666',pageId};if(reason==='page')mockParams={id:eventId,pageId:'66666666-6666-4666-8666-666666666666'};mockScope={userId:reason==='account'?'77777777-7777-4777-8777-777777777777':accountId,isCurrent:()=>reason!=='focus'};mockEvent.mockResolvedValue(null);act(()=>tree.update(<Screen/>));await flush();expect(words()).not.toContain('Meet by the water');}const reads=mockEvent.mock.calls.length,writes=(AsyncStorage.setItem as jest.Mock).mock.calls.length;act(()=>{change('Lost');reviewIt();back();again();});pending.resolve(audience);await flush();expect(mockEvent).toHaveBeenCalledTimes(reads);expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);expect(mockReview).not.toHaveBeenCalled();expect(mockBack).not.toHaveBeenCalled();expect(mockReplace).not.toHaveBeenCalled();
});
it('normal review Back returns to editing; cold Back retains page context; provider-off draft does not review/send remotely',async()=>{
 mockEnabled=false;await compose();await act(async()=>action('Review draft').props.onPress());expect(mockReview).not.toHaveBeenCalled();expect(action('Send update')).toBeUndefined();expect(words()).toContain('Nothing is sent to attendees');act(()=>frame().props.onBack());expect(input().props.value).toBe('Meet by the water');act(()=>frame().props.onBack());expect(mockReplace).toHaveBeenLastCalledWith(`/creator/event-messages?id=${eventId}&pageId=${pageId}`);mockCanBack=true;act(()=>frame().props.onBack());expect(mockBack).toHaveBeenCalledTimes(1);
});
it('draft-exit remains protected across transient access failure and old local retry cannot write',async()=>{
 await compose();(AsyncStorage.setItem as jest.Mock).mockRejectedValue(Error('disk'));await act(async()=>input().props.onChangeText('Unsaved subject'));const retry=action('Try again').props.onPress;mockEvent.mockRejectedValue(Error('offline'));act(()=>frame().props.onRefresh());await flush();const writes=(AsyncStorage.setItem as jest.Mock).mock.calls.length;act(()=>retry());await flush();expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);expect(mockPrevent.mock.calls.at(-1)[0]).toBe(true);expect(input().props.value).toBe('Unsaved subject');
});
it('old confirmed-request finish cannot clear draft/attempt during audience recovery',async()=>{
 await prepare();await act(async()=>action('Send update').props.onPress());const finish=action('Write another').props.onPress,pending=deferred<any>();mockAudience.mockReturnValue(pending.promise);const writes=(AsyncStorage.setItem as jest.Mock).mock.calls.length;act(()=>{frame().props.onRefresh();finish();});await flush();expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);expect([...storage.keys()].some(k=>k.startsWith('attendee-message-attempt:'))).toBe(true);pending.resolve(audience);await flush();await act(async()=>action('Write another').props.onPress());expect(input().props.value).toBe('');expect([...storage.keys()].some(k=>k.startsWith('attendee-message-attempt:'))).toBe(false);
});
it('confirmed empty registrations show zero only after both reads succeed; missing event never reads',async()=>{
 mockParams={};await mount();expect(mockEvent).not.toHaveBeenCalled();expect(words()).toContain('Event unavailable');unmount();mockParams={id:eventId};mockAudience.mockResolvedValue({seats:[],rsvps:0});await mount();expect(words()).toContain('0 ticket purchases · 0 RSVPs');expect(input()).toBeTruthy();
});
it('stalled draft save releases review and keeps the current message editable without a late review',async()=>{
 await compose();const pending=deferred<void>();(AsyncStorage.setItem as jest.Mock).mockReturnValueOnce(pending.promise);
 act(()=>action('Review update').props.onPress());await flush();expect(input().props.editable).toBe(false);
 await act(async()=>{await jest.advanceTimersByTimeAsync(12_000);});expect(input().props.editable).toBe(true);expect(input().props.value).toBe('Meet by the water');expect(mockReview).not.toHaveBeenCalled();
 pending.resolve();await flush();expect(mockReview).not.toHaveBeenCalled();expect(action('Send update')).toBeUndefined();expect(words()).toContain('Couldn’t save');
 await act(async()=>action('Review update').props.onPress());expect(action('Send update')).toBeTruthy();
});
it('a stalled Test to me recovers without a late delivery claim or automatic retry',async()=>{
 await prepare();const pending=deferred<void>();mockTest.mockReturnValueOnce(pending.promise);act(()=>action('Test to me').props.onPress());await flush();
 await act(async()=>{await jest.advanceTimersByTimeAsync(25_000);});expect(mockTest.mock.calls[0][3].isCurrent()).toBe(false);expect(words()).toContain('Test delivery could not be confirmed');
 pending.resolve();await flush();expect(words()).not.toContain('Test notification queued');expect(mockTest).toHaveBeenCalledTimes(1);
 expect(action('Test to me').props.disabled).toBe(false);expect(action('Back to editing').props.disabled).toBeFalsy();
});
