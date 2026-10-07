import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {Text,TextInput,TouchableOpacity,View} from 'react-native';
const mockAccess=jest.fn(),mockEntry=jest.fn(),mockAttendees=jest.fn(),mockSync=jest.fn(),mockRecord=jest.fn(),mockList=jest.fn(),mockLegacy=jest.fn(),mockConfirm=jest.fn(),mockBack=jest.fn(),mockReplace=jest.fn();
const event='22222222-2222-4222-8222-222222222222';
let mockId=event,mockScope={userId:'creator',isCurrent:()=>true},mockCanBack=true;
// The native scanner module remains held; exercise its existing callback contract.
jest.mock('react',()=>({...jest.requireActual('react'),lazy:()=>require('../TicketScanner').default}));
jest.mock('../../ProfileButton',()=>({__esModule:true,default:()=>null}));
jest.mock('expo-linear-gradient',()=>({LinearGradient:require('react-native').View}));
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{epoch:1}})}));
jest.mock('../../../lib/creatorTicketRead',()=>({canReadCreatorTickets:(...a:any[])=>mockAccess(...a)}));
jest.mock('../../../lib/creatorEventEntry',()=>({resolveCreatorEventEntry:(...a:any[])=>mockEntry(...a)}));
jest.mock('../../../constants/FeatureFlags',()=>({CREATOR_PAGES_ENABLED:true}));
jest.mock('../../../lib/ticketAttendees',()=>({...jest.requireActual('../../../lib/ticketAttendees'),getEventAttendees:(...a:any[])=>mockAttendees(...a)}));
jest.mock('../../../lib/ticketDoor',()=>({...jest.requireActual('../../../lib/ticketDoor'),syncQueuedCheckins:(...a:any[])=>mockSync(...a),recordCheckin:(...a:any[])=>mockRecord(...a),listQueued:(...a:any[])=>mockList(...a),readLegacyCheckins:(...a:any[])=>mockLegacy(...a),confirmLegacyCheckins:(...a:any[])=>mockConfirm(...a)}));
jest.mock('../../../lib/haptics',()=>({hapticLight:jest.fn(),hapticSuccess:jest.fn(),hapticError:jest.fn(),hapticWarning:jest.fn()}));
jest.mock('../pages/PageFrame',()=>({PageFrame:({children}:any)=>children,PageAction:()=>null,pageStyles:{body:{}}}));
jest.mock('../TicketScanner',()=>({__esModule:true,default:()=>null}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>({id:mockId}),router:{canGoBack:()=>mockCanBack,back:()=>mockBack(),replace:(...a:any[])=>mockReplace(...a)}}));
import Screen from '../../../app/creator/check-in';
import {PageAction} from '../pages/PageFrame';
let tree:ReactTestRenderer,client:QueryClient,alive=false;
const seats=[1,2,3].map(i=>({positionId:'seat'+i,orderId:'order',positionIndex:i,referenceCode:'ENTRY23'+i,buyerName:'Juniper',orderStatus:'paid',voided:false,checkedIn:i===1,refundedCents:0}));
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}
const content=()=> <QueryClientProvider client={client}><Screen/></QueryClientProvider>;
function mount(){act(()=>{tree=create(content());alive=true;});}
function update(){act(()=>tree.update(content()));}
function unmount(){if(alive)act(()=>{tree.unmount();alive=false;});}
function text(n:any):string{return Array.isArray(n)?n.map(text).join(''):String(n??'');}
function words(){return tree.root.findAllByType(Text).map(n=>text(n.props.children)).join(' ');}
function retry(){return tree.root.findByType(PageAction);}
function input(){return tree.root.findByType(TextInput);}
function control(label:string){return tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===label)!;}
function summary(){return tree.root.findAllByType(View).filter(n=>n.props.accessibilityRole==='summary');}
async function flush(){for(let p=0;p<3;p++){await act(async()=>{for(let i=0;i<25;i++)await Promise.resolve();});await act(async()=>{jest.advanceTimersByTime(1);for(let i=0;i<25;i++)await Promise.resolve();});}}
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();mockId=event;mockScope={userId:'creator',isCurrent:()=>true};mockCanBack=true;mockAccess.mockReset().mockResolvedValue(true);mockEntry.mockReset().mockResolvedValue({kind:'page',pageId:'page'});mockAttendees.mockReset().mockResolvedValue(seats);mockSync.mockReset().mockResolvedValue({processed:[],remaining:0});mockList.mockReset().mockResolvedValue([]);mockLegacy.mockReset().mockResolvedValue([]);mockConfirm.mockReset().mockResolvedValue({processed:[],remaining:0});mockRecord.mockReset().mockResolvedValue({kind:'queued',code:'ENTRY234'});client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});});
afterEach(()=>{unmount();client.clear();jest.clearAllTimers();jest.useRealTimers();});
it.each(['access','entry'])('bounds initial %s without starting queue/attendee work; retry is duplicate safe',async stage=>{
 const read=stage==='access'?mockAccess:mockEntry,pending=deferred<any>();read.mockReturnValue(pending.promise);mount();await flush();expect(mockSync).not.toHaveBeenCalled();expect(mockAttendees).not.toHaveBeenCalled();await act(async()=>{jest.advanceTimersByTime(12000);});await flush();expect(words()).toContain('Check-in couldn’t be loaded');const owned=read.mock.calls[0][1];expect(owned.isCurrent()).toBe(false);read.mockResolvedValue(stage==='access'?true:{kind:'page',pageId:'page'});const again=retry().props.onPress;act(()=>{again();again();});await flush();expect(mockSync).toHaveBeenCalledTimes(1);expect(summary()).toHaveLength(1);pending.resolve(stage==='access'?false:{kind:'page',pageId:'stale'});await flush();expect(input()).toBeDefined();expect(mockSync.mock.calls[0][0].pageId).toBe('page');
});
it('bounds initial attendance and recovers without a false zero count or repeated automatic reads',async()=>{
 const pending=deferred<any>();mockAttendees.mockReturnValue(pending.promise);mount();await flush();expect(summary()).toHaveLength(0);await act(async()=>{jest.advanceTimersByTime(12000);});await flush();expect(words()).toContain('Attendance couldn’t be loaded');expect(mockAttendees).toHaveBeenCalledTimes(1);expect(mockAttendees.mock.calls[0][1].isCurrent()).toBe(false);expect(input()).toBeDefined();const next=deferred<any>();mockAttendees.mockReturnValue(next.promise);const again=retry().props.onPress;act(()=>{again();again();});await flush();expect(mockAttendees).toHaveBeenCalledTimes(2);expect(retry().props.disabled).toBe(true);next.resolve(seats);await flush();expect(words()).toContain(' / 3 checked in');pending.resolve([]);await flush();expect(words()).toContain(' / 3 checked in');
});
it('retains counts and typed code during refresh failure/busy retry and leaves admission to the existing service',async()=>{
 mount();await flush();act(()=>input().props.onChangeText('entry234'));mockAttendees.mockRejectedValue(Error('offline'));await act(async()=>{await client.invalidateQueries({queryKey:['event-attendees']});});await flush();expect(summary()).toHaveLength(1);expect(words()).toContain(' / 3 checked in');expect(words()).toContain('Showing the last confirmed count');expect(input().props.value).toBe('ENTRY234');const next=deferred<any>();mockAttendees.mockReturnValue(next.promise);act(()=>retry().props.onPress());await flush();expect(words()).toContain('Updating attendance');expect(summary()).toHaveLength(1);next.resolve(seats);await flush();await act(async()=>input().props.onSubmitEditing());await flush();expect(mockRecord).toHaveBeenCalledWith('ENTRY234',{eventId:event,pageId:'page',scope:mockScope});expect(words()).toContain('awaiting confirmation');expect(words()).not.toContain('admitted');expect(input().props.value).toBe('');
});
it('never restores counts or entry controls while revoked access is being retried',async()=>{
 mount();await flush();act(()=>input().props.onChangeText('entry234'));const submit=input().props.onSubmitEditing,back=control('back').props.onPress;mockAccess.mockResolvedValue(false);await act(async()=>{await client.invalidateQueries({queryKey:['event-attendees']});});await flush();expect(words()).toContain('no longer available');expect(summary()).toHaveLength(0);expect(tree.root.findAllByType(TextInput)).toHaveLength(0);await act(async()=>{submit();back();});expect(mockRecord).not.toHaveBeenCalled();expect(mockBack).not.toHaveBeenCalled();const next=deferred<boolean>();mockAccess.mockReturnValue(next.promise);act(()=>retry().props.onPress());await flush();expect(tree.root.findAllByType(TextInput)).toHaveLength(0);next.resolve(true);await flush();expect(summary()).toHaveLength(1);expect(input().props.value).toBe('');
});
it.each(['account','event','focus','unmount'])('retires count retry, typed submit, navigation and late result on %s',async reason=>{
 mount();await flush();act(()=>input().props.onChangeText('entry234'));const submit=input().props.onSubmitEditing,back=control('back').props.onPress;mockAttendees.mockRejectedValue(Error('offline'));await act(async()=>{await client.invalidateQueries({queryKey:['event-attendees']});});await flush();const again=retry().props.onPress,pending=deferred<any>();mockAttendees.mockReturnValue(pending.promise);act(()=>again());await flush();if(reason==='unmount')unmount();else{if(reason==='event')mockId='33333333-3333-4333-8333-333333333333';mockScope={userId:reason==='account'?'other':'creator',isCurrent:()=>reason!=='focus'};mockAccess.mockResolvedValue(false);update();await flush();expect(tree.root.findAllByType(TextInput)).toHaveLength(0);}const reads=mockAttendees.mock.calls.length;await act(async()=>{submit();again();back();});pending.resolve(seats);await flush();expect(mockRecord).not.toHaveBeenCalled();expect(mockBack).not.toHaveBeenCalled();expect(mockAttendees).toHaveBeenCalledTimes(reads);
});
it('shows a confirmed zero only after a successful attendance result',async()=>{mockAttendees.mockResolvedValue([]);mount();await flush();expect(summary()).toHaveLength(1);expect(words()).toContain(' / 0 checked in');expect(tree.root.findAllByType(PageAction)).toHaveLength(0);});
it('keeps compact profile, normal Back and cold event-context Back',async()=>{mount();await flush();expect(tree.root.findByType(require('../../ProfileButton').default).props.compact).toBe(true);act(()=>control('back').props.onPress());expect(mockBack).toHaveBeenCalledTimes(1);mockCanBack=false;act(()=>control('back').props.onPress());expect(mockReplace).toHaveBeenCalledWith(`/creator/attendees?id=${event}`);});
it('preserves scan callback, code normalization and same-code cooldown with a scanner fixture',async()=>{
 mockRecord.mockResolvedValue({kind:'result',result:'admitted',code:'ENTRY234',admittedAt:null});mount();await flush();const toggle=control('Scan a ticket');act(()=>toggle.props.onPress());await flush();const scanner=tree.root.findByType(require('../TicketScanner').default);await act(async()=>scanner.props.onScan(' entry234 '));await flush();expect(mockRecord).toHaveBeenCalledWith('ENTRY234',{eventId:event,pageId:'page',scope:mockScope});await act(async()=>scanner.props.onScan('ENTRY234'));await flush();expect(mockRecord).toHaveBeenCalledTimes(1);expect(words()).toContain('admitted');
});

it('does not surface an old in-flight verdict after revoked access is re-established',async()=>{
 mount();await flush();const pending=deferred<any>();mockRecord.mockReturnValue(pending.promise);act(()=>input().props.onChangeText('entry234'));act(()=>{void input().props.onSubmitEditing();});mockAccess.mockResolvedValue(false);await act(async()=>{await client.invalidateQueries({queryKey:['event-attendees']});});await flush();expect(words()).toContain('no longer available');mockAccess.mockResolvedValue(true);act(()=>retry().props.onPress());await flush();expect(input().props.value).toBe('');pending.resolve({kind:'result',result:'admitted',code:'OLD-CODE',admittedAt:null});await flush();expect(words()).not.toContain('OLD-CODE');expect(words()).not.toContain('admitted');
});

it('does not reuse another screen’s attendance cache as this visit’s confirmed count',async()=>{
 client.setQueryData(['event-attendees',event,'creator',1],seats);mockAttendees.mockReturnValue(new Promise(()=>{}));mount();await flush();expect(summary()).toHaveLength(0);expect(words()).not.toContain(' / 3 checked in');
});
