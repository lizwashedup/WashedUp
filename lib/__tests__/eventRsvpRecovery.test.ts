import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { changeRsvpWithRecovery, checkRsvpRecovery, type RsvpOwner } from '../eventRsvpRecovery';
jest.mock('../supabase',()=>({supabase:{auth:{getUser:jest.fn()},from:jest.fn(),rpc:jest.fn()}}));
const memory=new Map<string,string>();
let row:any=null,readError:any=null,writeError:any=null,loseResponse=false,commit=true,active=true;
const writes=jest.fn();const owner:RsvpOwner={userId:'member',isCurrent:()=>active};
beforeEach(()=>{
 jest.clearAllMocks();jest.mocked(supabase.rpc).mockResolvedValue({data:null,error:{code:'PGRST202'}} as any);memory.clear();row=null;readError=null;writeError=null;loseResponse=false;commit=true;active=true;
 jest.mocked(AsyncStorage.getItem).mockImplementation(async k=>memory.get(k)??null);
 jest.mocked(AsyncStorage.setItem).mockImplementation(async(k,v)=>{memory.set(k,v);});
 jest.mocked(AsyncStorage.removeItem).mockImplementation(async k=>{memory.delete(k);});
 jest.mocked(supabase.auth.getUser).mockResolvedValue({data:{user:{id:'member'}},error:null} as any);
 const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:row,error:readError}),upsert:async(value:any)=>{
  writes(value);if(writeError)return {error:writeError};if(commit)row={status:value.status,updated_at:value.updated_at};if(loseResponse)throw Error('response lost');return {error:null};
 }};
 jest.mocked(supabase.from).mockReturnValue(q);
});
it.each([true,false])('recovers a committed %s change after response loss without replay',async going=>{
 loseResponse=true;const result=await changeRsvpWithRecovery('event',going,owner);expect(result).toEqual({kind:'confirmed',status:going?'going':'cancelled'});expect(writes).toHaveBeenCalledTimes(1);expect(memory.size).toBe(0);
});
it('preserves an unknown write across return and checks its exact timestamp without replay',async()=>{
 loseResponse=true;readError=Error('offline');expect((await changeRsvpWithRecovery('event',true,owner)).kind).toBe('unknown');expect(memory.size).toBe(1);
 const returning={...owner};expect((await checkRsvpRecovery('event',returning)).kind).toBe('unknown');readError=null;
 expect(await checkRsvpRecovery('event',returning)).toEqual({kind:'confirmed',status:'going'});expect(writes).toHaveBeenCalledTimes(1);expect(memory.size).toBe(0);
});
it('does not treat a missing or unrelated row as proof the original write stopped',async()=>{
 loseResponse=true;commit=false;expect((await changeRsvpWithRecovery('event',true,owner)).kind).toBe('unknown');
 expect((await changeRsvpWithRecovery('event',false,owner)).kind).toBe('unknown');
 row={status:'going',updated_at:'2020-01-01T00:00:00Z'};expect((await checkRsvpRecovery('event',owner)).kind).toBe('unknown');expect(writes).toHaveBeenCalledTimes(1);
});
it('does not dispatch when recovery storage is unavailable or damaged',async()=>{
 jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(Error('storage unavailable'));await expect(changeRsvpWithRecovery('event',true,owner)).rejects.toThrow('storage unavailable');expect(writes).not.toHaveBeenCalled();
 memory.set('event-rsvp-recovery:v1:member:event','invalid');await expect(changeRsvpWithRecovery('event',true,owner)).rejects.toThrow();expect(writes).not.toHaveBeenCalled();
});
it('clears an explicit database refusal so a later intentional retry is possible',async()=>{
 writeError={code:'42501'};await expect(changeRsvpWithRecovery('event',true,owner)).rejects.toThrow('not accepted');expect(memory.size).toBe(0);writeError=null;expect((await changeRsvpWithRecovery('event',true,owner)).kind).toBe('confirmed');
});
it('rejects the wrong account before recording an intent or writing',async()=>{
 jest.mocked(supabase.auth.getUser).mockResolvedValue({data:{user:{id:'other'}},error:null} as any);await expect(changeRsvpWithRecovery('event',true,owner)).rejects.toThrow('account');expect(writes).not.toHaveBeenCalled();expect(memory.size).toBe(0);
});
it('clears a known pre-dispatch account failure without leaving an impossible recovery',async()=>{
 jest.mocked(supabase.auth.getUser).mockResolvedValueOnce({data:{user:{id:'member'}},error:null} as any).mockResolvedValueOnce({data:{user:null},error:Error('account unavailable')} as any);
 await expect(changeRsvpWithRecovery('event',true,owner)).rejects.toThrow('account unavailable');expect(writes).not.toHaveBeenCalled();expect(memory.size).toBe(0);
});
it('does not dispatch a view retired during storage persistence',async()=>{
 jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async(k,v)=>{memory.set(k,v);active=false;});await expect(changeRsvpWithRecovery('event',true,owner)).rejects.toThrow('no longer active');expect(writes).not.toHaveBeenCalled();expect(memory.size).toBe(0);
});

it('settles an absent request only after an exact backend closure receipt',async()=>{
 loseResponse=true;commit=false;
 (supabase.rpc as jest.Mock).mockImplementation(async(_name:any,args:any)=>({data:{kind:'settled',event_id:args.p_event_id,user_id:'member',attempt_updated_at:args.p_updated_at,status:null},error:null}) as any);
 expect(await changeRsvpWithRecovery('event',true,owner)).toEqual({kind:'settled',status:null});expect(memory.size).toBe(0);expect(writes).toHaveBeenCalledTimes(1);
});
it('preserves an uncertain intent when settlement is unavailable or misbound',async()=>{
 loseResponse=true;commit=false;expect((await changeRsvpWithRecovery('event',true,owner)).kind).toBe('unknown');
 (supabase.rpc as jest.Mock).mockImplementation(async(_name:any,args:any)=>({data:{kind:'settled',event_id:args.p_event_id,user_id:'other',attempt_updated_at:args.p_updated_at,status:null},error:null}) as any);
 expect((await checkRsvpRecovery('event',owner)).kind).toBe('unknown');expect(memory.size).toBe(1);expect(writes).toHaveBeenCalledTimes(1);
});
it('accepts a superseded current state without claiming the old intended change succeeded',async()=>{
 loseResponse=true;commit=false;row={status:'going',updated_at:'2020-01-01T00:00:00Z'};
 (supabase.rpc as jest.Mock).mockImplementation(async(_name:any,args:any)=>({data:{kind:'settled',event_id:args.p_event_id,user_id:'member',attempt_updated_at:args.p_updated_at,status:'going'},error:null}) as any);
 expect(await changeRsvpWithRecovery('event',false,owner)).toEqual({kind:'settled',status:'going'});expect(memory.size).toBe(0);
});
