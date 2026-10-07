import React from 'react';
import {act,create,ReactTestRenderer} from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Screen from '../../../app/creator/invite-audience';
import {PageFrame,PageAction} from '../pages/PageFrame';
import {Text} from 'react-native';
jest.mock('../../../lib/eventInvitationHistory',()=>({loadEventInvitationHistory:jest.fn(async()=>({rows:[],next:null}))}));
const mockRead=jest.fn(),mockReview=jest.fn(),mockSubmit=jest.fn(),mockStatus=jest.fn();
const mockEvent='8ecc2920-0000-4000-8000-000000000001',mockAccount='8ecc2920-0000-4000-8000-000000000002',mockPage='8ecc2920-0000-4000-8000-000000000003',mockRequest='8ecc2920-0000-4000-8000-000000000004';
let mockParams:any={id:mockEvent,pageId:mockPage},mockCanBack=false;
const storage=new Map<string,string>();let mockScope={userId:mockAccount,isCurrent:()=>true};
jest.mock('expo-router',()=>({useLocalSearchParams:()=>mockParams,router:{canGoBack:()=>mockCanBack,replace:jest.fn(),back:jest.fn()},Stack:{Screen:()=>null}}));
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{isLoading:false}})}));
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:require('../../../constants/Typography').AfterglowFonts})}));
jest.mock('@react-navigation/native',()=>({useNavigation:()=>({dispatch:jest.fn()}),usePreventRemove:jest.fn()}));
jest.mock('../pages/PageFrame',()=>({PageFrame:({children}:any)=>children,PageAction:()=>null}));
jest.mock('expo-linear-gradient',()=>({LinearGradient:require('react-native').View}));
jest.mock('../AttendeeMessageHistory',()=>({AttendeeMessageHistory:()=>null}));
jest.mock('../../../lib/eventInvitation',()=>({...jest.requireActual('../../../lib/eventInvitation'),getEventInvitation:(...a:any[])=>mockRead(...a)}));
jest.mock('expo-crypto',()=>({randomUUID:()=>mockRequest}));
jest.mock('../../../constants/FeatureFlags',()=>({INVITE_AUDIENCE_ENABLED:true}));
jest.mock('../../../lib/eventInvitationSend',()=>({...jest.requireActual('../../../lib/eventInvitationSend'),reviewEventInvitation:(...a:any[])=>mockReview(...a),submitEventInvitation:(...a:any[])=>mockSubmit(...a),readEventInvitationStatus:(...a:any[])=>mockStatus(...a)}));
jest.mock('../../../lib/supabase',()=>({supabase:{}}));
let tree:ReactTestRenderer;
const context=()=>({eventId:mockEvent,eventTitle:'A Sunday by the ocean',eventImage:null,eventStatus:'Live',pageId:mockPage,pageName:'Sunset Social',pageKind:'organization',deliveryReady:false,
 audiences:[{type:'past_attendees',sourceCount:4,excludedCount:1,eligibleCount:3},{type:'followers',sourceCount:8,excludedCount:2,eligibleCount:6}]});
const copy=()=>JSON.stringify(tree.toJSON());
const control=(label:string)=>tree.root.findAllByType(PageAction).find(n=>n.props.title===label)??tree.root.findAll(n=>typeof n.type!=='string' && n.props.accessibilityLabel===label)[0];
const frame=()=>tree.root.findByType(PageFrame);
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(v:any)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};}
async function flush(){await act(async()=>{for(let i=0;i<60;i++)await Promise.resolve();});}
function update(){act(()=>tree.update(<Screen/>));}

const mount=async()=>{await act(async()=>{tree=create(<Screen/>);});};
const edit=async(text:string)=>{await act(async()=>control('Invitation message').props.onChangeText(text));};
const reviewed=(message:any)=>({context:{...context(),audiences:undefined,deliveryReady:undefined},message,recipientCount:2,reviewHash:'a'.repeat(64),channel:'in_app_push',providerDeliveryConfirmed:false,sendingEnabled:false});
const receipt=()=>({id:'8ecc2920-0000-4000-8000-000000000005',eventId:mockEvent,pageId:mockPage,requestId:mockRequest,recipientCount:2,pushQueuedCount:2,deliveryStatus:'queued',createdAt:'2026-09-16T20:00:00Z',providerDeliveryConfirmed:false});
beforeEach(()=>{jest.useFakeTimers();mockParams={id:mockEvent,pageId:mockPage};mockCanBack=false;jest.clearAllMocks();storage.clear();mockRead.mockReset().mockResolvedValue(context());mockReview.mockReset().mockImplementation(async(_event,message)=>reviewed(message));mockSubmit.mockReset().mockResolvedValue(receipt());mockStatus.mockReset().mockResolvedValue(null);mockScope={userId:mockAccount,isCurrent:()=>true};
 (AsyncStorage.getItem as jest.Mock).mockImplementation(async k=>storage.get(k)??null);(AsyncStorage.setItem as jest.Mock).mockImplementation(async(k,v)=>{storage.set(k,v);});(AsyncStorage.removeItem as jest.Mock).mockImplementation(async k=>{storage.delete(k);});});
afterEach(()=>{if(tree)act(()=>tree.unmount());jest.clearAllTimers();jest.useRealTimers();});

it('bounds initial access and ignores a late response after explicit retry',async()=>{
 const pending=deferred<any>();mockRead.mockReturnValue(pending.promise);await mount();expect(control('Invitation message')).toBeUndefined();await act(async()=>jest.advanceTimersByTime(12000));await flush();expect(copy()).toContain('Couldn’t load this invitation');expect(mockRead.mock.calls[0][1].isCurrent()).toBe(false);mockRead.mockResolvedValue(context());const retry=control('Try again').props.onPress;act(()=>{retry();retry();});await flush();expect(mockRead).toHaveBeenCalledTimes(2);expect(control('Invitation message')).toBeTruthy();pending.resolve({...context(),eventTitle:'Retired response'});await flush();expect(copy()).not.toContain('Retired response');
});
it('retains draft/audience and blocks same-frame old edit and review callbacks during refresh/error',async()=>{
 await mount();await edit('Come to the water');await act(async()=>control('Page followers').props.onPress());const input=control('Invitation message').props.onChangeText,choose=control('Past attendees').props.onPress,review=control('Review draft').props.onPress,pending=deferred<any>();mockRead.mockReturnValue(pending.promise);const writes=(AsyncStorage.setItem as jest.Mock).mock.calls.length,retry=frame().props.onRefresh;act(()=>{retry();retry();input('lost');choose();review();});await flush();expect(mockRead).toHaveBeenCalledTimes(2);expect(control('Invitation message').props.value).toBe('Come to the water');expect(control('Page followers').props.accessibilityState.selected).toBe(true);expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);expect(mockReview).not.toHaveBeenCalled();pending.reject(Error('offline'));await flush();expect(copy()).toContain('Your draft is kept here');expect(control('Invitation message').props.editable).toBe(false);act(()=>{input('lost');review();});mockRead.mockResolvedValue(context());act(()=>control('Try again').props.onPress());await flush();expect(control('Invitation message').props.value).toBe('Come to the water');expect(control('Invitation message').props.editable).toBe(true);
});
async function prepare(){mockReview.mockImplementation(async(_event,message)=>({...reviewed(message),sendingEnabled:true}));await mount();await edit('Sunday by the water');await act(async()=>control('Review draft').props.onPress());}
it('retains review but blocks old Send/Edit actions during access checking, then hides it on authoritative denial',async()=>{
 await prepare();const send=control('Send invitation').props.onPress,editReview=control('Edit draft').props.onPress,back=frame().props.onBack,pending=deferred<any>();mockRead.mockReturnValue(pending.promise);act(()=>{frame().props.onRefresh();send();editReview();});await flush();expect(mockSubmit).not.toHaveBeenCalled();expect(copy()).toContain('Review your invitation');pending.reject({code:'42501',message:'no access'});await flush();expect(copy()).toContain('Invitation unavailable');expect(copy()).not.toContain('Sunday by the water');expect(copy()).not.toContain('Sunset Social');act(()=>{send();editReview();back();});expect(mockSubmit).not.toHaveBeenCalled();const {router}=require('expo-router');expect(router.replace).not.toHaveBeenCalled();mockRead.mockResolvedValue(context());act(()=>control('Try again').props.onPress());await flush();act(()=>send());expect(mockSubmit).not.toHaveBeenCalled();
});
it('allows only status reconciliation of an uncertain attempt while access is unknown',async()=>{
 await prepare();mockSubmit.mockRejectedValue(Error('lost acknowledgement'));await act(async()=>control('Send invitation').props.onPress());await act(async()=>control('Check status').props.onPress());const retryOriginal=control('Retry original').props.onPress,check=control('Check status').props.onPress;mockRead.mockRejectedValue(Error('offline'));act(()=>frame().props.onRefresh());await flush();act(()=>{retryOriginal();check();});await flush();expect(mockSubmit).toHaveBeenCalledTimes(1);expect(mockStatus).toHaveBeenCalledTimes(2);mockRead.mockRejectedValue({code:'42501'});act(()=>control('Try again').props.onPress());await flush();act(()=>{retryOriginal();check();});expect(mockStatus).toHaveBeenCalledTimes(2);expect(copy()).not.toContain('Sunday by the water');
});
it('keeps Write another and saved-draft retry inert during access checks',async()=>{
 await prepare();await act(async()=>control('Send invitation').props.onPress());const finish=control('Write another').props.onPress,pending=deferred<any>();mockRead.mockReturnValue(pending.promise);const writes=(AsyncStorage.setItem as jest.Mock).mock.calls.length;act(()=>{frame().props.onRefresh();finish();});await flush();expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);expect([...storage.keys()].some(k=>k.startsWith('event-invitation-attempt:'))).toBe(true);pending.resolve(context());await flush();await act(async()=>control('Write another').props.onPress());expect(control('Invitation message').props.value).toBe('');
});
it.each(['account','event','page','focus','unmount'])('retires old editor/access/Back callbacks after %s change',async reason=>{
 await mount();await edit('Private invitation');const input=control('Invitation message').props.onChangeText,review=control('Review draft').props.onPress,back=frame().props.onBack,retry=frame().props.onRefresh,pending=deferred<any>();mockRead.mockReturnValue(pending.promise);act(()=>retry());await flush();if(reason==='unmount')act(()=>tree.unmount());else{if(reason==='event')mockParams={id:'8ecc2920-0000-4000-8000-000000000099',pageId:mockPage};if(reason==='page')mockParams={id:mockEvent,pageId:'8ecc2920-0000-4000-8000-000000000099'};mockScope={userId:reason==='account'?'other':mockAccount,isCurrent:()=>reason!=='focus'};mockRead.mockRejectedValue(Error('offline'));update();await flush();expect(copy()).not.toContain('Private invitation');}const reads=mockRead.mock.calls.length,writes=(AsyncStorage.setItem as jest.Mock).mock.calls.length;act(()=>{input('lost');review();back();retry();});pending.resolve(context());await flush();expect(mockRead).toHaveBeenCalledTimes(reads);expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);expect(mockReview).not.toHaveBeenCalled();const {router}=require('expo-router');expect(router.replace).not.toHaveBeenCalled();expect(router.back).not.toHaveBeenCalled();
});
it('preserves normal Back, scoped cold Messages Back and review Back to editing',async()=>{
 await prepare();const {router}=require('expo-router');act(()=>frame().props.onBack());expect(control('Invitation message')).toBeTruthy();expect(router.replace).not.toHaveBeenCalled();act(()=>frame().props.onBack());expect(router.replace).toHaveBeenLastCalledWith(`/creator/event-messages?id=${mockEvent}&pageId=${mockPage}`);mockCanBack=true;act(()=>frame().props.onBack());expect(router.back).toHaveBeenCalledTimes(1);
});
it('missing event never loads an audience',async()=>{mockParams={};await mount();expect(mockRead).not.toHaveBeenCalled();expect(copy()).toContain('Invitation unavailable');});
it('a review finishing after access refresh starts cannot open stale review controls',async()=>{
 await mount();await edit('By the water');const pending=deferred<any>();mockReview.mockReturnValue(pending.promise);act(()=>control('Review draft').props.onPress());await flush();const access=deferred<any>();mockRead.mockReturnValue(access.promise);act(()=>frame().props.onRefresh());await flush();pending.resolve({...reviewed({audience:'past_attendees',body:'By the water'}),sendingEnabled:true});await flush();expect(control('Send invitation')).toBeUndefined();access.resolve(context());await flush();expect(control('Send invitation')).toBeUndefined();
});

it('preserves draft-exit protection through access failure without permitting an old local retry',async()=>{
 await mount();(AsyncStorage.setItem as jest.Mock).mockRejectedValue(Error('disk'));await edit('Keep this invitation');const retryDraft=control('Try again').props.onPress;mockRead.mockRejectedValue(Error('offline'));act(()=>frame().props.onRefresh());await flush();const writes=(AsyncStorage.setItem as jest.Mock).mock.calls.length;act(()=>retryDraft());await flush();expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);const {usePreventRemove}=require('@react-navigation/native');expect(usePreventRemove.mock.calls.at(-1)[0]).toBe(true);expect(control('Invitation message').props.value).toBe('Keep this invitation');
});

it('current reviewed Back leaves through draft-exit protection while access is refreshing or unavailable',async()=>{
 await prepare();const {router}=require('expo-router');const pending=deferred<any>();mockRead.mockReturnValue(pending.promise);act(()=>frame().props.onRefresh());await flush();expect(copy()).toContain('Review your invitation');act(()=>frame().props.onBack());expect(router.replace).toHaveBeenLastCalledWith(`/creator/event-messages?id=${mockEvent}&pageId=${mockPage}`);expect(copy()).toContain('Review your invitation');pending.reject(Error('offline'));await flush();mockCanBack=true;act(()=>frame().props.onBack());expect(router.back).toHaveBeenCalledTimes(1);expect(mockSubmit).not.toHaveBeenCalled();
});
