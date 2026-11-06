import React from 'react';
import { act,create } from 'react-test-renderer';
import { usePlanWaitlist } from '../usePlanWaitlist';
const mockAuth=jest.fn(),mockRead=jest.fn(),mockWrite=jest.fn(),mockInvalidate=jest.fn();
let mockBlur:(()=>void)|undefined,mockFocus:(()=>void|(()=>void))|undefined;
jest.mock('expo-router',()=>({useFocusEffect:(cb:any)=>require('react').useEffect(()=>{mockFocus=cb;mockBlur=cb();return()=>mockBlur?.();},[cb])}));
let mockClient={invalidateQueries:mockInvalidate};
jest.mock('@tanstack/react-query',()=>({useQueryClient:()=>mockClient}));
jest.mock('expo-crypto',()=>({randomUUID:()=> 'row'}));
jest.mock('../../lib/logger',()=>({logError:jest.fn()}));
jest.mock('../../lib/supabase',()=>({supabase:{auth:{getUser:()=>mockAuth()},from:(table:string)=>{
 let operation='read',payload:any,filters:any[]=[];const q:any={select:()=>q,eq:(...pair:any[])=>{filters.push(pair);return q;},insert:(data:any)=>{operation='insert';payload=data;return q;},delete:()=>{operation='delete';return q;},maybeSingle:()=>operation==='read'?mockRead(table,filters):mockWrite(operation,payload,filters)};return q;
}}}));
const entry={id:'row',event_id:'plan',user_id:'alice',notified:false,exception_status:null,exception_expires_at:null};
const response=(data:any)=>({data,error:null});
const auth=()=>({data:{user:{id:'alice'}},error:null});
const deferred=()=>{let resolve!:(data:any)=>void;const promise=new Promise<any>(r=>resolve=r);return{promise,resolve};};
let tree:ReturnType<typeof create>|undefined;
async function mount(owner="alice",eventId="plan"){
 let current!:ReturnType<typeof usePlanWaitlist>,epoch=1,allowed=true;
 function Harness(){const captured=epoch;current=usePlanWaitlist({eventId,viewerId:owner,epoch,isCurrent:()=>captured===epoch,canChange:()=>allowed});return null;}
 await act(async()=>{tree=create(<Harness/>);});
 return{get current(){return current;},retire:()=>{epoch++;},deny:()=>{allowed=false;},blur:()=>act(()=>mockBlur?.()),focus:async()=>{await act(async()=>{mockBlur=mockFocus?.() as any;});},renderNewAccount:async()=>{epoch++;await act(async()=>tree!.update(<Harness/>));}};
}
beforeEach(()=>{mockClient={invalidateQueries:mockInvalidate};jest.clearAllMocks();mockAuth.mockReset().mockResolvedValue(auth());mockRead.mockReset().mockResolvedValue(response(null));mockWrite.mockReset().mockResolvedValue(response(entry));mockInvalidate.mockResolvedValue(undefined);});
afterEach(()=>{if(tree)act(()=>tree!.unmount());tree=undefined;});
it('reads only the initiating account and plan and keeps empty distinct from failure',async()=>{const h=await mount();expect(mockRead).toHaveBeenCalledWith('event_waitlist',[['event_id','plan'],['user_id','alice']]);expect(h.current.ready).toBe(true);expect(h.current.entry).toBeNull();mockRead.mockResolvedValue({data:null,error:new Error('Offline')});await act(async()=>h.current.refresh());expect(h.current.ready).toBe(false);expect(h.current.error).toContain('Couldn’t check');await act(async()=>h.current.change(true));expect(mockWrite).not.toHaveBeenCalled();});
it('catches transport rejection rather than interpreting it as no row',async()=>{mockRead.mockRejectedValue(new Error('Offline'));const h=await mount();expect(h.current.ready).toBe(false);expect(h.current.loading).toBe(false);expect(h.current.error).toBeTruthy();});
it.each([{...entry,event_id:'other'},{...entry,user_id:'other'},[],{}])('rejects a malformed or unrelated read %p',async(row)=>{mockRead.mockResolvedValue(response(row));const h=await mount();expect(h.current.ready).toBe(false);expect(h.current.entry).toBeNull();});
it('does not let an older focus read overwrite a newer one',async()=>{const old=deferred();mockRead.mockReturnValueOnce(old.promise).mockResolvedValue(response(entry));const h=await mount();h.blur();await h.focus();expect(h.current.entry).toEqual(entry);await act(async()=>old.resolve(response(null)));expect(h.current.entry).toEqual(entry);});
it('retires old account reads',async()=>{const old=deferred();mockRead.mockReturnValueOnce(old.promise).mockResolvedValue(response(null));const h=await mount();await h.renderNewAccount();await act(async()=>old.resolve(response(entry)));expect(h.current.entry).toBeNull();});
it('requires fresh matching authentication for reads',async()=>{mockAuth.mockResolvedValue({data:{user:{id:'bob'}},error:null});const h=await mount();expect(mockRead).not.toHaveBeenCalled();expect(h.current.ready).toBe(false);});
it('locks before write authentication so rapid taps cannot overlap',async()=>{const h=await mount(),pending=deferred();mockAuth.mockReturnValueOnce(pending.promise);let work!:Promise<void>;act(()=>{work=h.current.change(true);void h.current.change(true);void h.current.change(false);});expect(h.current.busy).toBe(true);await act(async()=>{pending.resolve(auth());await work;});expect(mockWrite).toHaveBeenCalledTimes(1);expect(h.current.entry).toEqual(entry);expect(h.current.intent).toBeNull();});
it('does not dispatch after eligibility changes during authentication',async()=>{const h=await mount(),pending=deferred();mockAuth.mockReturnValueOnce(pending.promise);let work!:Promise<void>;act(()=>{work=h.current.change(true);});h.deny();await act(async()=>{pending.resolve(auth());await work;});expect(mockWrite).not.toHaveBeenCalled();expect(h.current.intent).toBeNull();});
it('does not dispatch after the initiating account retires',async()=>{const h=await mount(),pending=deferred();mockAuth.mockReturnValueOnce(pending.promise);let work!:Promise<void>;act(()=>{work=h.current.change(true);});h.retire();await act(async()=>{pending.resolve(auth());await work;});expect(mockWrite).not.toHaveBeenCalled();});
it('retains the original desired action after a rejected transaction',async()=>{mockWrite.mockResolvedValueOnce({data:null,error:{code:'42501'}});const h=await mount();await act(async()=>h.current.change(true));expect(h.current.intent).toMatchObject({desired:true,phase:'failed'});await act(async()=>h.current.change(false));expect(mockWrite).toHaveBeenCalledTimes(1);await act(async()=>h.current.retry());expect(mockWrite).toHaveBeenCalledTimes(2);expect(mockWrite.mock.calls[1][0]).toBe('insert');expect(h.current.entry).toEqual(entry);});
it('deletes exactly the originally observed own row',async()=>{mockRead.mockResolvedValue(response(entry));const h=await mount();await act(async()=>h.current.change(false));expect(mockWrite).toHaveBeenCalledWith('delete',undefined,[['id','row'],['event_id','plan'],['user_id','alice']]);expect(h.current.entry).toBeNull();});
it('requires the same deleted row in the receipt',async()=>{mockRead.mockResolvedValue(response(entry));mockWrite.mockResolvedValue(response({...entry,id:'other'}));const h=await mount();await act(async()=>h.current.change(false));expect(h.current.intent?.phase).toBe('unknown');expect(h.current.entry).toEqual(entry);});
it.each([null,[],{...entry,user_id:'other'}])('keeps an unconfirmed insert %p unresolved without repeating it',async(data)=>{mockWrite.mockResolvedValue(response(data));const h=await mount();await act(async()=>h.current.change(true));expect(h.current.intent?.phase).toBe('unknown');await act(async()=>h.current.change(true));await act(async()=>h.current.retry());expect(mockWrite).toHaveBeenCalledTimes(1);expect(h.current.entry).toBeNull();});
it('confirms an uncertain join using a read without another insert',async()=>{mockWrite.mockRejectedValue(new Error('Lost receipt'));const h=await mount();await act(async()=>h.current.change(true));mockRead.mockResolvedValue(response(entry));await act(async()=>h.current.refresh());expect(h.current.intent).toBeNull();expect(h.current.entry).toEqual(entry);expect(mockWrite).toHaveBeenCalledTimes(1);});
it('confirms uncertain removal only after a successful empty own-row read',async()=>{mockRead.mockResolvedValue(response(entry));mockWrite.mockResolvedValue(response(null));const h=await mount();await act(async()=>h.current.change(false));mockRead.mockRejectedValueOnce(new Error('Offline'));await act(async()=>h.current.refresh());expect(h.current.intent?.phase).toBe('unknown');mockRead.mockResolvedValue(response(null));await act(async()=>h.current.refresh());expect(h.current.intent).toBeNull();expect(h.current.entry).toBeNull();expect(mockWrite).toHaveBeenCalledTimes(1);});
it('keeps an opposite fresh result uncertain instead of enabling another write',async()=>{mockWrite.mockResolvedValue(response(null));const h=await mount();await act(async()=>h.current.change(true));await act(async()=>h.current.refresh());expect(h.current.intent?.phase).toBe('unknown');expect(h.current.error).toContain('still can’t confirm');});
it('reconciles a duplicate insert with the existing own row',async()=>{const h=await mount();mockWrite.mockResolvedValue({data:null,error:{code:'23505'}});mockRead.mockResolvedValue(response(entry));await act(async()=>h.current.change(true));expect(h.current.entry).toEqual(entry);expect(h.current.intent).toBeNull();expect(mockWrite).toHaveBeenCalledTimes(1);});
it('does not let an old refresh restore waitlist state after confirmed joining',async()=>{const h=await mount(),read=deferred();mockRead.mockReturnValueOnce(read.promise);let work!:Promise<void>;act(()=>{work=h.current.refresh();});act(()=>h.current.clearAfterJoining());await act(async()=>{read.resolve(response({...entry,notified:true,exception_status:'invited'}));await work;});expect(h.current.entry).toBeNull();expect(h.current.loading).toBe(false);});
it('does not allow a late waitlist write to replace confirmed plan membership',async()=>{const h=await mount(),write=deferred();mockWrite.mockReturnValueOnce(write.promise);let work!:Promise<void>;await act(async()=>{work=h.current.change(true);});act(()=>h.current.clearAfterJoining());await act(async()=>{write.resolve(response(entry));await work;});expect(h.current.entry).toBeNull();expect(h.current.intent).toBeNull();});
it('retains a lost write receipt across leaving and returning to the same route',async()=>{const h=await mount(),write=deferred();mockWrite.mockReturnValueOnce(write.promise);let work!:Promise<void>;await act(async()=>{work=h.current.change(true);});h.blur();await act(async()=>{write.resolve(response(null));await work;});await h.focus();expect(h.current.intent?.phase).toBe('unknown');expect(mockWrite).toHaveBeenCalledTimes(1);});


it.each(['auth','row'] as const)('recovers a stalled initial %s read without treating it as an empty waitlist',async stage=>{
 const pending=deferred();if(stage==='auth')mockAuth.mockReturnValueOnce(pending.promise);else mockRead.mockReturnValueOnce(pending.promise);
 jest.useFakeTimers();
 try {const h=await mount();expect(h.current.loading).toBe(true);await act(async()=>jest.advanceTimersByTimeAsync(stage==='auth'?8001:12001));expect(h.current.loading).toBe(false);expect(h.current.ready).toBe(false);expect(h.current.error).toContain('Couldn’t check');
 await act(async()=>pending.resolve(stage==='auth'?auth():response(entry)));expect(h.current.entry).toBeNull();expect(h.current.ready).toBe(false);expect(mockWrite).not.toHaveBeenCalled();
 await act(async()=>h.current.refresh());expect(h.current.ready).toBe(true);expect(h.current.entry).toBeNull();
 }finally{jest.useRealTimers();}
});
it.each([true,false])('recovers stalled write preflight preserving desired=%s without late dispatch',async desired=>{
 if(!desired)mockRead.mockResolvedValue(response(entry));const h=await mount(),pending=deferred();mockAuth.mockReturnValueOnce(pending.promise);jest.useFakeTimers();
 try {act(()=>{void h.current.change(desired)});await act(async()=>jest.advanceTimersByTimeAsync(8001));expect(h.current.busy).toBe(false);expect(h.current.intent).toEqual({desired,phase:'failed'});expect(mockWrite).not.toHaveBeenCalled();
 await act(async()=>pending.resolve(auth()));expect(mockWrite).not.toHaveBeenCalled();await act(async()=>h.current.retry());expect(mockWrite).toHaveBeenCalledTimes(1);expect(mockWrite.mock.calls[0][0]).toBe(desired?'insert':'delete');expect(h.current.intent).toBeNull();
 }finally{jest.useRealTimers();}
});
it('keeps an uncertain waitlist write locked after a reconciliation timeout',async()=>{
 const h=await mount();mockWrite.mockResolvedValueOnce(response(null));await act(async()=>h.current.change(true));expect(h.current.intent?.phase).toBe('unknown');const pending=deferred();mockRead.mockReturnValueOnce(pending.promise);jest.useFakeTimers();
 try {act(()=>{void h.current.refresh()});await act(async()=>jest.advanceTimersByTimeAsync(12001));expect(h.current.loading).toBe(false);expect(h.current.intent?.phase).toBe('unknown');await act(async()=>h.current.retry());await act(async()=>h.current.change(true));expect(mockWrite).toHaveBeenCalledTimes(1);
 await act(async()=>pending.resolve(response(entry)));expect(h.current.intent?.phase).toBe('unknown');mockRead.mockResolvedValueOnce(response(entry));await act(async()=>h.current.refresh());expect(h.current.intent).toBeNull();expect(h.current.entry).toEqual(entry);expect(mockWrite).toHaveBeenCalledTimes(1);
 }finally{jest.useRealTimers();}
});
it('releases the waiting screen and still observes a late waitlist receipt',async()=>{
 const h=await mount(),pending=deferred();mockWrite.mockReturnValueOnce(pending.promise);jest.useFakeTimers();
 try {act(()=>{void h.current.change(true)});await act(async()=>jest.advanceTimersByTimeAsync(30000));expect(h.current.busy).toBe(false);await act(async()=>h.current.retry());expect(mockWrite).toHaveBeenCalledTimes(1);await act(async()=>pending.resolve(response(entry)));expect(h.current.entry).toEqual(entry);expect(h.current.intent).toBeNull();}finally{jest.useRealTimers();}
});

it.each([true,false])('must not repeat unresolved desired waitlist membership %p after leaving and returning',async desired=>{
  jest.useFakeTimers();
  try {
    const held=deferred();mockRead.mockResolvedValue(response(desired?null:entry));mockWrite.mockReturnValue(held.promise);
    const first=await mount();await act(async()=>{void first.current.change(desired);});
    await act(async()=>{await jest.advanceTimersByTimeAsync(31000);});
    act(()=>tree!.unmount());tree=undefined;
    const second=await mount();
    await act(async()=>{void second.current.change(desired);});
    expect(mockWrite).toHaveBeenCalledTimes(1);
  }finally{jest.useRealTimers();}
});
it.each([true,false])('must offer a read-only status check after a held %p change',async desired=>{
  jest.useFakeTimers();
  try {
    const held=deferred();mockRead.mockResolvedValue(response(desired?null:entry));mockWrite.mockReturnValue(held.promise);
    const h=await mount();await act(async()=>{void h.current.change(desired);});
    await act(async()=>{await jest.advanceTimersByTimeAsync(31000);});
    expect(h.current.busy).toBe(false); expect(h.current.intent?.phase).toBe('unknown');
    await act(async()=>{await h.current.refresh();await h.current.retry();});expect(mockWrite).toHaveBeenCalledTimes(1);
  }finally{jest.useRealTimers();}
});

it('does not confuse another join on the same account and plan with the pending insert',async()=>{
  const h=await mount(), held=deferred();
  mockWrite.mockReturnValueOnce(held.promise);
  jest.useFakeTimers();
  try {
    let write!:Promise<void>;await act(async()=>{write=h.current.change(true);});
    await act(async()=>{await jest.advanceTimersByTimeAsync(12001);await write;});
    expect(mockWrite.mock.calls[0][1]).toEqual({event_id:'plan',user_id:'alice',id:'row'});
    mockRead.mockResolvedValue(response({...entry,id:'second-device'}));
    await act(async()=>{await h.current.refresh();await h.current.change(false);});
    expect(h.current.intent?.phase).toBe('unknown');expect(mockWrite).toHaveBeenCalledTimes(1);
    await act(async()=>held.resolve({data:null,error:{code:'23505'}}));
    await act(async()=>h.current.refresh());expect(h.current.intent).toBeNull();expect(h.current.entry?.id).toBe('second-device');
  }finally{jest.useRealTimers();}
});
it.each(['pending','refused'] as const)('never retries a %s leave against a newer row',async outcome=>{
  const held=deferred();mockRead.mockResolvedValue(response(entry));mockWrite.mockReturnValueOnce(held.promise);
  const first=await mount();await act(async()=>{void first.current.change(false);});
  if(outcome==='refused')await act(async()=>held.resolve({data:null,error:{code:'42501'}}));
  act(()=>tree!.unmount());tree=undefined;
  mockRead.mockResolvedValue(response({...entry,id:'rejoined'}));const second=await mount();
  await act(async()=>second.current.retry());expect(mockWrite).toHaveBeenCalledTimes(1);
  if(outcome==='pending')await act(async()=>held.resolve(response(entry)));
  expect(second.current.entry?.id).toBe('rejoined');expect(second.current.intent).toBeNull();
});
it('keeps an older submit from touching the new account or another plan',async()=>{
  const held=deferred();mockWrite.mockReturnValueOnce(held.promise);const first=await mount();
  await act(async()=>{void first.current.change(true);});act(()=>tree!.unmount());tree=undefined;
  const otherPlan=await mount('alice','second-plan');expect(otherPlan.current.intent).toBeNull();
  act(()=>tree!.unmount());tree=undefined;mockAuth.mockResolvedValue({data:{user:{id:'bob'}},error:null});
  const bob=await mount('bob','plan');await act(async()=>held.resolve(response(entry)));
  expect(bob.current.intent).toBeNull();expect(bob.current.entry).toBeNull();expect(mockWrite).toHaveBeenCalledTimes(1);
  expect(mockInvalidate).not.toHaveBeenCalledWith({queryKey:['waitlisted-plans','bob']});
});
it('does not dispatch a waitlist insert after a confirmed plan join during preflight',async()=>{
  const h=await mount(),authCheck=deferred();mockAuth.mockReturnValueOnce(authCheck.promise);
  let write!:Promise<void>;act(()=>{write=h.current.change(true);});
  act(()=>h.current.clearAfterJoining());await act(async()=>{authCheck.resolve(auth());await write;});
  expect(mockWrite).not.toHaveBeenCalled();expect(h.current.intent).toBeNull();
});
it('allows an explicit retry after a proven duplicate and a verified empty status check',async()=>{
  mockWrite.mockResolvedValueOnce({data:null,error:{code:'23505'}});
  const h=await mount();await act(async()=>h.current.change(true));expect(mockWrite).toHaveBeenCalledTimes(1);
  expect(h.current.intent).toMatchObject({phase:'failed',desired:true});
  await act(async()=>h.current.retry());expect(mockWrite).toHaveBeenCalledTimes(2);expect(h.current.entry).toEqual(entry);
});
