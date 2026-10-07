import { loadCreatorSpaceEntry, creatorSpaceTitle, loadLegacyCreatorSpaces } from '../creatorSpaceEntry';
const mockSaved=jest.fn(),mockLocal=jest.fn(),mockInvitations=jest.fn(),mockLegacy=jest.fn();
jest.mock('../supabase',()=>({supabase:{}}));
jest.mock('../creatorMode',()=>({...jest.requireActual('../creatorMode'),getCreatorAccess:(...a:unknown[])=>mockLegacy(...a)}));
jest.mock('../creatorPageWorkspace',()=>({listCreatorPages:(...a:unknown[])=>mockSaved(...a)}));
jest.mock('../creatorPageEditor',()=>({listLocalPageEditors:(...a:unknown[])=>mockLocal(...a)}));
jest.mock('../creatorPageTeam',()=>({listMyPageTeamInvitations:(...a:unknown[])=>mockInvitations(...a)}));
jest.mock('../creatorPageReview',()=>({CreatorPageScopeExpired:class extends Error {}}));
let active=true;const scope={userId:'alice',isCurrent:()=>active};
const owned=(id='one',kind='community')=>({id,page_kind:kind,page_data:{name:'Sunday Table'}});
const team=(extra={})=>({pageId:'team',pageKind:'organization',pageName:'Sunset Studio',status:'accepted',currentPermissions:['page_content'],accessRevokedAt:null,...extra});
beforeEach(()=>{jest.clearAllMocks();active=true;mockSaved.mockResolvedValue([]);mockLocal.mockResolvedValue([]);mockInvitations.mockResolvedValue([]);mockLegacy.mockResolvedValue({ledCommunities:[],hasLeaderGrant:false,hasEventHostGrant:false,isRevoked:false});});
it.each([['community','Your community'],['organization','Your organization']])('takes a single %s directly to its existing workspace',async(kind,title)=>{
 mockSaved.mockResolvedValue([owned('one',kind)]);const result=await loadCreatorSpaceEntry(scope);expect(result).toMatchObject({title,subtitle:'Sunday Table',route:'/creator/page?id=one'});
});
it('deduplicates local records for saved pages and resumes only unsaved local editors',async()=>{
 mockSaved.mockResolvedValue([owned()]);mockLocal.mockResolvedValue([{id:'one',kind:'community',pageData:{name:'Duplicate'}}]);expect((await loadCreatorSpaceEntry(scope)).spaces).toHaveLength(1);
 mockSaved.mockResolvedValue([]);expect(await loadCreatorSpaceEntry(scope)).toMatchObject({route:'/creator/page-edit?id=one',subtitle:'Duplicate'});
});
it('uses exact teammate access and excludes revoked or empty assignments',async()=>{
 mockInvitations.mockResolvedValue([team(),team({pageId:'revoked',accessRevokedAt:'2026-09-19T00:00:00Z'}),team({pageId:'empty',currentPermissions:[]})]);
 expect(await loadCreatorSpaceEntry(scope)).toMatchObject({title:'Your organization',route:'/creator/page-team?id=team',spaces:[expect.objectContaining({id:'team'})]});
});
it('keeps multiple and mixed spaces in the existing chooser',async()=>{
 mockSaved.mockResolvedValue([owned('one'),owned('two')]);expect(await loadCreatorSpaceEntry(scope)).toMatchObject({title:'Your communities',route:'/creator/pages'});
 mockInvitations.mockResolvedValue([team()]);expect(await loadCreatorSpaceEntry(scope)).toMatchObject({title:'Creator space',route:'/creator/pages'});
 expect(creatorSpaceTitle(['organization','organization'])).toBe('Your organizations');
});
it('retains pending invitations beside a direct single-space shortcut and ignores elapsed ones',async()=>{
 mockSaved.mockResolvedValue([owned()]);mockInvitations.mockResolvedValue([team({invitationId:'pending',status:'pending',expiresAt:'2099-01-01T00:00:00Z'}),team({invitationId:'elapsed',status:'pending',expiresAt:'2000-01-01T00:00:00Z'})]);
 const result=await loadCreatorSpaceEntry(scope);expect(result.route).toBe('/creator/page?id=one');expect(result.invitations.map(i=>i.invitationId)).toEqual(['pending']);
});
it('does not infer a single-space shortcut from an incomplete read',async()=>{
 mockSaved.mockResolvedValue([owned()]);mockInvitations.mockRejectedValue(new Error('Offline'));await expect(loadCreatorSpaceEntry(scope)).rejects.toThrow('Offline');
});
it('rejects results from a retired account or focused visit',async()=>{
 let resolve!:(x:unknown)=>void;mockSaved.mockReturnValue(new Promise(r=>resolve=r));const work=loadCreatorSpaceEntry(scope);active=false;resolve([owned()]);await expect(work).rejects.toBeInstanceOf(Error);
});

const legacyAccess=(extra={})=>({ledCommunities:[],hasLeaderGrant:false,hasEventHostGrant:false,isRevoked:false,...extra});
const led=(extra={})=>({id:'old-community',name:'Already here',role:'leader',status:'active',handle:'already',...extra});
it('retains an existing live community without a new page record and uses the unified chooser',async()=>{
 mockLegacy.mockResolvedValue(legacyAccess({ledCommunities:[led()]}));
 expect(await loadCreatorSpaceEntry(scope)).toMatchObject({title:'Your community',route:'/creator/pages',spaces:[{id:'old-community',name:'Already here',route:'/(creator)/today',legacy:{communityId:'old-community',workspace:'community'}}]});
 expect(mockLegacy).toHaveBeenCalledWith('alice');
});
it('retains approved organizer and approved community setup access without reapplication',async()=>{
 mockLegacy.mockResolvedValue(legacyAccess({hasLeaderGrant:true,hasEventHostGrant:true}));
 const result=await loadCreatorSpaceEntry(scope);
 expect(result.spaces.map(s=>s.route)).toEqual(['/(creator)/today','/(creator)/organizer-home']);
 expect(result.route).toBe('/creator/pages');
});
it('does not create legacy access for an unapproved or solely revoked applicant',async()=>{
 mockLegacy.mockResolvedValue(legacyAccess({isRevoked:true}));expect(await loadLegacyCreatorSpaces(scope)).toEqual([]);
 mockLegacy.mockResolvedValue(legacyAccess());expect(await loadLegacyCreatorSpaces(scope)).toEqual([]);
});
it('deduplicates a community already represented by its new page identity',async()=>{
 mockSaved.mockResolvedValue([owned('old-community')]);mockLegacy.mockResolvedValue(legacyAccess({ledCommunities:[led()]}));
 expect(await loadCreatorSpaceEntry(scope)).toMatchObject({spaces:[expect.objectContaining({route:'/creator/page?id=old-community'})]});
 expect((await loadCreatorSpaceEntry(scope)).spaces).toHaveLength(1);
});
it.each([['events','/(creator)/organizer-home'],['member_care','/(creator)/members'],['finance','/(creator)/menu']])('routes a %s collaborator by this community tier',async(role,route)=>{
 mockLegacy.mockResolvedValue(legacyAccess({hasLeaderGrant:true,ledCommunities:[led({role})]}));
 expect(await loadLegacyCreatorSpaces(scope)).toEqual([expect.objectContaining({route})]);
});
it('bounds a stalled legacy entitlement read instead of hanging the chooser',async()=>{
 jest.useFakeTimers();try{mockLegacy.mockReturnValue(new Promise(()=>{}));const result=loadLegacyCreatorSpaces(scope);const rejection=expect(result).rejects.toThrow();jest.advanceTimersByTime(12000);await rejection;}finally{jest.useRealTimers();}
});
