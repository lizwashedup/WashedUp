import React from 'react';
jest.mock('../../ProfileButton',()=>({__esModule:true,default:()=>null}));
jest.mock('expo-linear-gradient',()=>({LinearGradient:require('react-native').View}));
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {Share,TouchableOpacity,TextInput} from 'react-native';
const mockAccess=jest.fn(),mockPurchases=jest.fn(),mockEvent=jest.fn(),mockBack=jest.fn(),mockReplace=jest.fn(),mockPush=jest.fn(),mockCanGoBack=jest.fn();
const event='11111111-1111-4111-8111-111111111111';let mockCurrent=true,mockUser='creator',mockEpoch=1;let mockScope={userId:'creator',isCurrent:()=>mockCurrent};
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{epoch:mockEpoch}})}));
jest.mock('../../../lib/creatorTicketRead',()=>({canReadCreatorTickets:(...a:any[])=>mockAccess(...a),scopedTicketRequest:async(_s:any,work:any)=>work()}));
jest.mock('../../../lib/supabase',()=>({supabase:{from:()=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:()=>mockEvent()};return q;}}}));
jest.mock('../../../lib/ticketing',()=>({...jest.requireActual('../../../lib/ticketing'),getEventPurchases:(...a:any[])=>mockPurchases(...a)}));
jest.mock('../../../lib/haptics',()=>({hapticLight:jest.fn()}));
jest.mock('../../BrandedAlert',()=>({BrandedAlert:()=>null}));
jest.mock('../pages/PageFrame',()=>({PageFrame:({children}:any)=>children,PageAction:(props:any)=>require('react').createElement(require('react-native').TouchableOpacity,{onPress:props.onPress,accessibilityLabel:props.title})}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>({id:'11111111-1111-4111-8111-111111111111'}),router:{back:()=>mockBack(),replace:(...a:any[])=>mockReplace(...a),push:(...a:any[])=>mockPush(...a),canGoBack:()=>mockCanGoBack()}}));
jest.mock('react-native-safe-area-context',()=>jest.requireActual('react-native-safe-area-context/jest/mock').default);
import Screen from '../../../app/creator/ticket-sales';
let tree:ReactTestRenderer,client:QueryClient;
const purchase={orderId:'order',eventId:event,eventTitle:'Sunday picnic',buyerName:'Juniper',tierName:'Picnic',qty:2,totalCents:2000,refundedCents:500,status:'paid',createdAt:'2026-09-17T20:00:00Z'};
const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,25));});
const named=(label:string)=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===label);
const json=()=>JSON.stringify(tree.toJSON());
async function press(label:string){await act(async()=>{named(label)!.props.onPress();});await settle();}
async function mount(){client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});await act(async()=>{tree=create(<QueryClientProvider client={client}><Screen/></QueryClientProvider>);});await settle();await settle();}
beforeEach(()=>{jest.clearAllMocks();mockCurrent=true;mockUser='creator';mockEpoch=1;mockScope={userId:mockUser,isCurrent:()=>mockCurrent};mockAccess.mockResolvedValue(true);mockEvent.mockResolvedValue({data:{id:event,title:'Sunday picnic'}});mockPurchases.mockResolvedValue([purchase]);mockCanGoBack.mockReturnValue(true);jest.spyOn(Share,'share').mockResolvedValue({action:Share.sharedAction});});
afterEach(()=>{if(tree)act(()=>tree.unmount());client?.clear();jest.restoreAllMocks();});
it('admits event-authorized page creators, preserves purchase detail and export',async()=>{await mount();expect(mockAccess).toHaveBeenCalledWith(event,expect.objectContaining({userId:mockScope.userId,isCurrent:expect.any(Function)}));expect(mockPurchases).toHaveBeenCalledWith(event,'Sunday picnic',expect.objectContaining({userId:mockScope.userId,isCurrent:expect.any(Function)}));expect(json()).toContain('Partially refunded');await press('open purchase by Juniper');expect(mockPush).toHaveBeenCalledWith('/creator/purchase/order');await press('export purchases');expect(Share.share).toHaveBeenCalledTimes(1);expect((Share.share as jest.Mock).mock.calls[0][0].message).toContain('Juniper');});
it('denied event access never reads buyer data or exports',async()=>{mockAccess.mockResolvedValue(false);await mount();expect(mockPurchases).not.toHaveBeenCalled();expect(mockEvent).not.toHaveBeenCalled();expect(named('export purchases')).toBeUndefined();expect(json()).toContain('aren’t available');});
it('failed reads are recoverable and never appear as zero sales',async()=>{mockPurchases.mockRejectedValueOnce(Error('offline'));await mount();expect(json()).toContain('Purchases couldn’t be loaded');expect(json()).not.toContain('as people book');expect(named('export purchases')).toBeUndefined();await press('Try again');expect(json()).toContain('Juniper');});
it('failed refresh keeps cached buyer rows disabled and hides export while preserving search for retry',async()=>{await mount();act(()=>tree.root.findByType(TextInput).props.onChangeText('Juniper'));mockPurchases.mockRejectedValueOnce(Error('offline'));await act(async()=>{await client.invalidateQueries({queryKey:['event-purchases',event]});});await settle();expect(named('open purchase by Juniper')!.props.disabled).toBe(true);expect(named('export purchases')).toBeUndefined();await press('Try again');expect(tree.root.findByType(TextInput).props.value).toBe('Juniper');expect(named('open purchase by Juniper')).toBeDefined();});
it('return without history goes to the same event tickets',async()=>{mockCanGoBack.mockReturnValue(false);await mount();await press('back');expect(mockReplace).toHaveBeenCalledWith(`/creator/tickets?id=${event}`);expect(mockBack).not.toHaveBeenCalled();});
it('retired callbacks cannot export or open private purchases',async()=>{await mount();const open=named('open purchase by Juniper')!.props.onPress,share=named('export purchases')!.props.onPress;mockCurrent=false;await act(async()=>{open();await share();});expect(mockPush).not.toHaveBeenCalled();expect(Share.share).not.toHaveBeenCalled();});
it('an account change cannot inherit cached purchases or search',async()=>{await mount();mockAccess.mockResolvedValue(false);mockEpoch=2;mockScope={userId:'other',isCurrent:()=>true};await act(async()=>{tree.update(<QueryClientProvider client={client}><Screen/></QueryClientProvider>);});await settle();expect(json()).not.toContain('Juniper');expect(named('export purchases')).toBeUndefined();expect(mockPurchases).toHaveBeenCalledTimes(1);});
it('a successful empty result is distinct from an unavailable event',async()=>{mockPurchases.mockResolvedValue([]);await mount();expect(json()).toContain('as people book');expect(named('export purchases')).toBeUndefined();});

it('export rechecks event authority and never shares cached rows after revocation',async()=>{await mount();mockAccess.mockResolvedValue(false);await press('export purchases');expect(Share.share).not.toHaveBeenCalled();expect(named('open purchase by Juniper')).toBeUndefined();expect(json()).toContain('Sales access is no longer available');});
