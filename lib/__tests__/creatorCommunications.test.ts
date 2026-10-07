const mockSession=jest.fn(),mockRpc=jest.fn(),mockFrom=jest.fn(),mockSeats=jest.fn();
jest.mock('../supabase',()=>({supabase:{auth:{getSession:()=>mockSession()},rpc:(...a:any[])=>mockRpc(...a),from:(...a:any[])=>mockFrom(...a)}}));
jest.mock('../ticketAttendees',()=>({getEventAttendees:(...a:any[])=>mockSeats(...a)}));
import {getCommunicationEvent,getCommunicationAudience,CommunicationAudienceDenied} from '../creatorCommunications';
import {getEventRsvpGoingCount} from '../attendeeMessaging';
const headers:any[]=[];let scope={userId:'creator',isCurrent:()=>true};
function chain(data:any,error:any=null,count:any=null){const q:any={select:()=>q,eq:()=>q,maybeSingle:()=>q,setHeader:(...a:any[])=>{headers.push(a);return q;},then:(resolve:any)=>Promise.resolve({data,error,count}).then(resolve)};return q;}
beforeEach(()=>{jest.clearAllMocks();headers.length=0;scope={userId:'creator',isCurrent:()=>true};mockSession.mockResolvedValue({data:{session:{user:{id:'creator'},access_token:'isolated'}},error:null});mockRpc.mockImplementation(()=>chain(true));mockFrom.mockImplementation(()=>chain({id:'event',title:'Sunday'}));mockSeats.mockResolvedValue([{orderId:'a'},{orderId:'a'},{orderId:'b'}]);});
it('requires exact backend authority before event metadata',async()=>{mockRpc.mockImplementation(()=>chain(false));expect(await getCommunicationEvent('event',scope)).toBeNull();expect(mockFrom).not.toHaveBeenCalled();});
it('pins metadata and audience count to initiating authorization',async()=>{await getCommunicationEvent('event',scope);mockFrom.mockImplementation(()=>chain(null,null,3));expect(await getCommunicationAudience('event',scope)).toEqual({purchases:2,rsvps:3});expect(mockSeats).toHaveBeenCalledWith('event',scope);expect(headers.every(h=>h[0]==='Authorization'&&h[1]==='Bearer isolated')).toBe(true);});
it('does not turn an unknown or failed count into zero',async()=>{mockFrom.mockImplementation(()=>chain(null,Error('offline'),null));await expect(getEventRsvpGoingCount('event',scope)).rejects.toThrow();mockFrom.mockImplementation(()=>chain(null,null,null));await expect(getEventRsvpGoingCount('event',scope)).rejects.toThrow();});
it('rejects a switched session before loading private records',async()=>{mockSession.mockResolvedValue({data:{session:{user:{id:'other'},access_token:'other'}}});await expect(getCommunicationAudience('event',scope)).rejects.toThrow();expect(mockSeats).not.toHaveBeenCalled();});
it('retains the existing unscoped RSVP fallback for legacy callers',async()=>{mockFrom.mockImplementation(()=>chain(null,Error('offline')));expect(await getEventRsvpGoingCount('event')).toBe(0);expect(mockSession).not.toHaveBeenCalled();});

it('distinguishes authoritative audience denial from an unavailable permission read before private source queries',async()=>{
 mockRpc.mockImplementation(()=>chain(false));await expect(getCommunicationAudience('event',scope)).rejects.toBeInstanceOf(CommunicationAudienceDenied);expect(mockSeats).not.toHaveBeenCalled();expect(mockFrom).not.toHaveBeenCalled();
 mockRpc.mockImplementation(()=>chain(null,Error('offline')));const problem=await getCommunicationAudience('event',scope).catch(error=>error);expect(problem).toBeInstanceOf(Error);expect(problem).not.toBeInstanceOf(CommunicationAudienceDenied);expect(mockSeats).not.toHaveBeenCalled();
});
