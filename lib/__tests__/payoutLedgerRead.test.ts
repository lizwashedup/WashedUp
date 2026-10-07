import {getMyPayoutState,getPayoutSummary,getFailedPayouts,getOrganizationPurchases,getOrganizationReconciliation} from '../ticketing';
const mockResponses=new Map<string,any[]>(),mockHeaders=jest.fn(),mockMoney=jest.fn(),mockAttendees=jest.fn();
jest.mock('../supabase',()=>({supabase:{auth:{getSession:async()=>({data:{session:{user:{id:'owner'},access_token:'fixture-only'}},error:null})},from:(table:string)=>{const q:any={};for(const m of ['select','eq','or','in','order','maybeSingle'])q[m]=()=>q;q.setHeader=(...a:any[])=>{mockHeaders(...a);return q;};q.then=(yes:any,no:any)=>Promise.resolve(mockResponses.get(table)?.shift()??{data:[],error:null}).then(yes,no);return q;}}}));
jest.mock('../ticketAttendees',()=>({getEventMoneySummary:(...a:any[])=>mockMoney(...a),getEventAttendees:(...a:any[])=>mockAttendees(...a),countAttendees:()=>({sold:0}),sumRefundedCentsOnPaidOrders:()=>0}));
const scope={userId:'owner',isCurrent:()=>true};
const failed={data:null,error:new Error('read failed')};
beforeEach(()=>{jest.clearAllMocks();mockResponses.clear();mockMoney.mockResolvedValue({grossFaceCents:0,processingCents:0,commissionCents:0,payoutStatus:null});mockAttendees.mockResolvedValue([]);});
it('distinguishes a failed payout-account lookup from an authoritatively absent account',async()=>{
 mockResponses.set('organizer_stripe_accounts',[failed,{data:null,error:null}]);await expect(getMyPayoutState('owner',scope)).rejects.toThrow('read failed');await expect(getMyPayoutState('owner',scope)).resolves.toMatchObject({exists:false});expect(mockHeaders).toHaveBeenCalledWith('Authorization','Bearer fixture-only');
});
it.each([getPayoutSummary,getFailedPayouts,getOrganizationPurchases,getOrganizationReconciliation])('rejects an unavailable event set instead of manufacturing an empty result (%p)',async read=>{
 mockResponses.set('explore_events',[failed]);await expect(read([],'owner',scope)).rejects.toThrow('read failed');
});
it.each(['ticket_orders','ticket_order_positions'])('rejects partial summary data when %s fails',async table=>{
 mockResponses.set('explore_events',[{data:[{id:'event'}],error:null}]);mockResponses.set('ticket_orders',[{data:[{id:'order',face_cents:100,commission_cents:4,processing_cents:3}],error:null}]);mockResponses.set(table,[failed]);await expect(getPayoutSummary([],'owner',scope)).rejects.toThrow('read failed');
});
it.each([[getFailedPayouts,'ticket_payouts'],[getOrganizationPurchases,'ticket_orders']] as const)('rejects unavailable detail rows (%p)',async(read,table)=>{
 mockResponses.set('explore_events',[{data:[{id:'event',title:'Supper'}],error:null}]);mockResponses.set(table,[failed]);await expect(read([],'owner',scope)).rejects.toThrow('read failed');
});
it('passes the original account scope through each reconciliation child and retains failure',async()=>{
 mockResponses.set('explore_events',[{data:[{id:'event',title:'Supper'}],error:null}]);mockMoney.mockRejectedValue(Error('unavailable money'));await expect(getOrganizationReconciliation([],'owner',scope)).rejects.toThrow('unavailable money');expect(mockMoney).toHaveBeenCalledWith('event',scope);expect(mockAttendees).toHaveBeenCalledWith('event',scope);
});
it.each([getPayoutSummary,getFailedPayouts,getOrganizationPurchases,getOrganizationReconciliation])('retains valid empty-event results (%p)',async read=>{
 mockResponses.set('explore_events',[{data:[],error:null}]);await expect(read([],'owner',scope)).resolves.toBeDefined();
});
