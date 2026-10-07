import React from 'react';import {act,create} from 'react-test-renderer';
const mockStorage=new Map<string,string>();
const mockGet=jest.fn(),mockSet=jest.fn(),mockRemove=jest.fn();
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{getItem:(k:string)=>mockGet(k),setItem:(k:string,v:string)=>mockSet(k,v),removeItem:(k:string)=>mockRemove(k)}}));
jest.mock('expo-crypto',()=>({randomUUID:()=> '0f900000-0000-4000-8000-000000000020'}));
jest.mock('../../lib/supabase',()=>({supabase:{}}));
jest.mock('../../lib/creatorPageEventStatus',()=>({...jest.requireActual('../../lib/creatorPageEventStatus'),getPageEventStatusAttempt:jest.fn(),setPageEventStatus:jest.fn()}));
jest.mock('../../lib/creatorPageEventSave',()=>({getPageEventSaveState:jest.fn()}));
jest.mock('../../lib/creatorPageEventReadiness',()=>({loadCreatorPageEventReadiness:jest.fn()}));
import * as status from '../../lib/creatorPageEventStatus';import {getPageEventSaveState} from '../../lib/creatorPageEventSave';import {loadCreatorPageEventReadiness} from '../../lib/creatorPageEventReadiness';import {useCreatorPageEventStatus} from '../useCreatorPageEventStatus';
const page='f5d7644a-2ff5-4def-b0ab-d04b8250892b',event='0f900000-0000-4000-8000-000000000010',request='0f900000-0000-4000-8000-000000000020',user='0e6e1827-0f87-4e03-b42b-7ade8219725b';let active=true;const scope={userId:user,isCurrent:()=>active},input={status:'Cancelled' as const,expectedUpdatedAt:'2026-09-15T01:00:00Z'},receipt={...input,pageId:page,eventId:event,requestId:request,userId:user,updatedAt:'2026-09-15T02:00:00Z'};
const write=status.setPageEventStatus as jest.Mock,read=status.getPageEventStatusAttempt as jest.Mock,stateRead=getPageEventSaveState as jest.Mock,ready=loadCreatorPageEventReadiness as jest.Mock;const trees:ReturnType<typeof create>[]=[];
function mount(){let value!:ReturnType<typeof useCreatorPageEventStatus>;function H(){value=useCreatorPageEventStatus(page,event,scope);return null;}let tree!:ReturnType<typeof create>;act(()=>{tree=create(<H/>);});trees.push(tree);return{get value(){return value;},close:()=>act(()=>tree.unmount())};}
async function flush(){for(let n=0;n<8;n++)await act(async()=>{await Promise.resolve();});}
beforeEach(()=>{jest.resetAllMocks();mockGet.mockImplementation(async(k:string)=>mockStorage.get(k)??null);mockSet.mockImplementation(async(k:string,v:string)=>{mockStorage.set(k,v);});mockRemove.mockImplementation(async(k:string)=>{mockStorage.delete(k);});mockStorage.clear();active=true;read.mockResolvedValue(null);stateRead.mockResolvedValue({status:'Live',updatedAt:input.expectedUpdatedAt});ready.mockResolvedValue({cancellationRequiresRefunds:false});write.mockResolvedValue(receipt);});
const release:(()=>void)[]=[];
function deferred<T>(value:T){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});release.push(()=>resolve(value));return {promise,resolve};}
afterEach(async()=>{for(const tree of trees.splice(0))act(()=>tree.unmount());for(const settle of release.splice(0))settle();await flush();jest.useRealTimers();});
it('mounting reads pending storage without status or financial writes',async()=>{const f=mount();await flush();expect(f.value.canWrite()).toBe(true);expect(write).not.toHaveBeenCalled();});
it('persists before optional financial work and never overlaps a second action',async()=>{const f=mount();await flush();const financial=jest.fn(async()=>{expect(mockStorage.size).toBe(1);await expect(f.value.begin(input)).rejects.toThrow();});await act(async()=>{await f.value.begin(input,financial);});expect(financial).toHaveBeenCalledTimes(1);expect(write).toHaveBeenCalledTimes(1);expect(mockStorage.size).toBe(0);expect(f.value.outcome).toEqual(receipt);});
it('lost committed response is recovered on return without replaying financial work',async()=>{write.mockRejectedValue(Error('Lost response'));const financial=jest.fn(async()=>{}),a=mount();await flush();await act(async()=>{await expect(a.value.begin(input,financial)).rejects.toThrow();});a.close();read.mockResolvedValue(receipt);stateRead.mockResolvedValue({status:'Cancelled',updatedAt:receipt.updatedAt});const b=mount();await flush();expect(b.value.outcome).toEqual(receipt);expect(financial).toHaveBeenCalledTimes(1);expect(write).toHaveBeenCalledTimes(1);expect(mockStorage.size).toBe(0);});
it('an interrupted financial callback leaves the original intent for a read-only check',async()=>{const f=mount();await flush();await act(async()=>{await expect(f.value.begin(input,async()=>{throw Error('Unconfirmed money');})).rejects.toThrow();});expect(write).not.toHaveBeenCalled();ready.mockResolvedValue({cancellationRequiresRefunds:true});await act(async()=>{await f.value.check();});expect(f.value.refundsNeedReview).toBe(true);expect(f.value.retryReady).toBe(false);expect(mockStorage.size).toBe(1);});
it('after verified settlement explicit original status retry never replays refunds',async()=>{const f=mount();await flush();const financial=jest.fn(async()=>{throw Error('Interrupted');});await act(async()=>{await expect(f.value.begin(input,financial)).rejects.toThrow();await f.value.check();});expect(f.value.retryReady).toBe(true);await act(async()=>{await f.value.retry();});expect(financial).toHaveBeenCalledTimes(1);expect(write).toHaveBeenCalledWith(page,event,request,input,expect.objectContaining({userId:user,isCurrent:expect.any(Function)}));});
it('a new outstanding paid order blocks status retry after an earlier clear check',async()=>{write.mockRejectedValueOnce(Error('Disconnected'));const f=mount();await flush();await act(async()=>{await expect(f.value.begin(input)).rejects.toThrow();await f.value.check();});ready.mockResolvedValue({cancellationRequiresRefunds:true});await act(async()=>{await f.value.retry();});expect(write).toHaveBeenCalledTimes(1);expect(f.value.refundsNeedReview).toBe(true);});
it('a newer event version requires review, after checking twice for the original receipt',async()=>{write.mockRejectedValueOnce(Error('Lost response'));const f=mount();await flush();await act(async()=>{await expect(f.value.begin(input)).rejects.toThrow();});stateRead.mockResolvedValue({status:'Live',updatedAt:receipt.updatedAt});await act(async()=>{await f.value.check();});expect(read).toHaveBeenCalledTimes(2);expect(f.value.conflict).toBe(true);expect(f.value.canWrite()).toBe(false);expect(mockStorage.size).toBe(0);});
it('an original late commit wins over treating a changed version as conflict',async()=>{write.mockRejectedValueOnce(Error('Lost response'));const f=mount();await flush();await act(async()=>{await expect(f.value.begin(input)).rejects.toThrow();});stateRead.mockResolvedValue({status:'Cancelled',updatedAt:receipt.updatedAt});read.mockResolvedValueOnce(null).mockResolvedValueOnce(receipt);await act(async()=>{await f.value.check();});expect(f.value.outcome).toEqual(receipt);expect(f.value.conflict).toBe(false);});
it('a retired visit cannot dispatch status after financial work returns',async()=>{const f=mount();await flush();await act(async()=>{await expect(f.value.begin(input,async()=>{active=false;})).rejects.toThrow();});expect(write).not.toHaveBeenCalled();expect(mockStorage.size).toBe(1);});

async function tick(ms:number){await act(async()=>{jest.advanceTimersByTime(ms);});await flush();}
it('releases a stalled initial journal read and blocks a late stale response',async()=>{
 jest.useFakeTimers();const d=deferred<string|null>(null);mockGet.mockReturnValueOnce(d.promise);
 const f=mount();await flush();await tick(12_001);
 expect(f.value.busy).toBe(false);expect(f.value.error).toBeTruthy();expect(f.value.canWrite()).toBe(false);
 d.resolve(null);await flush();expect(f.value.error).toBeTruthy();
 await act(async()=>{await f.value.check();});expect(f.value.canWrite()).toBe(true);
});
it('retires a timed out financial callback before it can dispatch status',async()=>{
 jest.useFakeTimers();const f=mount();await flush();const d=deferred<void>(undefined);let owned:any;
 let action:Promise<unknown>;act(()=>{action=f.value.begin(input,async(s:any)=>{owned=s;await d.promise;}).catch(e=>e);});await flush();
 await tick(25_001);expect(f.value.busy).toBe(false);expect(f.value.pending?.requestId).toBe(request);expect(owned.isCurrent()).toBe(false);
 await act(async()=>{await f.value.check();});expect(f.value.retryReady).toBe(true);
 d.resolve(undefined);await flush();expect(write).not.toHaveBeenCalled();await action!;
});
it('keeps the original uncertain request after a status timeout and checks without another write',async()=>{
 jest.useFakeTimers();const f=mount();await flush();const d=deferred(receipt);write.mockReturnValueOnce(d.promise);
 let action:Promise<unknown>;act(()=>{action=f.value.begin(input).catch(e=>e);});await flush();await tick(25_001);
 expect(f.value.busy).toBe(false);expect(f.value.error).toBeTruthy();expect(f.value.pending?.requestId).toBe(request);
 read.mockResolvedValue(receipt);await act(async()=>{await f.value.check();});expect(f.value.outcome).toEqual(receipt);expect(mockStorage.size).toBe(0);
 d.resolve({...receipt,updatedAt:'2026-09-15T09:00:00Z'});await flush();expect(f.value.outcome).toEqual(receipt);expect(write).toHaveBeenCalledTimes(1);await action!;
});
it('allows another read after a stalled status check without replaying the action',async()=>{
 jest.useFakeTimers();const f=mount();await flush();write.mockRejectedValueOnce(Error('Lost response'));
 await act(async()=>{await f.value.begin(input).catch(()=>{});});const d=deferred<any>(null);read.mockReturnValueOnce(d.promise);
 let check:Promise<unknown>;act(()=>{check=f.value.check();});await flush();await tick(12_001);
 expect(f.value.busy).toBe(false);expect(f.value.retryReady).toBe(false);expect(f.value.pending?.requestId).toBe(request);
 read.mockResolvedValue(receipt);await act(async()=>{await f.value.check();});d.resolve(null);await flush();await check!;
 expect(f.value.outcome).toEqual(receipt);expect(write).toHaveBeenCalledTimes(1);
});
it('keeps a confirmed outcome when its journal cleanup stalls',async()=>{
 jest.useFakeTimers();const f=mount();await flush();const d=deferred<void>(undefined);mockRemove.mockReturnValueOnce(d.promise);
 let action:Promise<unknown>;act(()=>{action=f.value.begin(input).catch(e=>e);});await flush();await tick(3_001);
 expect(f.value.busy).toBe(false);expect(f.value.outcome).toEqual(receipt);expect(f.value.error).toContain('recorded');expect(f.value.canWrite()).toBe(false);
 d.resolve(undefined);await flush();await action!;
});
it('cannot proceed from delayed journal preparation after the action timed out',async()=>{
 jest.useFakeTimers();const f=mount();await flush();const d=deferred<void>(undefined);mockSet.mockReturnValueOnce(d.promise);const financial=jest.fn(async()=>{});
 let action:Promise<unknown>;act(()=>{action=f.value.begin(input,financial).catch(e=>e);});await flush();await tick(25_001);
 expect(f.value.busy).toBe(false);expect(f.value.canWrite()).toBe(false);d.resolve(undefined);await flush();await action!;
 expect(financial).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
});
