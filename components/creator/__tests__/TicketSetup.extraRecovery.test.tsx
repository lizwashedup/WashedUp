import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {TouchableOpacity,Text} from 'react-native';
const mockPerform=jest.fn(),mockEntry=jest.fn(),mockMemory=new Map<string,string>(),mockBack=jest.fn(),mockReplace=jest.fn(),mockCanGoBack=jest.fn(),mockTiers=jest.fn(),mockPayout=jest.fn();let mockSetup:string|undefined;
const event='11111111-1111-4111-8111-111111111111',page='22222222-2222-4222-8222-222222222222',user='33333333-3333-4333-8333-333333333333',extra='55555555-5555-4555-8555-555555555555';
const mockScope={userId:user,isCurrent:()=>true};
const mockAddon={id:extra,event_id:event,name:'Picnic blanket',description:null,image_url:null,price_cents:0,quantity_cap:5,per_order_max:2,sales_open_at:null,sales_close_at:null,sold_count:0,status:'on_sale'};
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{epoch:1}})}));
jest.mock('../../../lib/creatorEventEntry',()=>({resolveCreatorEventEntry:(...a:any[])=>mockEntry(...a)}));
jest.mock('../../../lib/creatorMode',()=>({getCreatorAccess:async()=>({hasEventHostGrant:false}),canManageEvents:()=>false}));
jest.mock('../../../constants/FeatureFlags',()=>({CREATOR_PAGES_ENABLED:true}));
jest.mock('../../../lib/creatorTicketAction',()=>({performTicketAction:(...a:any[])=>mockPerform(...a)}));
jest.mock('../../../lib/creatorTicketRead',()=>({canReadCreatorTickets:async()=>true,scopedTicketRequest:async(_scope:any,work:any)=>work()}));
jest.mock('../../../lib/supabase',()=>({supabase:{from:()=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:'11111111-1111-4111-8111-111111111111',title:'Sunday picnic'}})};return q;}}}));
jest.mock('../../../lib/ticketing',()=>({...jest.requireActual('../../../lib/ticketing'),getTiers:()=>mockTiers(),getQuestions:async()=>[],getEventFaqs:async()=>({faqs:[],available:true}),getMyPayoutState:()=>mockPayout(),getConfirmationMessage:async()=>null}));
jest.mock('../../../lib/ticketPromosAddons',()=>({...jest.requireActual('../../../lib/ticketPromosAddons'),listAddons:async()=>[mockAddon],listPromoCodes:async()=>[]}));
jest.mock('../EventSaleAlertPreference',()=>({EventSaleAlertPreference:()=>null}));
jest.mock('../PayoutsCard',()=>({PayoutsCard:()=>null}));
jest.mock('../TierEditorSheet',()=>({TierEditorSheet:()=>null}));
jest.mock('../PromotionEditorSheet',()=>({PromotionEditorSheet:()=>null}));
jest.mock('../AddonEditorSheet',()=>({AddonEditorSheet:()=>null}));
jest.mock('../../BrandedAlert',()=>({BrandedAlert:(props:any)=>props.visible?require('react').createElement('ConfirmationAlert',props):null}));
jest.mock('../pages/PageFrame',()=>({PageFrame:({children}:any)=>children,PageAction:()=>null}));
jest.mock('../../../lib/haptics',()=>({hapticLight:jest.fn(),hapticSuccess:jest.fn(),hapticError:jest.fn()}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>({id:'11111111-1111-4111-8111-111111111111',setup:mockSetup}),useFocusEffect:(work:any)=>require('react').useEffect(work,[work]),router:{back:()=>mockBack(),push:jest.fn(),replace:(...args:any[])=>mockReplace(...args),canGoBack:()=>mockCanGoBack()}}));
jest.mock('react-native-safe-area-context',()=>jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{getItem:async(k:string)=>mockMemory.get(k)??null,setItem:async(k:string,v:string)=>{mockMemory.set(k,v);},removeItem:async(k:string)=>{mockMemory.delete(k);}}}));
jest.mock('expo-crypto',()=>({randomUUID:()=> '44444444-4444-4444-8444-444444444444'}));
import Screen from '../../../app/creator/tickets';
let tree:ReactTestRenderer,client:QueryClient;
const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,25));});
async function mount(){client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{gcTime:0}}});await act(async()=>{tree=create(<QueryClientProvider client={client}><Screen/></QueryClientProvider>);});await settle();await settle();}
const named=(label:string)=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===label)!;
const press=async(label:string)=>{await act(async()=>{named(label).props.onPress();});await settle();};
async function remove(){await press('Remove Picnic blanket');await act(async()=>{tree.root.findByType('ConfirmationAlert' as any).props.buttons.find((b:any)=>b.text==='remove it').onPress();});await settle();}
beforeEach(()=>{jest.clearAllMocks();mockMemory.clear();mockSetup=undefined;mockCanGoBack.mockReturnValue(true);mockTiers.mockResolvedValue([]);mockPayout.mockResolvedValue(null);mockEntry.mockResolvedValue({kind:'page',pageId:page,eventId:event,entry:'owner'});mockPerform.mockResolvedValue('in_use');});
afterEach(()=>{if(tree)act(()=>tree.unmount());client?.clear();});
it('uses resolved page identity and returns usable Pause after order-reference recovery',async()=>{await mount();expect(named('Remove Picnic blanket').props.disabled).toBe(false);await remove();expect(mockPerform.mock.calls[0][0]).toMatchObject({kind:'remove-extra',pageId:page,eventId:event,recordId:extra,requestId:'44444444-4444-4444-8444-444444444444'});expect(JSON.stringify(tree.toJSON())).toContain('linked to an order');expect(named('Pause sales for Picnic blanket').props.disabled).toBe(false);expect(mockMemory.size).toBe(0);await press('Pause sales for Picnic blanket');expect(mockPerform.mock.calls[1][0]).toMatchObject({kind:'extra-sale',expected:'on_sale',recordId:extra});});
it('reopening exposes the original saved removal and no dismissal of uncertain removal',async()=>{mockPerform.mockResolvedValue('unchanged');await mount();await remove();const original=mockPerform.mock.calls[0][0];act(()=>tree.unmount());client.clear();await mount();expect(mockPerform).toHaveBeenCalledTimes(1);expect(named('Pause sales for Picnic blanket').props.disabled).toBe(true);expect(tree.root.findAllByType(Text).some(n=>n.props.children==='Not now')).toBe(false);const check=tree.root.findAllByType(TouchableOpacity).find(n=>n.findAllByType(Text).some(t=>t.props.children==='Check status'))!;mockPerform.mockResolvedValueOnce('in_use');await act(async()=>{check.props.onPress();});await settle();expect(mockPerform.mock.calls[1][0]).toEqual(original);expect(mockPerform.mock.calls[1][2]).toBe(true);expect(named('Pause sales for Picnic blanket').props.disabled).toBe(false);});

it('cold ticket entry returns to the same saved event through the existing classification gate',async()=>{
 mockCanGoBack.mockReturnValue(false);await mount();await press('Back');expect(mockBack).not.toHaveBeenCalled();expect(mockReplace).toHaveBeenCalledWith(`/creator/event-form?id=${event}`);expect(mockPerform).not.toHaveBeenCalled();
});
it('normal ticket return preserves the existing navigation stack',async()=>{
 await mount();await press('Back');expect(mockBack).toHaveBeenCalledTimes(1);expect(mockReplace).not.toHaveBeenCalled();
});
it('ready ticket setup offers review without claiming the page/event is published',async()=>{
 mockSetup='1';mockCanGoBack.mockReturnValue(false);mockTiers.mockResolvedValue([{id:extra,name:'Entry',price_cents:1000,status:'on_sale',quantity_cap:10}]);mockPayout.mockResolvedValue({exists:true,chargesEnabled:true,payoutsEnabled:true,requirementsDue:[]});await mount();
 expect(JSON.stringify(tree.toJSON())).toContain('tickets are ready');expect(JSON.stringify(tree.toJSON())).not.toContain('ready to publish');await press('review event');expect(mockReplace).toHaveBeenCalledWith(`/creator/event-form?id=${event}`);expect(mockPerform).not.toHaveBeenCalled();
 mockTiers.mockRejectedValueOnce(Error('offline'));await act(async()=>{await client.invalidateQueries({queryKey:['ticket-tiers',event]});});await settle();
 expect(JSON.stringify(tree.toJSON())).toContain('check ticket setup');expect(named('review event')).toBeUndefined();expect(JSON.stringify(tree.toJSON())).not.toContain('tickets are ready');
});
