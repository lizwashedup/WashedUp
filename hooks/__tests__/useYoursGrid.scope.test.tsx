import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useYoursGrid } from '../useYoursGrid';
import { YOURS_GRID_KEYS } from '../../lib/yours/shapeGuard';
const mockAuth=jest.fn(), mockRead=jest.fn(), mockRpc=jest.fn();
jest.mock('../../lib/supabase',()=>({supabase:{auth:{getUser:()=>mockAuth()},rpc:(...args:any[])=>{mockRpc(...args);const p=mockRead();return Object.assign(p,{abortSignal:()=>p});}}}));
const person={...Object.fromEntries(YOURS_GRID_KEYS.map(k=>[k,null])),user_id:'friend',handle:'private.friend'};
let client:QueryClient,tree:ReactTestRenderer|undefined,current:ReturnType<typeof useYoursGrid>,live:boolean,epoch:number;
function Harness(){current=useYoursGrid('viewer',{userId:'viewer',epoch,isCurrent:()=>live});void current.isError;void current.isFetching;return null;}
const render=()=> <QueryClientProvider client={client}><Harness/></QueryClientProvider>;
async function flush(){for(let i=0;i<3;i++)await act(async()=>{await new Promise(r=>setTimeout(r,0));});}
async function mount(){act(()=>{tree=create(render());});await flush();}
beforeEach(()=>{jest.clearAllMocks();live=true;epoch=1;client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});mockAuth.mockResolvedValue({data:{user:{id:'viewer'}},error:null});mockRead.mockResolvedValue({data:[person],error:null});});
afterEach(async()=>{act(()=>tree?.unmount());tree=undefined;client.clear();await flush();});
it('uses accepted-People RPC scoped to the verified account generation',async()=>{await mount();expect(current.data).toEqual([person]);expect(mockRpc).toHaveBeenCalledWith('get_yours_grid',{p_user_id:'viewer'});expect(client.getQueryData(['yours','grid','viewer',1])).toEqual([person]);});
it('does not read another account after authentication changes',async()=>{mockAuth.mockResolvedValue({data:{user:{id:'other'}},error:null});await mount();expect(mockRpc).not.toHaveBeenCalled();expect(current.isError).toBe(true);});
it('does not cache delayed private handles after the owner retires',async()=>{let resolve!:Function;mockRead.mockReturnValue(new Promise(r=>{resolve=r;}));await mount();live=false;resolve({data:[person],error:null});await flush();expect(current.data).toBeUndefined();expect(current.isError).toBe(true);});
it('propagates denied/failed People reads without returning public fallback profiles',async()=>{mockRead.mockResolvedValue({data:null,error:new Error('denied')});await mount();expect(current.isError).toBe(true);expect(current.data).toBeUndefined();expect(mockRpc).toHaveBeenCalledTimes(1);});
it('does not reuse a previous account-generation cache on return',async()=>{await mount();expect(current.data).toEqual([person]);epoch=2;mockRead.mockReturnValue(new Promise(()=>{}));act(()=>tree!.update(render()));await flush();expect(current.data).toBeUndefined();});

async function flushTimers(ms=0){await act(async()=>{await jest.advanceTimersByTimeAsync(ms);});}
it('bounds an unanswered authentication check without dispatching a late People read',async()=>{
  let finish!:Function;mockAuth.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  jest.useFakeTimers();
  try{
    act(()=>{tree=create(render());});await flushTimers();await flushTimers(12_001);
    expect(current.isError).toBe(true);expect(current.error?.message).toContain('too long');expect(mockRpc).not.toHaveBeenCalled();
    finish({data:{user:{id:'viewer'}},error:null});await flushTimers();
    expect(mockRpc).not.toHaveBeenCalled();expect(current.data).toBeUndefined();
  }finally{jest.useRealTimers();}
});
it('keeps accepted People after a stalled refresh and ignores its late result',async()=>{
  await mount();let finish!:Function;mockRead.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  jest.useFakeTimers();
  try{
    let refresh!:ReturnType<typeof current.refetch>;act(()=>{refresh=current.refetch();});await flushTimers();await flushTimers(12_001);
    await refresh; jest.useRealTimers(); await flush();
    expect(current.isError).toBe(true);expect(current.data).toEqual([person]);expect(current.isFetching).toBe(false);
    finish({data:[{...person,user_id:'late-person'}],error:null});await flush();
    expect(current.data).toEqual([person]);expect(mockRpc).toHaveBeenCalledTimes(2);
  }finally{jest.useRealTimers();}
});
