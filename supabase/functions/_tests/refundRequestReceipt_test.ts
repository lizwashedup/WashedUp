import { beginRefundRequest, readRefundRequestStatus, recordRefundRequestOutcome, refundRequestTargetHash } from '../_shared/refundRequestReceipt.ts';
const assert = (value: unknown, message='assertion failed') => { if (!value) throw new Error(message); };
const equal = (a:unknown,b:unknown) => assert(JSON.stringify(a)===JSON.stringify(b),`${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const identity={requestId:'req',orderId:'order',requesterId:'creator'};
function fake() {
 const rows=new Map<string,any[]>();const operations:any[]=[];let authority=false,hangInsert=false,hangUpdate=false,failInsert=false;
 rows.set('ticket_orders',[{id:'order',buyer_user_id:'buyer',event_id:'event',explore_events:{host_user_id:'creator',community_id:null}}]);
 rows.set('ticket_refund_requests',[]);rows.set('ticket_refunds',[]);rows.set('ticket_order_positions',[]);
 const service:any={rpc:async(name:string,args:any)=>{operations.push({rpc:name,args});return{data:authority,error:null};},from:(table:string)=>{
  const filters:((r:any)=>boolean)[]=[];let mode='select',payload:any,head=false;const query:any={};
  query.select=(_columns:string,options:any={})=>{head=options.head===true;return query;};
  query.eq=(column:string,value:any)=>{filters.push(r=>r[column]===value);return query;};
  query.in=(column:string,value:any[])=>{filters.push(r=>value.includes(r[column]));return query;};
  query.not=(column:string,_is:string,_null:any)=>{filters.push(r=>r[column]!=null);return query;};
  query.maybeSingle=()=>query;
  query.insert=(value:any)=>{mode='insert';payload=value;return query;};query.update=(value:any)=>{mode='update';payload=value;return query;};
  query.then=(yes:any,no:any)=>Promise.resolve().then(()=>{
   operations.push({table,mode,payload});
   if ((mode==='insert'&&hangInsert)||(mode==='update'&&hangUpdate))return new Promise(()=>{});
   const data=rows.get(table)??[];
   if(mode==='insert') {if(failInsert)return{error:{code:'offline'}};if(data.some(r=>r.request_id===payload.request_id))return{error:{code:'23505'}};data.push({...payload});return{error:null};}
   const selected=data.filter(r=>filters.every(filter=>filter(r)));
   if(mode==='update'){selected.forEach(r=>Object.assign(r,payload));return{error:null};}
   return head?{count:selected.length,error:null}:{data:selected[0]??null,error:null};
  }).then(yes,no);return query;
 }};
 return{service,rows,operations,setAuthority:(v:boolean)=>authority=v,setHangInsert:()=>hangInsert=true,setHangUpdate:()=>hangUpdate=true,setFailInsert:()=>failInsert=true};
}
const target={kind:'buyer_request',positions:[2,1],reason:'Duplicate',reviewedAmount:2400,reviewedCount:2};
Deno.test('target correlation normalizes seats but separates kind, reason and reviewed amount',async()=>{
 const hash=await refundRequestTargetHash(target);equal(hash,await refundRequestTargetHash({...target,positions:[1,2,1]}));
 for(const changed of [{kind:'organizer_cancel'},{positions:null},{reason:'Other'},{reviewedAmount:1200}])assert(hash!==await refundRequestTargetHash({...target,...changed}));
});
Deno.test('only first original request acquires journal; duplicate and changed target do not modify it',async()=>{
 const f=fake();equal(await beginRefundRequest(f.service,identity,'hash'),'started');equal(await beginRefundRequest(f.service,identity,'hash'),'duplicate');equal(await beginRefundRequest(f.service,identity,'different'),'conflict');equal(f.rows.get('ticket_refund_requests')?.[0].state,'pending');equal(f.rows.get('ticket_refund_requests')?.length,1);
});
Deno.test('journal preparation failure cannot authorize dispatch',async()=>{const f=fake();f.setFailInsert();equal(await beginRefundRequest(f.service,identity,'hash'),'unavailable');});
Deno.test('exact owned refusal records not-started; ambiguous provider result remains pending',async()=>{
 const f=fake();await beginRefundRequest(f.service,identity,'hash');await recordRefundRequestOutcome(f.service,identity,true,{error:'connection lost'});equal(f.rows.get('ticket_refund_requests')?.[0].state,'pending');await recordRefundRequestOutcome(f.service,identity,false,{error:'reviewed amount changed'});equal((await readRefundRequestStatus(f.service,identity)).body.state,'not-started');
});
Deno.test('confirmed receipt cannot be downgraded by a late pre-dispatch update',async()=>{const f=fake();await beginRefundRequest(f.service,identity,'hash');await recordRefundRequestOutcome(f.service,identity,true,{stripe_refund_id:'re_1'});await recordRefundRequestOutcome(f.service,identity,false,{error:'stale'});equal((await readRefundRequestStatus(f.service,identity)).body.state,'confirmed');});
Deno.test('complete receipt remains readable after order is refunded and exact complete cannot downgrade',async()=>{
 const f=fake();await beginRefundRequest(f.service,identity,'hash');await recordRefundRequestOutcome(f.service,identity,true,{ok:true,order_id:'order',stripe_refund_id:'re_1',refund_amount_cents:1200,positions_voided:1});
 f.rows.get('ticket_orders')![0].status='refunded';await recordRefundRequestOutcome(f.service,identity,true,{stripe_refund_id:'re_1'});const result=await readRefundRequestStatus(f.service,identity);equal(result.status,200);equal(result.body.state,'complete');equal(result.body.refund_amount_cents,1200);equal(result.body.positions_voided,1);
});
Deno.test('current buyer and community owner can read only their own original request',async()=>{
 const f=fake();const buyer={...identity,requesterId:'buyer'};await beginRefundRequest(f.service,buyer,'hash');await recordRefundRequestOutcome(f.service,buyer,false,{error:'refused'});equal((await readRefundRequestStatus(f.service,buyer)).body.state,'not-started');equal((await readRefundRequestStatus(f.service,identity)).body.state,'unknown');
 f.rows.get('ticket_orders')![0].explore_events={host_user_id:null,community_id:'community'};f.rows.set('communities',[{id:'community',created_by:'creator'}]);equal((await readRefundRequestStatus(f.service,identity)).status,200);
});
Deno.test('revoked delegate cannot read old receipt; reinstated exact delegate can',async()=>{
 const f=fake(),delegate={...identity,requesterId:'delegate'};await beginRefundRequest(f.service,delegate,'hash');f.setAuthority(true);equal((await readRefundRequestStatus(f.service,delegate)).status,200);f.setAuthority(false);equal((await readRefundRequestStatus(f.service,delegate)).status,403);
});
Deno.test('different order/request/account cannot acquire someone else’s result',async()=>{
 const f=fake();await beginRefundRequest(f.service,identity,'hash');await recordRefundRequestOutcome(f.service,identity,true,{ok:true,order_id:'order',stripe_refund_id:'re_1',refund_amount_cents:1200,positions_voided:1});
 equal((await readRefundRequestStatus(f.service,{...identity,orderId:'other'})).status,403);equal((await readRefundRequestStatus(f.service,{...identity,requestId:'other'})).body.state,'unknown');equal((await readRefundRequestStatus(f.service,{...identity,requesterId:'other'})).status,403);
});
Deno.test('missing exact journal entry remains unknown despite paid eligibility',async()=>{const f=fake();equal((await readRefundRequestStatus(f.service,identity)).body.state,'unknown');assert(f.operations.every(op=>op.mode===undefined||op.mode==='select'));});
Deno.test('confirmed request reconciles only against its exact recorded ledger and voided seats',async()=>{
 const f=fake();await beginRefundRequest(f.service,identity,'hash');await recordRefundRequestOutcome(f.service,identity,true,{stripe_refund_id:'re_1'});
 f.rows.set('ticket_refunds',[{order_id:'order',stripe_refund_id:'different',total_refunded_cents:999}]);equal((await readRefundRequestStatus(f.service,identity)).body.state,'confirmed');
 f.rows.get('ticket_refunds')!.push({order_id:'order',stripe_refund_id:'re_1',total_refunded_cents:1200});equal((await readRefundRequestStatus(f.service,identity)).body.state,'confirmed');
 f.rows.set('ticket_order_positions',[{order_id:'order',stripe_refund_id:'re_1',voided_at:'today'},{order_id:'order',stripe_refund_id:'other',voided_at:'today'}]);const before=f.operations.length;const result=await readRefundRequestStatus(f.service,identity);equal(result.body.state,'complete');equal(result.body.refund_amount_cents,1200);equal(result.body.positions_voided,1);assert(f.operations.slice(before).every(op=>op.mode===undefined||op.mode==='select'));
});
Deno.test('stalled post-provider journal cannot block existing accounting indefinitely',async()=>{
 const f=fake();await beginRefundRequest(f.service,identity,'hash');f.setHangUpdate();const start=Date.now();let rejected=false;try{await recordRefundRequestOutcome(f.service,identity,true,{stripe_refund_id:'re_1'});}catch{rejected=true;}assert(rejected);assert(Date.now()-start<3500);equal(f.rows.get('ticket_refund_requests')?.[0].state,'pending');
});
