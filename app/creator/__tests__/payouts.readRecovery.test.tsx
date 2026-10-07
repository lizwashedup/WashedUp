import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {Text,TouchableOpacity,Share} from 'react-native';
import GettingPaidScreen from '../payouts';
import {PageFrame} from '../../../components/creator/pages/PageFrame';
import ProfileButton from '../../../components/ProfileButton';
import {PayoutsCard} from '../../../components/creator/PayoutsCard';
const mockPayout=jest.fn(),mockSummary=jest.fn(),mockFailed=jest.fn(),mockReconciliation=jest.fn(),mockPurchases=jest.fn(),mockAccess=jest.fn(),mockOnboard=jest.fn();
const mockBack=jest.fn();let mockCurrent=true;let mockRealScope=false;let mockParams:any={};const mockIdentityCurrent=()=>mockCurrent;let mockScope={userId:'owner',isCurrent:()=>mockCurrent};
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:(id:string)=>mockRealScope?jest.requireActual('../../../hooks/useCreatorPageScope').useCreatorPageScope(id):({scope:mockScope,focused:true,account:{epoch:1,isLoading:false,error:null}})}));
jest.mock('../../../hooks/useObservedUser',()=>({useObservedUser:()=>({viewerId:'owner',epoch:1,isLoading:false,error:null,isCurrent:mockIdentityCurrent})}));
jest.mock('@react-navigation/native',()=>({useIsFocused:()=>true}));
jest.mock('../../../components/ProfileButton',()=>({__esModule:true,default:()=>null}));
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:require('../../../constants/Typography').CreatorFonts})}));
jest.mock('expo-router',()=>({Stack:{Screen:()=>null},router:{back:()=>mockBack(),push:jest.fn(),setParams:jest.fn()},Redirect:()=>null,useLocalSearchParams:()=>mockParams,useFocusEffect:()=>{}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('../../../lib/haptics',()=>({hapticLight:jest.fn()}));
jest.mock('../../../lib/url',()=>({openUrl:jest.fn()}));
jest.mock('../../../lib/creatorMode',()=>({getCreatorAccess:()=>mockAccess(),canManageFinance:()=>true,creatorLandingRoute:()=>'/creator/pages'}));
jest.mock('../../../lib/organizerHome',()=>({failedPayoutLabel:()=> 'Payout needs attention'}));
jest.mock('../../../lib/ticketing',()=>({
 getMyPayoutState:(...a:any[])=>mockPayout(...a),getPayoutSummary:(...a:any[])=>mockSummary(...a),getFailedPayouts:(...a:any[])=>mockFailed(...a),getOrganizationReconciliation:(...a:any[])=>mockReconciliation(...a),getOrganizationPurchases:(...a:any[])=>mockPurchases(...a),
 requestOnboardingLink:()=>mockOnboard(),syncMyPayoutState:jest.fn(),formatCents:(n:number)=>`$${n/100}`,isPayoutReady:(p:any)=>!!p?.payoutsEnabled,
 searchOrganizationPurchases:(p:any[])=>p,purchaseStatusLabel:()=> 'paid',organizationPurchasesToCsv:()=> 'private csv',
}));
jest.mock('../../../components/creator/EarningsSummaryCard',()=>({EarningsSummaryCard:()=>null}));
jest.mock('../../../components/BrandedAlert',()=>({BrandedAlert:()=>null}));
let tree:ReactTestRenderer,client:QueryClient;
const words=()=>tree.root.findAllByType(Text).map(n=>n.props.children).flat(Infinity).join(' ');
const button=(label:string)=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===label)!;
async function flush(){for(let i=0;i<12;i++)await act(async()=>{jest.advanceTimersByTime(1);await Promise.resolve();});}
async function mount(){act(()=>{tree=create(<QueryClientProvider client={client}><GettingPaidScreen/></QueryClientProvider>);});await flush();}
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();mockCurrent=true;mockRealScope=false;mockParams={};mockOnboard.mockResolvedValue({ok:true,url:"https://example.test/fixture-only"});mockScope={userId:'owner',isCurrent:()=>mockCurrent};client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});mockAccess.mockResolvedValue({hasEventHostGrant:true,ledCommunities:[]});mockPayout.mockReset().mockResolvedValue({exists:false,requirementsDue:[],commissionBps:400});mockSummary.mockReset().mockResolvedValue({});mockFailed.mockReset().mockResolvedValue([]);mockReconciliation.mockReset().mockResolvedValue({rows:[]});mockPurchases.mockReset().mockResolvedValue([]);});
afterEach(()=>{act(()=>tree?.unmount());client.clear();jest.useRealTimers();jest.restoreAllMocks();});
it('shows an initial payout read failure instead of setup or a permanent spinner; explicit retry restores setup',async()=>{
 mockPayout.mockRejectedValue(Error('offline'));await mount();expect(words()).toContain('Couldn’t load payout setup.');expect(words()).not.toContain('checking payout setup');expect(tree.root.findAllByType(PayoutsCard)).toHaveLength(0);expect(mockOnboard).not.toHaveBeenCalled();
 mockPayout.mockResolvedValue({exists:false,requirementsDue:[],commissionBps:400});act(()=>button('Retry payout setup').props.onPress());await flush();expect(words()).toContain('Set up payouts');expect(mockPayout).toHaveBeenCalledTimes(2);
});
it.each(['summary','failed','reconciliation','purchases'])('does not turn a failed %s read into a confirmed empty ledger and restores it explicitly',async key=>{
 const failures:any={summary:[mockSummary,'earnings summary'],failed:[mockFailed,'payout issues'],reconciliation:[mockReconciliation,'event breakdown'],purchases:[mockPurchases,'purchases']};const [read,label]=failures[key];read.mockRejectedValue(Error('offline'));await mount();expect(words()).toContain(`Couldn’t load ${label}.`);if(key==='purchases')expect(words()).not.toContain('Nothing sold yet');
 read.mockResolvedValue(key==='summary'?{}:key==='reconciliation'?{rows:[]}:[]);act(()=>button(`Retry ${label}`).props.onPress());await flush();expect(words()).not.toContain(`Couldn’t load ${label}.`);expect(read).toHaveBeenCalledTimes(2);
});
it('bounds a stalled read and rejects a late success after retry has recovered',async()=>{
 let resolve!:(v:any)=>void;mockPayout.mockReturnValue(new Promise(r=>{resolve=r;}));await mount();const owned=mockPayout.mock.calls[0][1];expect(owned.isCurrent()).toBe(true);await act(async()=>{jest.advanceTimersByTime(12000);});await flush();expect(owned.isCurrent()).toBe(false);expect(words()).toContain('Couldn’t load payout setup.');mockPayout.mockResolvedValue({exists:false,requirementsDue:[],commissionBps:400});act(()=>button('Retry payout setup').props.onPress());await flush();resolve({exists:true,payoutsEnabled:true,commissionBps:400});await flush();expect(words()).toContain('Set up payouts');expect(words()).not.toContain('Payouts are set up');
});
it('hides failed-refresh purchases and refuses the retained export callback',async()=>{
 mockPurchases.mockResolvedValue([{orderId:'order',eventId:'event',eventTitle:'Supper',buyerName:'Juniper',qty:1,totalCents:100,status:'paid',purchasedAt:'2026-09-20'}]);const share=jest.spyOn(Share,'share').mockResolvedValue({action:Share.sharedAction});await mount();const exportRows=button('export purchases').props.onPress;expect(words()).toContain('Juniper');mockPurchases.mockRejectedValue(Error('offline'));await act(async()=>{await client.invalidateQueries({queryKey:['ledger-purchases']});});await flush();expect(words()).not.toContain('Juniper');expect(words()).not.toContain('Nothing sold yet');await act(async()=>{await exportRows();});expect(share).not.toHaveBeenCalled();
});
it('retires read retry and setup callbacks with their visit',async()=>{
 mockPayout.mockRejectedValue(Error('offline'));await mount();const retry=button('Retry payout setup').props.onPress;const count=mockPayout.mock.calls.length;mockCurrent=false;act(()=>retry());await flush();expect(mockPayout).toHaveBeenCalledTimes(count);expect(mockOnboard).not.toHaveBeenCalled();
});

it('starts the first reads with the actual creator scope after its mount effect',async()=>{
 mockRealScope=true;await mount();expect(mockPayout).toHaveBeenCalledTimes(1);expect(mockPurchases).toHaveBeenCalledTimes(1);expect(words()).toContain('Nothing sold yet');
});
it('shows unavailable access without starting financial readers when permission resolves absent',async()=>{
 mockAccess.mockResolvedValue(null);await mount();expect(words()).toContain('Payout tools aren’t available');expect(mockPurchases).not.toHaveBeenCalled();
});
it('coalesces repeated explicit retry while the same read is pending',async()=>{
 mockPayout.mockRejectedValue(Error('offline'));await mount();mockPayout.mockImplementation(()=>new Promise(()=>{}));const retry=button('Retry payout setup').props.onPress;act(()=>{retry();retry();});await flush();expect(mockPayout).toHaveBeenCalledTimes(2);
});

it('preserves the expired Stripe-link refresh entry, waiting for confirmed read state and invoking once',async()=>{
 mockParams={stripe:'refresh'};let resolve!:(v:any)=>void;mockPayout.mockReturnValue(new Promise(r=>{resolve=r;}));await mount();expect(mockOnboard).not.toHaveBeenCalled();resolve({exists:false,requirementsDue:[],commissionBps:400});await flush();expect(mockOnboard).toHaveBeenCalledTimes(1);
});
it('refuses a previously retained setup callback after payout refresh fails',async()=>{
 await mount();const setup=tree.root.findByType(PayoutsCard).props.onOnboard;mockPayout.mockRejectedValue(Error('offline'));await act(async()=>{await client.invalidateQueries({queryKey:['payout-state']});});await flush();await act(async()=>{await setup();});expect(mockOnboard).not.toHaveBeenCalled();
});

it.each([false,true])('uses the existing creator frame and Profile during ready/error state (%s)',async error=>{
 if(error)mockAccess.mockRejectedValue(Error('offline'));await mount();expect(tree.root.findByType(PageFrame).props.title).toBe('Getting paid');expect(tree.root.findByType(ProfileButton).props.compact).toBe(true);act(()=>tree.root.findByType(PageFrame).props.onBack());expect(mockBack).toHaveBeenCalledTimes(1);
});
it('labels the account-wide reconciliation Overall total without changing its amount',async()=>{
 mockReconciliation.mockResolvedValue({rows:[{eventId:'event',eventTitle:'Supper',netToYouCents:100,ticketsSold:1,grossFaceCents:110,commissionCents:10,refundedCents:0}],totals:{netToYouCents:100}});await mount();expect(words()).toContain('Overall total');expect(words()).not.toContain('organization total');expect(words()).toContain('$1');
});
