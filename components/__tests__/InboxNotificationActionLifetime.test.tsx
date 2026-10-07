import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import ts from 'typescript';
import { useInboxNotificationScope } from '../../hooks/useInboxNotificationScope';
const mockListeners=new Set<(event:string,session:any)=>void>();
const mockWrite=jest.fn(),mockUpdate=jest.fn(),mockEq=jest.fn();
jest.mock('../../lib/supabase',()=>({supabase:{auth:{getUser:async()=>({data:{user:{id:'alice'}},error:null}),onAuthStateChange:(fn:any)=>{mockListeners.add(fn);return{data:{subscription:{unsubscribe:()=>mockListeners.delete(fn)}}};}},from:()=>({update:(value:any)=>{mockUpdate(value);const chain:any={eq:(...args:any[])=>{mockEq(...args);return chain;},then:(yes:any,no:any)=>mockWrite().then(yes,no)};return chain;}})}}));
import {supabase} from '../../lib/supabase';
// Execute the real generic callback with the real observed-account/visit hook.
const source=fs.readFileSync(path.join(__dirname,'../InboxModal.tsx'),'utf8');
const start=source.indexOf('  const handleNotifAction = useCallback('),end=source.indexOf('\n  }, [',start);
if(start<0||end<0)throw Error('Inbox callback boundary changed');
const code=ts.transpileModule(source.slice(start,end)+'\n  }, []);globalThis.handler=handleNotifAction;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const push=jest.fn(),close=jest.fn(),alert=jest.fn(),refresh=jest.fn(),invalidate=jest.fn();
let handler:(...args:any[])=>Promise<void>,tree:ReactTestRenderer;
function Harness({id='alice',visible=true}:{id?:string;visible?:boolean}){
 const notificationScope=useInboxNotificationScope(id,visible);
 const context:any={notificationScope,useCallback:(f:any)=>f,hapticLight:()=>{},supabase,refetchNotifs:refresh,queryClient:{invalidateQueries:invalidate},INBOX_COUNT_KEY:['inbox'],WAITLIST_MANAGER_KEY:(id:string)=>['waitlist',id],YOURS_NOTIF_TYPES:new Set(['people_request','people_request_accepted','referral_joined']),YOURS_PAGE_ENABLED:true,COMMUNITIES_ENABLED:true,userId:id,router:{push},onClose:close,setAlertInfo:alert};
 vm.runInNewContext(code,context);handler=context.handler;return null;
}
const held=()=>{let resolve!:(v:any)=>void,reject!:(v:any)=>void;const promise=new Promise<any>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
async function flush(){await act(async()=>{for(let i=0;i<10;i++)await Promise.resolve();});}
const emit=(id:string|null)=>{for(const fn of mockListeners)fn(id?'SIGNED_IN':'SIGNED_OUT',id?{user:{id}}:null);};
beforeEach(async()=>{jest.clearAllMocks();mockListeners.clear();mockWrite.mockResolvedValue({error:null});await act(async()=>{tree=create(<Harness/>);});await flush();});
afterEach(()=>{act(()=>tree.unmount());expect(mockListeners.size).toBe(0);});
it.each(['close','reopen','account ABA','unmount'])('does not navigate/refetch from an old awaited callback after %s',async change=>{
 const pending=held();mockWrite.mockReturnValueOnce(pending.promise);let done:Promise<void>;act(()=>{done=handler('notice','acted','plan','waitlist_spot');});await flush();expect(mockWrite).toHaveBeenCalledTimes(1);
 if(change==='unmount')act(()=>tree.unmount());else if(change==='account ABA'){act(()=>{emit('bob');emit('alice');});await flush();}else{act(()=>tree.update(<Harness visible={false}/>));if(change==='reopen')act(()=>tree.update(<Harness/>));}
 await act(async()=>{pending.resolve({error:null});await done;});expect(push).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();expect(invalidate).not.toHaveBeenCalled();expect(alert).not.toHaveBeenCalled();
});
it('does not show a stale failed-write alert after closing',async()=>{
 const pending=held();mockWrite.mockReturnValueOnce(pending.promise);let done:Promise<void>;act(()=>{done=handler('notice','read');});await flush();act(()=>tree.update(<Harness visible={false}/>));await act(async()=>{pending.reject(Error('offline'));await done;});expect(alert).not.toHaveBeenCalled();
});
it('does not dispatch a retained callback after an auth event before props update',async()=>{
 const old=handler;act(()=>emit('bob'));await act(async()=>{await old('notice','read');});expect(mockWrite).not.toHaveBeenCalled();expect(push).not.toHaveBeenCalled();
});
it('allows the newly committed same-account visit after an account roundtrip',async()=>{
 act(()=>{emit('bob');emit('alice');});await flush();await act(async()=>{await handler('notice','acted','plan','waitlist_spot');});expect(push).toHaveBeenCalledWith('/plan/plan');expect(mockUpdate).toHaveBeenCalledWith({status:'acted'});
});
it.each([['member_joined','/(tabs)/chats/plan'],['waitlist_request','/waitlist/plan'],['album_upload_prompt','/album/upload/plan'],['album_ready','/album/plan']])('preserves %s current navigation and mark semantics',async(type,route)=>{
 await act(async()=>{await handler('notice','acted','plan',type);});expect(push).toHaveBeenCalledWith(route);expect(close).toHaveBeenCalledTimes(1);expect(mockUpdate).toHaveBeenCalledWith({status:'acted'});expect(refresh).toHaveBeenCalledTimes(1);
});
it('preserves current dismissal without navigation and current write error feedback',async()=>{
 await act(async()=>{await handler('notice','read');});expect(mockUpdate).toHaveBeenCalledWith({status:'read'});expect(push).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
 mockWrite.mockRejectedValueOnce(Error('offline'));await act(async()=>{await handler('next','read');});expect(alert).toHaveBeenCalledWith({title:'Something went wrong',message:'Please try again.'});
});

it('marks an operator decision acted then opens fresh application status without using unrelated identity fields',async()=>{
 await act(async()=>{await handler('operator-notice','acted','wrong-event','operator_grant','wrong-actor');});
 expect(mockEq).toHaveBeenCalledWith('user_id','alice');expect(mockUpdate).toHaveBeenCalledWith({status:'acted'});expect(close).toHaveBeenCalledTimes(1);expect(push).toHaveBeenCalledWith('/creator/apply');
});
it('does not open an operator decision after account retirement while read-mark is pending',async()=>{
 const pending=held();mockWrite.mockReturnValueOnce(pending.promise);let done!:Promise<void>;act(()=>{done=handler('operator-notice','acted',undefined,'operator_grant');});act(()=>emit('bob'));await act(async()=>{pending.resolve({error:null});await done;});expect(push).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
});

it('exposes the actual operator row action without requiring an event identity',()=>{
 const from=source.indexOf('                const hasAction ='),to=source.indexOf('                const timeLeft',from)-1;
 expect(from).toBeGreaterThan(-1);const row:any={notif:{type:'operator_grant'},goesToYours:false,goesToCommunityRequests:false,goesToCommunityEvent:false};
 vm.runInNewContext(source.slice(from,to+1)+'globalThis.actionable=hasAction;',row);expect(row.actionable).toBe(true);
});

it.each(['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'])('makes a cancellation row actionable and opens only its exact plan: %s', async eventId => {
 const from=source.indexOf('                const hasAction ='),to=source.indexOf('                const timeLeft',from)-1;
 expect(from).toBeGreaterThan(-1);
 const row:any={notif:{type:'plan_cancelled',event_id:eventId},goesToYours:false,goesToCommunityRequests:false,goesToCommunityEvent:false};
 vm.runInNewContext(source.slice(from,to+1)+'globalThis.actionable=hasAction;',row);
 expect(row.actionable).toBeTruthy();
 await act(async()=>{await handler('cancellation-notice','acted',eventId,'plan_cancelled');});
 expect(mockEq).toHaveBeenCalledWith('user_id','alice');
 expect(mockUpdate).toHaveBeenCalledWith({status:'acted'});
 expect(close).toHaveBeenCalledTimes(1);expect(push).toHaveBeenCalledWith(`/plan/${eventId}`);
});
it('does not expose a cancellation action without an event identity',()=>{
 const from=source.indexOf('                const hasAction ='),to=source.indexOf('                const timeLeft',from)-1;
 const row:any={notif:{type:'plan_cancelled'},goesToYours:false,goesToCommunityRequests:false,goesToCommunityEvent:false};
 vm.runInNewContext(source.slice(from,to+1)+'globalThis.actionable=hasAction;',row);
 expect(row.actionable).toBeFalsy();
});
it('does not open cancelled plan details after account retirement while read-mark is pending',async()=>{
 const pending=held();mockWrite.mockReturnValueOnce(pending.promise);let done!:Promise<void>;
 act(()=>{done=handler('cancellation-notice','acted','11111111-1111-4111-8111-111111111111','plan_cancelled');});
 act(()=>{emit('bob');emit('alice');});
 await act(async()=>{pending.resolve({error:null});await done;});
 expect(push).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
});
