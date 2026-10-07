import AsyncStorage from '@react-native-async-storage/async-storage';
const mockSession=jest.fn(),mockInvoke=jest.fn(),mockFrom=jest.fn(),mockRpc=jest.fn(),mockUser=jest.fn();
jest.mock('../supabase',()=>({supabase:{auth:{getSession:()=>mockSession(),getUser:()=>mockUser()},functions:{invoke:(...a:any[])=>mockInvoke(...a)},from:(...a:any[])=>mockFrom(...a),rpc:(...a:any[])=>mockRpc(...a)}}));
import {executeRefund,getRefundAccess,getPurchaseDetail,previewRefund} from '../ticketing';
let current=true;const scope={userId:'creator',isCurrent:()=>current};const headers:any[]=[];
function chain(data:any,error:any=null){const q:any={};for(const key of ['select','eq','maybeSingle'])q[key]=()=>q;q.setHeader=(...a:any[])=>{headers.push(a);return q;};q.then=(a:any,b:any)=>Promise.resolve({data,error}).then(a,b);return q;}
beforeEach(async()=>{await AsyncStorage.clear();jest.clearAllMocks();current=true;headers.length=0;mockSession.mockResolvedValue({data:{session:{user:{id:'creator'},access_token:'isolated-token'}},error:null});mockInvoke.mockResolvedValue({data:{ok:true,allowed:true,refund_amount_cents:2400,position_count:1,positions_voided:1,order_id:'order'},error:null});mockFrom.mockImplementation(()=>chain({host_user_id:'creator'}));});
it('pins preview and refund to the initiating session without changing target',async()=>{const target={kind:'buyer_request' as const,positionIndexes:[2],reason:'Duplicate purchase'};await previewRefund('order',target,scope);await executeRefund('order',target,scope);for(const [i,action] of ['preview','refund'].entries())expect(mockInvoke.mock.calls[i]).toEqual(['ticket-refund',{body:{order_id:'order',action,...(action==='refund'?{client_request_id:expect.any(String)}:{}),kind:'buyer_request',position_indexes:[2],reason:'Duplicate purchase'},headers:{Authorization:'Bearer isolated-token'}}]);});
it('denies a changed account before any refund invocation',async()=>{mockSession.mockResolvedValue({data:{session:{user:{id:'other'},access_token:'other'}}});await expect(executeRefund('order',{},scope)).rejects.toThrow();expect(mockInvoke).not.toHaveBeenCalled();});
it('rejects a retired preview result',async()=>{mockInvoke.mockImplementation(async()=>{current=false;return {data:{ok:true,allowed:true}};});await expect(previewRefund('order',{},scope)).rejects.toThrow();});
it('pins owner/delegate reads and preserves strict authority',async()=>{mockFrom.mockImplementation(()=>chain({host_user_id:'owner'}));mockRpc.mockImplementation(()=>chain(true));expect(await getRefundAccess('event',scope)).toEqual({isOwner:false,isDelegate:true,canRefund:true});expect(headers.every(h=>h[1]==='Bearer isolated-token')).toBe(true);expect(mockRpc).toHaveBeenCalledWith('has_refund_authority',{p_user_id:'creator',p_event_id:'event'});});
it('distinguishes failed authority lookup from denial',async()=>{mockFrom.mockImplementation(()=>chain(null,Error('offline')));await expect(getRefundAccess('event',scope)).rejects.toThrow('could not be checked');});
it('retains original unscoped caller request shape',async()=>{await previewRefund('order');expect(mockInvoke).toHaveBeenCalledWith('ticket-refund',{body:{order_id:'order',action:'preview'}});expect(mockSession).not.toHaveBeenCalled();});

it('rejects a missing or malformed scoped preview instead of reporting unavailable',async()=>{mockInvoke.mockResolvedValue({data:null,error:null});await expect(previewRefund('order',{},scope)).rejects.toThrow('could not be verified');mockInvoke.mockResolvedValue({data:{ok:true,allowed:true,refund_amount_cents:'2400',position_count:1}});await expect(previewRefund('order',{},scope)).rejects.toThrow('could not be verified');});
it('requires the exact order and numeric receipt before scoped success',async()=>{mockInvoke.mockResolvedValue({data:{ok:true,order_id:'other',refund_amount_cents:2400,positions_voided:1}});await expect(executeRefund('order',{},scope)).rejects.toThrow('receipt');});

it('carries the exact reviewed amount and seat count to server confirmation',async()=>{await executeRefund('order',{kind:'buyer_request',positionIndexes:[2],reviewedAmountCents:2400,reviewedPositionCount:1},scope);expect(mockInvoke.mock.calls[0][1].body).toMatchObject({reviewed_amount_cents:2400,reviewed_position_count:1,position_indexes:[2]});});

it('pins purchase reads and distinguishes missing, failed and mismatched results',async()=>{mockFrom.mockImplementation(()=>chain(null));expect(await getPurchaseDetail('order',scope)).toBeNull();mockFrom.mockImplementation(()=>chain(null,Error('offline')));await expect(getPurchaseDetail('order',scope)).rejects.toThrow('could not be loaded');mockFrom.mockImplementation(()=>chain({id:'other',event_id:'event'}));await expect(getPurchaseDetail('order',scope)).rejects.toThrow('verified');expect(headers.every(h=>h[1]==='Bearer isolated-token')).toBe(true);});

it('reads the installed SDK Response error and identifies a confirmed pre-provider refusal',async()=>{
 mockInvoke.mockImplementation(async (_name,options)=>({data:null,error:{message:'Edge Function returned a non-2xx status code',context:{json:async()=>({error:'refund details changed; review the amount again',client_request_id:options.body.client_request_id,order_id:'order',requester_user_id:'creator',request_state:'not-started'})}}}));
 await expect(executeRefund('order',{},scope)).resolves.toMatchObject({ok:false,notStarted:true,message:'The refund details changed. Review the amount before confirming again.'});
});
it('preserves confirmed provider success when recording failed in a Response body',async()=>{
 mockInvoke.mockResolvedValue({data:null,error:{message:'Edge Function returned a non-2xx status code',context:{json:async()=>({error:'refund succeeded at stripe but recording failed'})}}});
 await expect(executeRefund('order',{},scope)).resolves.toEqual({ok:true,refundAmountCents:0,positionsVoided:0,pending:true});
});
it('requires exact request correlation even for a legacy structured refusal',async()=>{
 mockInvoke.mockResolvedValueOnce({data:null,error:{context:{body:JSON.stringify({error:'could not load the payment'})}}});
 await expect(executeRefund('order',{},scope)).resolves.toMatchObject({ok:false});
 mockInvoke.mockResolvedValueOnce({data:null,error:{message:'could not load the payment'}});
 const unknown=await executeRefund('order',{},scope);
 expect(unknown).toMatchObject({ok:false});expect(unknown).not.toHaveProperty('notStarted',true);
});
it.each(['stripe refund failed','another refund on this order is still in progress','refund failed for an unknown reason'])('does not release an uncertain refund from %s',async raw=>{
 mockInvoke.mockResolvedValue({data:null,error:{context:{body:JSON.stringify({error:raw})}}});
 const result=await executeRefund('order',{},scope);
 expect(result).toMatchObject({ok:false});expect(result).not.toHaveProperty('notStarted',true);
 expect(result).not.toHaveProperty('message',expect.stringMatching(/try again|already refunded/));
});
it('retires the outcome when the account changes during error-body reading',async()=>{
 mockInvoke.mockResolvedValue({data:null,error:{context:{json:async()=>{current=false;return {error:'could not load the payment'};}}}});
 await expect(executeRefund('order',{},scope)).rejects.toThrow();
});
it('bounds a stalled error body without treating the request as refused',async()=>{
 jest.useFakeTimers();
 try {
  mockInvoke.mockResolvedValue({data:null,error:{message:'Unconfirmed response',context:{json:()=>new Promise(()=>{})}}});
  const pending=executeRefund('order',{},scope);
  await jest.advanceTimersByTimeAsync(12_001);
  const outcome=await pending;
  expect(outcome).toMatchObject({ok:false});expect(outcome).not.toHaveProperty('notStarted',true);
  expect(jest.getTimerCount()).toBe(0);
 } finally {jest.useRealTimers();}
});
