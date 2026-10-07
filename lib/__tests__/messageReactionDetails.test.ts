import { loadMessageReactionDetails, removeMessageReaction, isMessageReactionRemoved } from '../messageReactionDetails';
const mockCalls: { table:string; methods:any[] }[]=[];
let mockResults:any[]=[];
const mockUser=jest.fn();const mockBlocked=jest.fn();
jest.mock('../supabase',()=>({supabase:{auth:{getUser:(...args:any[])=>mockUser(...args)},from:(table:string)=>{
 const call={table,methods:[] as any[]};mockCalls.push(call);const query:any={};
 for(const method of ['select','eq','order','range','in','delete','limit','maybeSingle'])query[method]=(...args:any[])=>{call.methods.push([method,...args]);return query;};
 query.then=(yes:any,no:any)=>Promise.resolve(mockResults.shift()).then(yes,no);return query;
}}}));
jest.mock('../blocking',()=>({getBlockedWith:(...args:any[])=>mockBlocked(...args)}));
let current=true;const scope={userId:'me',isCurrent:()=>current};const target={source:'chat' as const,messageId:'message'};
const readable={data:{id:'message'},error:null};
beforeEach(()=>{current=true;mockCalls.length=0;mockResults=[];mockUser.mockReset().mockResolvedValue({data:{user:{id:'me'}},error:null});mockBlocked.mockReset().mockResolvedValue(new Set());});
it.each(['chat','topic','broadcast'] as const)('reads only %s message reactions and permitted profile fields',async source=>{
 mockResults=[readable,{data:[{user_id:'other',reaction:'heart',emoji:'heart'}]}, {data:[{id:'other',first_name_display:'Amelia',profile_photo_url:'photo'}]}];
 const result=await loadMessageReactionDetails({...target,source},scope);
 expect(result.people).toEqual([{userId:'other',storageKey:'heart',emoji:'❤️',name:'Amelia',photo:'photo',mine:false}]);
 expect(mockCalls[1].methods).toContainEqual(['eq',source==='broadcast'?'broadcast_id':'message_id','message']);
 expect(mockCalls[2].methods).toContainEqual(['select','id, first_name_display, profile_photo_url']);
});
it('does not fetch or reveal a blocked profile',async()=>{
 mockBlocked.mockResolvedValue(new Set(['other']));mockResults=[readable,{data:[{user_id:'other',reaction:'👍'}]}];
 const result=await loadMessageReactionDetails(target,scope);expect(result.people[0]).toMatchObject({name:null,photo:null});expect(mockCalls).toHaveLength(2);
});
it('stops enrichment after the initiating visit retires',async()=>{
 mockResults=[readable,{data:[{user_id:'other',reaction:'👍'}]}];mockBlocked.mockImplementation(async()=>{current=false;return new Set();});
 await expect(loadMessageReactionDetails(target,scope)).rejects.toThrow('conversation changed');expect(mockCalls).toHaveLength(2);
});
it('distinguishes an unavailable message from a message with no reactions',async()=>{
 mockResults=[{data:null}];await expect(loadMessageReactionDetails(target,scope)).rejects.toThrow('no longer available');expect(mockCalls).toHaveLength(1);
});
it('rejects mismatched authenticated accounts before any table read',async()=>{
 mockUser.mockResolvedValue({data:{user:{id:'different'}}});await expect(loadMessageReactionDetails(target,scope)).rejects.toThrow();expect(mockCalls).toHaveLength(0);
});
it('paginates reaction rows before enriching profiles',async()=>{
 mockResults=[readable,{data:Array.from({length:41},(_,i)=>({user_id:`person-${i}`,reaction:'👍'}))},{data:[]}];
 const result=await loadMessageReactionDetails(target,scope,40);expect(result.people).toHaveLength(40);expect(result.nextOffset).toBe(80);expect(mockCalls[1].methods).toContainEqual(['range',40,80]);
});
it('removes only the current viewer’s exact key and confirms absence',async()=>{
 mockResults=[readable,{data:[],error:null},readable,{data:[]}];await removeMessageReaction(target,'heart',scope);
 expect(mockCalls[1].methods).toEqual(expect.arrayContaining([['delete'],['eq','message_id','message'],['eq','user_id','me'],['eq','reaction','heart']]));
 expect(mockCalls[3].methods).toContainEqual(['eq','reaction','heart']);
});
it('never claims a filtered-out deletion removed a reaction that remains',async()=>{
 mockResults=[readable,{data:[]},readable,{data:[{user_id:'me'}]}];await expect(removeMessageReaction(target,'heart',scope)).rejects.toThrow('still here');
});
it('checks an uncertain result without dispatching another delete',async()=>{
 mockResults=[readable,{data:[]}];expect(await isMessageReactionRemoved(target,'heart',scope)).toBe(true);expect(mockCalls.some(call=>call.methods.some(([m])=>m==='delete'))).toBe(false);
});
it('bounds a stalled identity read instead of leaving the sheet loading forever',async()=>{
 jest.useFakeTimers();mockUser.mockReturnValue(new Promise(()=>{}));const pending=loadMessageReactionDetails(target,scope);const rejection=expect(pending).rejects.toThrow('too long');await jest.advanceTimersByTimeAsync(10_000);await rejection;jest.useRealTimers();
});
