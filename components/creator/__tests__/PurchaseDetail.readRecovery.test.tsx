import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {Text,TouchableOpacity} from 'react-native';
import type {AttendeeQuestion,RawTicketAnswer} from '../../../lib/ticketAttendees';
const mockPurchase=jest.fn(),mockRefundAccess=jest.fn(),mockPreview=jest.fn(),mockExecute=jest.fn(),mockAccess=jest.fn(),mockAttendees=jest.fn(),mockQuestions=jest.fn(),mockAnswers=jest.fn(),mockBack=jest.fn();
let mockId='order',mockScope={userId:'creator',isCurrent:()=>true};
jest.mock('../../ProfileButton',()=>({__esModule:true,default:()=>null}));
jest.mock('expo-linear-gradient',()=>({LinearGradient:require('react-native').View}));
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope})}));
jest.mock('../../../lib/creatorTicketRead',()=>({canReadCreatorTickets:(...a:any[])=>mockAccess(...a)}));
jest.mock('../pages/PageFrame',()=>({PageFrame:({children}:any)=>children,PageAction:()=>null,pageStyles:{body:{}}}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>({id:mockId}),router:{back:()=>mockBack()}}));
jest.mock('../../../lib/supabase',()=>({supabase:{}}));
jest.mock('../../../lib/haptics',()=>({hapticLight:jest.fn()}));
jest.mock('../../../lib/ticketing',()=>({...jest.requireActual('../../../lib/ticketing'),getPurchaseDetail:(...a:any[])=>mockPurchase(...a),getRefundAccess:(...a:any[])=>mockRefundAccess(...a),previewRefund:(...a:any[])=>mockPreview(...a),executeRefund:(...a:any[])=>mockExecute(...a)}));
jest.mock('../../../lib/ticketAttendees',()=>({...jest.requireActual('../../../lib/ticketAttendees'),getEventAttendees:(...a:any[])=>mockAttendees(...a),getEventQuestions:(...a:any[])=>mockQuestions(...a),getEventAnswers:(...a:any[])=>mockAnswers(...a)}));
jest.mock('../RefundReasonModal',()=>({RefundReasonModal:()=>null}));
jest.mock('../../BrandedAlert',()=>({BrandedAlert:()=>null}));
import Screen from '../../../app/creator/purchase/[id]';
import {PageAction} from '../pages/PageFrame';
let tree:ReactTestRenderer,client:QueryClient,alive=false;
const purchase={orderId:'order',eventId:'event',eventTitle:'Sunset picnic',buyerName:'Juniper',tierName:'Entry',qty:2,totalCents:2400,refundedCents:0,status:'paid',createdAt:'2026-09-16T12:00:00Z'};
const seats=[1,2].map(i=>({positionId:'seat'+i,orderId:'order',positionIndex:i,referenceCode:'WU-'+i,buyerName:'Juniper',tierName:'Entry',orderStatus:'paid',voided:false,checkedIn:false,refundedCents:0}));
const questions:AttendeeQuestion[]=[{id:'q1',prompt:'Picnic choice',qtype:'short_text',scope:'per_order',sortOrder:0,options:null}];
const answers:RawTicketAnswer[]=[{orderId:'order',questionId:'q1',attendeeIndex:null,value:{text:'Vegetarian picnic, no sesame'}}];
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(v:any)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};}
const content=()=> <QueryClientProvider client={client}><Screen/></QueryClientProvider>;
function mount(){act(()=>{tree=create(content());alive=true;});}
function update(){act(()=>tree.update(content()));}
function unmount(){if(alive)act(()=>{tree.unmount();alive=false;});}
function text(n:any):string{return Array.isArray(n)?n.map(text).join(''):String(n??'');}
function words(){return tree.root.findAllByType(Text).map(n=>text(n.props.children)).join(' ');}
function button(label:string){return tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===label)!;}
function retry(){return tree.root.findByType(PageAction);}
async function flush(){for(let pass=0;pass<3;pass++){await act(async()=>{for(let i=0;i<25;i++)await Promise.resolve();});await act(async()=>{jest.advanceTimersByTime(1);for(let i=0;i<25;i++)await Promise.resolve();});}}
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();mockId='order';mockScope={userId:'creator',isCurrent:()=>true};mockAccess.mockReset().mockResolvedValue(true);mockPurchase.mockReset().mockResolvedValue(purchase);mockAttendees.mockReset().mockResolvedValue(seats);mockQuestions.mockReset().mockResolvedValue(questions);mockAnswers.mockReset().mockResolvedValue(answers);mockRefundAccess.mockReset().mockResolvedValue({canRefund:true,isDelegate:true});mockPreview.mockReset().mockResolvedValue({allowed:true,refundAmountCents:2400,positionCount:2});mockExecute.mockReset().mockResolvedValue({ok:false,message:'Try again later.'});client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});});
afterEach(()=>{unmount();client.clear();jest.clearAllTimers();jest.useRealTimers();jest.restoreAllMocks();});
it('bounds initial purchase read, retries once and refuses a late unavailable response',async()=>{
 const pending=deferred<any>();mockPurchase.mockReturnValue(pending.promise);mount();await flush();expect(mockAttendees).not.toHaveBeenCalled();await act(async()=>{jest.advanceTimersByTime(12000);});await flush();expect(words()).toContain('This purchase couldn’t be loaded');expect(mockPurchase).toHaveBeenCalledTimes(1);mockPurchase.mockResolvedValue(purchase);const fn=retry().props.onPress;act(()=>{fn();fn();});await flush();expect(mockPurchase).toHaveBeenCalledTimes(2);expect(words()).toContain('Juniper');pending.resolve(null);await flush();expect(words()).toContain('Vegetarian picnic, no sesame');
});
it.each([['tickets',mockAttendees,seats,'Tickets couldn’t be refreshed.'],['questions',mockQuestions,questions,'Questions couldn’t be loaded.'],['answers',mockAnswers,answers,'Answers couldn’t be loaded.'],['refund access',mockRefundAccess,{canRefund:true,isDelegate:true},'Refund access couldn’t be checked.']] as const)('bounds %s reads with explicit busy recovery and actual content after retry',async(name,read,value,label)=>{
 const pending=deferred<any>();read.mockReturnValue(pending.promise);mount();await flush();expect(words()).toContain('Juniper');if(name==='tickets'||name==='refund access')expect(button('Refund purchase')).toBeUndefined();expect(words()).not.toContain('No tickets are available');await act(async()=>{jest.advanceTimersByTime(12000);});await flush();expect(words()).toContain(label);expect(read).toHaveBeenCalledTimes(1);const next=deferred<any>();read.mockReturnValue(next.promise);const fn=retry().props.onPress;act(()=>{fn();fn();});await flush();expect(read).toHaveBeenCalledTimes(2);expect(retry().props.disabled).toBe(true);expect(words()).toContain('Checking the latest purchase details.');next.resolve(value);await flush();expect(words()).toContain('Vegetarian picnic, no sesame');pending.resolve([]);await flush();expect(words()).toContain('Vegetarian picnic, no sesame');
});
it.each([['purchase-detail',mockPurchase,purchase],['event-attendees',mockAttendees,seats],['event-questions',mockQuestions,questions],['event-answers',mockAnswers,answers],['event-refund-access',mockRefundAccess,{canRefund:true,isDelegate:true}]] as const)('keeps confirmed buyer/tickets/answers during cached %s failure',async(key,read,value)=>{
 mount();await flush();const oldRefund=button('Refund purchase').props.onPress;read.mockRejectedValue(Error('offline'));await act(async()=>{await client.invalidateQueries({queryKey:[key]});});await flush();expect(words()).toContain('Juniper');expect(words()).toContain('WU-1');expect(words()).toContain('Vegetarian picnic, no sesame');if(key==='purchase-detail'||key==='event-attendees'||key==='event-refund-access'){expect(button('Refund purchase')).toBeUndefined();await act(async()=>{await oldRefund();});expect(mockPreview).not.toHaveBeenCalled();}read.mockResolvedValue(value);act(()=>retry().props.onPress());await flush();expect(words()).toContain('Vegetarian picnic, no sesame');
});
it.each(['account','order','focus','unmount'])('retires old refund/retry/Back callbacks and deferred reads on %s',async retirement=>{
 mount();await flush();const oldRefund=button('Refund purchase').props.onPress,back=button('back').props.onPress;mockAttendees.mockRejectedValue(Error('offline'));await act(async()=>{await client.invalidateQueries({queryKey:['event-attendees']});});await flush();const oldRetry=retry().props.onPress;const pending=deferred<any>();mockAttendees.mockReturnValue(pending.promise);act(()=>oldRetry());await flush();if(retirement==='unmount')unmount();else{if(retirement==='order')mockId='order2';mockScope={userId:retirement==='account'?'other':'creator',isCurrent:()=>retirement!=='focus'};mockAccess.mockResolvedValue(false);update();await flush();expect(words()).not.toContain('Juniper');}const calls=mockAttendees.mock.calls.length;await act(async()=>{await oldRefund();oldRetry();back();});pending.resolve(seats);await flush();expect(mockAttendees).toHaveBeenCalledTimes(calls);expect(mockPreview).not.toHaveBeenCalled();expect(mockExecute).not.toHaveBeenCalled();expect(mockBack).not.toHaveBeenCalled();
});
it('hides private content on purchase event change or explicit authority revocation during refresh',async()=>{
 mount();await flush();mockPurchase.mockResolvedValue({...purchase,eventId:'different'});await act(async()=>{await client.invalidateQueries({queryKey:['purchase-detail']});});await flush();expect(words()).not.toContain('Juniper');expect(words()).toContain('no longer available');mockPurchase.mockResolvedValue(purchase);mockAccess.mockResolvedValue(false);act(()=>retry().props.onPress());await flush();expect(words()).not.toContain('Juniper');expect(button('Refund purchase')).toBeUndefined();
});
it('preserves compact profile, original Back and purchase amount/status/seat data',async()=>{
 mockPurchase.mockResolvedValue({...purchase,refundedCents:600});mount();await flush();expect(tree.root.findByType(require('../../ProfileButton').default).props.compact).toBe(true);expect(words()).toContain('Partially refunded');expect(words()).toContain('$24.00');expect(words()).toContain('$6.00');expect(words()).toContain('WU-2');expect(words()).toContain('Vegetarian picnic, no sesame');act(()=>button('back').props.onPress());expect(mockBack).toHaveBeenCalledTimes(1);
});
