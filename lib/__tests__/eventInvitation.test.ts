const mockSession=jest.fn(),mockRpc=jest.fn();
jest.mock('../supabase',()=>({supabase:{auth:{getSession:()=>mockSession()},rpc:(...a:any[])=>mockRpc(...a)}}));
import { getEventInvitation, parseEventInvitation, validInvitationDraft } from '../eventInvitation';
const context=()=>({eventId:'event',eventTitle:'Sunday picnic',eventImage:null,eventStatus:'Draft',pageId:'page',pageName:'Sunset Social',pageKind:'organization',deliveryReady:false,
 audiences:[{type:'past_attendees',sourceCount:4,excludedCount:1,eligibleCount:3},{type:'followers',sourceCount:8,excludedCount:2,eligibleCount:6}]});
let scope={userId:'creator',isCurrent:()=>true};const headers:any[]=[];
function chain(data:any,error:any=null){const q:any={setHeader:(...args:any[])=>{headers.push(args);return q;},then:(resolve:any)=>Promise.resolve({data,error}).then(resolve)};return q;}
beforeEach(()=>{jest.clearAllMocks();headers.length=0;scope={userId:'creator',isCurrent:()=>true};mockSession.mockResolvedValue({data:{session:{user:{id:'creator'},access_token:'local-token'}},error:null});mockRpc.mockImplementation(()=>chain(context()));});
it('loads only the aggregate RPC pinned to the initiating account',async()=>{expect(await getEventInvitation('event',scope)).toEqual(context());expect(mockRpc).toHaveBeenCalledWith('preview_event_invitation',{p_event_id:'event'});expect(headers).toEqual([['Authorization','Bearer local-token']]);});
it('rejects an account switch before audience dispatch',async()=>{mockSession.mockResolvedValue({data:{session:{user:{id:'other'},access_token:'other'}}});await expect(getEventInvitation('event',scope)).rejects.toThrow();expect(mockRpc).not.toHaveBeenCalled();});
it('rejects retired visits even after a successful response',async()=>{mockRpc.mockImplementation(()=>{scope.isCurrent=()=>false;return chain(context());});await expect(getEventInvitation('event',scope)).rejects.toThrow();});
it('does not turn a failed permission read into an empty audience',async()=>{mockRpc.mockImplementation(()=>chain(null,Error('access denied')));await expect(getEventInvitation('event',scope)).rejects.toThrow('access denied');});
it.each([
 ['foreign event',{eventId:'other'}],['missing page',{pageId:null}],['unknown type',{pageKind:'personal'}],['pretend delivery',{deliveryReady:true}],
 ['unknown count',{audiences:[{type:'past_attendees',sourceCount:4,excludedCount:null,eligibleCount:4},context().audiences[1]]}],
 ['inconsistent count',{audiences:[{type:'past_attendees',sourceCount:4,excludedCount:1,eligibleCount:4},context().audiences[1]]}],
 ['duplicate audience',{audiences:[context().audiences[0],context().audiences[0]]}],
 ['wrong page audience',{pageKind:'community'}],
])('rejects %s',(label,change)=>{expect(()=>parseEventInvitation({...context(),...change},'event')).toThrow();});
it('allows empty saved drafts but rejects invalid or overlong ones',()=>{expect(validInvitationDraft({audience:'past_attendees',body:''})).toBe(true);expect(validInvitationDraft({audience:'all_users',body:'Hi'})).toBe(false);expect(validInvitationDraft({audience:'followers',body:'x'.repeat(2001)})).toBe(false);});
