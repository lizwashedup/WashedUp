const mockStorage=new Map<string,string>();const mockGet=jest.fn(),mockSet=jest.fn(),mockRemove=jest.fn(),mockUUID=jest.fn();
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{getItem:(...a:unknown[])=>mockGet(...a),setItem:(...a:unknown[])=>mockSet(...a),removeItem:(...a:unknown[])=>mockRemove(...a)}}));
jest.mock('expo-crypto',()=>({randomUUID:()=>mockUUID()}));
jest.mock('../communityChat',()=>({ObsoleteCommunityOperationError:class extends Error{}}));
jest.mock('../supabase',()=>({supabase:{}}));
jest.mock('../communityRoomHistory',()=>({}));
import { clearCreatorGroupAttempt, prepareCreatorGroupAttempt, readCreatorGroupAttempt } from '../creatorCommunityGroupAttempt';
const page='0ed00000-0000-4000-8000-000000000001',id='0ed00000-0000-4000-8000-000000000002',scope={userId:'creator',isCurrent:()=>true};
beforeEach(()=>{jest.resetAllMocks();mockStorage.clear();mockGet.mockImplementation(async(k)=>mockStorage.get(k)??null);mockSet.mockImplementation(async(k,v)=>{mockStorage.set(k,v);});mockRemove.mockImplementation(async(k)=>{mockStorage.delete(k);});mockUUID.mockReturnValue(id);});
it('persists one request before returning and recovers it unchanged after reopening',async()=>{
 const first=await prepareCreatorGroupAttempt(page,'  Walks ',scope);expect(first).toEqual({created:true,attempt:{communityId:page,requestId:id,name:'Walks'}});
 expect(await readCreatorGroupAttempt(page,scope)).toEqual(first.attempt);expect(await prepareCreatorGroupAttempt(page,'Another name',scope)).toEqual({...first,created:false});expect(mockSet).toHaveBeenCalledTimes(1);
});
it('serializes simultaneous forms so only one may dispatch a newly prepared request',async()=>{
 const values=await Promise.all([prepareCreatorGroupAttempt(page,'Walks',scope),prepareCreatorGroupAttempt(page,'Coffee',scope)]);
 expect(values.map(v=>v.created)).toEqual([true,false]);expect(values[0].attempt).toEqual(values[1].attempt);expect(mockUUID).toHaveBeenCalledTimes(1);
});
it('does not return dispatchable work when storage fails and allows a later verified preparation',async()=>{
 mockSet.mockRejectedValueOnce(Error('Storage unavailable'));await expect(prepareCreatorGroupAttempt(page,'Walks',scope)).rejects.toThrow();expect(await readCreatorGroupAttempt(page,scope)).toBeNull();expect((await prepareCreatorGroupAttempt(page,'Walks',scope)).created).toBe(true);
});
it('recovers a storage write with a lost response without generating another request',async()=>{
 mockSet.mockImplementationOnce(async(k,v)=>{mockStorage.set(k,v);throw Error('Lost storage response');});await expect(prepareCreatorGroupAttempt(page,'Walks',scope)).rejects.toThrow();
 expect((await prepareCreatorGroupAttempt(page,'Coffee',scope)).created).toBe(false);expect(mockUUID).toHaveBeenCalledTimes(1);
});
it('clears only a matching confirmed attempt and isolates other accounts',async()=>{
 const {attempt}=await prepareCreatorGroupAttempt(page,'Walks',scope);const receipt={...attempt,currentName:'Walks',status:'available' as const};
 await clearCreatorGroupAttempt({...receipt,name:'Other'},scope);expect(await readCreatorGroupAttempt(page,scope)).toEqual(attempt);
 await clearCreatorGroupAttempt(receipt,{...scope,userId:'other'});expect(mockRemove).not.toHaveBeenCalled();
 await clearCreatorGroupAttempt(receipt,scope);expect(await readCreatorGroupAttempt(page,scope)).toBeNull();
});
it('rejects retired work and corrupt persisted identities without overwriting them',async()=>{
 await expect(prepareCreatorGroupAttempt(page,'Walks',{...scope,isCurrent:()=>false})).rejects.toThrow();expect(mockSet).not.toHaveBeenCalled();
 mockGet.mockResolvedValue(JSON.stringify({communityId:'other',requestId:id,name:'Walks'}));await expect(prepareCreatorGroupAttempt(page,'Walks',scope)).rejects.toThrow();expect(mockSet).not.toHaveBeenCalled();
});
