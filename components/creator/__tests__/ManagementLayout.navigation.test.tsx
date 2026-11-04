import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockNavigate=jest.fn(), mockDismiss=jest.fn();
let mockWorkspace='organization', mockScreen='menu', mockParams:any={}, mockName:string|null='Sunset Studio';
const mockCommunity={id:'club',name:'Sunset Club',role:'leader'};
jest.mock('expo-router',()=>({Stack:()=>null,Redirect:()=>null,router:{navigate:(...a:unknown[])=>mockNavigate(...a),dismissTo:(...a:unknown[])=>mockDismiss(...a)},useSegments:()=>['(tabs)','friends','manage','(tools)',mockScreen],useGlobalSearchParams:()=>mockParams}));
jest.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:jest.fn()})}));
jest.mock('@react-navigation/native',()=>({useIsFocused:()=>true}));
jest.mock('../../../lib/creatorMode',()=>({hasCreatorAccess:()=>true}));
jest.mock('../../../hooks/useCreatorAccessRead',()=>({useCreatorAccessRead:()=>({data:{hasEventHostGrant:true,ledCommunities:[mockCommunity]},isLoading:false,isError:false})}));
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:{userId:'alice',isCurrent:()=>true}})}));
jest.mock('../../../hooks/useCreatorPageRead',()=>({useCreatorPageRead:()=>({data:mockName})}));
jest.mock('../../../lib/creatorManagement',()=>({loadManagedOrganizationName:jest.fn()}));
jest.mock('../../../lib/selectedCommunity',()=>({hydrateSelectedCommunity:jest.fn(),useLedCommunity:()=>mockCommunity}));
jest.mock('../../../lib/workspaceContext',()=>({hydrateWorkspace:jest.fn(),useWorkspace:()=>mockWorkspace}));
jest.mock('../../../lib/viewAs',()=>({setViewAsEventHost:jest.fn(),useViewAsEventHost:()=>false}));
jest.mock('../CreatorScreenHeader',()=>({CreatorScreenHeader:()=>null}));
import ManagementLayout from '../ManagementLayout';
import { CreatorScreenHeader } from '../CreatorScreenHeader';
let tree:ReactTestRenderer;
const header=()=>tree.root.findByType(CreatorScreenHeader).props;
beforeEach(()=>{jest.clearAllMocks();mockWorkspace='organization';mockScreen='menu';mockParams={};mockName='Sunset Studio';});
afterEach(()=>act(()=>tree?.unmount()));
function mount(){act(()=>{tree=create(<ManagementLayout/>);});}
it.each(['menu','events'])('returns a direct %s shortcut to the directory and names the organization',screen=>{
 mockScreen=screen;mockParams={fromManagementDirectory:'1'};mount();
 expect(header().title).toBe('Sunset Studio');expect(header().backLabel).toBe('Back to everything you manage');
 act(()=>header().onBack());expect(mockNavigate).toHaveBeenCalledWith('/(tabs)/friends/manage');
});
it('retains the organization dashboard return for tools opened from that dashboard',()=>{
 mount();expect(header().backLabel).toBe('Back to managing Sunset Studio');
 act(()=>header().onBack());expect(mockNavigate).toHaveBeenCalledWith('/(tabs)/friends/manage/(tools)/organizer-home');
});
it('uses a neutral organization label when its verified name is unavailable',()=>{
 mockName=null;mount();expect(header().title).toBe('Your organization');
});
it('preserves the community page return and never substitutes the organization name',()=>{
 mockWorkspace='community';mockScreen='community';mockParams={fromCommunityId:'club'};mount();
 expect(header().title).toBe('Sunset Club');expect(header().backLabel).toBe('Back to Sunset Club');
 act(()=>header().onBack());expect(mockDismiss).toHaveBeenCalledWith('/community/club');expect(mockNavigate).not.toHaveBeenCalled();
});
