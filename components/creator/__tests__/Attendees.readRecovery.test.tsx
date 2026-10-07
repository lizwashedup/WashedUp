import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {Alert,Share,Text,TextInput,TouchableOpacity} from 'react-native';
const mockAccess=jest.fn(),mockAttendees=jest.fn(),mockMoney=jest.fn(),mockQuestions=jest.fn(),mockAnswers=jest.fn(),mockExtras=jest.fn(),mockRefundAccess=jest.fn(),mockPush=jest.fn(),mockBack=jest.fn();
let mockEvent='event',mockScope={userId:'creator',isCurrent:()=>true};
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope})}));
jest.mock('../../../lib/creatorTicketRead',()=>({canReadCreatorTickets:(...a:any[])=>mockAccess(...a)}));
jest.mock('../pages/PageFrame',()=>({PageFrame:({children}:any)=>children,PageAction:({title,onPress}:any)=>require('react').createElement(require('react-native').TouchableOpacity,{accessibilityLabel:title,onPress}),pageStyles:{body:{}}}));
jest.mock('../../../lib/purchaseExtras',()=>({readPurchaseExtras:(...a:any[])=>mockExtras(...a)}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>({id:mockEvent}),router:{push:(...a:any[])=>mockPush(...a),back:()=>mockBack()}}));
jest.mock('../../../lib/supabase',()=>({supabase:{}}));
jest.mock('../../../lib/haptics',()=>({hapticLight:jest.fn()}));
jest.mock('../../../lib/ticketing',()=>({...jest.requireActual('../../../lib/ticketing'),getRefundAccess:(...a:any[])=>mockRefundAccess(...a)}));
jest.mock('../../../lib/ticketAttendees',()=>({...jest.requireActual('../../../lib/ticketAttendees'),getEventAttendees:(...a:any[])=>mockAttendees(...a),getEventMoneySummary:(...a:any[])=>mockMoney(...a),getEventQuestions:(...a:any[])=>mockQuestions(...a),getEventAnswers:(...a:any[])=>mockAnswers(...a)}));
jest.mock('../MoneySummaryCard',()=>({MoneySummaryCard:()=>require('react').createElement(require('react-native').Text,null,'Detailed sales breakdown')}));
jest.mock('../RefundReasonModal',()=>({RefundReasonModal:()=>null}));
import Screen from '../../../app/creator/attendees';
let tree:ReactTestRenderer,client:QueryClient,alive=false;
const seats=[1,2].map(i=>({positionId:'seat'+i,orderId:'order',positionIndex:i,referenceCode:'WU-'+i,buyerName:'Juniper',tierName:'Entry',orderStatus:'paid',voided:false,checkedIn:false,refundedCents:0}));
const questions=[{id:'q1',prompt:'What are you bringing?',scope:'per_order',qtype:'short_text',sort_order:0}];
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(v:any)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};}
const content=()=> <QueryClientProvider client={client}><Screen/></QueryClientProvider>;
function mount(){act(()=>{tree=create(content());alive=true;});}
function update(){act(()=>tree.update(content()));}
function unmount(){if(alive)act(()=>{tree.unmount();alive=false;});}
function words(){return tree.root.findAllByType(Text).map(n=>Array.isArray(n.props.children)?n.props.children.join(''):n.props.children).join(' ');}
function button(label:string){return tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===label)!;}
async function flush(){for(let pass=0;pass<3;pass++){await act(async()=>{for(let i=0;i<25;i++)await Promise.resolve();});await act(async()=>{jest.advanceTimersByTime(1);for(let i=0;i<25;i++)await Promise.resolve();});}}
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();mockEvent='event';mockScope={userId:'creator',isCurrent:()=>true};mockAccess.mockReset().mockResolvedValue(true);mockAttendees.mockReset().mockResolvedValue(seats);mockMoney.mockReset().mockResolvedValue({grossFaceCents:6000,processingCents:300,commissionCents:240});mockQuestions.mockReset().mockResolvedValue(questions);mockAnswers.mockReset().mockResolvedValue([{orderId:'order',questionId:'q1',value:{text:'Picnic'},attendeeIndex:null}]);mockRefundAccess.mockReset().mockResolvedValue({canRefund:true,isDelegate:false});mockExtras.mockReset().mockResolvedValue(new Map());client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});});
afterEach(()=>{unmount();client.clear();jest.clearAllTimers();jest.useRealTimers();jest.restoreAllMocks();});
it.each([['attendees',mockAttendees,'Attendees couldn’t be refreshed.'],['money',mockMoney,'Sales couldn’t be refreshed.'],['questions',mockQuestions,'Questions couldn’t be loaded.'],['answers',mockAnswers,'Answers couldn’t be loaded.'],['refund access',mockRefundAccess,'Refund access couldn’t be checked.']] as const)('bounds stalled %s, explicitly retries and refuses late data',async(_name,read,label)=>{
 const pending=deferred<any>();read.mockReturnValue(pending.promise);mount();await flush();if(read!==mockMoney&&read!==mockRefundAccess)expect(button('export attendees')).toBeUndefined();if(read===mockRefundAccess)expect(button('refund Juniper')).toBeUndefined();if(read===mockMoney||read===mockRefundAccess)expect(words()).toContain('Juniper');await act(async()=>{jest.advanceTimersByTime(12000);});await flush();expect(button(`Retry: ${label}`)).toBeDefined();expect(read).toHaveBeenCalledTimes(1);if(read===mockAttendees)expect(words()).not.toContain('Share your event');
 const result=read===mockAttendees?seats:read===mockMoney?{grossFaceCents:6000,processingCents:300,commissionCents:240}:read===mockQuestions?questions:read===mockAnswers?[]:{canRefund:false};read.mockResolvedValue(result);act(()=>button(`Retry: ${label}`).props.onPress());await flush();expect(words()).not.toContain(label);pending.resolve(read===mockAttendees?[]:null);await flush();expect(words()).toContain('Juniper');
});
it('does not export while questionnaire eligibility or answers are unknown',async()=>{
 const pending=deferred<any>();mockQuestions.mockReturnValue(pending.promise);mount();await flush();expect(words()).toContain('Checking questionnaire');expect(button('export attendees')).toBeUndefined();const answers=deferred<any>();mockAnswers.mockReturnValue(answers.promise);pending.resolve(questions);await flush();expect(words()).toContain('Loading answers');expect(button('export attendees')).toBeUndefined();answers.resolve([]);await flush();expect(button('export attendees')).toBeDefined();
});
it('retains filters, expanded answers and rows through failed refresh and one busy retry',async()=>{
 mount();await flush();act(()=>{tree.root.findByType(TextInput).props.onChangeText('WU-1');button('show answers for Juniper').props.onPress();});expect(words()).toContain('What are you bringing?');expect(words()).toContain('Picnic');mockAttendees.mockRejectedValue(Error('offline'));await act(async()=>{await client.invalidateQueries({queryKey:['event-attendees']});});await flush();expect(words()).toContain('WU-1');expect(words()).not.toContain('WU-2');expect(words()).toContain('What are you bringing?');expect(words()).toContain('Picnic');expect(words()).toContain('Counts from the last successful load.');expect(button('export attendees')).toBeUndefined();
 const pending=deferred<any>();mockAttendees.mockReturnValue(pending.promise);const retry=button('Retry: Attendees couldn’t be refreshed.').props.onPress;const count=mockAttendees.mock.calls.length;act(()=>{retry();retry();});await flush();expect(mockAttendees).toHaveBeenCalledTimes(count+1);expect(button('Retry: Attendees couldn’t be refreshed.').props.disabled).toBe(true);pending.resolve(seats);await flush();expect(tree.root.findByType(TextInput).props.value).toBe('WU-1');expect(words()).toContain('What are you bringing?');expect(words()).toContain('Picnic');
});
it('retains cached expanded answers during their refresh failure and suppresses incomplete export',async()=>{
 mount();await flush();act(()=>button('show answers for Juniper').props.onPress());mockAnswers.mockRejectedValue(Error('offline'));await act(async()=>{await client.invalidateQueries({queryKey:['event-answers']});});await flush();expect(words()).toContain('What are you bringing?');expect(words()).toContain('Picnic');expect(button('Retry: Answers couldn’t be loaded.')).toBeDefined();expect(button('export attendees')).toBeUndefined();
});
it.each(['event','account','same-account-new-visit','unmount'])('retires old export/navigation/retry on %s without reusing attendee cache',async retirement=>{
 const share=jest.spyOn(Share,'share').mockResolvedValue({action:Share.sharedAction});mount();await flush();const exportRows=button('export attendees').props.onPress;const checkIn=button('open check-in').props.onPress;const back=button('back').props.onPress;mockAttendees.mockRejectedValue(Error('offline'));await act(async()=>{await client.invalidateQueries({queryKey:['event-attendees']});});await flush();const retry=button('Retry: Attendees couldn’t be refreshed.').props.onPress;
 mockAttendees.mockImplementation(()=>new Promise(()=>{}));if(retirement==='unmount')unmount();else{if(retirement==='event')mockEvent='event2';mockScope={userId:retirement==='account'?'other':'creator',isCurrent:()=>true};update();await flush();expect(words()).not.toContain('Juniper');}const calls=mockAttendees.mock.calls.length;await act(async()=>{await exportRows();checkIn();back();retry();});expect(share).not.toHaveBeenCalled();expect(mockPush).not.toHaveBeenCalled();expect(mockBack).not.toHaveBeenCalled();expect(mockAttendees).toHaveBeenCalledTimes(calls);
});
it('exports the filtered seats with confirmed questions and preserves existing destination',async()=>{
 const share=jest.spyOn(Share,'share').mockResolvedValue({action:Share.sharedAction});mount();await flush();act(()=>tree.root.findByType(TextInput).props.onChangeText('WU-2'));await act(async()=>{await button('export attendees').props.onPress();});expect(share.mock.calls[0][0].message).toContain('WU-2');expect(share.mock.calls[0][0].message).not.toContain('WU-1');act(()=>button('open check-in').props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/check-in?id=event');
});
it('bounds access and extras reads separately without losing rows',async()=>{
 mockAccess.mockImplementation(()=>new Promise(()=>{}));mount();await flush();await act(async()=>{jest.advanceTimersByTime(12000);});await flush();expect(words()).toContain('This event couldn’t be loaded.');expect(mockAttendees).not.toHaveBeenCalled();mockAccess.mockResolvedValue(true);mockExtras.mockImplementation(()=>new Promise(()=>{}));act(()=>button('Try again').props.onPress());await flush();await act(async()=>{jest.advanceTimersByTime(12000);});await flush();expect(words()).toContain('Juniper');expect(words()).toContain('Extras couldn’t be loaded.');
});
it('shows confirmed empty attendance only after a successful read and suppresses stale share rejection feedback',async()=>{
 mockAttendees.mockResolvedValue([]);mount();await flush();expect(words()).toContain('Share your event to welcome your first guests.');unmount();client.clear();mockAttendees.mockResolvedValue(seats);const pending=deferred<any>();jest.spyOn(Share,'share').mockReturnValue(pending.promise);const alert=jest.spyOn(Alert,'alert');mount();await flush();act(()=>{void button('export attendees').props.onPress();});unmount();pending.reject(Error('cancelled'));await flush();expect(alert).not.toHaveBeenCalled();
});
