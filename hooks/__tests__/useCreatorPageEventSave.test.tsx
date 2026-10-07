import React from 'react';import {act,create} from 'react-test-renderer';
const mockStorage=new Map<string,string>(),mockGet=jest.fn(),mockSet=jest.fn(),mockRemove=jest.fn();
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{getItem:(...a:unknown[])=>mockGet(...a),setItem:(...a:unknown[])=>mockSet(...a),removeItem:(...a:unknown[])=>mockRemove(...a)}}));
jest.mock('expo-crypto',()=>({randomUUID:()=> '0f830000-0000-4000-8000-000000000011'}));
jest.mock('../../lib/supabase',()=>({supabase:{}}));
jest.mock('../../lib/creatorPageEventSave',()=>({...jest.requireActual('../../lib/creatorPageEventSave'),getPageEventSaveState:jest.fn(),getPageEventSaveAttempt:jest.fn(),savePageEvent:jest.fn()}));
import * as api from '../../lib/creatorPageEventSave';import {useCreatorPageEventSave} from '../useCreatorPageEventSave';
const page='f5d7644a-2ff5-4def-b0ab-d04b8250892b',event='0f830000-0000-4000-8000-000000000001',request='0f830000-0000-4000-8000-000000000011',user='0e6e1827-0f87-4e03-b42b-7ade8219725b';let active=true;const scope={userId:user,isCurrent:()=>active};
const input:Omit<api.PageEventSaveInput,'expectedUpdatedAt'>={fields:{title:'Full event',description:'Story',image_url:'',event_date:'',start_time:null,end_time:null,venue:'',venue_address:'',category:'Social',external_url:'',ticket_price:'',public_name:'',pin_to_chat:true},offerType:'free_event',ticketCapacity:25,latitude:null,longitude:null};
const initial:api.PageEventSaveState={fields:input.fields,pageId:page,eventId:event,updatedAt:'2026-09-15T01:00:00Z',status:'Draft',offerType:'ticketed_event',ticketCapacity:null,latitude:null,longitude:null,canManageTickets:true};
const receipt:api.PageEventSaveReceipt={...initial,updatedAt:'2026-09-15T01:01:00Z',offerType:'free_event',ticketCapacity:25,requestId:request,userId:user};
const write=jest.mocked(api.savePageEvent),read=jest.mocked(api.getPageEventSaveState),check=jest.mocked(api.getPageEventSaveAttempt);
const closes:Array<()=>void>=[],settlePending:Array<()=>void>=[];async function flush(){await act(async()=>{for(let i=0;i<24;i++)await Promise.resolve();});}
function mount(){let value!:ReturnType<typeof useCreatorPageEventSave>,tree!:ReturnType<typeof create>;function H(){value=useCreatorPageEventSave(page,event,scope);return null;}act(()=>{tree=create(<H/>);});let closed=false;const close=()=>{if(!closed){act(()=>tree.unmount());closed=true;}};closes.push(close);return{get value(){return value;},close};}
beforeEach(()=>{jest.resetAllMocks();mockStorage.clear();active=true;mockGet.mockImplementation(async k=>mockStorage.get(k)??null);mockSet.mockImplementation(async(k,v)=>{mockStorage.set(k,v);});mockRemove.mockImplementation(async k=>{mockStorage.delete(k);});read.mockResolvedValue(initial);check.mockResolvedValue(null);write.mockResolvedValue(receipt);});
afterEach(async()=>{closes.splice(0).forEach(f=>f());settlePending.splice(0).forEach(f=>f());await flush();jest.useRealTimers();});
it('loads actual saved settings without performing any write',async()=>{const f=mount();await flush();expect(f.value.ready).toBe(true);expect(f.value.current?.offerType).toBe('ticketed_event');expect(write).not.toHaveBeenCalled();});
it('persists a complete snapshot and serializes immediate repeated saves',async()=>{const f=mount();await flush();await act(async()=>{const a=f.value.save(input);await expect(f.value.save(input)).rejects.toThrow('Check');await a;});expect(write).toHaveBeenCalledTimes(1);expect(write).toHaveBeenCalledWith(page,event,request,{...input,expectedUpdatedAt:initial.updatedAt},expect.objectContaining({userId:user,isCurrent:expect.any(Function)}));expect(f.value.confirmedInput).toEqual({...input,expectedUpdatedAt:initial.updatedAt});expect(mockStorage.size).toBe(0);});
it('unknown save survives reopening and read-only recovery never replays it',async()=>{write.mockRejectedValue(Error('Lost'));const f=mount();await flush();await act(async()=>{await expect(f.value.save(input)).rejects.toThrow('Lost');});f.close();const next=mount();await flush();expect(next.value.recoveryRequired).toBe(true);expect(next.value.retryReady).toBe(false);check.mockResolvedValue(receipt);read.mockResolvedValue(receipt);await act(async()=>{await next.value.check();});expect(write).toHaveBeenCalledTimes(1);expect(next.value.ready).toBe(true);expect(next.value.confirmedInput?.fields).toEqual(input.fields);});
it('only an explicit retry after a successful no-result check repeats the identical attempt',async()=>{write.mockRejectedValueOnce(Error('Lost'));const f=mount();await flush();await act(async()=>{await expect(f.value.save(input)).rejects.toThrow();await f.value.check();});expect(f.value.retryReady).toBe(true);expect(write).toHaveBeenCalledTimes(1);await act(async()=>{await f.value.retry();});expect(write).toHaveBeenCalledTimes(2);expect(write.mock.calls[1].slice(0,4)).toEqual(write.mock.calls[0].slice(0,4));expect(write.mock.calls[1][4].userId).toBe(user);});
it('stale conflict rechecks a possible late receipt before requiring fresh event review',async()=>{write.mockRejectedValue(new api.PageEventSaveConflict());const f=mount();await flush();await act(async()=>{await expect(f.value.save(input)).rejects.toThrow();});read.mockResolvedValue({...initial,updatedAt:'2026-09-15T01:02:00Z'});await act(async()=>{await f.value.check();});expect(check).toHaveBeenCalledTimes(2);expect(f.value.conflict).toBe(true);expect(f.value.retryReady).toBe(false);expect(mockStorage.size).toBe(0);expect(write).toHaveBeenCalledTimes(1);});
it('failed recovery retains the pending save without enabling another write',async()=>{write.mockRejectedValue(Error('Lost'));const f=mount();await flush();await act(async()=>{await expect(f.value.save(input)).rejects.toThrow();});check.mockRejectedValue(Error('Offline'));await act(async()=>{await f.value.check();});expect(f.value.recoveryRequired).toBe(true);expect(f.value.retryReady).toBe(false);expect(mockStorage.size).toBe(1);});
it('confirmed save remains confirmed if local cleanup fails',async()=>{mockRemove.mockRejectedValueOnce(Error('Storage unavailable'));const f=mount();await flush();await act(async()=>{await expect(f.value.save(input)).rejects.toThrow();});expect(f.value.outcome).toEqual(receipt);expect(f.value.recoveryRequired).toBe(true);check.mockResolvedValue(receipt);read.mockResolvedValue(receipt);await act(async()=>{await f.value.check();});expect(f.value.recoveryRequired).toBe(false);expect(write).toHaveBeenCalledTimes(1);});
it('invalid capacity does not become an uncertain dispatched save',async()=>{const f=mount();await flush();await act(async()=>{await expect(f.value.save({...input,ticketCapacity:0})).rejects.toThrow('Capacity');});expect(f.value.recoveryRequired).toBe(false);expect(write).not.toHaveBeenCalled();expect(mockStorage.size).toBe(0);});
it('a definite rejected transaction permits correction only after its missing receipt is verified',async()=>{write.mockRejectedValue({code:'P0001',message:'Not authorized'});const f=mount();await flush();await act(async()=>{await expect(f.value.save(input)).rejects.toMatchObject({code:'P0001'});});expect(check).toHaveBeenCalledWith(page,event,request,expect.objectContaining({userId:user,isCurrent:expect.any(Function)}));expect(f.value.recoveryRequired).toBe(false);expect(f.value.ready).toBe(true);expect(mockStorage.size).toBe(0);});
it('a failed receipt check after definitive rejection still preserves recovery',async()=>{write.mockRejectedValue({code:'22023'});check.mockRejectedValue(Error('Offline'));const f=mount();await flush();await act(async()=>{await expect(f.value.save(input)).rejects.toMatchObject({code:'22023'});});expect(f.value.recoveryRequired).toBe(true);expect(mockStorage.size).toBe(1);});
it('an older callback reads the current synchronous save lock',async()=>{const f=mount();await flush();const canWrite=f.value.canWrite;let finish!:(v:api.PageEventSaveReceipt)=>void;write.mockReturnValue(new Promise(r=>{finish=r;}));let pending!:Promise<api.PageEventSaveReceipt>;await act(async()=>{pending=f.value.save(input);expect(canWrite()).toBe(false);await Promise.resolve();});await act(async()=>{finish(receipt);await pending;});expect(canWrite()).toBe(true);});

it('read-only Check cannot authorize stale editor fields against a newer version',async()=>{const f=mount();await flush();read.mockResolvedValue({...initial,fields:{...initial.fields,title:'Newer saved edit'},updatedAt:'2026-09-15T01:02:00Z'});await act(async()=>{await f.value.check();});expect(f.value.current?.fields.title).toBe('Newer saved edit');expect(f.value.conflict).toBe(true);expect(f.value.ready).toBe(false);await expect(f.value.save(input)).rejects.toThrow('Check');expect(write).not.toHaveBeenCalled();});
it('read-only Check of an unchanged version keeps normal editing available',async()=>{const f=mount();await flush();await act(async()=>{await f.value.check();});expect(f.value.conflict).toBe(false);expect(f.value.canWrite()).toBe(true);expect(write).not.toHaveBeenCalled();});

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});settlePending.push(()=>resolve(undefined as T));return {promise,resolve};}
async function tick(ms:number){await act(async()=>{jest.advanceTimersByTime(ms);for(let i=0;i<24;i++)await Promise.resolve();});}
it('a stalled initial read unlocks recovery and its late result cannot replace the retried event',async()=>{
 jest.useFakeTimers();const late=deferred<api.PageEventSaveState>();read.mockReturnValueOnce(late.promise);const f=mount();await flush();
 await tick(12_000);expect(f.value.busy).toBe(false);expect(f.value.error).toBeTruthy();expect(f.value.ready).toBe(false);
 await act(async()=>f.value.refresh());expect(f.value.current).toEqual(initial);
 await act(async()=>late.resolve({...initial,fields:{...initial.fields,title:'Retired event'}}));expect(f.value.current?.fields.title).toBe('Full event');
});
it('a timed-out save keeps its original request and ignores a late receipt after explicit recovery',async()=>{
 jest.useFakeTimers();const late=deferred<api.PageEventSaveReceipt>();write.mockReturnValueOnce(late.promise);const f=mount();await flush();let pending!:Promise<unknown>;
 await act(async()=>{pending=f.value.save(input).catch(e=>e);});await tick(25_000);
 expect(f.value.busy).toBe(false);expect(f.value.recoveryRequired).toBe(true);expect(f.value.pending?.requestId).toBe(request);expect(f.value.canWrite()).toBe(false);
 expect(await pending).toBeInstanceOf(Error);const oldScope=write.mock.calls[0][4];expect(oldScope.isCurrent()).toBe(false);
 check.mockResolvedValue(receipt);read.mockResolvedValue(receipt);await act(async()=>f.value.check());expect(f.value.ready).toBe(true);expect(write).toHaveBeenCalledTimes(1);
 await act(async()=>late.resolve({...receipt,updatedAt:'2026-09-15T01:02:00Z'}));expect(f.value.current?.updatedAt).toBe(receipt.updatedAt);
});
it('timed-out preparation cannot send after storage returns late',async()=>{
 jest.useFakeTimers();const f=mount();await flush();const late=deferred<void>();mockSet.mockImplementationOnce(async(k,v)=>{await late.promise;mockStorage.set(k,v);});
 await act(async()=>{void f.value.save(input).catch(()=>{});});await tick(25_000);expect(f.value.busy).toBe(false);
 await act(async()=>late.resolve());await flush();expect(write).not.toHaveBeenCalled();expect(f.value.recoveryRequired).toBe(true);
});
it('a stalled saved-status check unlocks without resending or accepting a late stale receipt',async()=>{
 jest.useFakeTimers();write.mockRejectedValueOnce(Error('Lost'));const f=mount();await flush();await act(async()=>{await f.value.save(input).catch(()=>{});});
 const late=deferred<api.PageEventSaveReceipt|null>();check.mockReturnValueOnce(late.promise);await act(async()=>{void f.value.check();});await tick(12_000);
 expect(f.value.busy).toBe(false);expect(f.value.retryReady).toBe(false);expect(f.value.error).toBeTruthy();expect(write).toHaveBeenCalledTimes(1);
 check.mockResolvedValue(receipt);read.mockResolvedValue(receipt);await act(async()=>f.value.check());await act(async()=>late.resolve(null));
 expect(f.value.outcome).toEqual(receipt);expect(f.value.ready).toBe(true);expect(write).toHaveBeenCalledTimes(1);
});
it('a confirmed save retains its receipt and unlocks recovery when marker cleanup stalls',async()=>{
 jest.useFakeTimers();const late=deferred<void>();mockRemove.mockReturnValueOnce(late.promise);const f=mount();await flush();
 await act(async()=>{void f.value.save(input).catch(()=>{});});await tick(3_000);
 expect(f.value.busy).toBe(false);expect(f.value.outcome).toEqual(receipt);expect(f.value.confirmedInput?.fields).toEqual(input.fields);expect(f.value.recoveryRequired).toBe(true);
 await act(async()=>late.resolve());await flush();expect(write).toHaveBeenCalledTimes(1);
});
it('a failed read with no pending attempt cannot let a retained save callback use unchecked state',async()=>{
 const f=mount();await flush();const save=f.value.save;read.mockRejectedValueOnce(Error('Offline'));await act(async()=>f.value.check());
 expect(f.value.canWrite()).toBe(false);await expect(save(input)).rejects.toThrow('Check');expect(write).not.toHaveBeenCalled();
});

it('a confirmed explicit retry reports a saved event when cleanup fails',async()=>{
 const f=mount();await flush();write.mockRejectedValueOnce(Error('Lost'));
 await act(async()=>{await f.value.save(input).catch(()=>{});await f.value.check();});expect(f.value.retryReady).toBe(true);
 mockRemove.mockRejectedValueOnce(Error('Storage unavailable'));await act(async()=>f.value.retry());
 expect(f.value.outcome).toEqual(receipt);expect(f.value.error).toContain('The event saved.');expect(f.value.recoveryRequired).toBe(true);expect(write).toHaveBeenCalledTimes(2);
});
