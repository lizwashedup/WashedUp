const mockSession=jest.fn(),mockRpc=jest.fn(),mockHeader=jest.fn();
jest.mock('../supabase',()=>({supabase:{auth:{getSession:(...a:unknown[])=>mockSession(...a)},rpc:(...a:unknown[])=>mockRpc(...a)}}));
import {createOperatorDraft,getOperatorDraftAttempt,hasOperatorDraftProtocol,cancelOperatorDraftAttempt,validOperatorDraftInput,type OperatorDraftInput} from '../operatorEventDraft';
const user='00000000-0000-4000-8000-000000000001',request='10000000-0000-4000-8000-000000000001',event='20000000-0000-4000-8000-000000000001';
let active=true;const scope={userId:user,isCurrent:()=>active};
const input:OperatorDraftInput={communityId:null,offerType:'free_event',ticketCapacity:24,latitude:34,longitude:-118,
 fields:{title:'Picnic',description:'A short introduction',image_url:'',event_date:'',start_time:null,end_time:null,venue:'LA',venue_address:'',category:'music',categories:['music'],external_url:'',ticket_price:'',public_name:'',pin_to_chat:true,description_blocks:[]}};
const receipt=()=>({version:1,request_id:request,user_id:user,event_id:event,community_id:null,status:'Draft',offer_type:'free_event',ticket_capacity:24,latitude:34,longitude:-118,created_at:'2026-11-05T20:00:00Z'});
beforeEach(()=>{jest.clearAllMocks();active=true;mockSession.mockResolvedValue({data:{session:{user:{id:user},access_token:'fictional-token'}},error:null});mockRpc.mockReturnValue({setHeader:mockHeader});mockHeader.mockResolvedValue({data:receipt(),error:null});});
afterEach(()=>jest.useRealTimers());
it('sends one immutable complete draft with its original request key and pinned account',async()=>{
 const saved=await createOperatorDraft(request,input,scope);expect(saved.eventId).toBe(event);
 expect(mockHeader).toHaveBeenCalledWith('Authorization','Bearer fictional-token');
 expect(mockRpc).toHaveBeenCalledTimes(1);expect(mockRpc).toHaveBeenCalledWith('create_operator_event_draft',expect.objectContaining({p_request_id:request,p_fields:input.fields,p_offer_type:'free_event',p_ticket_capacity:24,p_community_id:null}));
 expect(mockRpc.mock.calls[0][1]).not.toHaveProperty('p_publish');
});
it('keeps later caller edits out of an already-started save',async()=>{
 let resume!:(v:unknown)=>void;mockSession.mockImplementationOnce(()=>new Promise(r=>{resume=r;}));const mutable=JSON.parse(JSON.stringify(input));
 const save=createOperatorDraft(request,mutable,scope);mutable.fields.title='Later edit';mutable.ticketCapacity=99;
 resume({data:{session:{user:{id:user},access_token:'fictional-token'}},error:null});await save;
 expect(mockRpc.mock.calls[0][1].p_fields.title).toBe('Picnic');expect(mockRpc.mock.calls[0][1].p_ticket_capacity).toBe(24);
});
it.each(['request_id','user_id','event_id','offer_type','ticket_capacity','latitude','community_id','status','version'])('does not certify a wrong %s receipt or create again',async key=>{
 const wrong:any=receipt();wrong[key]=key==='ticket_capacity'?12:key==='latitude'?35:key==='version'?2:'wrong';mockHeader.mockResolvedValueOnce({data:wrong,error:null});
 await expect(createOperatorDraft(request,input,scope)).rejects.toThrow();expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('reads a confirmed receipt without writing',async()=>{
 expect((await getOperatorDraftAttempt(request,scope))?.eventId).toBe(event);expect(mockRpc).toHaveBeenCalledWith('get_operator_event_draft_attempt',{p_request_id:request});
});
it('returns unknown when a receipt is absent and does not resend',async()=>{
 mockHeader.mockResolvedValue({data:null,error:null});await expect(getOperatorDraftAttempt(request,scope)).resolves.toBeNull();expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('recognizes only the exact supported protocol version',async()=>{
 mockHeader.mockResolvedValueOnce({data:1,error:null});await expect(hasOperatorDraftProtocol(scope)).resolves.toBe(true);
 mockHeader.mockResolvedValueOnce({data:2,error:null});await expect(hasOperatorDraftProtocol(scope)).rejects.toThrow('version');
});
it('distinguishes a missing deployment from a connection or permission failure',async()=>{
 mockHeader.mockResolvedValueOnce({data:null,error:{code:'PGRST202'}});await expect(hasOperatorDraftProtocol(scope)).resolves.toBe(false);
 mockHeader.mockResolvedValueOnce({data:null,error:{code:'42501'}});await expect(hasOperatorDraftProtocol(scope)).rejects.toMatchObject({code:'42501'});
});
it('does not dispatch from a different account',async()=>{
 mockSession.mockResolvedValue({data:{session:{user:{id:event},access_token:'other-fictional'}},error:null});await expect(createOperatorDraft(request,input,scope)).rejects.toThrow();expect(mockRpc).not.toHaveBeenCalled();
});
it('does not navigate a late receipt into a retired account or visit',async()=>{
 mockHeader.mockImplementationOnce(async()=>{active=false;return {data:receipt(),error:null};});await expect(createOperatorDraft(request,input,scope)).rejects.toThrow();expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('bounds a stalled write and never starts a replacement request',async()=>{
 jest.useFakeTimers();mockHeader.mockImplementationOnce(()=>new Promise(()=>{}));const save=createOperatorDraft(request,input,scope);const outcome=expect(save).rejects.toThrow('too long');
 await jest.advanceTimersByTimeAsync(25_001);await outcome;expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('bounds session lookup without dispatching a write afterward',async()=>{
 jest.useFakeTimers();mockSession.mockImplementationOnce(()=>new Promise(()=>{}));const save=createOperatorDraft(request,input,scope);const outcome=expect(save).rejects.toThrow('too long');await jest.advanceTimersByTimeAsync(12_001);await outcome;expect(mockRpc).not.toHaveBeenCalled();
});
it.each([0,-1,1.5,NaN,2147483648])('rejects invalid capacity %s before dispatch',async ticketCapacity=>{
 await expect(createOperatorDraft(request,{...input,ticketCapacity},scope)).rejects.toThrow('Check');expect(mockRpc).not.toHaveBeenCalled();
});
it('keeps an unlimited dateless draft valid without publishing semantics',()=>{expect(validOperatorDraftInput({...input,ticketCapacity:null,latitude:null,longitude:null})).toBe(true);});

it('accepts a sealed cancellation only with its exact account, request and settings',async()=>{
 mockHeader.mockResolvedValue({data:{...receipt(),event_id:null,status:'Cancelled'},error:null});
 await expect(cancelOperatorDraftAttempt(request,input,scope)).resolves.toMatchObject({status:'Cancelled',eventId:null,requestId:request});
 expect(mockRpc).toHaveBeenCalledWith('cancel_operator_event_draft_attempt',{p_request_id:request,p_input:expect.objectContaining({fields:input.fields,community_id:null,offer_type:'free_event',ticket_capacity:24})});
});
it('returns the existing event if the original save won the cancellation race',async()=>{
 await expect(cancelOperatorDraftAttempt(request,input,scope)).resolves.toMatchObject({status:'Draft',eventId:event});expect(mockRpc).toHaveBeenCalledTimes(1);
});
it.each([{event_id:event,status:'Cancelled'},{event_id:null,status:'Draft'},{event_id:null,status:'Cancelled',ticket_capacity:15}])('refuses a malformed cancellation receipt %j',async patch=>{
 mockHeader.mockResolvedValue({data:{...receipt(),...patch},error:null});await expect(cancelOperatorDraftAttempt(request,input,scope)).rejects.toThrow();
});
it('rejects unknown input fields before persisting or dispatching a request',()=>{
 expect(validOperatorDraftInput({...input,fields:{...input.fields,publish:true}})).toBe(false);
});
