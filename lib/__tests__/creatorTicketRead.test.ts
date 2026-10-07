const mockSession=jest.fn(),mockFrom=jest.fn(),mockRpc=jest.fn();
jest.mock('../supabase',()=>({supabase:{auth:{getSession:()=>mockSession()},from:(...args:any[])=>mockFrom(...args),rpc:(...args:any[])=>mockRpc(...args)}}));
import {canReadCreatorTickets} from '../creatorTicketRead';
import {getEventMoneySummary,getEventQuestions,getEventAnswers,getEventAttendees} from '../ticketAttendees';
const scope={userId:'creator',isCurrent:()=>true};
function request(data:any,error:any=null){const q:any={then:(ok:any,bad:any)=>Promise.resolve({data,error}).then(ok,bad)};for(const name of ['select','eq','in','order','maybeSingle','setHeader'])q[name]=jest.fn(()=>q);return q;}
beforeEach(()=>{jest.clearAllMocks();mockSession.mockResolvedValue({data:{session:{user:{id:'creator'},access_token:'original-token'}},error:null});});
it('checks exact event and user with the initiating session, preserving true/false permission',async()=>{
 const q=request(true);mockRpc.mockReturnValue(q);expect(await canReadCreatorTickets('event',scope)).toBe(true);expect(mockRpc).toHaveBeenCalledWith('is_ticketing_organizer',{p_event_id:'event',p_user:'creator'});expect(q.setHeader).toHaveBeenCalledWith('Authorization','Bearer original-token');mockRpc.mockReturnValue(request(false));expect(await canReadCreatorTickets('event',scope)).toBe(false);
});
it('does not confuse a permission read error with confirmed denial',async()=>{mockRpc.mockReturnValue(request(null,{message:'offline'}));await expect(canReadCreatorTickets('event',scope)).rejects.toThrow('Event access');});
it('rejects retired visits and mismatched sessions before private dispatch',async()=>{
 await expect(getEventAttendees('event',{...scope,isCurrent:()=>false})).rejects.toThrow();mockSession.mockResolvedValue({data:{session:{user:{id:'other'},access_token:'other-token'}}});await expect(getEventQuestions('event',scope)).rejects.toThrow();expect(mockFrom).not.toHaveBeenCalled();
});
it('throws scoped order and payout read failures instead of returning zero sales',async()=>{
 mockFrom.mockImplementation((table:string)=>table==='ticket_orders'?request(null,Error('orders unavailable')):request(null));await expect(getEventMoneySummary('event',scope)).rejects.toThrow('orders unavailable');
 mockFrom.mockImplementation((table:string)=>table==='ticket_orders'?request([]):request(null,Error('payout unavailable')));await expect(getEventMoneySummary('event',scope)).rejects.toThrow('payout unavailable');
});
it('retains confirmed empty results while failing questionnaire reads explicitly',async()=>{
 const q=request([]);mockFrom.mockReturnValue(q);expect(await getEventQuestions('event',scope)).toEqual([]);expect(q.setHeader).toHaveBeenCalledWith('Authorization','Bearer original-token');mockFrom.mockReturnValue(request(null,Error('offline')));await expect(getEventQuestions('event',scope)).rejects.toThrow('offline');await expect(getEventAnswers(['order'],scope)).rejects.toThrow('offline');
});
it('discards a response if the visit retires while it is pending',async()=>{
 let active=true,finish:any;const q=request([]);q.then=(ok:any)=>new Promise(resolve=>{finish=resolve;}).then(ok);mockFrom.mockReturnValue(q);const pending=getEventAttendees('event',{...scope,isCurrent:()=>active});await Promise.resolve();await Promise.resolve();await Promise.resolve();active=false;finish({data:[],error:null});await expect(pending).rejects.toThrow('no longer active');
});
it('ticket setup reads pin their session and reject section errors while retaining legacy defaults',async()=>{
 const {getTiers,getMyPayoutState,getEventFaqs,getQuestions,getConfirmationMessage,getTierAvailability}=require('../ticketing');const {listPromoCodes,listAddons}=require('../ticketPromosAddons');
 for(const read of [()=>getTiers('event',true,scope),()=>getMyPayoutState('creator',scope),()=>getEventFaqs('event',scope),()=>getQuestions('event',true,scope),()=>getConfirmationMessage('event',true,scope),()=>listPromoCodes('event',scope),()=>listAddons('event',true,scope)]){
  const q=request(null,Error('offline'));mockFrom.mockReturnValue(q);await expect(read()).rejects.toThrow('offline');expect(q.setHeader).toHaveBeenCalledWith('Authorization','Bearer original-token');
 }
 mockRpc.mockReturnValue(request(null,Error('availability offline')));await expect(getTierAvailability(['tier'],scope)).rejects.toThrow('availability offline');
 mockFrom.mockReturnValue(request(null,Error('offline')));expect(await getTiers('event')).toEqual([]);expect(await listPromoCodes('event')).toEqual([]);
});
