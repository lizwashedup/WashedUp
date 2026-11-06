import React from 'react';
import { act, create } from 'react-test-renderer';
import { useInterestedPlanActions } from '../useInterestedPlanActions';
const mockAuth=jest.fn(), mockRemove=jest.fn(), mockSimilar=jest.fn(), mockPush=jest.fn();
const mockCache=jest.fn(), mockInvalidate=jest.fn();
let mockFocused=true;
jest.mock('expo-router',()=>({useRouter:()=>({push:mockPush}),useFocusEffect:(callback:()=>void)=>{
 require('react').useEffect(()=>mockFocused ? callback() : undefined,[callback,mockFocused]);
}}));
jest.mock('@tanstack/react-query',()=>({useQueryClient:()=>({setQueryData:mockCache,invalidateQueries:mockInvalidate})}));
jest.mock('../../lib/supabase',()=>({supabase:{auth:{getUser:()=>mockAuth()}}}));
jest.mock('../../lib/interestedPlanActions',()=>({canMakeSimilarPlan:(plan:any)=>plan.allow_duplicate===true,removeInterestedPlan:(...args:any[])=>mockRemove(...args),fetchSimilarPlanParams:(...args:any[])=>mockSimilar(...args)}));
const plan:any={id:'plan',title:'Walk',allow_duplicate:true};
let value:ReturnType<typeof useInterestedPlanActions>, tree:ReturnType<typeof create>, user='alice';
function Harness(){value=useInterestedPlanActions(user);return null;}
function mount(){act(()=>{tree=create(<Harness/>);});}
function update(){act(()=>tree.update(<Harness/>));}
function deferred(){let resolve!:(v?:any)=>void;const promise=new Promise<any>(yes=>{resolve=yes;});return {promise,resolve};}
async function flush(){await act(async()=>{for(let i=0;i<10;i++)await Promise.resolve();});}
beforeEach(()=>{jest.clearAllMocks();user='alice';mockFocused=true;mockAuth.mockResolvedValue({data:{user:{id:'alice'}},error:null});mockRemove.mockResolvedValue(true);mockSimilar.mockResolvedValue({prefillTitle:'Walk',similarPlanRequest:'new'});mockInvalidate.mockResolvedValue(undefined);});
afterEach(()=>{act(()=>tree?.unmount());jest.useRealTimers();});
it('keeps the item cached until removal is confirmed and prevents same-tap duplicates',async()=>{
 const pending=deferred();mockRemove.mockReturnValue(pending.promise);mount();
 act(()=>{void value.run(plan,'remove');void value.run(plan,'remove');});await flush();
 expect(mockAuth).toHaveBeenCalledTimes(1);expect(mockRemove).toHaveBeenCalledTimes(1);expect(mockCache).not.toHaveBeenCalled();expect(value.feedback.plan.pending).toBe('remove');
 pending.resolve(true);await flush();expect(mockCache).toHaveBeenCalledTimes(1);
 const [key,filter]=mockCache.mock.calls[0];expect(key).toEqual(['plans.myInterested','alice']);expect(filter([plan,{id:'other'}])).toEqual([{id:'other'}]);
 expect(mockInvalidate).toHaveBeenCalledWith({queryKey:['plans.myInterested','alice']});
});
it('keeps a failed removal visible, with a retry that can succeed',async()=>{
 mockRemove.mockRejectedValueOnce(new Error('offline'));mount();await act(async()=>{await value.run(plan,'remove');});
 expect(mockCache).not.toHaveBeenCalled();expect(value.feedback.plan).toMatchObject({pending:null,retry:'remove',error:expect.stringContaining('Couldn’t remove')});
 await act(async()=>{await value.run(plan,'remove');});expect(mockRemove).toHaveBeenCalledTimes(2);expect(mockCache).toHaveBeenCalledTimes(1);expect(value.feedback.plan.error).toBeNull();
});
it('opens a read-only prefill without removing interest',async()=>{
 mount();await act(async()=>{await value.run(plan,'similar');});expect(mockPush).toHaveBeenCalledWith({pathname:'/(tabs)/post',params:{prefillTitle:'Walk',similarPlanRequest:'new'}});expect(mockRemove).not.toHaveBeenCalled();expect(mockCache).not.toHaveBeenCalled();
});
it('prevents another action on the same card while a source read is pending',async()=>{
 const read=deferred();mockSimilar.mockReturnValue(read.promise);mount();act(()=>{void value.run(plan,'similar');void value.run(plan,'remove');});await flush();expect(mockSimilar).toHaveBeenCalledTimes(1);expect(mockRemove).not.toHaveBeenCalled();read.resolve({prefillTitle:'Walk'});await flush();
});
it('retains retryable errors when a fresh source can no longer be copied',async()=>{
 mockSimilar.mockRejectedValue(new Error('private'));mount();await act(async()=>{await value.run(plan,'similar');});expect(mockPush).not.toHaveBeenCalled();expect(value.feedback.plan).toMatchObject({pending:null,retry:'similar',error:expect.stringContaining('no longer be available')});
});
it('does not dispatch actions under a mismatching authenticated account',async()=>{
 mockAuth.mockResolvedValue({data:{user:{id:'bob'}},error:null});mount();await act(async()=>{await value.run(plan,'remove');});expect(mockRemove).not.toHaveBeenCalled();expect(mockCache).not.toHaveBeenCalled();
});
it.each(['remove','similar'] as const)('ignores late %s results after leaving and returning',async action=>{
 const pending=deferred();(action==='remove'?mockRemove:mockSimilar).mockReturnValue(pending.promise);mount();act(()=>{void value.run(plan,action);});await flush();
 mockFocused=false;update();mockFocused=true;update();pending.resolve(action==='remove'?true:{prefillTitle:'Stale'});await flush();
 if(action==='remove')expect(mockInvalidate).toHaveBeenCalledWith({queryKey:['plans.myInterested','alice'],refetchType:'active'});
 expect(mockPush).not.toHaveBeenCalled();expect(mockCache).not.toHaveBeenCalled();expect(value.feedback).toEqual({});
});
it('retires auth preflight across an account change even if the old account returns',async()=>{
 const auth=deferred();mockAuth.mockReturnValue(auth.promise);mount();act(()=>{void value.run(plan,'remove');});user='bob';update();user='alice';update();auth.resolve({data:{user:{id:'alice'}},error:null});await flush();expect(mockRemove).not.toHaveBeenCalled();
});
it('bounds stalled authentication and permits retry',async()=>{
 jest.useFakeTimers();mockAuth.mockReturnValueOnce(new Promise(()=>{}));mount();act(()=>{void value.run(plan,'remove');});await act(async()=>{await jest.advanceTimersByTimeAsync(8000);});expect(value.feedback.plan.pending).toBeNull();expect(mockRemove).not.toHaveBeenCalled();
 await act(async()=>{await value.run(plan,'remove');});expect(mockRemove).toHaveBeenCalledTimes(1);
});

it('marks only the originating account stale after a confirmed removal arrives in a different account', async () => {
  const receipt = deferred(); mockRemove.mockReturnValue(receipt.promise); mount();
  act(() => { void value.run(plan, 'remove'); }); await flush();
  user='bob'; update(); receipt.resolve(true); await flush();
  expect(mockInvalidate).toHaveBeenCalledWith({queryKey:['plans.myInterested','alice'],refetchType:'none'});
  expect(mockCache).not.toHaveBeenCalled();
  expect(value.feedback).toEqual({});
});
it('preserves the card when the preflight retires before dispatch',async () => {
  mockRemove.mockResolvedValue(false); mount();
  await act(async()=>{await value.run(plan,'remove');});
  expect(mockCache).not.toHaveBeenCalled(); expect(mockInvalidate).not.toHaveBeenCalled();
});
