import { loadCreatorAddon, saveCreatorAddon, addonOptionsProblem, CreatorAddonRejected, CreatorAddonChanged } from '../creatorAddonEditor';
const mockSession=jest.fn(),mockRequest=jest.fn();
const calls:any[]=[];
jest.mock('../supabase',()=>({supabase:{auth:{getSession:(...args:any[])=>mockSession(...args)},from:(table:string)=>{
 const call:any={table,filters:[],op:'read'};calls.push(call);
 const query:any={select:()=>query,eq:(key:string,value:string)=>{call.filters.push([key,value]);return query;},is:(key:string,value:null)=>{call.filters.push([key,value]);return query;},maybeSingle:()=>query,
 insert:(value:any)=>{call.op='insert';call.value=value;return query;},update:(value:any)=>{call.op='update';call.value=value;return query;},
 setHeader:(key:string,value:string)=>{call.header=[key,value];return mockRequest(call);}};return query;
}}}));
let active=true;
const scope:any={userId:'creator-a',isCurrent:()=>active};
const draft:any={name:'Picnic lunch',description:null,image_url:null,price_cents:1200,quantity_cap:20,per_order_max:2,status:'draft',variations:[{id:'vegan',label:'Vegan'}]};
const row={id:'extra-a',event_id:'event-a',...draft,sold_count:0};
beforeEach(()=>{active=true;calls.length=0;jest.clearAllMocks();mockSession.mockResolvedValue({data:{session:{user:{id:'creator-a'},access_token:'fixture-token'}},error:null});});
it('saves options with the extra in one insert pinned to the initiating account',async()=>{
 mockRequest.mockResolvedValueOnce({data:null}).mockResolvedValueOnce({data:row});
 expect(await saveCreatorAddon('event-a','extra-a',draft,true,scope)).toEqual(row);
 expect(calls.map(c=>c.op)).toEqual(['read','insert']);expect(calls[1].value).toEqual({id:'extra-a',event_id:'event-a',...draft});
 expect(calls.every(c=>c.header[1]==='Bearer fixture-token')).toBe(true);
});
it('recovers a lost insert response by reading the same ID without another write',async()=>{
 mockRequest.mockResolvedValueOnce({data:null}).mockRejectedValueOnce(Error('lost response')).mockResolvedValueOnce({data:row});
 expect(await saveCreatorAddon('event-a','extra-a',draft,true,scope)).toEqual(row);
 expect(calls.map(c=>c.op)).toEqual(['read','insert','read']);expect(calls[2].filters).toEqual([['event_id','event-a'],['id','extra-a']]);
});
it('a retry finds the original saved extra before inserting',async()=>{
 mockRequest.mockResolvedValue({data:row});await saveCreatorAddon('event-a','extra-a',draft,true,scope);expect(calls.map(c=>c.op)).toEqual(['read']);
});
it('refuses to overwrite a different saved version during new-extra recovery',async()=>{
 mockRequest.mockResolvedValue({data:{...row,name:'Another name'}});await expect(saveCreatorAddon('event-a','extra-a',draft,true,scope)).rejects.toThrow('Reopen');expect(calls).toHaveLength(1);
});
it('a failed new-extra preflight cannot dispatch a write',async()=>{
 mockRequest.mockResolvedValue({data:null,error:Error('offline')});await expect(saveCreatorAddon('event-a','extra-a',draft,true,scope)).rejects.toThrow('offline');expect(calls).toHaveLength(1);
});
it('zero-row updates remain unconfirmed and use exact event and extra filters',async()=>{
 mockRequest.mockResolvedValue({data:null});await expect(saveCreatorAddon('event-a','extra-a',draft,false,scope)).rejects.toThrow('could not be confirmed');expect(calls.map(c=>c.op)).toEqual(['update','read']);expect(calls[0].filters).toEqual([['event_id','event-a'],['id','extra-a']]);
});
it('retiring a read prevents late content and subsequent save work',async()=>{
 mockRequest.mockImplementation(async()=>{active=false;return {data:row};});await expect(loadCreatorAddon('event-a','extra-a',scope)).rejects.toThrow('no longer active');
 await expect(saveCreatorAddon('event-a','extra-a',draft,false,scope)).rejects.toThrow('no longer active');expect(calls).toHaveLength(1);
});
it('a mismatched signed-in account cannot query or write',async()=>{
 mockSession.mockResolvedValue({data:{session:{user:{id:'creator-b'},access_token:'other'}},error:null});await expect(loadCreatorAddon('event-a','extra-a',scope)).rejects.toThrow('sign-in');expect(calls).toHaveLength(0);
});
it('rejects malformed saved options rather than treating them as empty',async()=>{
 mockRequest.mockResolvedValue({data:{...row,variations:[null]}});await expect(loadCreatorAddon('event-a','extra-a',scope)).rejects.toThrow('could not be loaded');
 expect(addonOptionsProblem([{id:'same',label:'A'},{id:'same',label:'B'}])).not.toBeNull();
});

it('checking an uncertain original save never writes',async()=>{
 mockRequest.mockResolvedValue({data:row});expect(await saveCreatorAddon('event-a','extra-a',draft,true,scope,false)).toEqual(row);expect(calls.map(c=>c.op)).toEqual(['read']);
 calls.length=0;mockRequest.mockResolvedValue({data:null});await expect(saveCreatorAddon('event-a','extra-a',draft,true,scope,false)).rejects.toThrow('not confirmed');expect(calls.map(c=>c.op)).toEqual(['read']);
});
it('refuses a returned edit when another teammate changed the original fields',async()=>{
 mockRequest.mockResolvedValue({data:{...row,name:'Other change'}});await expect(saveCreatorAddon('event-a','extra-a',{...draft,name:'My change'},false,scope,true,row as any)).rejects.toThrow('changed');expect(calls.map(c=>c.op)).toEqual(['read']);
});
it('conditions edits on original values without including changing sold counts',async()=>{
 const changed={...draft,name:'Updated'};mockRequest.mockResolvedValueOnce({data:{...row,sold_count:1}}).mockResolvedValueOnce({data:{...row,...changed,sold_count:1}});
 await saveCreatorAddon('event-a','extra-a',changed,false,scope,true,row as any);expect(calls.map(c=>c.op)).toEqual(['read','update']);expect(calls[1].filters).toContainEqual(['name',row.name]);expect(calls[1].filters).toContainEqual(['variations',JSON.stringify(row.variations)]);expect(calls[1].filters.some(([k]:any)=>k==='sold_count')).toBe(false);
});

it('fresh SQL rejection with an unchanged readback allows correction after durable dispatch marking',async()=>{
 const beforeDispatch=jest.fn(async()=>true);mockRequest.mockResolvedValueOnce({data:null}).mockImplementationOnce(async()=>{expect(beforeDispatch).toHaveBeenCalledTimes(1);return {data:null,error:{code:'23514'}};}).mockResolvedValueOnce({data:null});
 await expect(saveCreatorAddon('event-a','extra-a',draft,true,scope,true,null,{previouslyDispatched:false,beforeDispatch})).rejects.toBeInstanceOf(CreatorAddonRejected);
});
it('a later SQL refusal cannot erase an earlier uncertain save',async()=>{
 mockRequest.mockResolvedValueOnce({data:null}).mockResolvedValueOnce({data:null,error:{code:'23514'}}).mockResolvedValueOnce({data:null});
 const error=await saveCreatorAddon('event-a','extra-a',draft,true,scope,true,null,{previouslyDispatched:true,beforeDispatch:async()=>true}).catch(e=>e);expect(error).not.toBeInstanceOf(CreatorAddonRejected);expect(error.message).toContain('could not be confirmed');
});
it('transport failures and failed rejection readbacks remain uncertain',async()=>{
 const dispatch={previouslyDispatched:false,beforeDispatch:async()=>true};mockRequest.mockResolvedValueOnce({data:null}).mockRejectedValueOnce(Error('lost')).mockResolvedValueOnce({data:null});
 let error=await saveCreatorAddon('event-a','extra-a',draft,true,scope,true,null,dispatch).catch(e=>e);expect(error).not.toBeInstanceOf(CreatorAddonRejected);
 mockRequest.mockResolvedValueOnce({data:null}).mockResolvedValueOnce({data:null,error:{code:'23514'}}).mockRejectedValueOnce(Error('lost read'));
 error=await saveCreatorAddon('event-a','extra-a',draft,true,scope,true,null,dispatch).catch(e=>e);expect(error).not.toBeInstanceOf(CreatorAddonRejected);
});
it('refuses network dispatch when durable marking fails',async()=>{
 mockRequest.mockResolvedValueOnce({data:null});await expect(saveCreatorAddon('event-a','extra-a',draft,true,scope,true,null,{previouslyDispatched:false,beforeDispatch:async()=>false})).rejects.toThrow('device');expect(calls.map(c=>c.op)).toEqual(['read']);
});
it('an undispatched conflict returns the saved row without replacing anything',async()=>{
 const saved={...row,name:'Updated by teammate'};mockRequest.mockResolvedValue({data:saved});const error=await saveCreatorAddon('event-a','extra-a',{...draft,name:'Mine'},false,scope,false,row as any,{previouslyDispatched:false,beforeDispatch:async()=>true}).catch(e=>e);expect(error).toBeInstanceOf(CreatorAddonChanged);expect(error.saved).toEqual(saved);expect(calls.map(c=>c.op)).toEqual(['read']);
});

it('a fresh zero-row conditional edit settles the newer saved version',async()=>{
 const changed={...row,name:'Team edit'};mockRequest.mockResolvedValueOnce({data:row}).mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:changed});
 const error=await saveCreatorAddon('event-a','extra-a',{...draft,name:'My edit'},false,scope,true,row as any,{previouslyDispatched:false,beforeDispatch:async()=>true}).catch(e=>e);expect(error).toBeInstanceOf(CreatorAddonChanged);expect(error.saved).toEqual(changed);
});
it('a zero-row retry cannot settle an earlier uncertain save',async()=>{
 const changed={...row,name:'Team edit'};mockRequest.mockResolvedValueOnce({data:row}).mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:changed});
 const error=await saveCreatorAddon('event-a','extra-a',{...draft,name:'My edit'},false,scope,true,row as any,{previouslyDispatched:true,beforeDispatch:async()=>true}).catch(e=>e);expect(error).not.toBeInstanceOf(CreatorAddonChanged);expect(error).not.toBeInstanceOf(CreatorAddonRejected);
});
