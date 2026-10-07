const mockStored = new Map<string,string>();
const mockGet = jest.fn(async (key:string) => mockStored.get(key) ?? null);
const mockSet = jest.fn(async (key:string,value:string) => {mockStored.set(key,value);});
const mockRemove = jest.fn(async (key:string) => {mockStored.delete(key);});
const mockInvoke = jest.fn(), mockSession = jest.fn();
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{getItem:(key:string)=>mockGet(key),setItem:(key:string,value:string)=>mockSet(key,value),removeItem:(key:string)=>mockRemove(key)}}));
jest.mock('../supabase',()=>({supabase:{auth:{getSession:()=>mockSession()},functions:{invoke:(...args:any[])=>mockInvoke(...args)}}}));
function freshClient(): typeof import('../ticketing') {let client:any;jest.isolateModules(()=>{client=require('../ticketing');});return client;}
const owner=()=>({userId:'buyer',isCurrent:()=>true});
const success={data:{ok:true,order_id:'order',refund_amount_cents:1200,positions_voided:1},error:null};
const eligibility={data:{ok:true,allowed:true,can_self_refund:true,refund_amount_cents:1200,position_count:1},error:null};
beforeEach(()=>{
 jest.clearAllMocks();mockStored.clear();
 mockGet.mockImplementation(async key=>mockStored.get(key)??null);
 mockSet.mockImplementation(async(key,value)=>{mockStored.set(key,value);});
 mockRemove.mockImplementation(async key=>{mockStored.delete(key);});
 mockSession.mockResolvedValue({data:{session:{user:{id:'buyer'},access_token:'fixture-token'}},error:null});
 mockInvoke.mockResolvedValue(success);
});
it('does not dispatch an unknown refund again after the client module is recreated',async()=>{
 mockInvoke.mockResolvedValueOnce({data:null,error:{message:'connection lost'}});
 expect(await freshClient().executeRefund('order',{},owner())).toMatchObject({ok:false});
 expect(await freshClient().executeRefund('order',{},owner())).toMatchObject({ok:false});
 expect(mockInvoke).toHaveBeenCalledTimes(1);
});
it('keeps paid/eligible preview separate from an unresolved saved refund',async()=>{
 mockInvoke.mockResolvedValueOnce({data:null,error:{message:'connection lost'}});
 await freshClient().executeRefund('order',{},owner());
 mockInvoke.mockResolvedValueOnce(eligibility);
 expect(await freshClient().previewRefund('order',{},owner())).toMatchObject({allowed:true,canSelfRefund:true,pendingAttempt:'unknown'});
});
it('does not claim a whole-purchase refund succeeded from a prior recording-pending seat refund after restart',async()=>{
 mockInvoke.mockResolvedValueOnce({data:null,error:{context:{body:JSON.stringify({error:'refund succeeded at stripe but recording failed'})}}});
 expect(await freshClient().executeRefund('order',{positionIndexes:[1]},owner())).toMatchObject({ok:true,pending:true});
 expect(await freshClient().executeRefund('order',{kind:'organizer_cancel',positionIndexes:null},owner())).toMatchObject({ok:false,message:expect.stringContaining('earlier refund')});
 expect(mockInvoke).toHaveBeenCalledTimes(1);
 mockInvoke.mockResolvedValueOnce(eligibility);
 expect(await freshClient().previewRefund('order',{},owner())).toMatchObject({pendingAttempt:'confirmed'});
});
it('does not dispatch if the original attempt cannot be saved',async()=>{
 mockSet.mockRejectedValueOnce(Error('storage unavailable'));
 await expect(freshClient().executeRefund('order',{},owner())).resolves.toMatchObject({ok:false,notStarted:true});
 expect(mockInvoke).not.toHaveBeenCalled();
});
it('settles an exact full receipt so a separately confirmed different seat can be requested',async()=>{
 const client=freshClient();await client.executeRefund('order',{positionIndexes:[1]},owner());
 await freshClient().executeRefund('order',{positionIndexes:[2]},owner());
 expect(mockInvoke).toHaveBeenCalledTimes(2);expect(JSON.parse([...mockStored.values()][0]).state).toBe('complete');
});
it('retires an exact pre-provider refusal while retaining transport ambiguity',async()=>{
 mockInvoke.mockImplementationOnce(async (_name,options)=>({data:null,error:{context:{body:JSON.stringify({error:'refund details changed; review the amount again',client_request_id:options.body.client_request_id,order_id:'order',requester_user_id:'buyer',request_state:'not-started'})}}}));
 expect(await freshClient().executeRefund('order',{},owner())).toMatchObject({ok:false,notStarted:true});
 await freshClient().executeRefund('order',{},owner());expect(mockInvoke).toHaveBeenCalledTimes(2);
});
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};};
const flush=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
it('blocks overlapping seat and whole-purchase attempts while the first response is pending',async()=>{
 const reply=deferred<any>();mockInvoke.mockReturnValueOnce(reply.promise);const client=freshClient();
 const first=client.executeRefund('order',{positionIndexes:[1]},owner());await flush();
 expect(await client.executeRefund('order',{positionIndexes:null},owner())).toMatchObject({ok:false});
 expect(await freshClient().executeRefund('order',{positionIndexes:[2]},owner())).toMatchObject({ok:false});
 expect(mockInvoke).toHaveBeenCalledTimes(1);reply.resolve(success);await first;
});
it('never dispatches a saved attempt whose screen retired during storage',async()=>{
 const saved=deferred<void>();let current=true;
 mockSet.mockImplementationOnce(async(key,value)=>{await saved.promise;mockStored.set(key,value);});
 const pending=freshClient().executeRefund('order',{}, {userId:'buyer',isCurrent:()=>current});
 const result=expect(pending).rejects.toThrow();await flush();current=false;saved.resolve();await result;
 expect(mockInvoke).not.toHaveBeenCalled();expect(mockStored.size).toBe(0);
});
it('bounds stalled storage and cleans its late unsent record without dispatch',async()=>{
 jest.useFakeTimers();
 try{
  const saved=deferred<void>();mockSet.mockImplementationOnce(async(key,value)=>{await saved.promise;mockStored.set(key,value);});
  const pending=freshClient().executeRefund('order',{},owner());const result=expect(pending).resolves.toMatchObject({ok:false,notStarted:true});
  await jest.advanceTimersByTimeAsync(12_001);await result;expect(mockInvoke).not.toHaveBeenCalled();
  saved.resolve();await flush();expect(mockStored.size).toBe(0);expect(mockInvoke).not.toHaveBeenCalled();
 }finally{jest.useRealTimers();}
});
it('settles a late exact receipt for its original account without returning to a retired screen',async()=>{
 let current=true;const reply=deferred<any>();mockInvoke.mockReturnValueOnce(reply.promise);
 const pending=freshClient().executeRefund('order',{}, {userId:'buyer',isCurrent:()=>current});
 const result=expect(pending).rejects.toThrow();await flush();current=false;reply.resolve(success);await result;
 expect(JSON.parse([...mockStored.values()][0]).state).toBe('complete');mockInvoke.mockResolvedValueOnce(eligibility);
 expect(await freshClient().previewRefund('order',{},owner())).not.toHaveProperty('pendingAttempt');
});
it('retains ambiguity from a mismatched receipt instead of authorizing another dispatch',async()=>{
 mockInvoke.mockResolvedValueOnce({data:{...success.data,order_id:'different'},error:null});
 await expect(freshClient().executeRefund('order',{},owner())).rejects.toThrow('receipt');
 expect(await freshClient().executeRefund('order',{},owner())).toMatchObject({ok:false});expect(mockInvoke).toHaveBeenCalledTimes(1);
});
it('does not treat a corrupt saved attempt as permission for another refund',async()=>{
 mockStored.set('ticket-refund-attempt:v1:buyer:order','{broken');
 await expect(freshClient().executeRefund('order',{},owner())).resolves.toMatchObject({ok:false,notStarted:true});
 expect(mockInvoke).not.toHaveBeenCalled();
 mockInvoke.mockResolvedValueOnce(eligibility);
 await expect(freshClient().previewRefund('order',{},owner())).rejects.toThrow('could not be checked');
});
it('does not share or clear the original buyer barrier when another account reviews the same order',async()=>{
 mockInvoke.mockResolvedValueOnce({data:null,error:{message:'connection lost'}});await freshClient().executeRefund('order',{},owner());
 mockSession.mockResolvedValue({data:{session:{user:{id:'other'},access_token:'other-token'}},error:null});
 await freshClient().executeRefund('order',{}, {userId:'other',isCurrent:()=>true});
 expect(mockInvoke).toHaveBeenCalledTimes(2);expect(mockStored.size).toBe(2);
 mockSession.mockResolvedValue({data:{session:{user:{id:'buyer'},access_token:'fixture-token'}},error:null});
 expect(await freshClient().executeRefund('order',{},owner())).toMatchObject({ok:false});expect(mockInvoke).toHaveBeenCalledTimes(2);
});
it('cleans only its exact original saved attempt when a delayed receipt arrives',async()=>{
 const reply=deferred<any>();mockInvoke.mockReturnValueOnce(reply.promise);
 const pending=freshClient().executeRefund('order',{},owner());await flush();
 const key='ticket-refund-attempt:v1:buyer:order',saved=JSON.parse(mockStored.get(key)!);
 mockStored.set(key,JSON.stringify({...saved,id:'newer-attempt'}));reply.resolve(success);await pending;
 expect(JSON.parse(mockStored.get(key)!).id).toBe('newer-attempt');
});

describe('exact saved request status',()=>{
 const key='ticket-refund-attempt:v1:buyer:order';
 const stored=()=>JSON.parse(mockStored.get(key)!);
 async function unknown(){mockInvoke.mockResolvedValueOnce({data:null,error:{message:'lost'}});const client=freshClient();await client.executeRefund('order',{},owner());return client;}
 function status(state:string,extra:Record<string,unknown>={}) {mockInvoke.mockImplementation(async(name,options)=>{
  expect(name).toBe('ticket-refund-status');expect(options.body).toEqual({order_id:'order',client_request_id:stored().id});
  return {data:{ok:true,order_id:'order',client_request_id:options.body.client_request_id,requester_user_id:'buyer',state,...extra},error:null};
 });}
 it('reads a lost exact partial receipt without refund execution and retains it through later checks/restart',async()=>{
  const client=await unknown(),id=stored().id;status('complete',{refund_amount_cents:1200,positions_voided:1});
  const result=await client.checkRefundAttempt('order',owner());expect(result).toMatchObject({state:'complete',refundAmountCents:1200,positionsVoided:1});expect(result.isCurrent?.()).toBe(true);
  expect(stored()).toMatchObject({id,state:'complete'});const calls=mockInvoke.mock.calls.length;
  expect(await freshClient().checkRefundAttempt('order',owner())).toMatchObject({state:'complete',refundAmountCents:1200});expect(mockInvoke).toHaveBeenCalledTimes(calls);
  expect(mockInvoke.mock.calls.filter(([name])=>name==='ticket-refund')).toHaveLength(1);
 });
 it.each(['unknown','missing-endpoint'])('does not release from %s and never sends status to the executing endpoint',async kind=>{
  const client=await unknown();if(kind==='unknown')status('unknown');else mockInvoke.mockResolvedValue({data:null,error:{message:'function not found'}});
  expect(await client.checkRefundAttempt('order',owner())).toMatchObject({state:'unknown'});expect(await client.executeRefund('order',{},owner())).toMatchObject({ok:false});
  expect(mockInvoke.mock.calls.map(([name])=>name)).toEqual(['ticket-refund','ticket-refund-status']);
 });
 it.each(['order','requester','request','amount'])('rejects a mismatched %s receipt',async kind=>{
  const client=await unknown();const extra:any={refund_amount_cents:1200,positions_voided:1};if(kind==='order')extra.order_id='other';if(kind==='requester')extra.requester_user_id='other';if(kind==='request')extra.client_request_id='other';if(kind==='amount')extra.refund_amount_cents='1200';status('complete',extra);
  expect(await client.checkRefundAttempt('order',owner())).toMatchObject({state:'unknown'});expect(stored().state).toBe('unknown');
 });
 it('returns a verified saved refusal repeatedly before a separate new confirmation replaces its ID',async()=>{
  const client=await unknown(),id=stored().id;status('not-started');expect(await client.checkRefundAttempt('order',owner())).toMatchObject({state:'not-started'});
  expect(await freshClient().checkRefundAttempt('order',owner())).toMatchObject({state:'not-started'});mockInvoke.mockResolvedValue(success);
  await client.executeRefund('order',{positionIndexes:[2]},owner());expect(stored().id).not.toBe(id);expect(mockInvoke.mock.calls.at(-1)[1].body.client_request_id).toBe(stored().id);
 });
 it('does not downgrade known provider confirmation when server record is missing or refused',async()=>{
  const client=await unknown();status('confirmed');await client.checkRefundAttempt('order',owner());status('not-started');expect(await client.checkRefundAttempt('order',owner())).toMatchObject({state:'confirmed'});
  status('unknown');expect(await client.checkRefundAttempt('order',owner())).toMatchObject({state:'confirmed'});
 });
 it('invalidates a cached terminal receipt before a newly confirmed same-order storage write completes',async()=>{
  const client=freshClient();await client.executeRefund('order',{},owner());const receipt=await client.checkRefundAttempt('order',owner());expect(receipt.isCurrent?.()).toBe(true);
  const write=deferred<void>();mockSet.mockImplementationOnce(async(k,v)=>{await write.promise;mockStored.set(k,v);});const newer=client.executeRefund('order',{positionIndexes:[2]},owner());await flush();expect(receipt.isCurrent?.()).toBe(false);write.resolve();await newer;
 });
 it('rejects a late status for an older request after a newer marker replaces it',async()=>{
  const client=await unknown(),id=stored().id;const response=deferred<any>();mockInvoke.mockReturnValueOnce(response.promise);const checking=client.checkRefundAttempt('order',owner());const result=expect(checking).rejects.toThrow('attempt changed');await flush();mockStored.set(key,JSON.stringify({...stored(),id:'newer-request'}));response.resolve({data:{ok:true,order_id:'order',client_request_id:id,requester_user_id:'buyer',state:'complete',refund_amount_cents:1200,positions_voided:1},error:null});await result;expect(stored().id).toBe('newer-request');expect(stored().state).toBe('unknown');
 });
 it('does not accept an early raw duplicate refusal as proof the original request never dispatched',async()=>{
  mockInvoke.mockResolvedValue({data:null,error:{context:{json:async()=>({error:'not your order'})}}});const client=freshClient();const result=await client.executeRefund('order',{},owner());expect(result).toMatchObject({ok:false});expect(result).not.toHaveProperty('notStarted');expect(stored().state).toBe('unknown');expect(await client.executeRefund('order',{},owner())).toMatchObject({ok:false});expect(mockInvoke).toHaveBeenCalledTimes(1);
 });
 it('bounds a stalled read-only status without releasing its original attempt',async()=>{
  jest.useFakeTimers();try{const client=await unknown();mockInvoke.mockReturnValue(new Promise(()=>{}));const pending=client.checkRefundAttempt('order',owner());await jest.advanceTimersByTimeAsync(12_001);expect(await pending).toMatchObject({state:'unknown'});expect(stored().state).toBe('unknown');expect(jest.getTimerCount()).toBe(0);}finally{jest.useRealTimers();}
 });
});

describe('reviewed refund target continuity',()=>{
 const saved=()=>JSON.parse([...mockStored.values()][0]);
 it('attributes a newer multi-seat receipt to its saved request and target after restart',async()=>{
  const client=freshClient();
  await client.executeRefund('order',{positionIndexes:[1],reviewedPositionCount:1},owner());
  const first=await client.checkRefundAttempt('order',owner());
  expect(first).toMatchObject({requestId:saved().id,target:{positionIndexes:[1],reviewedPositionCount:1}});
  mockInvoke.mockResolvedValueOnce({data:{...success.data,refund_amount_cents:2400,positions_voided:2},error:null});
  await client.executeRefund('order',{positionIndexes:[2,3],reviewedPositionCount:2},owner());
  expect(first.isCurrent?.()).toBe(false);
  expect(await freshClient().checkRefundAttempt('order',owner())).toMatchObject({requestId:saved().id,state:'complete',positionsVoided:2,target:{positionIndexes:[2,3],reviewedPositionCount:2}});
 });
 it('retains a whole remaining purchase target through an unknown result and restart',async()=>{
  mockInvoke.mockResolvedValue({data:null,error:{message:'lost'}});
  await freshClient().executeRefund('order',{reviewedPositionCount:2},owner());
  expect(saved().target).toEqual({positionIndexes:null,reviewedPositionCount:2});
  expect(await freshClient().checkRefundAttempt('order',owner())).toMatchObject({state:'unknown',requestId:saved().id,target:saved().target});
 });
 it('keeps metadata-free version1 records readable without inventing a target',async()=>{
  const client=freshClient();await client.executeRefund('order',{},owner());
  expect(await freshClient().checkRefundAttempt('order',owner())).toMatchObject({state:'complete'});
  expect(await client.checkRefundAttempt('order',owner())).not.toHaveProperty('target');
 });
 it.each([{indexes:[0]},{indexes:[1,1]}])('rejects invalid target indexes $indexes before dispatch',async({indexes})=>{
  expect(await freshClient().executeRefund('order',{positionIndexes:indexes,reviewedPositionCount:indexes.length},owner())).toMatchObject({ok:false,notStarted:true});
  expect(mockInvoke).not.toHaveBeenCalled();
 });
 it('does not expose a completed receipt with corrupted target metadata',async()=>{
  const client=freshClient();await client.executeRefund('order',{positionIndexes:[1],reviewedPositionCount:1},owner());
  const [key]=mockStored.keys();mockStored.set(key,JSON.stringify({...saved(),target:{positionIndexes:[1],reviewedPositionCount:2}}));
  await expect(client.checkRefundAttempt('order',owner())).rejects.toThrow('could not be checked');
 });
 it('snapshots target values before storage and authentication can yield',async()=>{
  const storage=deferred<string|null>();mockGet.mockReturnValueOnce(storage.promise);
  const target={positionIndexes:[1],reviewedPositionCount:1,reviewedAmountCents:1200,reason:'original'};
  const pending=freshClient().executeRefund('order',target,owner());await flush();
  target.positionIndexes[0]=3;target.reviewedPositionCount=2;target.reviewedAmountCents=2400;target.reason='changed';
  storage.resolve(null);await pending;
  expect(saved().target).toEqual({positionIndexes:[1],reviewedPositionCount:1});
  expect(mockInvoke.mock.calls[0][1].body).toMatchObject({position_indexes:[1],reviewed_position_count:1,reviewed_amount_cents:1200,reason:'original'});
 });
});
