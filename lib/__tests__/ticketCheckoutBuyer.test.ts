const mockSession=jest.fn(),mockInvoke=jest.fn();
jest.mock('../supabase',()=>({supabase:{auth:{getSession:()=>mockSession()},functions:{invoke:(...args:unknown[])=>mockInvoke(...args)}}}));
import {startTicketCheckout} from '../ticketing';
beforeEach(()=>{jest.clearAllMocks();mockSession.mockResolvedValue({data:{session:{user:{id:'buyer'},access_token:'synthetic-token'}},error:null});mockInvoke.mockResolvedValue({data:{free:true,order_id:'order'},error:null});});
it('pins dispatch to the initiating buyer token and persisted key',async()=>{
 await startTicketCheckout('tier',1,{checkoutKey:'persisted-attempt',buyerUserId:'buyer'});
 expect(mockInvoke).toHaveBeenCalledWith('create-ticket-checkout',expect.objectContaining({headers:{Authorization:'Bearer synthetic-token'},body:expect.objectContaining({checkout_key:'persisted-attempt'})}));
});
it('refuses a mismatched account before checkout dispatch',async()=>{
 const result=await startTicketCheckout('tier',1,{checkoutKey:'persisted-attempt',buyerUserId:'other-buyer'});
 expect(result.kind).toBe('error');expect(mockInvoke).not.toHaveBeenCalled();
});
it('preserves the existing path for legacy callers',async()=>{
 await startTicketCheckout('tier',1);expect(mockSession).not.toHaveBeenCalled();expect(mockInvoke).toHaveBeenCalledTimes(1);
});

it.each([
  ['insufficient availability (0 left)', 'there are not that many tickets left.'],
  ['tickets are not on sale', 'these tickets are not on sale right now.'],
  ['per-order limit exceeded', 'that is more than you can buy in one order.'],
])('reads the current SDK Response and sanitizes %s',async(raw,message)=>{
 mockInvoke.mockResolvedValue({error:{message:'Edge Function returned a non-2xx status code',context:{json:async()=>({error:raw})}}});
 expect(await startTicketCheckout('tier',1)).toEqual({kind:'error',message});
});
it('keeps serialized response adapters compatible',async()=>{
 mockInvoke.mockResolvedValue({error:{context:{body:JSON.stringify({error:'insufficient availability'})}}});
 expect(await startTicketCheckout('tier',1)).toMatchObject({message:'there are not that many tickets left.'});
});
it.each([
 async()=>{throw Error('Body was already consumed');},
 async()=>({error:{detail:'private diagnostic'}}),
 async()=>({error:'Could not find begin_ticket_checkout in schema cache'}),
])('retains safe recovery copy for unreadable or diagnostic errors',async(json)=>{
 mockInvoke.mockResolvedValue({error:{message:'Edge Function returned a non-2xx status code',context:{json}}});
 expect(await startTicketCheckout('tier',1)).toEqual({kind:'error',message:'checkout could not start. give it a moment and try again.'});
});
