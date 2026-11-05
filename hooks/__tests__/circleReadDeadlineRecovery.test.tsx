import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCirclePlans } from '../useCirclePlans';
import { useMyCircles } from '../useMyCircles';
import { useCircleMemberPreviews } from '../useCircleMemberPreviews';
import { useCirclePlanContext } from '../useCirclePlanContext';
import { useCircleSuggestions, useSetSuggestionStatus } from '../useCircleSuggestions';

const mockAuth=jest.fn(), mockRead=jest.fn(), mockAbort=jest.fn();
jest.mock('../../lib/supabase',()=>({supabase:{
 auth:{getUser:()=>mockAuth(),onAuthStateChange:()=>({data:{subscription:{unsubscribe:jest.fn()}}})},
 rpc:(name:string)=>mockChain(name),from:(name:string)=>mockChain(name),
}}));
function mockChain(name:string):any {
 const value:any={then:(...callbacks:any[])=>mockRead(name).then(...callbacks)};
 for(const method of ['select','eq','in','order'])value[method]=()=>value;
 value.abortSignal=(signal:AbortSignal)=>{mockAbort(signal);return value;};return value;
}
const circleId='7b42d4c2-8bd2-4f4a-8a52-37275f1c14ef';
const circle={id:circleId,name:'Sunday circle',member_count:3};
const context={is_circle_plan:true,circle_id:circleId,circle_name:'Sunday circle',circle_visibility:'circle_only',stranger_cap:null,has_own_chat:true,viewer_is_member:true,viewer_stranger_spots_left:null};
const scope={userId:'alice',epoch:1,isCurrent:()=>true};
const auth={data:{user:{id:'alice'}},error:null};
type Kind='plans'|'mine'|'members'|'context'|'suggestions';
const kinds:Kind[]=['plans','mine','members','context','suggestions'];
const names:Record<Kind,string>={plans:'events',mine:'get_my_circles',members:'circle_members',context:'get_circle_plan_context',suggestions:'get_circle_suggestions'};
let kind:Kind,current:any,mutation:any,tree:ReactTestRenderer,client:QueryClient;
function response(name:string){return {data:name==='get_circle_plan_context'?context:name==='get_my_circles'?[circle]:name==='set_circle_suggestion_status'?'dismissed':[],error:null};}
function Probe(){
 const plans=useCirclePlans(kind==='plans'?circleId:null,scope);
 const mine=useMyCircles(kind==='mine'?'alice':null,scope);
 const members=useCircleMemberPreviews([circleId],kind==='members'?'alice':null,scope);
 const details=useCirclePlanContext(kind==='context'?'event':null,kind==='context'?{viewerId:'alice',epoch:1,isCurrent:scope.isCurrent,event:{id:'event',circle_id:circleId}}:undefined);
 const suggestions=useCircleSuggestions(kind==='suggestions'?'alice':null,scope);
 mutation=useSetSuggestionStatus('alice');
 current={plans,mine,members,context:details,suggestions}[kind];return null;
}
function deferred(){let resolve!:(value:any)=>void;const promise=new Promise<any>(r=>resolve=r);return{promise,resolve};}
async function tick(ms=1){await act(async()=>{await jest.advanceTimersByTimeAsync(ms);});}
async function mount(){act(()=>{tree=create(<QueryClientProvider client={client}><Probe/></QueryClientProvider>);});await tick();}
beforeEach(()=>{
 jest.useFakeTimers();jest.clearAllMocks();kind='mine';
 client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
 mockAuth.mockReset().mockResolvedValue(auth);mockRead.mockReset().mockImplementation(async name=>response(name));
});
afterEach(()=>{act(()=>tree?.unmount());client.clear();jest.clearAllTimers();jest.useRealTimers();});

it.each(kinds)('%s recovers from stalled authentication without dispatching a read, ignores late auth, and retries',async which=>{
 kind=which;const pending=deferred();mockAuth.mockReturnValueOnce(pending.promise);await mount();
 expect(current.isPending).toBe(true);await tick(12001);expect(current.isError).toBe(true);expect(current.data).toBeUndefined();expect(mockRead).not.toHaveBeenCalled();
 pending.resolve(auth);await tick();expect(mockRead).not.toHaveBeenCalled();expect(current.isError).toBe(true);
 await act(async()=>{await current.refetch();});await tick();expect(current.isSuccess).toBe(true);expect(mockRead).toHaveBeenCalledWith(names[which]);
});
it.each(kinds)('%s ends a stalled read as an error rather than an empty result and ignores its late answer',async which=>{
 kind=which;const pending=deferred();mockRead.mockReturnValueOnce(pending.promise);await mount();
 expect(current.isPending).toBe(true);expect(mockAbort).toHaveBeenCalledTimes(1);const signal=mockAbort.mock.calls[0][0];
 await tick(12001);expect(current.isError).toBe(true);expect(current.data).toBeUndefined();if(which==='context')expect(current.isContextReady).toBe(false);
 pending.resolve(response(names[which]));await tick();expect(current.isError).toBe(true);expect(current.data).toBeUndefined();
 await act(async()=>{await current.refetch();});await tick();expect(current.isSuccess).toBe(true);
 // The existing query-owned abort signal must not be replaced by a timeout helper.
 expect(signal).toBeInstanceOf(AbortSignal);
});
it('keeps a confirmed directory when optional unnamed-member enrichment stalls',async()=>{
 const pending=deferred();mockRead.mockImplementation(name=>name==='get_my_circles'?Promise.resolve({data:[{...circle,name:''}],error:null}):pending.promise);
 await mount();await tick(12001);expect(current.isSuccess).toBe(true);expect(current.data).toEqual([{...circle,name:'',display_name:'New circle'}]);
 pending.resolve({data:[{circle_id:circleId,user_id:'bea',profiles_public:{first_name_display:'Bea'}}],error:null});await tick();expect(current.data[0].display_name).toBe('New circle');
});
it('cancels the original query signal on unmount while a read is stalled',async()=>{
 mockRead.mockReturnValue(new Promise(()=>{}));await mount();const signal=mockAbort.mock.calls[0][0];act(()=>tree.unmount());expect(signal.aborted).toBe(true);
});
it('a stalled suggestion action account check permits explicit retry without a late write',async()=>{
 await mount();mockRead.mockClear();const pending=deferred();mockAuth.mockReturnValueOnce(pending.promise);
 let result:Promise<any>;act(()=>{result=mutation.mutateAsync({id:'suggestion',status:'dismissed'},{scope}).catch((e:any)=>e);});
 await tick(12001);expect(await result!).toBeInstanceOf(Error);expect(mockRead).not.toHaveBeenCalled();
 pending.resolve(auth);await tick();expect(mockRead).not.toHaveBeenCalled();
 await act(async()=>{await mutation.mutateAsync({id:'suggestion',status:'dismissed'},{scope});});await tick();expect(mockRead.mock.calls.filter(([name])=>name==='set_circle_suggestion_status')).toHaveLength(1);
});
it('does not cut off a suggestion write that has already been dispatched',async()=>{
 await mount();const pending=deferred();mockRead.mockImplementation(name=>name==='set_circle_suggestion_status'?pending.promise:Promise.resolve(response(name)));
 let result:Promise<any>;act(()=>{result=mutation.mutateAsync({id:'suggestion',status:'dismissed'},{scope});});await tick(12001);expect(mutation.isPending).toBe(true);
 pending.resolve(response('set_circle_suggestion_status'));await act(async()=>{expect(await result!).toBe('dismissed');});
});
