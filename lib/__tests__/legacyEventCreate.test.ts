import { resolveLegacyEventCreate, prepareLegacyEventCreate } from '../legacyEventCreate';
const mockAccess=jest.fn(),mockPrepare=jest.fn();
jest.mock('../creatorMode',()=>({getCreatorAccess:(...a:unknown[])=>mockAccess(...a),isAdminTierRole:(r:string)=>['leader','admin','co_leader'].includes(r)}));
jest.mock('../creatorPageReview',()=>({CreatorPageScopeExpired:class extends Error{}}));
jest.mock('../creatorPageEventMedia',()=>({mediaUUID:(s:unknown)=>typeof s==='string'&&/^[a-f0-9-]{36}$/.test(s)}));
jest.mock('../creatorManagement',()=>({prepareCreatorSpace:(...a:unknown[])=>mockPrepare(...a)}));
const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
let active=true;const scope={userId:'alice',isCurrent:()=>active};
const club=(role='leader',status='active',communityId=id)=>({id:communityId,name:'Sunset Club',role,status});
beforeEach(()=>{jest.clearAllMocks();active=true;mockAccess.mockResolvedValue({hasEventHostGrant:true,ledCommunities:[club()]});});
it('binds community creation to the exact authorized identity',async()=>{
 expect(await resolveLegacyEventCreate('community',id,scope)).toMatchObject({workspace:'community',community:{id}});expect(mockAccess).toHaveBeenCalledWith('alice');
 await prepareLegacyEventCreate({workspace:'community',community:club() as any},scope);expect(mockPrepare).toHaveBeenCalledWith(expect.objectContaining({legacy:expect.objectContaining({workspace:'community',communityId:id})}),scope);
});
it.each(['member_care','finance','member'])('does not borrow another community’s leader role for %s access',async role=>{
 mockAccess.mockResolvedValue({hasEventHostGrant:true,ledCommunities:[club(role),club('leader','active',other)]});await expect(resolveLegacyEventCreate('community',id,scope)).rejects.toThrow('not available');
});
it.each(['draft','archived'])('does not create under a %s community',async status=>{mockAccess.mockResolvedValue({ledCommunities:[club('leader',status)]});await expect(resolveLegacyEventCreate('community',id,scope)).rejects.toThrow();});
it('permits the events role for its own active community',async()=>{mockAccess.mockResolvedValue({ledCommunities:[club('events')]});await expect(resolveLegacyEventCreate('community',id,scope)).resolves.toMatchObject({community:{id}});});
it('requires a current organization approval and no mixed identity',async()=>{
 await expect(resolveLegacyEventCreate('organization',id,scope)).rejects.toThrow('Choose');
 mockAccess.mockResolvedValue({hasEventHostGrant:false,ledCommunities:[club()]});await expect(resolveLegacyEventCreate('organization',undefined,scope)).rejects.toThrow('unavailable');
});
it('rechecks permission before creation and rejects a retired visit',async()=>{
 const context=await resolveLegacyEventCreate('community',id,scope);mockAccess.mockResolvedValue({ledCommunities:[]});await expect(prepareLegacyEventCreate(context,scope)).rejects.toThrow();expect(mockPrepare).not.toHaveBeenCalled();
 active=false;await expect(resolveLegacyEventCreate('community',id,scope)).rejects.toThrow();
});
