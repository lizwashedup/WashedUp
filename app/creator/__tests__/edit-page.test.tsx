import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mockAccess=jest.fn(),mockSelected=jest.fn(),mockParams=jest.fn(),mockQuery=jest.fn(),mockAdd=jest.fn();
jest.mock('../../../hooks/useCreatorAccessRead',()=>({useCreatorAccessRead:()=>mockAccess()}));
jest.mock('../../../lib/selectedCommunity',()=>({useLedCommunity:()=>mockSelected()}));
jest.mock('../../../lib/creatorMode',()=>({isAdminTierRole:(role:string)=>['leader','co_leader','admin'].includes(role)}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>mockParams(),useRouter:()=>({back:jest.fn(),push:jest.fn()}),Stack:{Screen:()=>null},router:{}}));
jest.mock('@tanstack/react-query',()=>({useQuery:(args:unknown)=>mockQuery(args),useQueryClient:()=>({invalidateQueries:jest.fn()})}));
jest.mock('../../../components/ProfileButton',()=>()=>null);
jest.mock('../../../components/creator/BlockEditorCard',()=>({BlockEditorCard:()=>null}));
jest.mock('../../../components/BrandedAlert',()=>({BrandedAlert:()=>null}));
jest.mock('../../../lib/communityBlocks',()=>({addBlock:(...args:unknown[])=>mockAdd(...args),getBlocksForEditor:jest.fn(),getCommunityIdentity:jest.fn(),BLOCK_TYPE_INFO:{},IDENTITY_NAME_MAX:60,IDENTITY_NAME_MIN:2,IDENTITY_PURPOSE_MAX:200,IDENTITY_PURPOSE_MIN:5}));
import EditPageScreen from '../edit-page';
function text(node:any):string{return typeof node==='string'?node:Array.isArray(node)?node.map(text).join(' '):node?.children?text(node.children):'';}
let tree:ReactTestRenderer;
const exact={id:'exact',name:'Exact community',role:'leader',status:'active'},other={id:'other',name:'Other community',role:'leader',status:'active'};
beforeEach(()=>{jest.clearAllMocks();mockParams.mockReturnValue({communityId:'exact'});mockAccess.mockReturnValue({data:{ledCommunities:[exact,other]},isLoading:false,isError:false});mockSelected.mockReturnValue(other);mockQuery.mockImplementation(({queryKey}:any)=>queryKey[0]==='community-blocks'?{data:[],isLoading:false}:{data:{name:'Exact community',purpose:'Meet for walks'}});});
afterEach(()=>act(()=>tree?.unmount()));
it('opens the requested community without inserting absent page sections',async()=>{
 await act(async()=>{tree=create(<EditPageScreen/>);});
 expect(text(tree.toJSON())).toContain('Exact community');expect(text(tree.toJSON())).not.toContain('Other community');
 expect(mockQuery.mock.calls.every(([args])=>args.queryKey[1]==='exact')).toBe(true);expect(mockAdd).not.toHaveBeenCalled();
});
it('a missing explicit community cannot fall back to the selected one',async()=>{
 mockAccess.mockReturnValue({data:{ledCommunities:[other]},isLoading:false,isError:false});
 await act(async()=>{tree=create(<EditPageScreen/>);});
 expect(text(tree.toJSON())).toContain('You don’t have editing access');expect(mockQuery).not.toHaveBeenCalled();expect(mockAdd).not.toHaveBeenCalled();
});
it('an event-only role cannot enter the community editor',async()=>{
 mockAccess.mockReturnValue({data:{ledCommunities:[{...exact,role:'events'},other]},isLoading:false,isError:false});
 await act(async()=>{tree=create(<EditPageScreen/>);});expect(mockQuery).not.toHaveBeenCalled();expect(mockAdd).not.toHaveBeenCalled();
});
