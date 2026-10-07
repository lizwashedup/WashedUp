import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {TouchableOpacity,TextInput} from 'react-native';
const mockCreator=jest.fn(),mockEntry=jest.fn();
const mockAccess=jest.fn(),mockTiers=jest.fn(),mockFaqs=jest.fn(),mockPayout=jest.fn(),mockPromos=jest.fn(),mockAddons=jest.fn(),mockQuestions=jest.fn(),mockNote=jest.fn(),mockReadiness=jest.fn();
const mockSaveFaq=jest.fn();
jest.mock('../../../lib/creatorTicketDetailsSave',()=>({saveCreatorFaq:(...a:any[])=>mockSaveFaq(...a),saveCreatorPromo:jest.fn()}));
let mockFocused=true;let mockScope={userId:'creator',isCurrent:()=>mockFocused};
jest.mock('../../../constants/FeatureFlags',()=>({CREATOR_PAGES_ENABLED:true}));
jest.mock('../../../lib/creatorEventEntry',()=>({resolveCreatorEventEntry:(...a:any[])=>mockEntry(...a)}));
jest.mock('../../../lib/creatorMode',()=>({getCreatorAccess:()=>mockCreator(),canManageEvents:()=>false}));
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{epoch:1}})}));
jest.mock('../../../lib/creatorTierEditor',()=>({saveCreatorTier:async(...args:any[])=>{const result=await mockReadiness();if(!result.ok)throw Object.assign(Error(result.message),{code:'event_end_time_required'});return {name:args[2].name};}}));
jest.mock('../../../lib/creatorTicketRead',()=>({canReadCreatorTickets:(...a:any[])=>mockAccess(...a),scopedTicketRequest:async()=>({data:{id:'event',title:'A slow Sunday by the sea'}})}));
jest.mock('../pages/PageFrame',()=>({PageFrame:({children}:any)=>children,PageAction:({title,onPress}:any)=>require('react').createElement(require('react-native').TouchableOpacity,{accessibilityLabel:title,onPress})}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>({id:'event'}),useFocusEffect:(cb:any)=>require('react').useEffect(()=>mockFocused?cb():undefined,[cb,mockFocused]),router:{back:jest.fn(),push:jest.fn()}}));
jest.mock('../../../lib/supabase',()=>({supabase:{}}));
jest.mock('../../../lib/haptics',()=>({hapticLight:jest.fn(),hapticSuccess:jest.fn(),hapticError:jest.fn()}));
jest.mock('../../../lib/ticketing',()=>({...jest.requireActual('../../../lib/ticketing'),getTiers:(...a:any[])=>mockTiers(...a),getEventFaqs:(...a:any[])=>mockFaqs(...a),getMyPayoutState:(...a:any[])=>mockPayout(...a),getQuestions:(...a:any[])=>mockQuestions(...a),getConfirmationMessage:(...a:any[])=>mockNote(...a),getTierAvailability:async()=>new Map(),getPaidTicketEventReadiness:(...a:any[])=>mockReadiness(...a)}));
jest.mock('../../../lib/ticketPromosAddons',()=>({...jest.requireActual('../../../lib/ticketPromosAddons'),listPromoCodes:(...a:any[])=>mockPromos(...a),listAddons:(...a:any[])=>mockAddons(...a)}));
jest.mock('../TierEditorSheet',()=>({TierEditorSheet:(props:any)=>require('react').createElement('TierEditor',props)}));
jest.mock('../PromotionEditorSheet',()=>({PromotionEditorSheet:()=>null}));
jest.mock('../AddonEditorSheet',()=>({AddonEditorSheet:()=>null}));
jest.mock('../../../components/BrandedAlert',()=>({BrandedAlert:(props:any)=>require('react').createElement('TestAlert',props)}));
import Screen from '../../../app/creator/tickets';
let tree:ReactTestRenderer,client:QueryClient;const content=()=>JSON.stringify(tree.toJSON());const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,20));});
async function render(){await act(async()=>tree.update(<QueryClientProvider client={client}><Screen/></QueryClientProvider>));await settle();await settle();}
async function mount(){client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{gcTime:0}}});await act(async()=>{tree=create(<QueryClientProvider client={client}><Screen/></QueryClientProvider>);});await settle();await settle();}
beforeEach(()=>{jest.clearAllMocks();mockCreator.mockResolvedValue({hasEventHostGrant:true});mockEntry.mockResolvedValue({kind:'ordinary'});mockFocused=true;mockScope={userId:'creator',isCurrent:()=>mockFocused};mockAccess.mockResolvedValue(true);mockTiers.mockResolvedValue([]);mockFaqs.mockResolvedValue({available:true,faqs:[]});mockPayout.mockResolvedValue({exists:true,chargesEnabled:true,payoutsEnabled:true,commissionBps:400,requirementsDue:[]});mockPromos.mockResolvedValue([]);mockAddons.mockResolvedValue([]);mockQuestions.mockResolvedValue([]);mockNote.mockResolvedValue(null);});
afterEach(()=>{if(tree)act(()=>tree.unmount());client?.clear();});
it('gates setup by exact event authority before any private readers',async()=>{mockAccess.mockResolvedValue(false);await mount();expect(content()).toContain('Ticket setup isn’t available');expect(mockTiers).not.toHaveBeenCalled();expect(mockPayout).not.toHaveBeenCalled();});
it('does not present failed ticket or payout reads as empty setup',async()=>{mockTiers.mockRejectedValue(Error('offline'));mockPayout.mockRejectedValue(Error('offline'));await mount();expect(content()).toContain('Tickets couldn’t be refreshed.');expect(content()).toContain('Payout setup couldn’t be checked.');expect(content()).not.toContain('Add your first ticket');expect(content()).not.toContain('start with stripe');});
it('retries a failed ticket section independently',async()=>{mockTiers.mockRejectedValueOnce(Error('offline'));await mount();await act(async()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Retry: Tickets couldn’t be refreshed.')!.props.onPress());await settle();expect(content()).toContain('Add your first ticket');expect(mockPayout).toHaveBeenCalledTimes(1);});
it('preserves the pending ticket draft through the existing end-time round trip',async()=>{
 mockReadiness.mockResolvedValue({ok:false,reason:'missing_end_time',message:'Add an end time.'});mockTiers.mockResolvedValue([{id:'other-tier',name:'Other ticket',price_cents:1200,status:'draft',quantity_cap:null}]);await mount();const draft={name:'Sunset entry',price_cents:1200};
 await act(async()=>{await expect(tree.root.findByType('TierEditor' as any).props.onSave(draft)).rejects.toThrow('Add an end time.');});await settle();expect(tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Edit Other ticket')!.props.disabled).toBe(true);const alert=tree.root.findByType('TestAlert' as any);await act(async()=>alert.props.buttons.find((b:any)=>b.text==='set end time').onPress());
 mockFocused=false;mockScope={userId:'creator',isCurrent:()=>false};await render();expect(tree.root.findByType('TierEditor' as any).props.visible).toBe(false);
 mockFocused=true;mockScope={userId:'creator',isCurrent:()=>true};await render();expect(tree.root.findByType('TierEditor' as any).props.initialDraft).toEqual(draft);expect(tree.root.findByType('TierEditor' as any).props.visible).toBe(true);
});
it('does not substitute empty FAQ, code, extra, question or note copy after failures',async()=>{for(const read of [mockFaqs,mockPromos,mockAddons,mockQuestions,mockNote])read.mockRejectedValue(Error('offline'));await mount();for(const label of ['FAQs couldn’t be loaded.','Promo codes couldn’t be refreshed.','Extras couldn’t be refreshed.','Questions couldn’t be refreshed.','The creator note couldn’t be loaded.'])expect(content()).toContain(label);expect(tree.root.findAllByType(TextInput)).toHaveLength(0);expect(content()).not.toContain('nothing set yet');});

it('retains the ordinary creator grant rule and requires explicit page provenance for page access',async()=>{
 mockCreator.mockResolvedValue({hasEventHostGrant:false});await mount();expect(content()).toContain('Ticket setup isn’t available');expect(mockTiers).not.toHaveBeenCalled();
 mockEntry.mockResolvedValue({kind:'page',pageId:'page'});await act(async()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Try again')!.props.onPress());await settle();await settle();expect(content()).toContain('Add your first ticket');
});

it('retains FAQ values and the same save ID across failure and retry',async()=>{
 mockSaveFaq.mockRejectedValueOnce(Error('lost')).mockResolvedValueOnce({id:'saved'});await mount();
 const fields=tree.root.findAllByType(TextInput);await act(async()=>{fields[0].props.onChangeText('Where do we meet?');fields[1].props.onChangeText('By the pier.');});
 await act(async()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Save FAQ')!.props.onPress());await settle();
 expect(mockSaveFaq).toHaveBeenCalledTimes(1);expect(tree.root.findAllByType(TextInput)[0].props.value).toBe('Where do we meet?');expect(tree.root.findAllByType(TextInput)[0].props.editable).toBe(false);
 await act(async()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Retry FAQ save')!.props.onPress());await settle();
 expect(mockSaveFaq.mock.calls[1]).toEqual(mockSaveFaq.mock.calls[0]);expect(tree.root.findAllByType(TextInput)[0].props.value).toBe('');
});
