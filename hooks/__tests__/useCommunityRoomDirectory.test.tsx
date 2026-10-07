import React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCommunityRoomDirectory } from '../useCommunityRoomDirectory';
import { getCommunityRoomIdentities, type CommunityRoomIdentities } from '../../lib/communityRoomHistory';
import { setOptionalRoomMembership } from '../../lib/communityOptionalRoom';
import type { ObservedUser } from '../useObservedUser';
jest.mock('../../lib/communityRoomHistory',()=>({getCommunityRoomIdentities:jest.fn()}));
jest.mock('../../lib/communityOptionalRoom',()=>({setOptionalRoomMembership:jest.fn(),requireOptionalRoom:(layout:any,id:string)=>{const room=layout?.rooms.find((r:any)=>r.id===id&&r.role==='optional');if(!room)throw Error('Unavailable');return room;}}));
const read=jest.mocked(getCommunityRoomIdentities),write=jest.mocked(setOptionalRoomMembership);
const layout=(joined=false):CommunityRoomIdentities=>({communityId:'page',name:'Community',rooms:[{id:'room',role:'optional',storage:'topic',name:'Walks',included:false,joined,notifications_on:joined?false:null}]});
const close:Array<()=>void>=[];
const deferred=<T,>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{resolve,promise};};
async function flush(){for(let i=0;i<4;i++)await act(async()=>{await new Promise(r=>setTimeout(r,0));});}
function mount(){
 const client=new QueryClient({defaultOptions:{queries:{retryDelay:0,gcTime:Infinity}}});let result!:ReturnType<typeof useCommunityRoomDirectory>,tree!:ReturnType<typeof create>;let id='a',enabled=true,epoch=1;
 function Harness(){const captured=id;const viewer={viewerId:id,epoch,isLoading:false,error:null,retry:async()=>{},isCurrent:()=>id===captured} as ObservedUser;result=useCommunityRoomDirectory('page',viewer,enabled);return null;}
 const node=()=> <QueryClientProvider client={client}><Harness/></QueryClientProvider>;
 act(()=>{tree=create(node());});close.push(()=>{act(()=>tree.unmount());client.clear();});
 return{client,get result(){return result;},focus:(value:boolean)=>{enabled=value;act(()=>tree.update(node()));},account:(value:string)=>{id=value;epoch++;act(()=>tree.update(node()));}};
}
beforeEach(()=>{jest.clearAllMocks();read.mockResolvedValue(layout());write.mockResolvedValue(layout(true));});
afterEach(async()=>{close.splice(0).forEach(fn=>fn());await flush();});
it('loads without changing membership or acknowledging messages',async()=>{const f=mount();await flush();expect(f.result.data).toEqual(layout());expect(write).not.toHaveBeenCalled();});
it('serializes rapid taps and updates the same directory after confirmed joining',async()=>{
 const pending=deferred<CommunityRoomIdentities>();write.mockReturnValue(pending.promise);const f=mount();await flush();
 let operation:any;act(()=>{operation=f.result.change('room',true);void f.result.change('room',true);});await flush();expect(write).toHaveBeenCalledTimes(1);expect(f.result.busy).toBe(true);
 read.mockResolvedValue(layout(true));await act(async()=>{pending.resolve(layout(true));await operation;});await flush();expect(f.result.pending).toBeNull();expect(f.result.data?.rooms[0].joined).toBe(true);
});
it('requires a read-only check after an unknown response and confirms an already committed join',async()=>{
 write.mockRejectedValue(Error('Response lost'));const f=mount();await flush();await act(async()=>{await f.result.change('room',true);});await flush();expect(f.result.pending?.retryReady).toBe(false);
 await act(async()=>{await f.result.retry();await f.result.change('room',false);});expect(write).toHaveBeenCalledTimes(1);
 read.mockResolvedValue(layout(true));await act(async()=>{await f.result.check();});expect(write).toHaveBeenCalledTimes(1);expect(f.result.pending).toBeNull();
});
it('offers only an explicit retry of the original desired state after checking an unapplied change',async()=>{
 write.mockRejectedValueOnce(Error('Rejected')).mockResolvedValue(layout(true));const f=mount();await flush();await act(async()=>{await f.result.change('room',true);});await flush();await act(async()=>{await f.result.check();});expect(f.result.pending?.retryReady).toBe(true);expect(write).toHaveBeenCalledTimes(1);
 read.mockResolvedValue(layout(true));await act(async()=>{await f.result.retry();});expect(write).toHaveBeenCalledTimes(2);expect(write.mock.calls[1][2]).toBe(true);
});
it('keeps an uncertain operation through blur and returns with checking available',async()=>{
 const pending=deferred<CommunityRoomIdentities>();write.mockReturnValue(pending.promise);const f=mount();await flush();let operation:any;act(()=>{operation=f.result.change('room',true);});await flush();f.focus(false);
 await act(async()=>{pending.resolve(layout(true));await operation;});expect(f.result.busy).toBe(false);expect(f.result.pending?.topicId).toBe('room');
 f.focus(true);await flush();expect(f.result.pending?.topicId).toBe('room');expect(write).toHaveBeenCalledTimes(1);
});
it('retires late results and callbacks after account changes',async()=>{
 const pending=deferred<CommunityRoomIdentities>();write.mockReturnValue(pending.promise);const f=mount();await flush();const old=f.result;let operation:any;act(()=>{operation=old.change('room',true);});await flush();f.account('b');await flush();await act(async()=>{pending.resolve(layout(true));await operation;});await old.retry();await old.change('room',false);expect(write).toHaveBeenCalledTimes(1);expect(f.result.pending).toBeNull();expect(f.result.data?.rooms[0].joined).toBe(false);
});

it('resolves a pending change as unavailable when a fresh authoritative directory removes that group',async()=>{
 write.mockRejectedValue(Error('Uncertain leave'));const f=mount();await flush();await act(async()=>{await f.result.change('room',false);});await flush();
 read.mockResolvedValue({...layout(),rooms:[]});await act(async()=>{await f.result.check();});expect(f.result.pending).toBeNull();expect(f.result.notice).toBe('This group is no longer available.');expect(write).toHaveBeenCalledTimes(1);
});

it('ends a stalled directory read without automatically repeating the timeout',async()=>{
 jest.useFakeTimers();
 try {
  read.mockImplementation(()=>new Promise(()=>{}));const f=mount();
  await act(async()=>{await jest.advanceTimersByTimeAsync(12_001);});
  expect(f.result.loading).toBe(false);expect(f.result.error?.name).toBe('RequestDeadlineError');
  const attempts=read.mock.calls.length;
  await act(async()=>{await jest.advanceTimersByTimeAsync(25_000);});expect(read).toHaveBeenCalledTimes(attempts);
  read.mockResolvedValue(layout());await act(async()=>{await f.result.refresh();await jest.advanceTimersByTimeAsync(1);});
  expect(f.result.data).toEqual(layout());expect(f.result.error).toBeNull();
 }finally{jest.useRealTimers();}
});
it('ends a stalled membership check with the original uncertain action preserved',async()=>{
 const f=mount();await flush();write.mockRejectedValue(Error('Response lost'));await act(async()=>{await f.result.change('room',true);});
 jest.useFakeTimers();
 try {
  read.mockImplementation(()=>new Promise(()=>{}));let operation:any;
  act(()=>{operation=f.result.check();});await act(async()=>{await jest.advanceTimersByTimeAsync(12_001);await operation;});
  expect(f.result.busy).toBe(false);expect(f.result.pending).toEqual({topicId:'room',joined:true,retryReady:false});
  expect(write).toHaveBeenCalledTimes(1);
 }finally{jest.useRealTimers();}
});
