import AsyncStorage from '@react-native-async-storage/async-storage';
import { beginIdentitySave, readIdentitySave, clearIdentitySave, identitySaveKey, claimIdentitySave, releaseIdentitySave } from '../circles/identitySaveAttempt';
const identity={name:'Friends',description:null,coverUploadId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clearCover:true};
const key=identitySaveKey('alice','room');
beforeEach(async()=>{await AsyncStorage.clear();releaseIdentitySave(key);});
it('reserves exactly one original operation when two mounted editors start together',async()=>{
 const results=await Promise.all([beginIdentitySave(key,null,identity,()=>{}),beginIdentitySave(key,null,{...identity,name:'Other'},()=>{})]);
 expect(results.filter(Boolean)).toHaveLength(1);expect((await readIdentitySave(key))?.identity).toEqual(identity);
});
it('cannot erase a later attempt with an old finalizer',async()=>{
 const first=(await beginIdentitySave(key,null,identity,()=>{}))!;await clearIdentitySave(key,first.requestId);
 const next=(await beginIdentitySave(key,null,identity,()=>{}))!;
 expect(await clearIdentitySave(key,first.requestId)).toBe(false);expect(await readIdentitySave(key)).toEqual(next);
});
it('keeps two accounts and two rooms independent',async()=>{
 await beginIdentitySave(key,null,identity,()=>{});
 expect(await readIdentitySave(identitySaveKey('bob','room'))).toBeNull();
 expect(await beginIdentitySave(identitySaveKey('alice','other'),null,identity,()=>{})).not.toBeNull();
});
it('fails closed on unreadable persisted data and does not dispatch over it',async()=>{
 await AsyncStorage.setItem(key,'{broken');
 await expect(beginIdentitySave(key,null,identity,()=>{})).rejects.toThrow();
 expect(await AsyncStorage.getItem(key)).toBe('{broken');
});
it('checks the active account after waiting for storage before reserving a new attempt',async()=>{
 await expect(beginIdentitySave(key,null,identity,()=>{throw new Error('retired');})).rejects.toThrow('retired');
 expect(await readIdentitySave(key)).toBeNull();
});
it('keeps a new transport lock when an older transport ends after exact status confirmation',()=>{
 const old=claimIdentitySave(key)!;releaseIdentitySave(key);const next=claimIdentitySave(key)!;
 releaseIdentitySave(key,old);expect(claimIdentitySave(key)).toBeNull();releaseIdentitySave(key,next);expect(claimIdentitySave(key)).not.toBeNull();releaseIdentitySave(key);
});
