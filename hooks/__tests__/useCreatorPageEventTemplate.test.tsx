import React from 'react';
import {act, create} from 'react-test-renderer';
const mockStorage = new Map<string,string>(), mockGet = jest.fn(), mockSet = jest.fn(), mockRemove = jest.fn();
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{getItem:(...a:unknown[])=>mockGet(...a),setItem:(...a:unknown[])=>mockSet(...a),removeItem:(...a:unknown[])=>mockRemove(...a)}}));
jest.mock('expo-crypto',()=>({randomUUID:()=> '0f830000-0000-4000-8000-000000000011'}));
jest.mock('../../lib/creatorPageEventTemplate',()=>({getPageEventTemplate:jest.fn(),savePageEventTemplate:jest.fn()}));
jest.mock('../../lib/creatorPageEventSave',()=>({getPageEventSaveState:jest.fn()}));
import {getPageEventSaveState} from '../../lib/creatorPageEventSave';
jest.mock('../../lib/supabase',()=>({supabase:{}}));
import {getPageEventTemplate,savePageEventTemplate} from '../../lib/creatorPageEventTemplate';
import {useCreatorPageEventTemplate} from '../useCreatorPageEventTemplate';
const page='f5d7644a-2ff5-4def-b0ab-d04b8250892b',event='0f830000-0000-4000-8000-000000000001',user='0e6e1827-0f87-4e03-b42b-7ade8219725b';
let active=true; const scope={userId:user,isCurrent:()=>active};
const read=jest.mocked(getPageEventTemplate),write=jest.mocked(savePageEventTemplate),saveSource=jest.fn();
const closes:Array<()=>void>=[];
const deferred:Array<()=>void>=[];
function later<T>(value:T){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});const finish=()=>resolve(value);deferred.push(finish);return {promise,finish};}
async function elapsed(ms:number){await act(async()=>{jest.advanceTimersByTime(ms);});await flush();}
async function flush(){for(let i=0;i<4;i++)await act(async()=>{await Promise.resolve();});}
function mount(){let value!:ReturnType<typeof useCreatorPageEventTemplate>,tree!:ReturnType<typeof create>;
 function H(){value=useCreatorPageEventTemplate(page,event,scope);return null;}act(()=>{tree=create(<H/>);});
 let closed=false;const close=()=>{if(!closed){act(()=>tree.unmount());closed=true;}};closes.push(close);return{get value(){return value;},close};}
beforeEach(()=>{jest.useFakeTimers();jest.resetAllMocks();mockStorage.clear();active=true;mockGet.mockImplementation(async k=>mockStorage.get(k)??null);
 mockSet.mockImplementation(async(k,v)=>{mockStorage.set(k,v);});mockRemove.mockImplementation(async k=>{mockStorage.delete(k);});read.mockResolvedValue(null);
 jest.mocked(getPageEventSaveState).mockResolvedValue({updatedAt:'2026-09-15T01:00:00Z'} as any);
 saveSource.mockResolvedValue({name:'Complete story',updatedAt:'2026-09-15T01:00:00Z'});
 write.mockImplementation(async a=>({id:a.templateId,userId:user,sourcePageId:page,sourceEventId:event,sourceUpdatedAt:a.expectedUpdatedAt,name:a.name} as any));});
afterEach(async()=>{closes.splice(0).forEach(f=>f());deferred.splice(0).forEach(f=>f());await flush();jest.useRealTimers();});
it('mount only reads local metadata and holds editing until that read completes',async()=>{
 let finish!:(v:null)=>void;mockGet.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));const f=mount();expect(f.value.ready).toBe(false);await flush();
 await act(async()=>{finish(null);});await flush();expect(f.value.ready).toBe(true);expect(read).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
});
it('synchronous busy state prevents duplicate source saves even through an older callback',async()=>{
 const f=mount();await flush();const begin=f.value.begin,canEdit=f.value.canEdit;let done!:(v:any)=>void;saveSource.mockReturnValueOnce(new Promise(r=>{done=r;}));
 let result!:Promise<unknown>;await act(async()=>{result=begin(saveSource);await expect(begin(saveSource)).rejects.toThrow('Check');});
 expect(canEdit()).toBe(false);await act(async()=>{done({name:'Complete story',updatedAt:'2026-09-15T01:00:00Z'});await result;});expect(saveSource).toHaveBeenCalledTimes(1);expect(write).toHaveBeenCalledTimes(1);
});
it('lost local persistence acknowledgement never sends a template and reopens the original',async()=>{
 const f=mount();await flush();mockSet.mockImplementationOnce(async(k,v)=>{mockStorage.set(k,v);throw Error('Lost disk ack');});
 await act(async()=>{await expect(f.value.begin(saveSource)).rejects.toThrow('Lost disk');});expect(write).not.toHaveBeenCalled();f.close();const next=mount();await flush();
 expect(next.value.recoveryRequired).toBe(true);expect(next.value.retryReady).toBe(false);expect(saveSource).toHaveBeenCalledTimes(1);
 await act(async()=>{await next.value.check();});expect(next.value.retryReady).toBe(true);expect(write).not.toHaveBeenCalled();
 await act(async()=>{await next.value.retry();});expect(write).toHaveBeenCalledTimes(1);expect(saveSource).toHaveBeenCalledTimes(1);expect(mockStorage.size).toBe(0);
});
it('an existing journal appearing before begin prevents any source mutation',async()=>{
 const f=mount();await flush();const original=require('../../lib/creatorPageEventTemplateAttempt');await original.preparePageTemplateAttempt(page,event,'Earlier source','2026-09-15T00:00:00Z',scope);
 await act(async()=>{await expect(f.value.begin(saveSource)).rejects.toThrow('Check');});expect(saveSource).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();expect(f.value.recoveryRequired).toBe(true);
});
it('a failed preflight journal read keeps editing blocked until a successful explicit check',async()=>{
 const f=mount();await flush();mockGet.mockRejectedValueOnce(Error('Unreadable journal'));
 await act(async()=>{await expect(f.value.begin(saveSource)).rejects.toThrow('Unreadable');});expect(f.value.ready).toBe(false);expect(saveSource).not.toHaveBeenCalled();
 await act(async()=>{await f.value.check();});expect(f.value.ready).toBe(true);
});
it('source save failure does not create a misleading template intent',async()=>{
 const f=mount();await flush();saveSource.mockRejectedValueOnce(Error('Source save unconfirmed'));
 await act(async()=>{await expect(f.value.begin(saveSource)).rejects.toThrow('Source save');});expect(mockStorage.size).toBe(0);expect(write).not.toHaveBeenCalled();expect(f.value.recoveryRequired).toBe(false);
});
it('read denial keeps pending intent and never enables replay',async()=>{
 const f=mount();await flush();write.mockRejectedValueOnce(Error('Lost response'));await act(async()=>{await expect(f.value.begin(saveSource)).rejects.toThrow();});
 read.mockRejectedValue({code:'42501'});await act(async()=>{await f.value.check();await f.value.retry();});
 expect(f.value.retryReady).toBe(false);expect(f.value.ready).toBe(false);expect(mockStorage.size).toBe(1);expect(write).toHaveBeenCalledTimes(1);
});
it('confirmed template remains saved when optional local cleanup fails',async()=>{
 const f=mount();await flush();mockRemove.mockRejectedValueOnce(Error('Disk busy'));
 await act(async()=>{await f.value.begin(saveSource);});expect(f.value.saved).toBe(true);expect(f.value.recoveryRequired).toBe(true);expect(f.value.retryReady).toBe(false);
 read.mockResolvedValue(await write.mock.results[0].value);await act(async()=>{await f.value.check();});expect(f.value.ready).toBe(true);expect(mockStorage.size).toBe(0);expect(write).toHaveBeenCalledTimes(1);
});
it('leaving while the source saves prevents a late template dispatch',async()=>{
 const f=mount();await flush();let finish!:(v:any)=>void;saveSource.mockReturnValueOnce(new Promise(r=>{finish=r;}));let pending!:Promise<unknown>;
 await act(async()=>{pending=f.value.begin(saveSource).catch(e=>e);});active=false;
 await act(async()=>{finish({name:'Late source',updatedAt:'2026-09-15T01:00:00Z'});await pending;});expect(write).not.toHaveBeenCalled();expect(mockStorage.size).toBe(0);
});
it('a late backend confirmation cannot update a replacement visit',async()=>{
 const f=mount();await flush();let finish!:(v:any)=>void;const original=write.getMockImplementation()!;let receipt:any;
 write.mockImplementationOnce(async a=>{receipt=await original(a,scope);return new Promise(r=>{finish=r;});});let pending!:Promise<unknown>;
 await act(async()=>{pending=f.value.begin(saveSource).catch(e=>e);});await flush();f.close();
 await act(async()=>{finish(receipt);await pending;});const next=mount();await flush();expect(next.value.saved).toBe(false);expect(next.value.ready).toBe(false);expect(next.value.recoveryRequired).toBe(true);
 read.mockResolvedValue(receipt);await act(async()=>{await next.value.check();});expect(next.value.saved).toBe(true);expect(next.value.ready).toBe(true);
});

async function staleVisit(){const f=mount();await flush();jest.mocked(getPageEventSaveState).mockResolvedValue({updatedAt:'2026-09-15T01:00:00.000001Z'} as any);await act(async()=>{expect(await f.value.begin(saveSource)).toMatchObject({state:'stale'});});return f;}
it('changed source blocks retry and editing until explicit review then a fresh visit',async()=>{const f=await staleVisit();expect(f.value.stale).toBe(true);expect(f.value.ready).toBe(false);await act(async()=>{await f.value.retry();});expect(write).not.toHaveBeenCalled();write.mockRejectedValueOnce({code:'PT409'});await act(async()=>{expect(await f.value.review()).toEqual({state:'retired',cleanupPending:false});});expect(f.value.retired).toBe(true);expect(f.value.ready).toBe(false);expect(mockStorage.size).toBe(0);await act(async()=>{await f.value.check();expect(await f.value.review()).toMatchObject({state:'retired'});});expect(f.value.ready).toBe(false);f.close();const next=mount();await flush();expect(next.value.ready).toBe(true);expect(saveSource).toHaveBeenCalledTimes(1);});
it('a previously committed template recovered during review stays saved',async()=>{const f=await staleVisit();read.mockResolvedValue({id:f.value.pending!.templateId,userId:user,sourcePageId:page,sourceEventId:event,sourceUpdatedAt:f.value.pending!.expectedUpdatedAt,name:f.value.pending!.name} as any);await act(async()=>{expect(await f.value.review()).toMatchObject({state:'saved'});});expect(f.value.saved).toBe(true);expect(f.value.retired).toBe(false);expect(f.value.ready).toBe(true);expect(write).not.toHaveBeenCalled();});
it('uncertain retirement shows recovery and retains intent without enabling a fresh save',async()=>{const f=await staleVisit();write.mockRejectedValueOnce(Error('Network'));await act(async()=>{await f.value.review();});expect(f.value.stale).toBe(false);expect(f.value.error).toContain('kept');expect(f.value.ready).toBe(false);expect(mockStorage.size).toBe(1);});
it('lost local clear acknowledgement permits explicit return without claiming unsaved failure',async()=>{const f=await staleVisit();write.mockRejectedValueOnce({code:'PT409'});mockRemove.mockImplementationOnce(async k=>{mockStorage.delete(k);throw Error('Lost ack');});await act(async()=>{expect(await f.value.review()).toMatchObject({state:'retired',cleanupPending:true});});await act(async()=>{await f.value.check();expect(await f.value.review()).toMatchObject({state:'retired',cleanupPending:false});});expect(f.value.ready).toBe(false);expect(write).toHaveBeenCalledTimes(1);});

it('initial journal timeout releases busy state and ignores a late read',async()=>{
 const readLater=later(null);mockGet.mockReturnValueOnce(readLater.promise);const f=mount();await flush();await elapsed(12000);
 expect(f.value.busy).toBe(false);expect(f.value.ready).toBe(false);expect(f.value.error).toBeTruthy();
 readLater.finish();await flush();expect(f.value.loaded).toBe(false);await act(async()=>{await f.value.check();});expect(f.value.ready).toBe(true);expect(write).not.toHaveBeenCalled();
});
it('source timeout retires its callback without creating a later template',async()=>{
 const f=mount();await flush();const sourceLater=later({name:'Late source',updatedAt:'2026-09-15T01:00:00Z'});saveSource.mockReturnValueOnce(sourceLater.promise);
 let result:any;act(()=>{void f.value.begin(saveSource).catch(e=>{result=e;});});await flush();await elapsed(25000);
 expect(f.value.busy).toBe(false);expect(result).toBeInstanceOf(Error);sourceLater.finish();await flush();expect(write).not.toHaveBeenCalled();expect(mockStorage.size).toBe(0);
});
it('uncertain template timeout checks the original and retries without saving the source again',async()=>{
 const f=mount();await flush();const response=later(null);write.mockReturnValueOnce(response.promise as any);
 act(()=>{void f.value.begin(saveSource).catch(()=>{});});await flush();const original=JSON.parse([...mockStorage.values()][0]);await elapsed(25000);
 expect(f.value.busy).toBe(false);expect(f.value.ready).toBe(false);
 await act(async()=>{await f.value.check();});expect(f.value.retryReady).toBe(true);await act(async()=>{await f.value.retry();});
 expect(write.mock.calls[1][0].templateId).toBe(original.templateId);expect(saveSource).toHaveBeenCalledTimes(1);expect(f.value.saved).toBe(true);response.finish();await flush();expect(f.value.saved).toBe(true);
});
it('a stalled status read cannot overwrite a later successful check',async()=>{
 const f=mount();await flush();write.mockRejectedValueOnce(Error('Lost response'));await act(async()=>{await f.value.begin(saveSource).catch(()=>{});});
 const response=later(null);read.mockReturnValueOnce(response.promise);act(()=>{void f.value.check();});await flush();await elapsed(12000);
 expect(f.value.busy).toBe(false);expect(f.value.retryReady).toBe(false);
 await act(async()=>{await f.value.check();});expect(f.value.retryReady).toBe(true);response.finish();await flush();expect(f.value.retryReady).toBe(true);
});
it('a confirmed template remains saved when cleanup stalls without releasing the journal queue',async()=>{
 const f=mount();await flush();const cleanup=later(undefined);mockRemove.mockReturnValueOnce(cleanup.promise);
 act(()=>{void f.value.begin(saveSource).catch(()=>{});});await flush();await elapsed(3000);
 expect(f.value.busy).toBe(false);expect(f.value.saved).toBe(true);expect(f.value.recoveryRequired).toBe(true);expect(f.value.retryReady).toBe(false);
 read.mockResolvedValue(await write.mock.results[0].value);act(()=>{void f.value.check();});await flush();expect(read).toHaveBeenCalledTimes(1);
 cleanup.finish();await flush();expect(f.value.saved).toBe(true);expect(f.value.recoveryRequired).toBe(false);expect(write).toHaveBeenCalledTimes(1);
});
it('confirmed obsolete retirement remains retired when its cleanup stalls',async()=>{
 const f=await staleVisit();write.mockRejectedValueOnce({code:'PT409'});const cleanup=later(undefined);mockRemove.mockReturnValueOnce(cleanup.promise);
 act(()=>{void f.value.review();});await flush();await elapsed(3000);expect(f.value.busy).toBe(false);expect(f.value.retired).toBe(true);expect(f.value.ready).toBe(false);
 cleanup.finish();await flush();expect(f.value.retired).toBe(true);expect(saveSource).toHaveBeenCalledTimes(1);
});
