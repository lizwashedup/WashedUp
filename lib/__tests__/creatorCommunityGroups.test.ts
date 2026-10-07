const mockRpc=jest.fn(), mockUser=jest.fn(), mockPage=jest.fn(), mockLayout=jest.fn();
jest.mock('../supabase',()=>({supabase:{auth:{getUser:()=>mockUser()},rpc:(...a:unknown[])=>mockRpc(...a),from:()=>{const chain={select:()=>chain,eq:()=>chain,maybeSingle:()=>mockPage()};return chain;}}}));
jest.mock('../communityChat',()=>({ObsoleteCommunityOperationError:class extends Error{}}));
jest.mock('../communityRoomHistory',()=>({getCommunityRoomIdentities:(...a:unknown[])=>mockLayout(...a)}));
import { canManageCommunityGroups, createCreatorCommunityGroup, getCreatorGroupCreation, normalizeCommunityRoomName, renameCreatorCommunityRoom } from '../creatorCommunityGroups';
import type { CommunityRoomIdentity } from '../communityRoomHistory';
const page='0ed00000-0000-4000-8000-000000000001',id='0ed00000-0000-4000-8000-000000000002';
const scope={userId:'creator',isCurrent:()=>true},attempt={communityId:page,requestId:id,name:'Walks'};
const receipt={community_id:page,id,requested_name:'Walks',name:'Walks',status:'available'};
beforeEach(()=>{jest.resetAllMocks();mockUser.mockResolvedValue({data:{user:{id:'creator'}},error:null});mockRpc.mockResolvedValue({data:receipt,error:null});mockLayout.mockResolvedValue({rooms:[]});mockPage.mockResolvedValue({data:{page_id:page,owner_id:'creator',page_kind:'community'},error:null});});
it('counts Unicode characters consistently and rejects control/empty/long names before dispatch',async()=>{
 expect(normalizeCommunityRoomName('  Walks  ')).toBe('Walks');expect(normalizeCommunityRoomName('🌴'.repeat(60))).toHaveLength(120);
 for(const name of ['', '  ', 'Walk\n', '🌴'.repeat(61)])await expect(createCreatorCommunityGroup({...attempt,name},scope)).rejects.toThrow();
 expect(mockRpc).not.toHaveBeenCalled();
});
it('limits creator controls to an owned published mapped community without writing',async()=>{
 expect(await canManageCommunityGroups(page,scope)).toBe(true);mockPage.mockResolvedValue({data:null,error:null});expect(await canManageCommunityGroups(page,scope)).toBe(false);
 mockPage.mockResolvedValue({data:{page_id:page,owner_id:'creator',page_kind:'community'},error:null});mockLayout.mockResolvedValue(null);expect(await canManageCommunityGroups(page,scope)).toBe(false);expect(mockRpc).not.toHaveBeenCalled();
});
it('sends the same saved creation identity and accepts its current renamed/archived state',async()=>{
 mockRpc.mockResolvedValue({data:{...receipt,name:'Evening walks',status:'archived'},error:null});
 expect(await createCreatorCommunityGroup(attempt,scope)).toMatchObject({...attempt,currentName:'Evening walks',status:'archived'});
 expect(mockRpc).toHaveBeenCalledWith('create_community_group',{p_community_id:page,p_request_id:id,p_name:'Walks'});
});
it('reads absent and deleted receipts without creating anything',async()=>{
 mockRpc.mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:{...receipt,name:null,status:'unavailable'},error:null});
 expect(await getCreatorGroupCreation(page,id,scope)).toBeNull();expect(await getCreatorGroupCreation(page,id,scope)).toMatchObject({status:'unavailable',currentName:null});
 expect(mockRpc.mock.calls.every(c=>c[0]==='get_community_group_creation')).toBe(true);
});
it('rejects mismatched identity, creation payload and malformed receipts',async()=>{
 for(const data of [{...receipt,id:page},{...receipt,community_id:id},{...receipt,requested_name:'Different'},{...receipt,status:'unknown'},{...receipt,name:null}]){
 mockRpc.mockResolvedValue({data,error:null});await expect(createCreatorCommunityGroup(attempt,scope)).rejects.toThrow();}
});
it('retires account/visit changes before dispatch and after the response',async()=>{
 mockUser.mockResolvedValue({data:{user:{id:'other'}},error:null});await expect(createCreatorCommunityGroup(attempt,scope)).rejects.toThrow();expect(mockRpc).not.toHaveBeenCalled();
 mockUser.mockResolvedValue({data:{user:{id:'creator'}},error:null});let current=true;
 mockRpc.mockImplementation(async()=>{current=false;return{data:receipt,error:null};});await expect(createCreatorCommunityGroup(attempt,{...scope,isCurrent:()=>current})).rejects.toThrow();expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('renames the original core/topic ID with the observed name and does not replay conflicts',async()=>{
 for(const role of ['intros','main','optional'] as const){const room={id,role,name:'Old',storage:role==='main'?'broadcast':'topic',included:role!=='optional',joined:true,notifications_on:false} as CommunityRoomIdentity;
 mockRpc.mockResolvedValue({data:{community_id:page,id,role,name:'New'},error:null});expect(await renameCreatorCommunityRoom(page,room,'New',scope)).toEqual({...room,name:'New'});
 expect(mockRpc).toHaveBeenLastCalledWith('rename_community_room',{p_community_id:page,p_room_id:id,p_role:role,p_name:'New',p_expected_name:'Old'});}
 const failure={code:'40001',message:'Newer name'};mockRpc.mockResolvedValue({data:null,error:failure});await expect(renameCreatorCommunityRoom(page,{id,role:'optional',name:'Old'} as CommunityRoomIdentity,'New',scope)).rejects.toEqual(failure);expect(mockRpc).toHaveBeenCalledTimes(4);
});
