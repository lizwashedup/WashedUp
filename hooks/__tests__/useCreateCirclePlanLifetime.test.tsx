import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCreateCirclePlan, isUnconfirmedCirclePlanCreation, isObsoleteCirclePlanOperation, UnconfirmedCirclePlanCreationError, type CreateCirclePlanArgs } from '../useCreateCirclePlan';
const mockGetUser=jest.fn(), mockRpc=jest.fn();
let mockAuthListener: ((event:string,session:any)=>void) | undefined;
const mockUnsubscribe=jest.fn();
jest.mock('../../lib/supabase',()=>({supabase:{auth:{getUser:(...args:any[])=>mockGetUser(...args),onAuthStateChange:(cb:any)=>{mockAuthListener=cb;return {data:{subscription:{unsubscribe:mockUnsubscribe}}};}},rpc:(...args:any[])=>mockRpc(...args)}}));
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(e:any)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};}
let hook:ReturnType<typeof useCreateCirclePlan>, tree:ReactTestRenderer, client:QueryClient, invalidate:jest.SpyInstance;
let current:boolean;
const receipt={event_id:'7b42d4c2-8bd2-4f4a-8a52-37275f1c14ef',has_own_chat:true};
const entryIsCurrent=()=>current;
function args(extra:any={}):CreateCirclePlanArgs{return {circleId:'circle-a',title:'Beach',startTime:'2040-09-15T23:00:00.000Z',visibility:'circle_only',scope:{userId:'alice',isCurrent:entryIsCurrent},...extra};}
function Probe(){hook=useCreateCirclePlan();return null;}
async function mount(){client=new QueryClient({defaultOptions:{mutations:{retry:false,gcTime:Infinity},queries:{retry:false,gcTime:Infinity}}});invalidate=jest.spyOn(client,'invalidateQueries').mockResolvedValue();await act(async()=>{tree=create(<QueryClientProvider client={client}><Probe/></QueryClientProvider>);});}
async function flush(){await act(async()=>{await Promise.resolve();await Promise.resolve();});}
beforeEach(()=>{jest.clearAllMocks();mockGetUser.mockReset();mockRpc.mockReset();mockAuthListener=undefined;current=true;mockGetUser.mockResolvedValue({data:{user:{id:'alice'}},error:null});mockRpc.mockResolvedValue({data:receipt,error:null});});
afterEach(()=>{act(()=>tree?.unmount());client?.clear();});
it('preserves exact RPC fields, defaults, receipt and existing cache prefixes',async()=>{
 await mount();let result:any;await act(async()=>{result=await hook.mutateAsync(args({memberUserIds:['bob'],locationText:'Beach',primaryVibe:'outdoors'}));});
 expect(result).toEqual(receipt);expect(mockGetUser).toHaveBeenCalledTimes(1);expect(mockRpc).toHaveBeenCalledWith('create_circle_plan',{p_circle_id:'circle-a',p_title:'Beach',p_start_time:'2040-09-15T23:00:00.000Z',p_visibility:'circle_only',p_stranger_cap:null,p_gender_rule:'mixed',p_member_user_ids:['bob'],p_location_text:'Beach',p_description:null,p_primary_vibe:'outdoors'});
 expect(invalidate.mock.calls.map(([v])=>v.queryKey)).toEqual([['circles','detail','circle-a'],['circle-plans','circle-a'],['events','feed'],['my-plans'],['feed-member-ids']]);
});
it.each(['retired','unavailable'] as const)('does not dispatch for %s scope',async kind=>{
 await mount();current=false;let failure:any;await act(async()=>{failure=await hook.mutateAsync(args(kind==='unavailable'?{scope:null}:{})).catch(e=>e);});expect(failure).toBeInstanceOf(Error);expect(mockGetUser).not.toHaveBeenCalled();expect(mockRpc).not.toHaveBeenCalled();
});
it('rejects an authenticated account mismatch before writing',async()=>{
 mockGetUser.mockResolvedValue({data:{user:{id:'bob'}},error:null});await mount();await act(async()=>{await expect(hook.mutateAsync(args())).rejects.toBeInstanceOf(Error);});expect(mockRpc).not.toHaveBeenCalled();
});
it('captures recipient IDs before the mutation microtask and auth wait',async()=>{
 const pending=deferred<any>();mockGetUser.mockReturnValue(pending.promise);await mount();const selected=['bob'];let result!:Promise<any>;
 act(()=>{result=hook.mutateAsync(args({memberUserIds:selected}));selected.push('cara');});await flush();await act(async()=>{pending.resolve({data:{user:{id:'alice'}},error:null});await result;});expect(mockRpc.mock.calls[0][1].p_member_user_ids).toEqual(['bob']);
});
it('retires a deferred auth result on account ABA, even before a component rerender',async()=>{
 const pending=deferred<any>();mockGetUser.mockReturnValue(pending.promise);await mount();mockAuthListener?.('SIGNED_IN',{user:{id:'alice'}});let result!:Promise<any>;
 act(()=>{result=hook.mutateAsync(args()).catch(e=>e);});await flush();mockAuthListener?.('SIGNED_IN',{user:{id:'bob'}});mockAuthListener?.('SIGNED_IN',{user:{id:'alice'}});
 await act(async()=>{pending.resolve({data:{user:{id:'alice'}},error:null});expect(await result).toBeInstanceOf(Error);});expect(mockRpc).not.toHaveBeenCalled();
});
it.each(['success','error'] as const)('ignores stale RPC %s without invalidating the next entry caches',async kind=>{
 const pending=deferred<any>();mockRpc.mockReturnValue(pending.promise);await mount();let result!:Promise<any>;act(()=>{result=hook.mutateAsync(args()).catch(e=>e);});await flush();expect(mockRpc).toHaveBeenCalledTimes(1);current=false;
 await act(async()=>{pending.resolve(kind==='success'?{data:receipt,error:null}:{data:null,error:new Error('old failure')});expect(await result).toBeInstanceOf(Error);});expect(invalidate).not.toHaveBeenCalled();
});
it('prevents synchronous duplicate writes and allows retry after a current failure',async()=>{
 const pending=deferred<any>();mockRpc.mockReturnValueOnce(pending.promise);await mount();let first!:Promise<any>,second!:Promise<any>;
 act(()=>{first=hook.mutateAsync(args()).catch(e=>e);second=hook.mutateAsync(args()).catch(e=>e);});await flush();expect(mockRpc).toHaveBeenCalledTimes(1);
 await act(async()=>{pending.resolve({data:null,error:new Error('try again'),status:400});expect(await first).toBeInstanceOf(Error);expect(await second).toBeInstanceOf(Error);});await act(async()=>{expect(await hook.mutateAsync(args())).toEqual(receipt);});expect(mockRpc).toHaveBeenCalledTimes(2);
});
it('preserves unscoped compatibility and open capacity/gender arguments',async()=>{
 await mount();await act(async()=>{expect(await hook.mutateAsync(args({scope:undefined,visibility:'open',strangerCap:7,genderRule:'women',description:'Come along',memberUserIds:[]}))).toEqual(receipt);});expect(mockRpc.mock.calls[0][1]).toMatchObject({p_visibility:'open',p_stranger_cap:7,p_gender_rule:'women',p_description:'Come along',p_member_user_ids:null});
});
it('does not touch caches after unmount while the RPC is pending',async()=>{
 const pending=deferred<any>();mockRpc.mockReturnValue(pending.promise);await mount();let result!:Promise<any>;act(()=>{result=hook.mutateAsync(args()).catch(e=>e);});await flush();act(()=>tree.unmount());
 await act(async()=>{pending.resolve({data:receipt,error:null});expect(await result).toBeInstanceOf(Error);});expect(invalidate).not.toHaveBeenCalled();
});


it('preserves a confirmed false chat flag without inferring it from visibility',async()=>{
 mockRpc.mockResolvedValue({data:{...receipt,has_own_chat:false},error:null});await mount();
 await act(async()=>{expect(await hook.mutateAsync(args({visibility:'open'}))).toEqual({...receipt,has_own_chat:false});});
 expect(invalidate).toHaveBeenCalledTimes(5);
});

it.each([
 ['null',null],['undefined',undefined],['array',[receipt]],['empty object',{}],
 ['missing id',{has_own_chat:true}],['invalid id',{...receipt,event_id:'plan-created'}],
 ['missing flag',{event_id:receipt.event_id}],['string flag',{...receipt,has_own_chat:'false'}],
 ['null flag',{...receipt,has_own_chat:null}],['numeric flag',{...receipt,has_own_chat:1}],
] as const)('treats a %s receipt as unconfirmed before success or invalidation',async(_label,data)=>{
 mockRpc.mockResolvedValue({data,error:null});await mount();const onSuccess=jest.fn();let failure:unknown;
 await act(async()=>{failure=await hook.mutateAsync(args(),{onSuccess}).catch(e=>e);});
 expect(isUnconfirmedCirclePlanCreation(failure)).toBe(true);expect(onSuccess).not.toHaveBeenCalled();expect(invalidate).not.toHaveBeenCalled();
 // Changing the draft cannot turn an uncertain create into a safe second write.
 mockRpc.mockResolvedValue({data:receipt,error:null});
 await act(async()=>{await expect(hook.mutateAsync(args({title:'Changed title'}))).rejects.toBeInstanceOf(UnconfirmedCirclePlanCreationError);});
 expect(mockRpc).toHaveBeenCalledTimes(1);
});

it.each([500,503,0,408,undefined])('keeps returned status %s errors unconfirmed and blocks repeat dispatch',async status=>{
 mockRpc.mockResolvedValueOnce({data:null,error:{message:'Request outcome unknown'},status});await mount();
 await act(async()=>{await expect(hook.mutateAsync(args())).rejects.toBeInstanceOf(UnconfirmedCirclePlanCreationError);});
 await act(async()=>{await expect(hook.mutateAsync(args())).rejects.toBeInstanceOf(UnconfirmedCirclePlanCreationError);});
 expect(mockRpc).toHaveBeenCalledTimes(1);expect(invalidate).not.toHaveBeenCalled();
});

it('classifies rejected transport after dispatch as unconfirmed for mutate callers too',async()=>{
 mockRpc.mockRejectedValueOnce(new TypeError('Network request failed'));await mount();const onError=jest.fn();
 await act(async()=>{hook.mutate(args(),{onError});});await flush();
 expect(isUnconfirmedCirclePlanCreation(onError.mock.calls[0]?.[0])).toBe(true);
 await act(async()=>{await expect(hook.mutateAsync(args())).rejects.toBeInstanceOf(UnconfirmedCirclePlanCreationError);});
 expect(mockRpc).toHaveBeenCalledTimes(1);expect(invalidate).not.toHaveBeenCalled();
});

it.each([400,401,403,409,422,429])('preserves ordinary retry after a definite status %s rejection',async status=>{
 const rejection={message:'Plan rejected',code:'P0001'};mockRpc.mockResolvedValueOnce({data:null,error:rejection,status});await mount();
 await act(async()=>{await expect(hook.mutateAsync(args())).rejects.toBe(rejection);});
 expect(invalidate).not.toHaveBeenCalled();await act(async()=>{expect(await hook.mutateAsync(args())).toEqual(receipt);});
 expect(mockRpc).toHaveBeenCalledTimes(2);
});

it.each(['returned','thrown'])('keeps a %s preflight failure retryable without dispatch',async kind=>{
 const failure=new Error('Account check unavailable');
 if(kind==='returned')mockGetUser.mockResolvedValueOnce({data:{user:null},error:failure});else mockGetUser.mockRejectedValueOnce(failure);
 await mount();await act(async()=>{await expect(hook.mutateAsync(args())).rejects.toBe(failure);});expect(mockRpc).not.toHaveBeenCalled();
 await act(async()=>{expect(await hook.mutateAsync(args())).toEqual(receipt);});expect(mockRpc).toHaveBeenCalledTimes(1);
});

it('keeps several active uncertain entries separate without replacing their locks',async()=>{
 const scopeA={userId:'alice',isCurrent:()=>current},scopeB={userId:'alice',isCurrent:()=>current};
 mockRpc.mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:null,error:null});await mount();
 for(const scope of [scopeA,scopeB])await act(async()=>{await expect(hook.mutateAsync(args({scope}))).rejects.toBeInstanceOf(UnconfirmedCirclePlanCreationError);});
 for(const scope of [scopeA,scopeB])await act(async()=>{await expect(hook.mutateAsync(args({scope}))).rejects.toBeInstanceOf(UnconfirmedCirclePlanCreationError);});
 expect(mockRpc).toHaveBeenCalledTimes(2);
 // Another circle in the same still-active source context is independent.
 await act(async()=>{expect(await hook.mutateAsync(args({scope:scopeA,circleId:'circle-b'}))).toEqual(receipt);});
 expect(mockRpc).toHaveBeenCalledTimes(3);
});

it('allows a new visit after uncertainty without carrying the old entry lock',async()=>{
 let firstCurrent=true;const firstScope={userId:'alice',isCurrent:()=>firstCurrent};
 mockRpc.mockResolvedValueOnce({data:null,error:null});await mount();
 await act(async()=>{await expect(hook.mutateAsync(args({scope:firstScope}))).rejects.toBeInstanceOf(UnconfirmedCirclePlanCreationError);});
 firstCurrent=false;
 await act(async()=>{expect(await hook.mutateAsync(args())).toEqual(receipt);});expect(mockRpc).toHaveBeenCalledTimes(2);
});

it('retires an uncertain lock on an account generation change including ABA',async()=>{
 mockRpc.mockResolvedValueOnce({data:null,error:null});await mount();mockAuthListener?.('SIGNED_IN',{user:{id:'alice'}});
 await act(async()=>{await expect(hook.mutateAsync(args())).rejects.toBeInstanceOf(UnconfirmedCirclePlanCreationError);});
 mockAuthListener?.('SIGNED_IN',{user:{id:'bob'}});mockAuthListener?.('SIGNED_IN',{user:{id:'alice'}});
 await act(async()=>{expect(await hook.mutateAsync(args())).toEqual(receipt);});expect(mockRpc).toHaveBeenCalledTimes(2);
});

it('does not assign an old pending ambiguity to the replacement visit',async()=>{
 const pending=deferred<any>();mockRpc.mockReturnValueOnce(pending.promise);let firstCurrent=true;
 const firstScope={userId:'alice',isCurrent:()=>firstCurrent};await mount();let first!:Promise<any>;
 act(()=>{first=hook.mutateAsync(args({scope:firstScope})).catch(e=>e);});await flush();firstCurrent=false;
 await act(async()=>{pending.reject(new TypeError('Old network failure'));expect(isObsoleteCirclePlanOperation(await first)).toBe(true);});
 expect(invalidate).not.toHaveBeenCalled();
 await act(async()=>{expect(await hook.mutateAsync(args())).toEqual(receipt);});expect(mockRpc).toHaveBeenCalledTimes(2);
});

it('protects an unscoped caller only for the same circle and account lifetime',async()=>{
 mockRpc.mockResolvedValueOnce({data:null,error:null});await mount();
 await act(async()=>{await expect(hook.mutateAsync(args({scope:undefined}))).rejects.toBeInstanceOf(UnconfirmedCirclePlanCreationError);});
 await act(async()=>{await expect(hook.mutateAsync(args({scope:undefined}))).rejects.toBeInstanceOf(UnconfirmedCirclePlanCreationError);});
 await act(async()=>{expect(await hook.mutateAsync(args({scope:undefined,circleId:'circle-b'}))).toEqual(receipt);});
 expect(mockRpc).toHaveBeenCalledTimes(2);
});
