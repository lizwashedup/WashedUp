import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {TextInput, TouchableOpacity, RefreshControl} from 'react-native';
import {PageAction} from '../../../components/creator/pages/PageFrame';
const mockAccess=jest.fn(),mockSelected=jest.fn(),mockParams=jest.fn(),mockQuery=jest.fn(),mockAdd=jest.fn(),mockSaveIdentity=jest.fn();
let mockScope:any,mockLive:boolean;
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{epoch:1}})}));
jest.mock('../../../hooks/useCreatorAccessRead',()=>({useCreatorAccessRead:()=>mockAccess()}));
jest.mock('../../../lib/selectedCommunity',()=>({useLedCommunity:()=>mockSelected()}));
jest.mock('../../../lib/creatorMode',()=>({isAdminTierRole:(role:string)=>['leader','co_leader','admin'].includes(role)}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>mockParams(),useRouter:()=>({back:jest.fn(),push:jest.fn()}),Stack:{Screen:()=>null},router:{}}));
jest.mock('@tanstack/react-query',()=>({useQuery:(args:unknown)=>mockQuery(args),useQueryClient:()=>({invalidateQueries:jest.fn()})}));
jest.mock('../../../components/ProfileButton',()=>()=>null);
jest.mock('../../../components/creator/BlockEditorCard',()=>({BlockEditorCard:()=>null}));
jest.mock('../../../components/BrandedAlert',()=>({BrandedAlert:()=>null}));
jest.mock('../../../lib/communityBlocks',()=>({addBlock:(...args:unknown[])=>mockAdd(...args),updateCommunityIdentity:(...args:unknown[])=>mockSaveIdentity(...args),getBlocksForEditor:jest.fn(),getCommunityIdentity:jest.fn(),BLOCK_TYPE_INFO:{},IDENTITY_NAME_MAX:60,IDENTITY_NAME_MIN:2,IDENTITY_PURPOSE_MAX:200,IDENTITY_PURPOSE_MIN:5}));
import EditPageScreen from '../edit-page';
import {BrandedAlert} from '../../../components/BrandedAlert';
function text(node:any):string{return typeof node==='string'?node:Array.isArray(node)?node.map(text).join(' '):node?.children?text(node.children):'';}
let tree:ReactTestRenderer;
let mockBlocksRead: any, mockIdentityRead: any;
const mockRefreshBlocks = jest.fn(), mockRefreshIdentity = jest.fn();
const exact={id:'exact',name:'Exact community',role:'leader',status:'active'},other={id:'other',name:'Other community',role:'leader',status:'active'};
beforeEach(() => {
 jest.clearAllMocks();
 mockLive=true;mockScope={userId:'alice',isCurrent:()=>mockLive};
 mockParams.mockReturnValue({communityId:'exact'});
 mockAccess.mockReturnValue({data:{ledCommunities:[exact,other]},isLoading:false,isError:false});
 mockSelected.mockReturnValue(other);
 mockRefreshBlocks.mockResolvedValue({}); mockRefreshIdentity.mockResolvedValue({});
 mockBlocksRead = {data:[],isLoading:false,isError:false,isFetching:false,refetch:mockRefreshBlocks};
 mockIdentityRead = {data:{name:'Exact community',purpose:'Meet for walks'},isLoading:false,isError:false,isFetching:false,refetch:mockRefreshIdentity};
 mockQuery.mockImplementation(({queryKey}:any)=>queryKey[0]==='community-blocks'?mockBlocksRead:mockIdentityRead);
});
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


function openBasics() {
 const entry = tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel?.startsWith('Basics.'))!;
 act(() => entry.props.onPress());
}
function field(label: string) {
 return tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === label)!;
}

it.each(['sections', 'identity'] as const)('does not present a failed %s read as an empty editable community', async failure => {
 if (failure === 'sections') mockBlocksRead = {...mockBlocksRead, data:undefined, isError:true};
 else mockIdentityRead = {...mockIdentityRead, data:undefined, isError:true};
 await act(async () => {tree=create(<EditPageScreen/>);});
 expect(text(tree.toJSON())).toContain('Couldn’t load community details');
 expect(text(tree.toJSON())).not.toContain('not started');
 expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
 expect(tree.root.findAllByType(TouchableOpacity).some(node => node.props.accessibilityLabel === 'add a block')).toBe(false);
 expect(mockAdd).not.toHaveBeenCalled();
 await act(async () => {await tree.root.findByType(PageAction).props.onPress();});
 expect(mockRefreshBlocks).toHaveBeenCalledTimes(1);
 expect(mockRefreshIdentity).toHaveBeenCalledTimes(1);
});

it('waits for saved identity before exposing fields, then displays the loaded values', async () => {
 mockIdentityRead = {...mockIdentityRead, data:undefined, isLoading:true, isFetching:true};
 await act(async () => {tree=create(<EditPageScreen/>);});
 expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
 expect(text(tree.toJSON())).not.toContain('not started');
 mockIdentityRead = {...mockIdentityRead, data:{name:'Loaded community',purpose:'Weekly walks'}, isLoading:false, isFetching:false};
 await act(async () => {tree.update(<EditPageScreen/>);});
 openBasics();
 expect(field('community name').props.value).toBe('Loaded community');
 expect(field('Short community description').props.value).toBe('Weekly walks');
 expect(mockAdd).not.toHaveBeenCalled();
});

it('keeps a missing identity unavailable instead of offering blank fields', async () => {
 mockIdentityRead = {...mockIdentityRead, data:null};
 await act(async () => {tree=create(<EditPageScreen/>);});
 expect(text(tree.toJSON())).toContain('Couldn’t load community details');
 expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
});

it('preserves unsaved identity text across a refresh failure and successful retry', async () => {
 await act(async () => {tree=create(<EditPageScreen/>);});
 openBasics();
 act(() => field('community name').props.onChangeText('My unsaved community name'));
 mockBlocksRead = {...mockBlocksRead, isError:true};
 await act(async () => {tree.update(<EditPageScreen/>);});
 expect(text(tree.toJSON())).toContain('Your edits are still here');
 expect(field('community name').props.value).toBe('My unsaved community name');
 await act(async () => {await tree.root.findByType(PageAction).props.onPress();});
 mockBlocksRead = {...mockBlocksRead, isError:false};
 mockIdentityRead = {...mockIdentityRead, data:{name:'Server copy',purpose:'Meet for walks'}};
 await act(async () => {tree.update(<EditPageScreen/>);});
 expect(field('community name').props.value).toBe('My unsaved community name');
 expect(text(tree.toJSON())).not.toContain('Couldn’t refresh your page');
});

it('refreshes both page sections and identity from the existing pull-to-refresh control', async () => {
 await act(async () => {tree=create(<EditPageScreen/>);});
 await act(async () => {await tree.root.findByType(RefreshControl).props.onRefresh();});
 expect(mockRefreshBlocks).toHaveBeenCalledTimes(1);
 expect(mockRefreshIdentity).toHaveBeenCalledTimes(1);
 expect(mockAdd).not.toHaveBeenCalled();
});

it('explains leader-only identity fields to an admin without presenting an unusable Save action',async()=>{
 mockAccess.mockReturnValue({data:{ledCommunities:[{...exact,role:'admin'},other]},isLoading:false,isError:false});
 await act(async()=>{tree=create(<EditPageScreen/>);});openBasics();
 expect(text(tree.toJSON())).toContain('Only this community’s leader or co-leader');
 expect(field('community name').props.editable).toBe(false);
 expect(field('Short community description').props.editable).toBe(false);
 expect(tree.root.findAllByType(TouchableOpacity).some(node=>node.props.accessibilityLabel==='Save name and description')).toBe(false);
 expect(mockSaveIdentity).not.toHaveBeenCalled();
});

it('preserves entered identity text when a save has no confirmed result',async()=>{
 mockSaveIdentity.mockRejectedValue(Error('Couldn’t confirm the saved name and description.'));
 await act(async()=>{tree=create(<EditPageScreen/>);});openBasics();
 act(()=>field('community name').props.onChangeText('Updated name'));
 const save=tree.root.findAllByType(TouchableOpacity).find(node=>node.props.accessibilityLabel==='Save name and description')!;
 await act(async()=>save.props.onPress());
 expect(mockSaveIdentity).toHaveBeenCalledWith('exact',{name:'Updated name',purpose:'Meet for walks'},expect.objectContaining({userId:'alice'}));
 expect(field('community name').props.value).toBe('Updated name');
 expect(tree.root.findByType(BrandedAlert).props.title).toBe('Couldn’t confirm save');
});

it('shows Saved only after confirmation and clears it when the name changes',async()=>{
 mockSaveIdentity.mockResolvedValue(undefined);
 await act(async()=>{tree=create(<EditPageScreen/>);});openBasics();
 const save=tree.root.findAllByType(TouchableOpacity).find(node=>node.props.accessibilityLabel==='Save name and description')!;
 await act(async()=>save.props.onPress());expect(text(tree.toJSON())).toContain('Saved.');
 act(()=>field('community name').props.onChangeText('Next edit'));expect(text(tree.toJSON())).not.toContain('Saved.');
});

it('blocks a same-frame duplicate save and ignores a late result after leaving',async()=>{
 let resolve!:()=>void;mockSaveIdentity.mockReturnValue(new Promise<void>(done=>{resolve=done;}));
 await act(async()=>{tree=create(<EditPageScreen/>);});openBasics();
 const save=tree.root.findAllByType(TouchableOpacity).find(node=>node.props.accessibilityLabel==='Save name and description')!;
 let saving!:Promise<void>;
 act(()=>{saving=save.props.onPress();void save.props.onPress();});expect(mockSaveIdentity).toHaveBeenCalledTimes(1);
 mockLive=false;await act(async()=>{resolve();await saving;});
 expect(text(tree.toJSON())).not.toContain('Saved.');expect(tree.root.findByType(BrandedAlert).props.visible).toBe(false);
});
