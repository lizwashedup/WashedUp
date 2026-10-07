const mockSession=jest.fn(),mockFrom=jest.fn(),mockUser=jest.fn();
jest.mock('../supabase',()=>({supabase:{auth:{getSession:()=>mockSession(),getUser:()=>mockUser()},from:(...a:any[])=>mockFrom(...a)}}));
import {getMyOrders} from '../ticketing';
const scope={userId:'buyer',isCurrent:()=>true};
function request(data:any,error:any=null){const q:any={then:(ok:any,bad:any)=>Promise.resolve({data,error}).then(ok,bad)};for(const name of ['select','eq','in','order','abortSignal','setHeader'])q[name]=jest.fn(()=>q);return q;}
beforeEach(()=>{jest.clearAllMocks();mockSession.mockResolvedValue({data:{session:{user:{id:'buyer'},access_token:'original-token'}},error:null});mockUser.mockResolvedValue({data:{user:{id:'buyer'}},error:null});});
it('scopes the original wallet query and preserves paid/refunded records, codes and admission',async()=>{
 const q=request([{id:'order',event_id:'event',qty:2,status:'paid',explore_events:{title:'Sunday',community_id:'page'},ticket_order_positions:[{id:'a',position_index:1,reference_code:'CODE',voided_at:null,ticket_checkins:[{result:'admitted'}]},{id:'b',position_index:2,reference_code:'VOID',voided_at:'2026-09-17',ticket_checkins:[{result:'duplicate'}]}]}]);mockFrom.mockReturnValue(q);const orders=await getMyOrders(scope);expect(q.eq).toHaveBeenCalledWith('buyer_user_id','buyer');expect(q.in).toHaveBeenCalledWith('status',['paid','refunded']);expect(q.setHeader).toHaveBeenCalledWith('Authorization','Bearer original-token');expect(orders[0].seats).toMatchObject([{reference_code:'CODE',checkedIn:true,voided:false},{reference_code:'VOID',checkedIn:false,voided:true}]);
});
it('throws a failed read instead of returning a false empty wallet for scoped and legacy callers',async()=>{
 mockFrom.mockReturnValue(request(null,Error('offline')));await expect(getMyOrders(scope)).rejects.toThrow('could not be loaded');await expect(getMyOrders()).rejects.toThrow('could not be loaded');mockFrom.mockReturnValue(request([]));expect(await getMyOrders(scope)).toEqual([]);
});
it('denies changed-account dispatch and late prior-account results',async()=>{
 mockSession.mockResolvedValueOnce({data:{session:{user:{id:'other'},access_token:'other'}}});await expect(getMyOrders(scope)).rejects.toThrow();expect(mockFrom).not.toHaveBeenCalled();let current=true;const q=request([]);q.then=(ok:any)=>{current=false;return Promise.resolve({data:[],error:null}).then(ok);};mockFrom.mockReturnValue(q);await expect(getMyOrders({...scope,isCurrent:()=>current})).rejects.toThrow('no longer active');
});
it('propagates unavailable authentication instead of false empty results',async()=>{mockUser.mockResolvedValue({data:{user:null},error:Error('account offline')});await expect(getMyOrders()).rejects.toThrow('account offline');expect(mockFrom).not.toHaveBeenCalled();});
