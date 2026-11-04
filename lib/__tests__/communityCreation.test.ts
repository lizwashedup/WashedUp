import AsyncStorage from '@react-native-async-storage/async-storage';
import { createCommunityWithJoining, readCommunityCreationAttempt, checkCommunityCreation, finishCommunityCreation, CommunityCreationUnknown } from '../communityCreation';
const mockSession=jest.fn(),mockRequest=jest.fn(),mockCall=jest.fn();
jest.mock('../supabase',()=>({supabase:{auth:{getSession:()=>mockSession()},rpc:(name:string,args:any)=>{mockCall(name,args);const chain:any={setHeader:(...args:any[])=>{mockCall('header',...args);return chain;},then:(...args:any[])=>mockRequest(name).then(...args)};return chain;}}}));
const user='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002';
const details={name:'Sunday Walks',handle:'sunday-walks',city:'Los Angeles',purpose:'Meet for weekly walks',method:'open' as const};
let live=true;const scope={userId:user,isCurrent:()=>live};
const deferred=()=>{let resolve!:(v:any)=>void,reject!:(v:any)=>void;const promise=new Promise((y,n)=>{resolve=y;reject=n;});return{promise,resolve,reject};};
beforeEach(async()=>{jest.clearAllMocks();await AsyncStorage.clear();live=true;mockSession.mockResolvedValue({data:{session:{user:{id:user},access_token:'fixture-token'}},error:null});mockRequest.mockImplementation(async name=>name==='create_community_with_joining'?{data:id,error:null}:{data:{request_id:mockCall.mock.calls.find(c=>c[0]==='create_community_with_joining')?.[1].p_request_id,community_id:id,payload:details},error:null});});
afterEach(()=>jest.useRealTimers());
it('persists exact intent before dispatch, checks a receipt and clears only after verified completion',async()=>{
 const original=mockRequest.getMockImplementation()!;mockRequest.mockImplementation(async name=>{expect(await readCommunityCreationAttempt(scope)).toMatchObject({userId:user,details});return original(name);});
 const result=await createCommunityWithJoining(details,scope);expect(result.id).toBe(id);expect(mockCall).toHaveBeenCalledWith('header','Authorization','Bearer fixture-token');expect(await readCommunityCreationAttempt(scope)).not.toBeNull();
 await finishCommunityCreation(result.attempt,scope);expect(await readCommunityCreationAttempt(scope)).toBeNull();
});
it('keeps the same persisted request after a lost response and never issues an automatic retry',async()=>{
 mockRequest.mockRejectedValueOnce(Error('offline'));await expect(createCommunityWithJoining(details,scope)).rejects.toBeInstanceOf(CommunityCreationUnknown);
 const first=await readCommunityCreationAttempt(scope);expect(first).not.toBeNull();expect(mockCall.mock.calls.filter(c=>c[0]==='create_community_with_joining')).toHaveLength(1);
 await createCommunityWithJoining(details,scope);expect(mockCall.mock.calls.filter(c=>c[0]==='create_community_with_joining').map(c=>c[1].p_request_id)).toEqual([first!.requestId,first!.requestId]);
});
it('rejects changed details while an earlier result is unknown',async()=>{
 mockRequest.mockRejectedValueOnce(Error('offline'));await expect(createCommunityWithJoining(details,scope)).rejects.toThrow();
 await expect(createCommunityWithJoining({...details,name:'Changed'},scope)).rejects.toBeInstanceOf(CommunityCreationUnknown);
 expect(mockCall.mock.calls.filter(c=>c[0]==='create_community_with_joining')).toHaveLength(1);
});
it('a missing receipt never clears an unknown request',async()=>{
 mockRequest.mockRejectedValueOnce(Error('offline'));await expect(createCommunityWithJoining(details,scope)).rejects.toThrow();const saved=(await readCommunityCreationAttempt(scope))!;
 mockRequest.mockResolvedValue({data:null,error:null});expect(await checkCommunityCreation(saved,scope)).toBeNull();await expect(finishCommunityCreation(saved,scope)).rejects.toThrow();expect(await readCommunityCreationAttempt(scope)).toEqual(saved);
});
it('clears a first-dispatch transaction rejection so an unavailable handle can be corrected',async()=>{
 mockRequest.mockResolvedValueOnce({data:null,error:{code:'23505',message:'taken'}});await expect(createCommunityWithJoining(details,scope)).rejects.toMatchObject({code:'23505'});expect(await readCommunityCreationAttempt(scope)).toBeNull();
});
it('a rejected retry cannot erase an earlier uncertain request',async()=>{
 mockRequest.mockRejectedValueOnce(Error('offline'));await expect(createCommunityWithJoining(details,scope)).rejects.toThrow();const saved=await readCommunityCreationAttempt(scope);
 mockRequest.mockResolvedValueOnce({data:null,error:{code:'42501',message:'denied'}});await expect(createCommunityWithJoining(details,scope)).rejects.toBeInstanceOf(CommunityCreationUnknown);expect(await readCommunityCreationAttempt(scope)).toEqual(saved);
});
it('rejects duplicate taps, storage failure and account changes before any second dispatch',async()=>{
 const waiting=deferred();mockRequest.mockReturnValueOnce(waiting.promise);const first=createCommunityWithJoining(details,scope);
 await expect(createCommunityWithJoining(details,scope)).rejects.toThrow('already running');waiting.reject(Error('offline'));await expect(first).rejects.toThrow();
 await AsyncStorage.clear();jest.spyOn(AsyncStorage,'setItem').mockRejectedValueOnce(Error('disk'));await expect(createCommunityWithJoining(details,scope)).rejects.toThrow('disk');
 mockSession.mockResolvedValueOnce({data:{session:{user:{id:'other'},access_token:'other'}},error:null});await expect(createCommunityWithJoining(details,scope)).rejects.toThrow();expect(mockCall.mock.calls.filter(c=>c[0]==='create_community_with_joining')).toHaveLength(1);
});
it('an expired visit keeps a submitted request for the initiating account',async()=>{
 const waiting=deferred();mockRequest.mockImplementationOnce(()=>{live=false;return waiting.promise;});const first=createCommunityWithJoining(details,scope);waiting.resolve({data:id,error:null});await expect(first).rejects.toThrow();live=true;expect(await readCommunityCreationAttempt(scope)).not.toBeNull();
 expect(await readCommunityCreationAttempt({...scope,userId:'other'})).toBeNull();
});
it('bounds a hung dispatch and preserves recovery without resending',async()=>{
 jest.useFakeTimers();mockRequest.mockReturnValueOnce(new Promise(()=>{}));const result=createCommunityWithJoining(details,scope);const assertion=expect(result).rejects.toBeInstanceOf(CommunityCreationUnknown);await jest.advanceTimersByTimeAsync(15_001);await assertion;
 expect(await readCommunityCreationAttempt(scope)).not.toBeNull();expect(mockCall.mock.calls.filter(c=>c[0]==='create_community_with_joining')).toHaveLength(1);
});
