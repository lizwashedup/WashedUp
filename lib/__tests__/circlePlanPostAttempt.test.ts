import AsyncStorage from '@react-native-async-storage/async-storage';
import { beginPlanPost, readPlanPost, clearPlanPost, planPostKey, claimPlanPost, releasePlanPost } from '../circles/planPostAttempt';
const payload={p_circle_id:'room',p_title:'Friends',p_start_time:'2040-11-08T19:00:00Z',p_host_message:'Meet by the park.',p_visibility:'circle_only',p_member_user_ids:['bob']};
const key=planPostKey('alice','room');
beforeEach(async()=>{await AsyncStorage.clear();releasePlanPost(key);});
it('reserves exactly one original operation when two mounted editors start together',async()=>{
 const results=await Promise.all([beginPlanPost(key,payload,()=>{}),beginPlanPost(key,{...payload,p_title:'Other'},()=>{})]);
 expect(results.filter(Boolean)).toHaveLength(1);expect((await readPlanPost(key))?.payload).toEqual(payload);
});
it('cannot erase a later attempt with an old finalizer',async()=>{
 const first=(await beginPlanPost(key,payload,()=>{}))!;await clearPlanPost(key,first.requestId);
 const next=(await beginPlanPost(key,payload,()=>{}))!;
 expect(await clearPlanPost(key,first.requestId)).toBe(false);expect(await readPlanPost(key)).toEqual(next);
});
it('keeps two accounts and two rooms independent',async()=>{
 await beginPlanPost(key,payload,()=>{});
 expect(await readPlanPost(planPostKey('bob','room'))).toBeNull();
 expect(await beginPlanPost(planPostKey('alice','other'),payload,()=>{})).not.toBeNull();
});
it('fails closed on unreadable persisted data and does not dispatch over it',async()=>{
 await AsyncStorage.setItem(key,'{broken');
 await expect(beginPlanPost(key,payload,()=>{})).rejects.toThrow();
 expect(await AsyncStorage.getItem(key)).toBe('{broken');
});
it('checks the active account after waiting for storage before reserving a new attempt',async()=>{
 await expect(beginPlanPost(key,payload,()=>{throw new Error('retired');})).rejects.toThrow('retired');
 expect(await readPlanPost(key)).toBeNull();
});
it('keeps a new transport lock when an older transport ends after exact status confirmation',()=>{
 const old=claimPlanPost(key)!;releasePlanPost(key);const next=claimPlanPost(key)!;
 releasePlanPost(key,old);expect(claimPlanPost(key)).toBeNull();releasePlanPost(key,next);expect(claimPlanPost(key)).not.toBeNull();releasePlanPost(key);
});

it('captures audience IDs independently of later edits',async()=>{
 const chosen={...payload,p_member_user_ids:['bob']};const saved=await beginPlanPost(key,chosen,()=>{});chosen.p_member_user_ids.push('cara');
 expect(saved?.payload.p_member_user_ids).toEqual(['bob']);expect((await readPlanPost(key))?.payload.p_member_user_ids).toEqual(['bob']);
});
