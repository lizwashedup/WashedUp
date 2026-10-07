import {createMembershipRequestsApi,createMembershipDecisionStore} from '../pageMembershipRequests';
const page='17000000-0000-4000-8000-000000000001',member='17000000-0000-4000-8000-000000000002',user='17000000-0000-4000-8000-000000000003';
const date='2026-09-17T00:00:00.123456+00:00';
const row={member_id:member,user_id:user,status:'pending',created_at:date,updated_at:date,first_name:'Juniper',last_name:'Example',intro_answer:'Hello',reason_answer:'Private reason',source_answer:null,open_question:null,open_answer:null,rules_confirmed:null,guidelines_accepted_at:null};
const scope={userId:user,isCurrent:()=>true};
const raw={page_id:page,page_name:'Sunset walks',requests:[row],next_cursor:null};
const decision={pageId:page,memberId:member,approve:true,updatedAt:date};
it('does not leak additional backend fields through the private answer projection',async()=>{const api=createMembershipRequestsApi(async()=>({...raw,requests:[{...row,email:'private@example.invalid',zip:'90001',handle:'private'}]}));const result=await api.read(page,scope);expect(result.requests[0].reason).toBe('Private reason');expect(JSON.stringify(result)).not.toMatch(/private@example|90001|handle/);});
it.each([{...raw,page_id:member},{...raw,requests:[row,row]},{...raw,requests:[{...row,status:'active'}]},{...raw,next_cursor:member}])('rejects mismatched, duplicate, terminal inbox or invalid pagination receipts',async value=>{await expect(createMembershipRequestsApi(async()=>value).read(page,scope)).rejects.toThrow();});
it('exact request recovery accepts terminal state but never another request',async()=>{const api=createMembershipRequestsApi(async()=>({...raw,requests:[{...row,status:'active'}]}));expect((await api.read(page,scope,{memberId:member})).requests[0].status).toBe('active');await expect(api.read(page,scope,{memberId:user})).rejects.toThrow();});
it('preserves sub-millisecond version in decision dispatch',async()=>{const rpc=jest.fn(async()=>({page_id:page,member_id:member,status:'active',changed:true}));await createMembershipRequestsApi(rpc).decide(decision,scope);expect(rpc.mock.calls[0]).toEqual(['review_creator_page_join_request',{p_page_id:page,p_member_id:member,p_approve:true,p_expected_updated_at:date},scope]);});
it('never accepts an unexpected outcome as successful',async()=>{await expect(createMembershipRequestsApi(async()=>({page_id:page,member_id:member,status:'declined',changed:true})).decide(decision,scope)).rejects.toThrow('unconfirmed');});
it('rejects results retired during transport',async()=>{let current=true;const api=createMembershipRequestsApi(async()=>{current=false;return raw;});await expect(api.read(page,{userId:user,isCurrent:()=>current})).rejects.toThrow('changed');});
it('keeps decision markers account/page scoped with no answers and prevents overwriting unresolved intent',async()=>{const map=new Map<string,string>();const storage={getItem:async(k:string)=>map.get(k)??null,setItem:async(k:string,v:string)=>{map.set(k,v);},removeItem:async(k:string)=>{map.delete(k);}};const store=createMembershipDecisionStore(storage);await store.prepare(decision,scope);expect([...map.values()][0]).toBe(JSON.stringify(decision));expect(await store.read(page,{...scope,userId:member})).toBeNull();await expect(store.prepare({...decision,approve:false},scope)).rejects.toThrow('previous');await store.clear({...decision,updatedAt:'2026-09-17T00:01:00Z'},scope);expect(await store.read(page,scope)).toEqual(decision);await store.clear(decision,scope);expect(await store.read(page,scope)).toBeNull();});

it('serializes recovery reads behind an expired persistence write and retains its original intent',async()=>{
  const map=new Map<string,string>();let finish!:()=>void;let current=true;
  const storage={getItem:jest.fn(async(k:string)=>map.get(k)??null),setItem:async(k:string,v:string)=>{await new Promise<void>(r=>{finish=r;});map.set(k,v);},removeItem:async(k:string)=>{map.delete(k);}};
  const store=createMembershipDecisionStore(storage),old={userId:user,isCurrent:()=>current};
  const saving=store.prepare(decision,old);const caught=saving.catch(error=>error);
  for(let turn=0;turn<10&&!finish;turn++)await Promise.resolve();expect(finish).toBeDefined();current=false;
  const recovery=store.read(page,scope);await Promise.resolve();expect(storage.getItem).toHaveBeenCalledTimes(1);
  finish();expect(await caught).toBeInstanceOf(Error);expect(await recovery).toEqual(decision);
});
it('cannot overwrite an unresolved decision through concurrent preparations',async()=>{
  const map=new Map<string,string>();const storage={getItem:async(k:string)=>map.get(k)??null,setItem:async(k:string,v:string)=>{map.set(k,v);},removeItem:async(k:string)=>{map.delete(k);}};
  const store=createMembershipDecisionStore(storage);
  const results=await Promise.allSettled([store.prepare(decision,scope),store.prepare({...decision,approve:false},scope)]);
  expect(results.map(r=>r.status)).toEqual(['fulfilled','rejected']);expect(await store.read(page,scope)).toEqual(decision);
});
