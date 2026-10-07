import React from 'react';
jest.mock('../../ProfileButton',()=>({__esModule:true,default:()=>null}));
jest.mock('expo-linear-gradient',()=>({LinearGradient:require('react-native').View}));
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {Share,Text,TextInput,TouchableOpacity} from 'react-native';
const mockAccess=jest.fn(),mockPurchases=jest.fn(),mockEventRead=jest.fn(),mockBack=jest.fn(),mockReplace=jest.fn(),mockPush=jest.fn(),mockCanGoBack=jest.fn();
const event='11111111-1111-4111-8111-111111111111';let mockId=event,mockScope={userId:'creator',isCurrent:()=>true},mockEpoch=1;
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{epoch:mockEpoch}})}));
jest.mock('../../../lib/creatorTicketRead',()=>({canReadCreatorTickets:(...a:any[])=>mockAccess(...a),scopedTicketRequest:async(_s:any,work:any)=>work()}));
jest.mock('../../../lib/supabase',()=>({supabase:{from:()=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:()=>mockEventRead()};return q;}}}));
jest.mock('../../../lib/ticketing',()=>({...jest.requireActual('../../../lib/ticketing'),getEventPurchases:(...a:any[])=>mockPurchases(...a)}));
jest.mock('../../../lib/haptics',()=>({hapticLight:jest.fn()}));
jest.mock('../../BrandedAlert',()=>({BrandedAlert:()=>null}));
jest.mock('../pages/PageFrame',()=>({PageFrame:({children}:any)=>children,PageAction:()=>null}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>({id:mockId}),router:{back:()=>mockBack(),replace:(...a:any[])=>mockReplace(...a),push:(...a:any[])=>mockPush(...a),canGoBack:()=>mockCanGoBack()}}));
jest.mock('react-native-safe-area-context',()=>jest.requireActual('react-native-safe-area-context/jest/mock').default);
import Screen from '../../../app/creator/ticket-sales';
import {PageAction} from '../pages/PageFrame';
import {BrandedAlert} from '../../BrandedAlert';
let tree:ReactTestRenderer,client:QueryClient,alive=false;
const purchases=[{orderId:'order1',eventId:event,eventTitle:'Sunday picnic',buyerName:'Juniper',tierName:'Picnic',qty:2,totalCents:2000,refundedCents:500,status:'paid',createdAt:'2026-09-17T20:00:00Z'},{orderId:'order2',eventId:event,eventTitle:'Sunday picnic',buyerName:'Aster',tierName:'Picnic',qty:1,totalCents:1000,refundedCents:0,status:'paid',createdAt:'2026-09-17T20:00:00Z'}];
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(v:any)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};}
const content=()=> <QueryClientProvider client={client}><Screen/></QueryClientProvider>;
function mount(){act(()=>{tree=create(content());alive=true;});}
function update(){act(()=>tree.update(content()));}
function unmount(){if(alive)act(()=>{tree.unmount();alive=false;});}
function text(n:any):string{return Array.isArray(n)?n.map(text).join(''):String(n??'');}
function words(){return tree.root.findAllByType(Text).map(n=>text(n.props.children)).join(' ');}
function button(label:string){return tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===label)!;}
function chip(label:string){return tree.root.findAllByType(TouchableOpacity).find(n=>n.findAllByType(Text).some(t=>text(t.props.children)===label))!;}
function retry(){return tree.root.findByType(PageAction);}
async function flush(){for(let pass=0;pass<3;pass++){await act(async()=>{for(let i=0;i<25;i++)await Promise.resolve();});await act(async()=>{jest.advanceTimersByTime(1);for(let i=0;i<25;i++)await Promise.resolve();});}}
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();mockId=event;mockEpoch=1;mockScope={userId:'creator',isCurrent:()=>true};mockAccess.mockReset().mockResolvedValue(true);mockEventRead.mockReset().mockImplementation(async()=>({data:{id:mockId,title:'Sunday picnic'},error:null}));mockPurchases.mockReset().mockResolvedValue(purchases);mockCanGoBack.mockReturnValue(true);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});});
afterEach(()=>{unmount();client.clear();jest.clearAllTimers();jest.useRealTimers();jest.restoreAllMocks();});
it('bounds initial purchase loading, retries without duplicates, and ignores late empty results',async()=>{
 const pending=deferred<any>();mockPurchases.mockReturnValue(pending.promise);mount();await flush();expect(words()).not.toContain('as people book');expect(button('export purchases')).toBeUndefined();await act(async()=>{jest.advanceTimersByTime(12000);});await flush();expect(words()).toContain('Purchases couldn’t be loaded');expect(mockPurchases).toHaveBeenCalledTimes(1);const next=deferred<any>();mockPurchases.mockReturnValue(next.promise);const fn=retry().props.onPress;act(()=>{fn();fn();});await flush();expect(mockPurchases).toHaveBeenCalledTimes(2);expect(retry().props.disabled).toBe(true);next.resolve(purchases);await flush();expect(words()).toContain('Juniper');pending.resolve([]);await flush();expect(words()).toContain('Juniper');
});
it('keeps cached rows/search/partial-refund filter during errors and disables current and retained detail/export callbacks',async()=>{
 const share=jest.spyOn(Share,'share').mockResolvedValue({action:Share.sharedAction});mount();await flush();const open=button('open purchase by Juniper').props.onPress,exp=button('export purchases').props.onPress;act(()=>{tree.root.findByType(TextInput).props.onChangeText('Juniper');chip('Partially refunded').props.onPress();});mockPurchases.mockRejectedValue(Error('offline'));await act(async()=>{await client.invalidateQueries({queryKey:['event-purchases']});});await flush();expect(words()).toContain('Juniper');expect(words()).not.toContain('Aster');expect(button('open purchase by Juniper').props.disabled).toBe(true);expect(button('export purchases')).toBeUndefined();await act(async()=>{open();await exp();});expect(mockPush).not.toHaveBeenCalled();expect(share).not.toHaveBeenCalled();mockPurchases.mockResolvedValue(purchases);act(()=>retry().props.onPress());await flush();expect(tree.root.findByType(TextInput).props.value).toBe('Juniper');expect(chip('Partially refunded').props.accessibilityState.selected).toBe(true);expect(button('open purchase by Juniper').props.disabled).toBe(false);
});
it('fresh export revalidates authority and exports the whole event, never the filtered subset',async()=>{
 const share=jest.spyOn(Share,'share').mockResolvedValue({action:Share.sharedAction});mount();await flush();act(()=>{tree.root.findByType(TextInput).props.onChangeText('Juniper');chip('Partially refunded').props.onPress();});const pending=deferred<any>();mockPurchases.mockReturnValue(pending.promise);const exportFn=button('export purchases').props.onPress;const accessCount=mockAccess.mock.calls.length;act(()=>{void exportFn();void exportFn();});await flush();expect(mockAccess).toHaveBeenCalledTimes(accessCount+1);expect(share).not.toHaveBeenCalled();expect(button('open purchase by Juniper').props.disabled).toBe(true);expect(button('export purchases').props.disabled).toBe(true);pending.resolve([...purchases,{...purchases[1],orderId:'order3',buyerName:'New buyer'}]);await flush();expect(share).toHaveBeenCalledTimes(1);expect(share.mock.calls[0][0].message).toContain('Juniper');expect(share.mock.calls[0][0].message).toContain('Aster');expect(share.mock.calls[0][0].message).toContain('New buyer');
});
it('keeps authority denial distinct from a failed refresh and never shares cached purchases after revocation',async()=>{
 const share=jest.spyOn(Share,'share').mockResolvedValue({action:Share.sharedAction});mockAccess.mockResolvedValue(false);mount();await flush();expect(mockPurchases).not.toHaveBeenCalled();expect(mockEventRead).not.toHaveBeenCalled();expect(words()).toContain('aren’t available');mockAccess.mockResolvedValue(true);act(()=>retry().props.onPress());await flush();mockAccess.mockResolvedValue(false);await act(async()=>{await button('export purchases').props.onPress();});await flush();expect(share).not.toHaveBeenCalled();expect(button('open purchase by Juniper')).toBeUndefined();expect(words()).toContain('Sales access is no longer available');
});
it.each(['event','account','focus','unmount'])('retires deferred exports and old retry/detail/Back on %s',async retirement=>{
 const share=jest.spyOn(Share,'share').mockResolvedValue({action:Share.sharedAction});mount();await flush();const open=button('open purchase by Juniper').props.onPress,back=button('back').props.onPress;mockPurchases.mockRejectedValueOnce(Error('offline'));await act(async()=>{await client.invalidateQueries({queryKey:['event-purchases']});});await flush();const oldRetry=retry().props.onPress;act(()=>oldRetry());await flush();const pending=deferred<any>();mockPurchases.mockReturnValue(pending.promise);act(()=>{void button('export purchases').props.onPress();});await flush();if(retirement==='unmount')unmount();else{if(retirement==='event')mockId='22222222-2222-4222-8222-222222222222';mockEpoch++;mockScope={userId:retirement==='account'?'other':'creator',isCurrent:()=>retirement!=='focus'};update();await flush();expect(words()).not.toContain('Juniper');}const calls=mockPurchases.mock.calls.length;act(()=>{open();back();oldRetry();});pending.resolve(purchases);await flush();expect(mockPurchases).toHaveBeenCalledTimes(calls);expect(share).not.toHaveBeenCalled();expect(mockPush).not.toHaveBeenCalled();expect(mockBack).not.toHaveBeenCalled();
});
it('rejects an earlier visit read when a new event succeeds and uses no previous private cache',async()=>{
 const pending=deferred<any>();mockPurchases.mockReturnValueOnce(pending.promise);mount();await flush();mockId='22222222-2222-4222-8222-222222222222';mockScope={userId:'creator',isCurrent:()=>true};mockPurchases.mockResolvedValue([{...purchases[1],buyerName:'Current buyer'}]);update();await flush();expect(words()).toContain('Current buyer');pending.resolve(purchases);await flush();expect(words()).not.toContain('Juniper');expect(words()).toContain('Current buyer');
});
it('bounds outer event/access reads and does not report an access error as empty sales',async()=>{
 const pending=deferred<any>();mockEventRead.mockReturnValue(pending.promise);mount();await flush();await act(async()=>{jest.advanceTimersByTime(12000);});await flush();expect(words()).toContain('Ticket sales couldn’t be loaded');expect(mockPurchases).not.toHaveBeenCalled();mockEventRead.mockResolvedValue({data:{id:event,title:'Sunday picnic'},error:null});act(()=>retry().props.onPress());await flush();expect(words()).toContain('Juniper');pending.resolve({data:null,error:null});await flush();expect(words()).toContain('Juniper');
});
it('preserves original detail and Back routes including cold return, and confirms true empty only after success',async()=>{
 mount();await flush();act(()=>button('open purchase by Juniper').props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/purchase/order1');act(()=>button('back').props.onPress());expect(mockBack).toHaveBeenCalledTimes(1);mockCanGoBack.mockReturnValue(false);act(()=>button('back').props.onPress());expect(mockReplace).toHaveBeenCalledWith(`/creator/tickets?id=${event}`);mockPurchases.mockResolvedValue([]);await act(async()=>{await client.invalidateQueries({queryKey:['event-purchases']});});await flush();expect(words()).toContain('as people book tickets');
});
it('suppresses late share failure after event retirement',async()=>{
 const pending=deferred<any>();jest.spyOn(Share,'share').mockReturnValue(pending.promise);mount();await flush();act(()=>{void button('export purchases').props.onPress();});await flush();mockScope={userId:'other',isCurrent:()=>true};mockEpoch++;update();await flush();pending.reject(Error('cancelled'));await flush();expect(tree.root.findByType(BrandedAlert).props.visible).toBe(false);
});

it('keeps the compact profile entry and presents one coherent busy recovery status',async()=>{
 mockPurchases.mockRejectedValueOnce(Error('offline'));mount();await flush();expect(tree.root.findByType(require('../../ProfileButton').default).props.compact).toBe(true);const pending=deferred<any>();mockPurchases.mockReturnValue(pending.promise);act(()=>retry().props.onPress());await flush();expect(retry().props.title).toBe('Retrying…');expect(retry().props.disabled).toBe(true);expect(words()).toContain('Checking the latest sales.');expect(words()).not.toContain('Purchases couldn’t be loaded');expect(words()).not.toContain('Updating purchases');expect(tree.root.findAll(n=>n.props.accessibilityLabel==='Loading purchases')).toHaveLength(0);pending.resolve(purchases);await flush();expect(words()).toContain('Juniper');
});
