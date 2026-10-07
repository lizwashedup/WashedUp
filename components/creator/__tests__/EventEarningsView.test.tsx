import React from 'react';
import {create,act,type ReactTestRenderer} from 'react-test-renderer';
import {EventEarningsView,earningsStatus} from '../EventEarningsView';
import {PageAction} from '../pages/PageFrame';
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:{regular:'System',medium:'System',display:'System'}})}));
jest.mock('../../../lib/ticketing',()=>({formatCents:(c:number)=>`$${(c/100).toFixed(2)}`,isPayoutReady:(p:any)=>!!p?.chargesEnabled&&!!p?.payoutsEnabled}));
jest.mock('expo-router',()=>({Stack:{Screen:()=>null},router:{}}));
const base:any={event:{title:'Sunday table',event_date:'2026-09-20',start_time:null},money:{grossFaceCents:10000,commissionCents:400,processingCents:500,payoutStatus:null,payoutPaidAt:null,payoutReleasedAt:null},ticketsSold:3,refundedCents:0,isPayee:true,setupError:false,payout:{exists:false,requirementsDue:[],detailsSubmitted:false,chargesEnabled:false,payoutsEnabled:false}};
let tree:ReactTestRenderer;const setup=jest.fn(),support=jest.fn(),refresh=jest.fn();
const action=(t:string)=>tree.root.findAllByType(PageAction).find(n=>n.props.title===t);
function mount(data=base){act(()=>{tree=create(<EventEarningsView data={data} disabled={false} onSetup={setup} onSupport={support} onRefresh={refresh}/>);});}
afterEach(()=>{act(()=>tree?.unmount());jest.clearAllMocks();});
it('shows net sales without promising a bank arrival date and provides a setup path',()=>{mount();const text=JSON.stringify(tree.toJSON());expect(text).toContain('$96.00');expect(text).toContain('A bank arrival date has not been confirmed');act(()=>action('Complete payout setup')!.props.onPress());expect(setup).toHaveBeenCalledTimes(1);});
it('lists the actual outstanding requirements',()=>{mount({...base,payout:{...base.payout,exists:true,requirementsDue:['a bank account for payouts']}});expect(JSON.stringify(tree.toJSON())).toContain('a bank account for payouts');expect(action('Complete payout setup')).toBeDefined();});
it('a submitted account with no outstanding items gets a status check instead of repeating onboarding',()=>{mount({...base,payout:{...base.payout,exists:true,detailsSubmitted:true}});expect(action('Complete payout setup')).toBeUndefined();act(()=>action('Check for updates')!.props.onPress());expect(refresh).toHaveBeenCalledTimes(1);});
it('a ready account with a released payout is not told to repeat setup for an arrival date',()=>{mount({...base,payout:{...base.payout,chargesEnabled:true,payoutsEnabled:true},money:{...base.money,payoutStatus:'released',payoutReleasedAt:'2026-09-21T18:00:00Z'}});expect(action('Complete payout setup')).toBeUndefined();expect(action('Payout settings')).toBeDefined();expect(JSON.stringify(tree.toJSON())).toContain('You don’t need to repeat setup');});
it('teammates get help without a link to change the recipient’s bank details',()=>{mount({...base,isPayee:false,payout:undefined});expect(action('Payout settings')).toBeUndefined();expect(action('Complete payout setup')).toBeUndefined();act(()=>action('Get payout help')!.props.onPress());expect(support).toHaveBeenCalledTimes(1);});
it('failure wins over older released and paid timestamps',()=>{expect(earningsStatus({...base.money,payoutStatus:'failed',payoutPaidAt:'2026-09-20',payoutReleasedAt:'2026-09-19'})).toBe('Payout needs attention');});
