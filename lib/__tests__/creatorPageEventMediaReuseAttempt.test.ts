const mockFiles=jest.fn(),mockGet=jest.fn(),mockSet=jest.fn(),mockAccount=jest.fn(),mockState=jest.fn(),mockSource=jest.fn(),mockReceipt=jest.fn(),mockUUID=jest.fn();
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:(...a:unknown[])=>mockGet(...a),setItem:(...a:unknown[])=>mockSet(...a)}));
jest.mock('../creatorPageEventMediaReuseFiles',()=>({removePageEventMediaReuseRuns:(...a:unknown[])=>mockFiles(...a)}));
jest.mock('expo-crypto',()=>({randomUUID:()=>mockUUID()}));
jest.mock('../creatorPageReview',()=>({CreatorPageScopeExpired:class extends Error{}}));
jest.mock('../creatorPageEventSave',()=>({getPageEventSaveState:(...a:unknown[])=>mockState(...a)}));
jest.mock('../creatorPageEventMedia',()=>({...jest.requireActual('../creatorPageEventMedia'),assertPageEventMediaAccount:(...a:unknown[])=>mockAccount(...a)}));
jest.mock('../supabase',()=>({supabase:{}}));
jest.mock('../creatorPageEventMediaReuse',()=>({...jest.requireActual('../creatorPageEventMediaReuse'),getPageEventMediaSource:(...a:unknown[])=>mockSource(...a),getPageEventMediaReuseAttempt:(...a:unknown[])=>mockReceipt(...a)}));
import {preparePageEventMediaReuseAttempt,readPageEventMediaReuseAttempts,clearPageEventMediaReuseAttempt} from '../creatorPageEventMediaReuseAttempt';
const page='f5d7644a-2ff5-4def-b0ab-d04b8250892b',event='0fc50000-0000-4000-8000-000000000001',id='0fc50000-0000-4000-8000-000000000002',sourceId='0fc50000-0000-4000-8000-000000000003',sourceEvent='0fc50000-0000-4000-8000-000000000004',user='753c5b17-ca8d-431f-ad8f-0d9b70c0dccb';let current=true;let values:Map<string,string>;
const scope={userId:user,isCurrent:()=>current},source={pageId:page,eventId:sourceEvent,mediaId:sourceId,purpose:'image' as const,byteSize:100,mimeType:'image/jpeg' as const,contentDigest:'a'.repeat(64),objectName:`${sourceEvent}/private-${sourceId}.jpg`};
const prepare=()=>preparePageEventMediaReuseAttempt(page,event,'cover',source,scope);
beforeEach(()=>{jest.clearAllMocks();current=true;values=new Map();mockGet.mockImplementation(async k=>values.get(k)??null);mockSet.mockImplementation(async(k,v)=>{values.set(k,v);});mockAccount.mockResolvedValue(undefined);mockState.mockResolvedValue({status:'Draft'});mockSource.mockResolvedValue(source);mockUUID.mockReturnValue(id);mockReceipt.mockResolvedValue(null);mockFiles.mockResolvedValue(undefined);});
it('persists one exact intent before any remote mutation and deduplicates concurrent taps',async()=>{
 const [first,second]=await Promise.all([prepare(),prepare()]);expect(first.created).toBe(true);expect(second.created).toBe(false);expect(second.attempt).toEqual(first.attempt);expect(mockUUID).toHaveBeenCalledTimes(1);expect(mockSet).toHaveBeenCalledTimes(1);
 expect(await readPageEventMediaReuseAttempts(page,event,scope)).toEqual([first.attempt]);expect([...values.keys()][0]).toBe(`creator-page-event-media-reuse:v1:${user}:${page}:${event}`);
});
it('retains the original saved intent after ambiguous persistence failure',async()=>{
 mockSet.mockImplementationOnce(async(k,v)=>{values.set(k,v);throw Error('lost storage receipt');});await expect(prepare()).rejects.toThrow('lost storage receipt');
 const recovered=await prepare();expect(recovered.created).toBe(false);expect(recovered.attempt.mediaId).toBe(id);expect(mockUUID).toHaveBeenCalledTimes(1);
});
it('does not return a prepared attempt when storage never saved it',async()=>{
 mockSet.mockRejectedValue(Error('disk'));await expect(prepare()).rejects.toThrow('disk');expect(await readPageEventMediaReuseAttempts(page,event,scope)).toEqual([]);
});
it('keeps a pending attempt recoverable after source access disappears',async()=>{
 const first=await prepare();mockSource.mockRejectedValue(Error('revoked'));expect((await prepare()).attempt).toEqual(first.attempt);expect(mockSource).toHaveBeenCalledTimes(1);
});
it.each(['Completed','Cancelled'])('does not prepare new media for %s destinations',async status=>{
 mockState.mockResolvedValue({status});await expect(prepare()).rejects.toThrow('closed');expect(mockSet).not.toHaveBeenCalled();expect(mockSource).not.toHaveBeenCalled();
});
it('does not store after its visible visit retires during source lookup',async()=>{
 mockSource.mockImplementation(async()=>{current=false;return source;});await expect(prepare()).rejects.toThrow();expect(mockSet).not.toHaveBeenCalled();
});
it('preserves corrupt storage for review without overwriting it',async()=>{
 values.set(`creator-page-event-media-reuse:v1:${user}:${page}:${event}`,'broken');await expect(prepare()).rejects.toThrow();expect(mockSet).not.toHaveBeenCalled();expect([...values.values()]).toEqual(['broken']);
});
it('separates another account from existing pending media',async()=>{
 await prepare();const other={userId:sourceId,isCurrent:()=>true};expect(await readPageEventMediaReuseAttempts(page,event,other)).toEqual([]);
});
it('cannot clear missing, merely reserved, unattached or missing-object recovery',async()=>{
 const {attempt}=await prepare();for(const receipt of [null,{...attempt,readyAt:null,attached:false,objectPresent:false},{...attempt,readyAt:'time',attached:false,objectPresent:true},{...attempt,readyAt:'time',attached:true,objectPresent:false}]){
  mockReceipt.mockResolvedValue(receipt);await expect(clearPageEventMediaReuseAttempt(attempt,scope)).rejects.toThrow();expect((await readPageEventMediaReuseAttempts(page,event,scope))).toHaveLength(1);
 }
});
it.each(['attached','abandoned'])('clears only fresh confirmed %s history',async state=>{
 const {attempt}=await prepare();mockReceipt.mockResolvedValue({...attempt,readyAt:state==='attached'?'time':null,attached:state==='attached',objectPresent:state==='attached',abandonedAt:state==='abandoned'?'time':null});
 expect(await clearPageEventMediaReuseAttempt(attempt,scope)).toBe(true);expect(await readPageEventMediaReuseAttempts(page,event,scope)).toEqual([]);
});
it('rejects altered caller intent without fetching or clearing the original',async()=>{
 const {attempt}=await prepare();expect(await clearPageEventMediaReuseAttempt({...attempt,purpose:'poster'},scope)).toBe(false);expect(mockReceipt).not.toHaveBeenCalled();expect(await readPageEventMediaReuseAttempts(page,event,scope)).toEqual([attempt]);
});
it('retains attempt when backend recovery is denied',async()=>{
 const {attempt}=await prepare();mockReceipt.mockRejectedValue(Error('revoked'));await expect(clearPageEventMediaReuseAttempt(attempt,scope)).rejects.toThrow('revoked');expect(await readPageEventMediaReuseAttempts(page,event,scope)).toEqual([attempt]);
});

it('retains durable intent if physical cleanup fails',async()=>{
 const {attempt}=await prepare();mockReceipt.mockResolvedValue({...attempt,readyAt:'time',attached:true,objectPresent:true,abandonedAt:null});mockFiles.mockRejectedValue(Error('disk cleanup failed'));
 await expect(clearPageEventMediaReuseAttempt(attempt,scope)).rejects.toThrow('disk cleanup failed');expect(await readPageEventMediaReuseAttempts(page,event,scope)).toEqual([attempt]);
});
it('does not forget intent when terminal state changes after file cleanup',async()=>{
 const {attempt}=await prepare();mockReceipt.mockResolvedValueOnce({...attempt,readyAt:'time',attached:true,objectPresent:true,abandonedAt:null}).mockResolvedValue(null);
 await expect(clearPageEventMediaReuseAttempt(attempt,scope)).rejects.toThrow();expect(mockFiles).toHaveBeenCalledTimes(1);expect(await readPageEventMediaReuseAttempts(page,event,scope)).toEqual([attempt]);
});

it('a stalled media source lookup releases the queue without a late write replacing recovery',async()=>{
 jest.useFakeTimers();try{
  let finish!:(v:any)=>void;mockSource.mockReturnValueOnce(new Promise(r=>{finish=r;}));let failure:any;
  const pending=prepare().catch(e=>{failure=e;});await jest.advanceTimersByTimeAsync(12_001);expect(failure).toBeInstanceOf(Error);
  const fresh=await prepare();finish({...source,byteSize:200});await pending;
  expect(await readPageEventMediaReuseAttempts(page,event,scope)).toEqual([fresh.attempt]);expect(mockSet).toHaveBeenCalledTimes(1);
 }finally{jest.useRealTimers();}
});
