const mockSession=jest.fn(),mockRpc=jest.fn(),mockRead=jest.fn(),mockTeam=jest.fn(),mockAccess=jest.fn(),mockHeaders:string[]=[];
jest.mock('../supabase',()=>({supabase:{auth:{getSession:()=>mockSession()},rpc:(...args:any[])=>({setHeader:(_n:string,v:string)=>{mockHeaders.push(v);return mockRpc(...args);}}),from:(table:string)=>{const filters:any[]=[];const q:any={select:()=>q,eq:(...args:any[])=>{filters.push(args);return q;},maybeSingle:()=>q,setHeader:(_n:string,v:string)=>{mockHeaders.push(v);return mockRead(table,filters);}};return q;}}}));
jest.mock('../creatorPageTeam',()=>({getPageTeam:(...args:any[])=>mockTeam(...args)}));
jest.mock('../creatorMode',()=>({getCreatorAccess:()=>mockAccess(),isAdminTierRole:(role:string)=>['leader','co_leader','admin'].includes(role)}));
import {resolveCommunityManageEntry,resolveCommunityCreatorActions} from '../communityManageEntry';
const id='0f860000-0000-4000-8000-000000000001',other='0f860000-0000-4000-8000-000000000002',user='0e6e1827-0f87-4e03-b42b-7ade8219725b';
let live:boolean;const scope={userId:user,isCurrent:()=>live};
beforeEach(()=>{jest.resetAllMocks();mockHeaders.length=0;live=true;mockSession.mockResolvedValue({data:{session:{user:{id:user},access_token:'synthetic-token'}},error:null});mockRpc.mockImplementation(async(name:string)=>({data:name==='creator_community_is_visible',error:null}));mockRead.mockResolvedValue({data:null,error:null});mockTeam.mockRejectedValue({code:'42501'});mockAccess.mockResolvedValue({ledCommunities:[{id,role:'leader'}]});});
it('opens the exact owned page without a legacy or roster read',async()=>{mockRpc.mockResolvedValue({data:true,error:null});expect(await resolveCommunityManageEntry(id,scope,true)).toEqual({kind:'page',route:`/creator/page?id=${id}`});expect(mockTeam).not.toHaveBeenCalled();expect(mockAccess).not.toHaveBeenCalled();});
it('keeps accepted teammate entry in its exact page team',async()=>{mockTeam.mockResolvedValue({pageId:id,pageKind:'community'});expect(await resolveCommunityManageEntry(id,scope,true)).toEqual({kind:'page',route:`/creator/page-team?id=${id}`});expect(mockAccess).not.toHaveBeenCalled();});
it('an explicit page permission denial cannot fall through to legacy creator tools',async()=>{mockRead.mockResolvedValue({data:{page_id:id,page_kind:'community'},error:null});expect(await resolveCommunityManageEntry(id,scope,true)).toBeNull();expect(mockAccess).not.toHaveBeenCalled();});
it('requires a visible community and a second publication read before legacy entry',async()=>{expect(await resolveCommunityManageEntry(id,scope,true)).toEqual({kind:'legacy',communityId:id,route:`/(tabs)/friends/manage/(tools)/today?fromCommunityId=${id}`});expect(mockRead).toHaveBeenCalledTimes(2);expect(mockRead.mock.calls[0][1]).toEqual([['page_id',id]]);expect(mockHeaders.every(v=>v==='Bearer synthetic-token')).toBe(true);});
it('a publication that appears during the visibility check does not open legacy tools',async()=>{mockRead.mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:{page_id:id,page_kind:'community'},error:null});expect(await resolveCommunityManageEntry(id,scope,true)).toBeNull();expect(mockAccess).not.toHaveBeenCalled();});
it.each([false,null])('visibility %s cannot establish legacy context',async visible=>{mockRpc.mockResolvedValueOnce({data:false,error:null}).mockResolvedValueOnce({data:visible,error:null});await expect(resolveCommunityManageEntry(id,scope,true)).rejects.toThrow('context');expect(mockAccess).not.toHaveBeenCalled();});
it('network or malformed team failures retain recovery rather than becoming a permission denial',async()=>{mockTeam.mockRejectedValue(Error('Offline'));await expect(resolveCommunityManageEntry(id,scope,true)).rejects.toThrow('Offline');expect(mockRead).not.toHaveBeenCalled();expect(mockAccess).not.toHaveBeenCalled();});
it('foreign page identity cannot open another team',async()=>{mockTeam.mockResolvedValue({pageId:other,pageKind:'community'});await expect(resolveCommunityManageEntry(id,scope,true)).rejects.toThrow('team');});
it('failed publication reads never reopen legacy tools',async()=>{mockRead.mockResolvedValue({data:null,error:Error('Offline')});await expect(resolveCommunityManageEntry(id,scope,true)).rejects.toThrow('Offline');expect(mockAccess).not.toHaveBeenCalled();});
it('another community’s leadership does not authorize this destination',async()=>{mockAccess.mockResolvedValue({ledCommunities:[{id:other,role:'leader'}]});expect(await resolveCommunityManageEntry(id,scope,true)).toBeNull();});
it('event-only legacy roles do not enter community management',async()=>{mockAccess.mockResolvedValue({ledCommunities:[{id,role:'events'}]});expect(await resolveCommunityManageEntry(id,scope,true)).toBeNull();});
it('disabled page capabilities leave the established legacy path independent of new tables/RPCs',async()=>{expect(await resolveCommunityManageEntry(id,scope,false)).toMatchObject({kind:'legacy',communityId:id});expect(mockRpc).not.toHaveBeenCalled();expect(mockRead).not.toHaveBeenCalled();expect(mockTeam).not.toHaveBeenCalled();});
it('wrong-account sessions are rejected before data reads',async()=>{mockSession.mockResolvedValue({data:{session:{user:{id:other},access_token:'other'}},error:null});await expect(resolveCommunityManageEntry(id,scope,true)).rejects.toThrow();expect(mockRpc).not.toHaveBeenCalled();});
it('a retired visit discards a late ownership result',async()=>{mockRpc.mockImplementation(async()=>{live=false;return{data:true,error:null};});await expect(resolveCommunityManageEntry(id,scope,true)).rejects.toThrow();expect(mockAccess).not.toHaveBeenCalled();});

it.each(['leader','co_leader'])('approved legacy %s can start an event for this community',async role=>{
 mockAccess.mockResolvedValue({hasLeaderGrant:true,ledCommunities:[{id,role,status:'active'}]});
 const actions=await resolveCommunityCreatorActions(id,scope,true);
 expect(actions.find(a=>a.key==='event')).toMatchObject({route:`/creator/event-form?workspace=community&communityId=${id}`,legacyCommunityId:id});
 expect(actions.some(a=>a.key==='edit')).toBe(true);
});
it.each(['admin', 'events'])('preserves other legacy %s actions without offering a rejected save', async role => {
  mockAccess.mockResolvedValue({hasEventHostGrant:true,ledCommunities:[{id,role,status:'active'},{id:other,role:'leader',status:'active'}]});
  expect((await resolveCommunityCreatorActions(id,scope,true)).map(action => action.key)).toEqual(role === 'admin' ? ['edit'] : []);
});
it.each(['member_care','finance'])('%s does not inherit another community’s admin rights',async role=>{
 mockAccess.mockResolvedValue({ledCommunities:[{id,role,status:'active'},{id:other,role:'leader',status:'active'}]});
 expect(await resolveCommunityCreatorActions(id,scope,true)).toEqual([]);
});
it('drafts continue setup without creating an event; archived communities have no creation shortcuts',async()=>{
 mockAccess.mockResolvedValue({ledCommunities:[{id,role:'leader',status:'draft'}]});
 const actions=await resolveCommunityCreatorActions(id,scope,true);
 expect(actions.map(a=>a.key)).toEqual(['setup','edit']);
 expect(actions.find(a=>a.key==='edit')?.route).toBe(`/creator/edit-page?communityId=${id}`);
 mockAccess.mockResolvedValue({ledCommunities:[{id,role:'leader',status:'archived'}]});
 expect(await resolveCommunityCreatorActions(id,scope,true)).toEqual([]);
});
it('published page owners get page-specific actions without entering legacy tools',async()=>{
 mockRpc.mockResolvedValue({data:true,error:null});mockRead.mockResolvedValue({data:{page_id:id,page_kind:'community'},error:null});
 expect(await resolveCommunityCreatorActions(id,scope,true)).toEqual([
  {key:'event',title:'Create event',route:`/creator/page-events?id=${id}&create=1`},
  {key:'edit',title:'Edit community',route:`/creator/page-edit?id=${id}&mode=approved&from=community`},
 ]);expect(mockAccess).not.toHaveBeenCalled();
});
it('an unpublished page owner continues setup',async()=>{
 mockRpc.mockResolvedValue({data:true,error:null});
 expect(await resolveCommunityCreatorActions(id,scope,true)).toEqual([{key:'setup',title:'Continue setup',route:`/creator/page?id=${id}`}]);
});
it('page content and event permissions stay distinct and revoked assignments grant neither',async()=>{
 mockRead.mockResolvedValue({data:{page_id:id,page_kind:'community'},error:null});
 for(const permissions of [['page_events'],['page_content'],['membership_requests']]){
  mockTeam.mockResolvedValue({pageId:id,pageKind:'community',assignments:[{userId:user,available:true,revokedAt:null,permissions},{userId:other,available:true,permissions:['page_content','page_events']}]});
  expect((await resolveCommunityCreatorActions(id,scope,true)).map(a=>a.key)).toEqual(permissions[0]==='page_events'?['event']:permissions[0]==='page_content'?['edit']:[]);
 }
 mockTeam.mockResolvedValue({pageId:id,pageKind:'community',assignments:[{userId:user,available:true,revokedAt:'yesterday',permissions:['page_events','page_content']}]});
 expect(await resolveCommunityCreatorActions(id,scope,true)).toEqual([]);
});
