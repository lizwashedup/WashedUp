import { loadManagedSpaces, loadManagedApplications, prepareCreatorSpace } from '../creatorManagement';
const mockPages=jest.fn(),mockLegacy=jest.fn(),mockProfile=jest.fn(),mockGrants=jest.fn(),mockWorkspace=jest.fn(),mockCommunity=jest.fn();
jest.mock('../creatorSpaceEntry',()=>({loadCreatorSpaceEntry:(...a:unknown[])=>mockPages(...a),loadLegacyCreatorSpaces:(...a:unknown[])=>mockLegacy(...a)}));
jest.mock('../organizerProfile',()=>({getMyOrganizerProfile:()=>mockProfile()}));
jest.mock('../operatorApplications',()=>({fetchMyGrants:(...a:unknown[])=>mockGrants(...a)}));
jest.mock('../workspaceContext',()=>({setWorkspace:(...a:unknown[])=>mockWorkspace(...a)}));
jest.mock('../selectedCommunity',()=>({setSelectedCommunityId:(...a:unknown[])=>mockCommunity(...a)}));
jest.mock('../creatorPageReview',()=>({CreatorPageScopeExpired:class extends Error {}}));
let active=true;const scope={userId:'alice',isCurrent:()=>active};
const org={id:'org',name:'Your events',kind:'organization' as const,route:'/(tabs)/friends/manage/(tools)/organizer-home',legacy:{workspace:'organization' as const,status:'approved'}};
beforeEach(()=>{jest.clearAllMocks();active=true;mockLegacy.mockResolvedValue([]);mockPages.mockResolvedValue({spaces:[],invitations:[]});mockProfile.mockResolvedValue(null);mockGrants.mockResolvedValue([]);});
it('does not call the gated page backend for existing creators when pages are disabled',async()=>{
 mockLegacy.mockResolvedValue([{...org,kind:'community',legacy:{workspace:'community',communityId:'sunset',status:'active'}}]);
 expect((await loadManagedSpaces(scope,false)).spaces).toHaveLength(1);expect(mockPages).not.toHaveBeenCalled();expect(mockProfile).not.toHaveBeenCalled();
});
it('uses the verified organization name without treating an optional lookup failure as loss of access',async()=>{
 mockLegacy.mockResolvedValue([org]);mockProfile.mockResolvedValue({user_id:'alice',display_name:'Sunset Studio'});
 expect((await loadManagedSpaces(scope,false)).spaces[0].name).toBe('Sunset Studio');
 mockProfile.mockRejectedValue(Error('offline'));expect((await loadManagedSpaces(scope,false)).spaces[0].name).toBe('Your events');
});
it('never borrows an organization name from a different account',async()=>{
 mockLegacy.mockResolvedValue([org]);mockProfile.mockResolvedValue({user_id:'bob',display_name:'Other account'});
 expect((await loadManagedSpaces(scope,false)).spaces[0].name).toBe('Your events');
});
it('does not fall back to older access after a page backend failure',async()=>{
 mockPages.mockRejectedValue(Error('denied'));await expect(loadManagedSpaces(scope,true)).rejects.toThrow('denied');expect(mockLegacy).not.toHaveBeenCalled();
});
it('retains unresolved applications independently of active management access',async()=>{
 mockGrants.mockResolvedValue(['approved','withdrawn','in_review','needs_more_info','declined','revoked'].map(status=>({status})));
 expect((await loadManagedApplications(scope)).map(g=>g.status)).toEqual(['in_review','needs_more_info','declined','revoked']);expect(mockGrants).toHaveBeenCalledWith('alice');
});
it('sets the explicit workspace and clears the previous community for organization entry',()=>{
 prepareCreatorSpace(org,scope);expect(mockWorkspace).toHaveBeenCalledWith('organization');expect(mockCommunity).toHaveBeenCalledWith(null);
 active=false;expect(()=>prepareCreatorSpace(org,scope)).toThrow();expect(mockWorkspace).toHaveBeenCalledTimes(1);
});
it('rejects results if the account or visit ends during a read',async()=>{
 mockLegacy.mockImplementation(async()=>{active=false;return [org];});await expect(loadManagedSpaces(scope,false)).rejects.toThrow();expect(mockProfile).not.toHaveBeenCalled();
});
