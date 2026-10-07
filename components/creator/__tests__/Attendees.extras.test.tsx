import React from 'react';
import {create,act,type ReactTestRenderer} from 'react-test-renderer';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {TextInput,TouchableOpacity} from 'react-native';
const mockExtras=jest.fn();const mockAccess=jest.fn();const mockAttendees=jest.fn();const mockMoney=jest.fn();const mockQuestions=jest.fn();let mockScope={userId:'creator',isCurrent:()=>true};
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope})}));
jest.mock('../../../lib/creatorTicketRead',()=>({canReadCreatorTickets:(...a:any[])=>mockAccess(...a)}));
jest.mock('../pages/PageFrame',()=>({PageFrame:({children}:any)=>children,PageAction:({title,onPress}:any)=>require('react').createElement(require('react-native').TouchableOpacity,{accessibilityLabel:title,onPress}),pageStyles:{body:{}}}));
jest.mock('../../../lib/purchaseExtras',()=>({readPurchaseExtras:(...a:any[])=>mockExtras(...a)}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>({id:'event'}),router:{push:jest.fn()}}));
jest.mock('../../../lib/supabase',()=>({supabase:{}}));
jest.mock('../../../lib/haptics',()=>({hapticLight:jest.fn()}));
jest.mock('../../../lib/ticketing',()=>({...jest.requireActual('../../../lib/ticketing'),getRefundAccess:async()=>({canRefund:false})}));
jest.mock('../../../lib/ticketAttendees',()=>({...jest.requireActual('../../../lib/ticketAttendees'),getEventAttendees:(...a:any[])=>mockAttendees(...a),getEventMoneySummary:(...a:any[])=>mockMoney(...a),getEventQuestions:(...a:any[])=>mockQuestions(...a)}));
jest.mock('../MoneySummaryCard',()=>({MoneySummaryCard:()=>require('react').createElement(require('react-native').Text,null,'Detailed sales breakdown')}));
jest.mock('../RefundReasonModal',()=>({RefundReasonModal:()=>null}));
import Screen from '../../../app/creator/attendees';
let tree:ReactTestRenderer,client:QueryClient;const content=()=>JSON.stringify(tree.toJSON());
const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,20));});
async function mount(){client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});await act(async()=>{tree=create(<QueryClientProvider client={client}><Screen/></QueryClientProvider>);});await settle();await settle();}
beforeEach(()=>{jest.clearAllMocks();mockScope={userId:'creator',isCurrent:()=>true};mockAccess.mockResolvedValue(true);mockMoney.mockResolvedValue(null);mockQuestions.mockResolvedValue([]);mockAttendees.mockResolvedValue([1,2].map(i=>({positionId:'seat'+i,orderId:'order',positionIndex:i,referenceCode:'WU-'+i,buyerName:'Juniper',tierName:'Entry',orderStatus:'paid',voided:false,checkedIn:false,refundedCents:0})));mockExtras.mockResolvedValue(new Map([['order',[{id:'extra',name:'Picnic lunch',quantity:2,unitPriceCents:1200,optionLabel:'Vegan picnic'}]]]));});
afterEach(()=>{if(tree)act(()=>tree.unmount());client?.clear();});
it('shows extras once per visible purchase without assigning them to every seat',async()=>{
 await mount();expect(content().split('Vegan picnic')).toHaveLength(2);expect(content()).toContain('Extras for this purchase');
 const input=tree.root.findByType(TextInput);await act(async()=>input.props.onChangeText('WU-2'));expect(content()).toContain('Vegan picnic');expect(content()).not.toContain('WU-1');expect(mockExtras).toHaveBeenCalledTimes(1);
});
it('keeps attendees when extras fail and retries independently',async()=>{
 mockExtras.mockRejectedValueOnce(Error('offline'));await mount();expect(content()).toContain('WU-1');expect(content()).toContain('Extras couldn’t be loaded.');mockExtras.mockResolvedValue(new Map([['order',[]]]));
 await act(async()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Retry purchase extras')!.props.onPress());expect(content()).not.toContain('Extras couldn’t be loaded.');expect(content()).toContain('WU-1');
});

it('does not mount private readers when exact-event access is denied',async()=>{
 mockAccess.mockResolvedValue(false);await mount();expect(content()).toContain('Attendee access isn’t available');expect(mockAttendees).not.toHaveBeenCalled();expect(mockExtras).not.toHaveBeenCalled();
});
it('shows an honest attendee read failure and can recover without a false empty list',async()=>{
 mockAttendees.mockRejectedValueOnce(Error('offline'));await mount();expect(content()).toContain('Attendees couldn’t be refreshed.');expect(content()).not.toContain('Share your event');
 await act(async()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Retry: Attendees couldn’t be refreshed.')!.props.onPress());await settle();expect(content()).toContain('WU-1');
});
it('keeps rows but suppresses incomplete export when questions fail',async()=>{
 mockQuestions.mockRejectedValue(Error('offline'));await mount();expect(content()).toContain('WU-1');expect(content()).toContain('Questions couldn’t be loaded.');expect(tree.root.findAllByType(TouchableOpacity).some(n=>n.props.accessibilityLabel==='export attendees')).toBe(false);
});
it('does not show previous account attendees when current access is rejected',async()=>{
 await mount();expect(content()).toContain('WU-1');mockScope={userId:'other',isCurrent:()=>true};mockAccess.mockResolvedValue(false);
 await act(async()=>tree.update(<QueryClientProvider client={client}><Screen/></QueryClientProvider>));await settle();expect(content()).not.toContain('WU-1');expect(content()).toContain('Attendee access isn’t available');
});
it('retains confirmed rows when a background refresh fails',async()=>{
 await mount();mockAttendees.mockRejectedValue(Error('offline'));await act(async()=>{await client.invalidateQueries({queryKey:['event-attendees']});});await settle();expect(content()).toContain('WU-1');expect(content()).toContain('Attendees couldn’t be refreshed.');
});

it('keeps sales compact until expanded without hiding attendee rows',async()=>{
 mockMoney.mockResolvedValue({grossFaceCents:6000,processingCents:300,commissionCents:240});await mount();expect(content()).toContain('WU-1');expect(content()).not.toContain('Detailed sales breakdown');
 await act(async()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Sales summary')!.props.onPress());expect(content()).toContain('Detailed sales breakdown');expect(content()).toContain('WU-1');
});
