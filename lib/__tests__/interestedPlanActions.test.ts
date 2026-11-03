import { buildSimilarPlanParams, canMakeSimilarPlan, fetchSimilarPlanParams, removeInterestedPlan } from '../interestedPlanActions';
const mockRpc=jest.fn(), mockRead=jest.fn(), mockEq=jest.fn();
jest.mock('../supabase',()=>({supabase:{rpc:(...args:any[])=>mockRpc(...args),from:()=>({select:()=>({eq:(...args:any[])=>{mockEq(...args);return {single:()=>mockRead()};}})})}}));
const source={id:'plan',title:'A walk',status:'completed',circle_id:null,allow_duplicate:true,
 start_time:'2026-01-01T20:00:00Z',end_time:'2026-01-01T22:00:00Z',tickets_url:'https://old.invalid/tickets',explore_event_id:'old-event',
 description:'A friendly walk.',location_text:'The park',location_lat:34,location_lng:-118,image_url:'https://photo.invalid/source.jpg'};
beforeEach(()=>{jest.clearAllMocks();mockRead.mockResolvedValue({data:source,error:null});mockRpc.mockResolvedValue({data:null,error:null});});
afterEach(()=>jest.useRealTimers());
it('allows next-time interest in a completed plan without copying dates, ticket/event links or invitations',()=>{
 expect(canMakeSimilarPlan(source)).toBe(true);
 const params=buildSimilarPlanParams(source,'request-1');
 expect(params).toMatchObject({prefillTitle:'A walk',prefillDescription:'A friendly walk.',prefillLocation:'The park',prefillImageUrl:source.image_url,similarPlanRequest:'request-1'});
 for(const key of ['prefillStartTime','prefillEndTime','prefillEventDate','prefillTicketsUrl','prefillExploreEventId','duplicatedFromEventId','draftId','prefillInvitePersonId']) expect(params[key]).toBe('');
 expect(mockRpc).not.toHaveBeenCalled();
});
it.each([{allow_duplicate:false},{allow_duplicate:null},{circle_id:'private-circle'},{circle_metadata_known:false},{status:'draft'},{status:'cancelled'}])('refuses ineligible copies: %s',change=>expect(canMakeSimilarPlan({...source,...change})).toBe(false));
it('fetches full current details before opening a draft, without writes',async()=>{
 const params=await fetchSimilarPlanParams('plan','fresh');expect(mockEq).toHaveBeenCalledWith('id','plan');expect(params.prefillDescription).toBe(source.description);expect(mockRpc).not.toHaveBeenCalled();
});
it.each([null,{...source,id:'other'},{...source,allow_duplicate:false},{...source,circle_id:'circle'},{...source,circle_id:undefined}])('rejects inaccessible or changed source details: %s',async data=>{
 mockRead.mockResolvedValue({data,error:null});await expect(fetchSimilarPlanParams('plan','fresh')).rejects.toThrow('no longer available');
});
it('preserves read failures',async()=>{mockRead.mockResolvedValue({data:null,error:new Error('offline')});await expect(fetchSimilarPlanParams('plan','fresh')).rejects.toThrow('offline');});
it('removes the current owned signal using its signal id rather than the event id',async()=>{
 mockRpc.mockResolvedValueOnce({data:[{event_id:'plan',signal_id:'own-signal'}],error:null});
 await removeInterestedPlan('plan',()=>true);expect(mockRpc.mock.calls).toEqual([['get_user_interest_signals'],['remove_interest_signal',{p_signal_id:'own-signal'}]]);
});
it('treats a fresh absence as already removed and performs no write',async()=>{mockRpc.mockResolvedValue({data:[],error:null});await removeInterestedPlan('plan',()=>true);expect(mockRpc).toHaveBeenCalledTimes(1);});
it('does not dispatch removal after the account or visit changes during the read',async()=>{mockRpc.mockResolvedValue({data:[{event_id:'plan',signal_id:'signal'}],error:null});await removeInterestedPlan('plan',()=>false);expect(mockRpc).toHaveBeenCalledTimes(1);});
it.each([null,{},[{event_id:'plan'}]])('fails closed on a malformed active-interest response: %s',async data=>{mockRpc.mockResolvedValue({data,error:null});await expect(removeInterestedPlan('plan',()=>true)).rejects.toThrow('Could not check');expect(mockRpc).toHaveBeenCalledTimes(1);});
it('surfaces removal failure for retry',async()=>{mockRpc.mockResolvedValueOnce({data:[{event_id:'plan',signal_id:'signal'}],error:null}).mockResolvedValueOnce({data:null,error:new Error('offline')});await expect(removeInterestedPlan('plan',()=>true)).rejects.toThrow('offline');});
it('bounds a stalled removal and retries through a new server read',async()=>{
 jest.useFakeTimers();mockRpc.mockResolvedValueOnce({data:[{event_id:'plan',signal_id:'signal'}],error:null}).mockReturnValueOnce(new Promise(()=>{}));
 const pending=expect(removeInterestedPlan('plan',()=>true)).rejects.toThrow('took too long');await Promise.resolve();await Promise.resolve();await jest.advanceTimersByTimeAsync(8000);await pending;
 mockRpc.mockResolvedValueOnce({data:[],error:null});await removeInterestedPlan('plan',()=>true);expect(mockRpc).toHaveBeenCalledTimes(3);
});
