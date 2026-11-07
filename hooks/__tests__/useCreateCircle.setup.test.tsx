import { readCircleCreationAttempt, beginCircleCreation, finishCircleCreation } from '../../lib/circles/creationAttempt';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MutationCache, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCreateCircle, type CircleCreationScope, isObsoleteCircleCreation, isUnconfirmedCircleCreation } from '../useCreateCircle';
import type { CreateCircleArgs } from '../../lib/circles/types';
const mockRpc=jest.fn(),mockGetUser=jest.fn(),mockUpload=jest.fn();
const mockListeners=new Set<(event:string,session:any)=>void>();
let mockViewer:string|null='alice';
const ID='11111111-1111-4111-8111-111111111111';
jest.mock('../../lib/supabase',()=>({supabase:{rpc:(...args:unknown[])=>mockRpc(...args),auth:{getUser:()=>mockGetUser(),onAuthStateChange:(fn:any)=>{mockListeners.add(fn);return {data:{subscription:{unsubscribe:()=>mockListeners.delete(fn)}}};}}}}));
jest.mock('../../lib/uploadPhoto',()=>({uploadBase64ToStorage:(...args:unknown[])=>mockUpload(...args)}));
jest.mock('expo-crypto',()=>({randomUUID:jest.fn(()=> '22222222-2222-4222-8222-222222222222')}));
const cleanups:Array<()=>void>=[];
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}
const observe=<T,>(p:Promise<T>)=>p.then(value=>({value,error:null}),error=>({value:undefined,error}));
async function flush(){await act(async()=>{for(let i=0;i<80;i++)await Promise.resolve();});}
function auth(id:string|null){mockViewer=id;for(const fn of mockListeners)fn(id?'SIGNED_IN':'SIGNED_OUT',id?{user:{id}}:null);}
function scope(){const s={userId:'alice',live:true,isCurrent:()=>s.live};return s;}
const args=(overrides:Partial<CreateCircleArgs>={}):CreateCircleArgs=>({name:'Friends',description:null,memberUserIds:['jamie','riley'],invitePolicy:'only_me',adminUserIds:[],coverBase64:null,...overrides});
function mount(cache=new MutationCache()){
 let userId='alice',current!:ReturnType<typeof useCreateCircle>,mounted=true;
 const client=new QueryClient({mutationCache:cache,defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false,gcTime:Infinity}}});
 const invalidate=jest.spyOn(client,'invalidateQueries');
 function Harness(){current=useCreateCircle(userId);return null;}
 const render=()=> <QueryClientProvider client={client}><Harness/></QueryClientProvider>;let tree!:ReturnType<typeof create>;act(()=>{tree=create(render());});
 const unmount=()=>{if(mounted)act(()=>tree.unmount());mounted=false;};cleanups.push(()=>{unmount();client.clear();});
 return{get current(){return current;},invalidate,unmount,update(id:string){userId=id;act(()=>tree.update(render()));}};
}
beforeEach(async()=>{await AsyncStorage.clear();jest.clearAllMocks();mockViewer='alice';mockListeners.clear();mockUpload.mockReset().mockResolvedValue(undefined);mockGetUser.mockReset().mockImplementation(async()=>({data:{user:mockViewer?{id:mockViewer}:null},error:null}));mockRpc.mockReset().mockImplementation(async(name:string)=>({data:name==='create_circle'?ID:null,error:null,status:200}));});
afterEach(()=>cleanups.splice(0).forEach(fn=>fn()));
it('preserves create arguments and returns a fully confirmed default receipt',async()=>{
 const f=mount();let receipt:any;await act(async()=>{receipt=await f.current.mutateAsync(args(),{scope:scope()});});
 expect(receipt).toEqual({circleId:ID,policyApplied:true,coverApplied:true});expect(mockRpc.mock.calls).toEqual([['create_circle',{p_name:'Friends',p_description:null,p_member_user_ids:['jamie','riley']}]]);expect(f.invalidate).toHaveBeenCalledWith({queryKey:['circles','mine','alice']});
});
it.each(['everyone','chosen'] as const)('keeps %s policy semantics and promotes the original people',async invitePolicy=>{
 const f=mount();await act(async()=>{await f.current.mutateAsync(args({invitePolicy,adminUserIds:['jamie']}),{scope:scope()});});
 expect(mockRpc).toHaveBeenCalledWith('update_circle',invitePolicy==='everyone'?{p_circle_id:ID,p_set_all_admins:true}:{p_circle_id:ID,p_promote_user_ids:['jamie']});
});
it('keeps a confirmed Circle on policy failure and retries only policy',async()=>{
 const f=mount(),entry=scope();mockRpc.mockResolvedValueOnce({data:ID,error:null,status:200}).mockResolvedValueOnce({data:null,error:{message:'failure'},status:500});let receipt:any;
 await act(async()=>{receipt=await f.current.mutateAsync(args({invitePolicy:'everyone'}),{scope:entry});});expect(receipt).toEqual({circleId:ID,policyApplied:false,coverApplied:true});
 await act(async()=>{receipt=await f.current.retrySetupAsync(ID);});expect(receipt.policyApplied).toBe(true);expect(mockRpc.mock.calls.filter(c=>c[0]==='create_circle')).toHaveLength(1);
});
it('retries a failed cover pointer with the same uploaded photo and no second create',async()=>{
 const f=mount();mockRpc.mockResolvedValueOnce({data:ID,error:null,status:200}).mockResolvedValueOnce({data:null,error:{message:'pointer failed'},status:500});let receipt:any;
 await act(async()=>{receipt=await f.current.mutateAsync(args({coverBase64:'sample-bytes'}),{scope:scope()});});expect(receipt.coverApplied).toBe(false);expect(mockUpload).toHaveBeenCalledTimes(1);
 await act(async()=>{receipt=await f.current.retrySetupAsync(ID);});expect(receipt.coverApplied).toBe(true);expect(mockUpload).toHaveBeenCalledTimes(1);expect(mockRpc.mock.calls.filter(c=>c[0]==='create_circle')).toHaveLength(1);expect(mockRpc.mock.calls.filter(c=>c[0]==='update_circle').map(c=>c[1].p_cover_upload_id)).toEqual(['22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222']);
});
it('reuses the upload path after upload failure and reports independent policy/cover outcomes',async()=>{
 const f=mount();mockUpload.mockRejectedValueOnce(new Error('offline'));let receipt:any;
 await act(async()=>{receipt=await f.current.mutateAsync(args({invitePolicy:'everyone',coverBase64:'sample'}),{scope:scope()});});expect(receipt).toMatchObject({policyApplied:true,coverApplied:false});
 await act(async()=>{receipt=await f.current.retrySetupAsync(ID);});expect(receipt.coverApplied).toBe(true);expect(mockUpload.mock.calls[0]).toEqual(mockUpload.mock.calls[1]);expect(mockRpc.mock.calls.filter(c=>c[1]?.p_set_all_admins)).toHaveLength(1);
});
it('coalesces duplicate taps before React Query renders pending',async()=>{
 const gate=deferred<any>(),f=mount(),entry=scope();mockRpc.mockReturnValueOnce(gate.promise);let first:any,second:any;
 act(()=>{first=observe(f.current.mutateAsync(args(),{scope:entry}));second=observe(f.current.mutateAsync(args(),{scope:entry}));});await flush();expect(mockRpc).toHaveBeenCalledTimes(1);expect((await second).error).toBeTruthy();await act(async()=>gate.resolve({data:ID,error:null,status:200}));expect((await first).value.circleId).toBe(ID);
});
it('never recreates a confirmed circle when the same flow retries create',async()=>{
 const f=mount(),entry=scope();await act(async()=>{await f.current.mutateAsync(args(),{scope:entry});await f.current.mutateAsync(args({name:'Changed form'}),{scope:entry});});expect(mockRpc.mock.calls.filter(c=>c[0]==='create_circle')).toHaveLength(1);
});
it.each(['account','roundtrip','visit','unmount'])('rejects queued create after %s retirement',async kind=>{
 const gate=deferred<void>(),f=mount(new MutationCache({onMutate:()=>gate.promise})),entry=scope();let result:any;act(()=>{result=observe(f.current.mutateAsync(args(),{scope:entry}));});await flush();
 if(kind==='account'){act(()=>auth('bob'));f.update('bob');}if(kind==='roundtrip')act(()=>{auth('bob');auth('alice');});if(kind==='visit')entry.live=false;if(kind==='unmount')f.unmount();await act(async()=>gate.resolve());expect(isObsoleteCircleCreation((await result).error)).toBe(true);expect(mockRpc).not.toHaveBeenCalled();
});
it('requires actual account ownership before create dispatch',async()=>{
 const f=mount();mockGetUser.mockResolvedValueOnce({data:{user:{id:'bob'}},error:null});const result=await observe(f.current.mutateAsync(args(),{scope:scope()}));expect(isObsoleteCircleCreation(result.error)).toBe(true);expect(mockRpc).not.toHaveBeenCalled();
});
it('stops refinements and feedback if the create completes after entry retirement',async()=>{
 const gate=deferred<any>(),f=mount(),entry=scope();mockRpc.mockReturnValueOnce(gate.promise);let result:any;act(()=>{result=observe(f.current.mutateAsync(args({invitePolicy:'everyone',coverBase64:'sample'}),{scope:entry}));});await flush();entry.live=false;await act(async()=>gate.resolve({data:ID,error:null,status:200}));expect(isObsoleteCircleCreation((await result).error)).toBe(true);expect(mockRpc).toHaveBeenCalledTimes(1);expect(mockUpload).not.toHaveBeenCalled();expect(f.invalidate).not.toHaveBeenCalled();
});
it.each([null,'not-a-circle',{id:ID}])('does not refine or route an invalid create receipt %p',async data=>{
 const f=mount(),entry=scope();mockRpc.mockResolvedValueOnce({data,error:null,status:200});const result=await observe(f.current.mutateAsync(args(),{scope:entry}));expect(isUnconfirmedCircleCreation(result.error)).toBe(true);const again=await observe(f.current.mutateAsync(args(),{scope:entry}));expect(isUnconfirmedCircleCreation(again.error)).toBe(true);expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('allows explicit retry after a definite server rejection',async()=>{
 const f=mount(),entry=scope(),error={message:'Name rejected',code:'22023'};mockRpc.mockResolvedValueOnce({data:null,error,status:400});expect((await observe(f.current.mutateAsync(args(),{scope:entry}))).error).toBe(error);await act(async()=>{await f.current.mutateAsync(args(),{scope:entry});});expect(mockRpc).toHaveBeenCalledTimes(2);
});
it.each(['throw','timeout','request-timeout'])('requires checking the Circle list after an ambiguous %s',async kind=>{
 const f=mount(),entry=scope();if(kind==='throw')mockRpc.mockRejectedValueOnce(new Error('network'));else mockRpc.mockResolvedValueOnce({data:null,error:{message:'timeout'},status:kind==='request-timeout'?408:504});const result=await observe(f.current.mutateAsync(args(),{scope:entry}));expect(isUnconfirmedCircleCreation(result.error)).toBe(true);expect(isUnconfirmedCircleCreation((await observe(f.current.mutateAsync(args(),{scope:entry}))).error)).toBe(true);expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('retains original policy and member choices across deferred dispatch and setup retry',async()=>{
 const gate=deferred<void>(),f=mount(new MutationCache({onMutate:()=>gate.promise})),input=args({invitePolicy:'chosen',adminUserIds:['jamie']}),entry=scope();let result:any;act(()=>{result=observe(f.current.mutateAsync(input,{scope:entry}));});input.memberUserIds.push('someone-new');input.adminUserIds.push('someone-new');await act(async()=>gate.resolve());await result;expect(mockRpc.mock.calls[0][1].p_member_user_ids).toEqual(['jamie','riley']);expect(mockRpc.mock.calls[1][1].p_promote_user_ids).toEqual(['jamie']);
});
it('will not retry setup under another account or a later visit',async()=>{
 const f=mount(),entry=scope();mockUpload.mockRejectedValueOnce(new Error('failed'));await act(async()=>{await f.current.mutateAsync(args({coverBase64:'sample'}),{scope:entry});});entry.live=false;expect(()=>f.current.retrySetupAsync(ID)).toThrow('no longer current');expect(mockUpload).toHaveBeenCalledTimes(1);
});
it('stops later cache effects if the first invalidation retires this entry',async()=>{
 const f=mount(),entry=scope();f.invalidate.mockImplementationOnce(async()=>{entry.live=false;});
 const result=await observe(f.current.mutateAsync(args(),{scope:entry}));
 expect(isObsoleteCircleCreation(result.error)).toBe(true);expect(f.invalidate).toHaveBeenCalledTimes(1);
 expect(f.invalidate).toHaveBeenCalledWith({queryKey:['circles','mine','alice']});
});

it('does not dispatch a second identical create from a new visit while the original request is outstanding', async () => {
  const cache = new MutationCache();
  const first = mount(cache), visit = scope();
  const gate = deferred<{data: string; error: null; status: number}>();
  mockRpc.mockReturnValueOnce(gate.promise);
  const original = observe(first.current.mutateAsync(args(), {scope: visit}));
  await flush();
  expect(mockRpc.mock.calls.filter(([name]) => name === 'create_circle')).toHaveLength(1);
  visit.live = false; first.unmount();
  const next = mount(cache);
  // Do not await the second call: it may correctly wait for the first receipt.
  const again = observe(next.current.mutateAsync(args(), {scope: scope()}));
  await flush();
  const callsWhilePending = mockRpc.mock.calls.filter(([name]) => name === 'create_circle').length;
  gate.resolve({data: ID, error: null, status: 200});
  await Promise.all([original, again]);
  expect(callsWhilePending).toBe(1);
});

it('keeps a late creation receipt for the original form and resumes only explicitly requested setup', async () => {
  const f = mount(), entry = scope(), gate = deferred<any>();
  mockRpc.mockReturnValueOnce(gate.promise);
  jest.useFakeTimers();
  try {
    const original = observe(f.current.mutateAsync(args({invitePolicy: 'everyone', coverBase64: 'photo'}), {scope: entry}));
    await flush();
    await act(async () => { await jest.advanceTimersByTimeAsync(12_100); });
    expect(isUnconfirmedCircleCreation((await original).error)).toBe(true);
    const attempt = await readCircleCreationAttempt('alice');
    if (!attempt) throw new Error('Expected the pending circle request');
    expect(attempt.circleId).toBeNull();
    gate.resolve({data: ID, error: null, status: 200}); await flush();
    expect(await readCircleCreationAttempt('alice')).toEqual({...attempt, circleId: ID});
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(f.current.canResumeSetup(attempt.requestId)).toBe(true);
    const result = await f.current.resumeSetupAsync(attempt.requestId);
    expect(result).toEqual({circleId: ID, policyApplied: true, coverApplied: true});
    expect(mockRpc.mock.calls.map(([name]) => name)).toEqual(['create_circle', 'update_circle', 'update_circle']);
    expect((await readCircleCreationAttempt('alice'))?.circleId).toBe(ID);
    f.current.acknowledgeReceipt(ID);
    expect(await readCircleCreationAttempt('alice')).toBeNull();
  } finally { jest.useRealTimers(); }
});

it('preserves an unknown response across entries while another account creates its own circle', async () => {
  const first = mount();
  mockRpc.mockResolvedValueOnce({data: null, error: {message: 'offline'}, status: 0});
  expect(isUnconfirmedCircleCreation((await observe(first.current.mutateAsync(args(), {scope: scope()}))).error)).toBe(true);
  first.unmount();
  const next = mount();
  expect(isUnconfirmedCircleCreation((await observe(next.current.mutateAsync(args({name:'Another title'}), {scope: scope()}))).error)).toBe(true);
  expect(mockRpc).toHaveBeenCalledTimes(1);
  act(() => auth('bob')); next.update('bob');
  await next.current.mutateAsync(args(), {scope: {userId:'bob', isCurrent:()=>true}});
  expect(mockRpc).toHaveBeenCalledTimes(2);
});

it('makes no network write if the local recovery marker could not be saved', async () => {
  const f = mount();
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('Device storage unavailable'));
  expect((await observe(f.current.mutateAsync(args(), {scope: scope()}))).error).toBeTruthy();
  expect(mockRpc).not.toHaveBeenCalled();
});

it('cannot modify a separately started request when the earlier creation finishes late', async () => {
  const ids = jest.requireMock('expo-crypto').randomUUID;
  ids.mockReturnValueOnce('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  ids.mockReturnValueOnce('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  const gate = deferred<any>(), first = mount(), visit = scope();
  mockRpc.mockReturnValueOnce(gate.promise);
  const original = observe(first.current.mutateAsync(args({invitePolicy:'everyone'}), {scope:visit}));
  await flush();
  const old = await readCircleCreationAttempt('alice');
  await finishCircleCreation('alice', old!.requestId, null);
  const separate = await beginCircleCreation('alice', () => {});
  expect(separate!.requestId).not.toBe(old!.requestId);
  gate.resolve({data:ID, error:null, status:200});
  expect(isObsoleteCircleCreation((await original).error)).toBe(true);
  expect(await readCircleCreationAttempt('alice')).toEqual(separate);
  expect(mockRpc).toHaveBeenCalledTimes(1);
});

it('returns an offline identity failure without queuing a creation for reconnection', async () => {
  onlineManager.setOnline(false);
  try {
    const f = mount();
    mockGetUser.mockRejectedValueOnce(new Error('Offline'));
    const result = await observe(f.current.mutateAsync(args(), {scope: scope()}));
    expect(result.error?.message).toBe('Offline');
    expect(mockRpc).not.toHaveBeenCalled();
    onlineManager.setOnline(true); await flush();
    expect(mockRpc).not.toHaveBeenCalled();
    await f.current.mutateAsync(args(), {scope: scope()});
    expect(mockRpc).toHaveBeenCalledTimes(1);
  } finally { onlineManager.setOnline(true); }
});

it('makes the confirmed circle available while the optional policy is still saving', async () => {
  const f = mount(), visit = scope(), onSetupPending = jest.fn(), gate = deferred<any>();
  mockRpc.mockResolvedValueOnce({data: ID, error: null, status: 200}).mockReturnValueOnce(gate.promise);
  const operation = observe(f.current.mutateAsync(args({invitePolicy: 'everyone', coverBase64: 'later'}), {scope: visit, onSetupPending}));
  await flush();
  const beforePolicyCompletes = onSetupPending.mock.calls.map(([receipt]) => receipt);
  visit.live = false;
  gate.resolve({data: null, error: null, status: 200});
  expect(isObsoleteCircleCreation((await operation).error)).toBe(true);
  expect(beforePolicyCompletes).toEqual([{circleId: ID, policyApplied: false, coverApplied: false}]);
  expect(mockUpload).not.toHaveBeenCalled();
  expect(mockRpc).toHaveBeenCalledTimes(2);
});

it('finishes a chosen policy with no additional admins without presenting unnecessary setup', async () => {
  const f = mount(), onSetupPending = jest.fn();
  const receipt = await f.current.mutateAsync(args({invitePolicy:'chosen',adminUserIds:[]}), {scope:scope(),onSetupPending});
  expect(receipt.policyApplied).toBe(true);
  expect(onSetupPending).not.toHaveBeenCalled();
  expect(mockRpc).toHaveBeenCalledTimes(1);
});
