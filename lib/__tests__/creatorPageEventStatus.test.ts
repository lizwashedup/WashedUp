const mockUser=jest.fn(),mockRpc=jest.fn();
jest.mock('../supabase',()=>({supabase:{auth:{getUser:()=>mockUser()},rpc:(...a:unknown[])=>mockRpc(...a)}}));
import {setPageEventStatus,getPageEventStatusAttempt} from '../creatorPageEventStatus';
const page='f5d7644a-2ff5-4def-b0ab-d04b8250892b',event='0f900000-0000-4000-8000-000000000010',request='0f900000-0000-4000-8000-000000000020',user='0e6e1827-0f87-4e03-b42b-7ade8219725b';
const scope={userId:user,isCurrent:()=>true},input={status:'Cancelled' as const,expectedUpdatedAt:'2026-09-15T01:00:00Z'};
const raw={page_id:page,event_id:event,request_id:request,user_id:user,status:'Cancelled',expected_updated_at:input.expectedUpdatedAt,updated_at:'2026-09-15T02:00:00Z'};
beforeEach(()=>{jest.resetAllMocks();mockUser.mockResolvedValue({data:{user:{id:user}}});mockRpc.mockResolvedValue({data:raw});});
it('dispatches only the original page, event, request, status and version',async()=>{
 await expect(setPageEventStatus(page,event,request,input,scope)).resolves.toMatchObject({pageId:page,eventId:event,requestId:request,status:'Cancelled'});
 expect(mockRpc).toHaveBeenCalledWith('set_creator_page_event_status',{p_page_id:page,p_event_id:event,p_request_id:request,p_status:'Cancelled',p_expected_updated_at:input.expectedUpdatedAt});
});
it('read-only checking never dispatches a status update',async()=>{mockRpc.mockResolvedValue({data:null});await expect(getPageEventStatusAttempt(page,event,request,input,scope)).resolves.toBeNull();expect(mockRpc).toHaveBeenCalledWith('get_creator_page_event_status_attempt',{p_page_id:page,p_event_id:event,p_request_id:request});});
it('keeps server denial and conflict intact without retry or fallback',async()=>{const error={code:'PT409'};mockRpc.mockResolvedValue({data:null,error});await expect(setPageEventStatus(page,event,request,input,scope)).rejects.toBe(error);expect(mockRpc).toHaveBeenCalledTimes(1);});
it('rejects changed accounts before dispatch',async()=>{mockUser.mockResolvedValue({data:{user:{id:event}}});await expect(setPageEventStatus(page,event,request,input,scope)).rejects.toThrow();expect(mockRpc).not.toHaveBeenCalled();});
it('retires a completed response after account change',async()=>{mockRpc.mockImplementation(async()=>{mockUser.mockResolvedValue({data:{user:{id:event}}});return {data:raw};});await expect(setPageEventStatus(page,event,request,input,scope)).rejects.toThrow();expect(mockRpc).toHaveBeenCalledTimes(1);});
it.each([{...raw,page_id:event},{...raw,event_id:page},{...raw,user_id:event},{...raw,request_id:event},{...raw,status:'Completed'},{...raw,expected_updated_at:'2026-09-15T03:00:00Z'},{...raw,updated_at:null},null])('rejects mismatched or unconfirmed receipts %#',async data=>{mockRpc.mockResolvedValue({data});await expect(setPageEventStatus(page,event,request,input,scope)).rejects.toThrow();});

it('rejects a receipt for another microsecond of the saved event version',async()=>{const precise={...input,expectedUpdatedAt:'2026-09-15T01:00:00.123456Z'};mockRpc.mockResolvedValue({data:{...raw,expected_updated_at:'2026-09-15T01:00:00.123457Z'}});await expect(setPageEventStatus(page,event,request,precise,scope)).rejects.toThrow('could not be confirmed');});
it('accepts an equivalent timezone representation of the exact version',async()=>{const precise={...input,expectedUpdatedAt:'2026-09-15T01:00:00.123456Z'};mockRpc.mockResolvedValue({data:{...raw,expected_updated_at:'2026-09-14T18:00:00.123456-07:00'}});await expect(setPageEventStatus(page,event,request,precise,scope)).resolves.toMatchObject({status:'Cancelled'});});
