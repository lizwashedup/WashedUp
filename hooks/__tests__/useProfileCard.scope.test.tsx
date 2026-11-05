import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {useProfileCard} from '../useProfileCard';
import {yoursKeys} from '../../lib/yours/keys';
const mockAuth=jest.fn(),mockRead=jest.fn(),mockRpc=jest.fn(),mockAbort=jest.fn();
jest.mock('../../lib/supabase',()=>({supabase:{auth:{getUser:()=>mockAuth()},rpc:(...args:any[])=>{
 mockRpc(...args);const promise=mockRead();return Object.assign(promise,{abortSignal:(signal:AbortSignal)=>{mockAbort(signal);return promise;}});
}}}));
const card={kind:'minimal',user_id:'jamie',first_name_display:'Jamie',profile_photo_url:null,handle:null,shared_count:0,milestone:null,since_date:null,upcoming:null,adventures:null};
const answer=(data:any=[card])=>({data,error:null});
const own=(userId='alice',epoch=1)=>{let active=true;return{userId,epoch,isCurrent:()=>active,retire:()=>{active=false;}};};
const deferred=()=>{let resolve!:(value:any)=>void;const promise=new Promise<any>(r=>{resolve=r;});return{promise,resolve};};
let scoped=true;
let owner=own(),viewer:string|null='alice',target:string|null='jamie',client:QueryClient,tree:ReactTestRenderer|undefined,current:any;
function Harness(){current=useProfileCard(viewer,target,scoped?owner:undefined);return null;}
const render=()=> <QueryClientProvider client={client}><Harness/></QueryClientProvider>;
const tick=async(ms=1)=>{await act(async()=>{await jest.advanceTimersByTimeAsync(ms);});};
const mount=async()=>{act(()=>{tree=create(render());});await tick();};
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();scoped=true;owner=own();viewer='alice';target='jamie';client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});mockAuth.mockReset().mockResolvedValue({data:{user:{id:'alice'}},error:null});mockRead.mockReset().mockImplementation(()=>Promise.resolve(answer()));});
afterEach(()=>{act(()=>tree?.unmount());tree=undefined;client.clear();jest.useRealTimers();});
it('keeps the existing request and minimal privacy payload',async()=>{await mount();expect(mockRpc).toHaveBeenCalledWith('get_profile_card',{p_user_id:'alice',p_target:'jamie'});expect(current.data).toEqual(card);});
it('ends a stalled profile read and allows explicit retry',async()=>{
 const read=deferred();mockRead.mockReturnValueOnce(read.promise);await mount();await tick(12001);
 expect(current.isFetching).toBe(false);expect(current.isError).toBe(true);
 read.resolve(answer([{...card,first_name_display:'Late'}]));await tick();expect(current.data).toBeUndefined();
 await act(async()=>{await current.refetch();});await tick();expect(current.data).toEqual(card);
});
it('cannot reuse an old response when the same account returns after another account',async()=>{
 const read=deferred();mockRead.mockReturnValueOnce(read.promise);await mount();
 owner.retire();viewer='bob';owner=own('bob',2);mockAuth.mockResolvedValue({data:{user:{id:'bob'}},error:null});act(()=>tree!.update(render()));await tick();
 read.resolve(answer([{...card,handle:'old-private-handle'}]));await tick();
 owner.retire();viewer='alice';owner=own('alice',3);mockAuth.mockResolvedValue({data:{user:{id:'alice'}},error:null});const fresh=deferred();mockRead.mockReturnValueOnce(fresh.promise);act(()=>tree!.update(render()));await tick();
 expect(current.data).toBeUndefined();fresh.resolve(answer());await tick();expect(current.data).toEqual(card);
 expect(client.getQueriesData({queryKey:[...yoursKeys.profileCard('alice','jamie'),1]}).every(([,data])=>data===undefined)).toBe(true);
});
it('does not dispatch with a mismatched authenticated viewer',async()=>{
 mockAuth.mockResolvedValueOnce({data:{user:{id:'bob'}},error:null});await mount();expect(mockRpc).not.toHaveBeenCalled();expect(current.isError).toBe(true);
});

it('starts a fresh private read when a new observer mounts with the same local epoch',async()=>{
 await mount();act(()=>tree!.unmount());tree=undefined;owner.retire();owner=own();
 const fresh=deferred();mockRead.mockReturnValueOnce(fresh.promise);await mount();
 expect(current.data).toBeUndefined();fresh.resolve(answer());await tick();expect(current.data).toEqual(card);
});
it('retires an unobserved read and cannot cache its late result',async()=>{
 const read=deferred();mockRead.mockReturnValueOnce(read.promise);await mount();const signal=mockAbort.mock.calls[0][0];
 act(()=>tree!.unmount());tree=undefined;expect(signal.aborted).toBe(true);read.resolve(answer());await tick();
 expect(client.getQueriesData({queryKey:yoursKeys.profileCard('alice','jamie')}).every(([,data])=>data===undefined)).toBe(true);
});
it('does not dispatch after account scope retires during preflight',async()=>{
 const read=deferred();mockAuth.mockReturnValueOnce(read.promise);await mount();owner.retire();read.resolve({data:{user:{id:'alice'}},error:null});await tick();
 expect(mockRpc).not.toHaveBeenCalled();expect(current.isError).toBe(true);
});
it('bounds a stalled account preflight and ignores its late success',async()=>{
 const read=deferred();mockAuth.mockReturnValueOnce(read.promise);await mount();await tick(12001);
 expect(current.isError).toBe(true);expect(current.isFetching).toBe(false);expect(mockRpc).not.toHaveBeenCalled();
 read.resolve({data:{user:{id:'alice'}},error:null});await tick();expect(mockRpc).not.toHaveBeenCalled();
});
it.each([{...card,user_id:'other'},{...card,kind:'unknown'},{user_id:'jamie'}])('does not expose mismatched or malformed profile data',async row=>{
 mockRead.mockResolvedValueOnce(answer([row]));await mount();expect(current.data).toBeUndefined();expect(current.isError).toBe(true);
});
it('preserves private unavailable as null without inventing a read error',async()=>{
 mockRead.mockResolvedValueOnce(answer([]));await mount();expect(current.data).toBeNull();expect(current.isError).toBe(false);
});
it('retains the existing legacy cache key without adding a preflight for unscoped callers',async()=>{
 scoped=false;await mount();expect(mockAuth).not.toHaveBeenCalled();expect(client.getQueryData(yoursKeys.profileCard('alice','jamie'))).toEqual(card);
});
it.each(['viewer','target'])('does not fetch without a %s',async missing=>{
 if(missing==='viewer')viewer=null;else target=null;await mount();expect(mockAuth).not.toHaveBeenCalled();expect(mockRpc).not.toHaveBeenCalled();
});
