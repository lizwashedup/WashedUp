import React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePlanDeparture } from '../usePlanDeparture';
const mockAuth=jest.fn(), mockRead=jest.fn(), mockWrite=jest.fn(), mockMessage=jest.fn();
let mockEpoch=1, mockAccount='alice';
let mockBlur: (()=>void)|undefined, mockFocus:(()=>void|(()=>void))|undefined;
jest.mock('expo-router',()=>({useFocusEffect:(cb:any)=>require('react').useEffect(()=>{mockFocus=cb;mockBlur=cb();return()=>mockBlur?.();},[cb])}));
jest.mock('../../lib/logger',()=>({logError:jest.fn()}));
jest.mock('../../lib/supabase',()=>({supabase:{auth:{getUser:()=>mockAuth()},from:(table:string)=>{
 let values:any, selected:string, filters:any[]=[];
 const q:any={update:(v:any)=>{values=v;return q;},select:(v:string)=>{selected=v;return q;},eq:(...v:any[])=>{filters.push(v);return q;},maybeSingle:()=>values?mockWrite(table,values,filters,selected):mockRead(table,filters,selected),insert:(v:any)=>mockMessage(table,v)};return q;
}}}));
type Options=Parameters<typeof usePlanDeparture>[0];
const cleanups:(()=>void)[]=[];
const deferred=()=>{let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};};
const flush=()=>act(async()=>{await new Promise(r=>setTimeout(r,8));});
async function mount(extra:Partial<Options>={}){
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:2,gcTime:Infinity}}});
 const onSuccess=jest.fn(),onError=jest.fn(),onUnconfirmed=jest.fn();let current!:ReturnType<typeof usePlanDeparture>, props=extra;
 function Harness(){const epoch=mockEpoch;current=usePlanDeparture({eventId:'plan',viewerId:mockAccount,epoch,isCurrent:()=>epoch===mockEpoch,ready:true,canLeave:true,canCancel:true,hasOwnChat:true,onSuccess,onError,onUnconfirmed,...props});return null;}
 const render=()=> <QueryClientProvider client={client}><Harness/></QueryClientProvider>;
 let tree!:ReturnType<typeof create>;act(()=>{tree=create(render());});cleanups.push(()=>{act(()=>tree.unmount());client.clear();});await flush();
 return {get current(){return current;},onSuccess,onError,onUnconfirmed,update:(next:Partial<Options>)=>{props={...props,...next};act(()=>tree.update(render()));},start:(action:'leave'|'cancel')=>act(()=>current[action]())};
}
const left={data:{event_id:'plan',user_id:'alice',status:'left'},error:null};
const cancelled={data:{id:'plan',creator_user_id:'alice',status:'cancelled'},error:null};
beforeEach(()=>{jest.clearAllMocks();mockEpoch=1;mockAccount='alice';mockAuth.mockImplementation(async()=>({data:{user:{id:mockAccount}},error:null}));mockWrite.mockImplementation(async table=>table==='events'?cancelled:left);mockRead.mockResolvedValue(left);mockMessage.mockResolvedValue({error:null});});
afterEach(()=>cleanups.splice(0).forEach(fn=>fn()));
it.each(['leave','cancel'] as const)('confirms exact %s receipt once and preserves its message',async action=>{const f=await mount();act(()=>{f.current[action]();f.current[action]();});await flush();expect(mockWrite).toHaveBeenCalledTimes(1);expect(mockMessage).toHaveBeenCalledTimes(1);expect(f.onSuccess).toHaveBeenCalledWith({action});f.start(action);await flush();expect(mockWrite).toHaveBeenCalledTimes(1);expect(mockWrite.mock.calls[0][3]).toBe(action==='leave'?'event_id,user_id,status':'id,creator_user_id,status');});
it.each(['leave','cancel'] as const)('does not announce a rejected %s and permits explicit retry',async action=>{mockWrite.mockResolvedValueOnce({data:null,error:{code:'42501'}});const f=await mount();f.start(action);await flush();expect(f.onSuccess).not.toHaveBeenCalled();expect(mockMessage).not.toHaveBeenCalled();expect(f.onError).toHaveBeenCalled();f.start(action);await flush();expect(f.onSuccess).toHaveBeenCalledWith({action});});
it.each([null,[],{event_id:'other',user_id:'alice',status:'left'},{event_id:'plan',user_id:'alice',status:'joined'}])('keeps malformed or missing receipt unresolved: %p',async data=>{mockWrite.mockResolvedValue({data,error:null});const f=await mount();f.start('leave');await flush();expect(f.current.unknownAction).toBe('leave');f.start('leave');await flush();expect(mockWrite).toHaveBeenCalledTimes(1);expect(mockMessage).not.toHaveBeenCalled();});
it('retains an unknown lock after transport loss and a negative read',async()=>{mockWrite.mockRejectedValue(new Error('offline'));mockRead.mockResolvedValue({data:null,error:null});const f=await mount();f.start('cancel');await flush();await act(async()=>f.current.checkResult());expect(f.current.unknownAction).toBe('cancel');f.start('cancel');await flush();expect(mockWrite).toHaveBeenCalledTimes(1);expect(f.onError).toHaveBeenCalled();});
it.each(['leave','cancel'] as const)('reconciles %s from a positive owned read without replaying its message',async action=>{mockWrite.mockRejectedValue(new Error('lost'));mockRead.mockResolvedValue(action==='leave'?left:cancelled);const f=await mount();f.start(action);await flush();await act(async()=>f.current.checkResult());expect(f.onSuccess).toHaveBeenCalledWith({action,reconciled:true});expect(mockMessage).not.toHaveBeenCalled();expect(f.current.unknownAction).toBeNull();});
it.each(['returned','rejected'])('keeps success final when announcement is %s error',async kind=>{if(kind==='returned')mockMessage.mockResolvedValue({error:{code:'42501'}});else mockMessage.mockRejectedValue(new Error('offline'));const f=await mount();f.start('leave');await flush();expect(f.onSuccess).toHaveBeenCalledWith({action:'leave',announcementUnconfirmed:true});expect(f.onError).not.toHaveBeenCalled();f.start('leave');await flush();expect(mockWrite).toHaveBeenCalledTimes(1);});
it('omits an event announcement when the plan uses Circle chat',async()=>{const f=await mount({hasOwnChat:false});f.start('leave');await flush();expect(f.onSuccess).toHaveBeenCalledWith({action:'leave'});expect(mockMessage).not.toHaveBeenCalled();});
it('blocks old auth continuations after blur',async()=>{const auth=deferred();mockAuth.mockReturnValue(auth.promise);const f=await mount();f.start('leave');await flush();act(()=>mockBlur?.());await act(async()=>auth.resolve({data:{user:{id:'alice'}},error:null}));await flush();expect(mockWrite).not.toHaveBeenCalled();expect(f.onSuccess).not.toHaveBeenCalled();});
it('does not apply old successful results or messages after an account change',async()=>{const receipt=deferred();mockWrite.mockReturnValue(receipt.promise);const f=await mount();f.start('leave');await flush();mockAccount='bob';mockEpoch++;f.update({});await act(async()=>receipt.resolve(left));await flush();expect(f.onSuccess).not.toHaveBeenCalled();expect(mockMessage).not.toHaveBeenCalled();});
it('rejects a retained callback after leaving and returning to the visit',async()=>{const f=await mount();const leave=f.current.leave;act(()=>{mockBlur?.();mockBlur=mockFocus?.()||undefined;});act(()=>leave());await flush();expect(mockWrite).not.toHaveBeenCalled();});
it('does not dispatch when readiness changes during auth preflight',async()=>{const auth=deferred();mockAuth.mockReturnValue(auth.promise);const f=await mount();f.start('cancel');await flush();f.update({ready:false});await act(async()=>auth.resolve({data:{user:{id:'alice'}},error:null}));await flush();expect(mockWrite).not.toHaveBeenCalled();});
