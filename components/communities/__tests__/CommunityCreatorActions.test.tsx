import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mockResolve=jest.fn(),mockPush=jest.fn(),mockSelected=jest.fn(),mockWorkspace=jest.fn();
let mockLive=true,mockScope:any;
jest.mock('../../../lib/communityManageEntry',()=>({resolveCommunityCreatorActions:(...args:unknown[])=>mockResolve(...args)}));
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{isLoading:false,error:null}})}));
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:{regular:'System',medium:'System'}})}));
jest.mock('../../../constants/FeatureFlags',()=>({CREATOR_PAGES_ENABLED:true}));
jest.mock('../../../lib/selectedCommunity',()=>({setSelectedCommunityId:(...args:unknown[])=>mockSelected(...args)}));
jest.mock('../../../lib/workspaceContext',()=>({setWorkspace:(...args:unknown[])=>mockWorkspace(...args)}));
jest.mock('../../ProfileButton',()=>()=>null);
jest.mock('expo-router',()=>({router:{push:(...args:unknown[])=>mockPush(...args)}}));
import {CommunityCreatorActions} from '../CommunityCreatorActions';
let tree:ReactTestRenderer;
const actions=[{key:'event',title:'Create event',route:'/creator/event-form?workspace=community&communityId=exact',legacyCommunityId:'exact'}, {key:'edit',title:'Edit community',route:'/creator/edit-page?communityId=exact',legacyCommunityId:'exact'}];
const button=(label:string)=>tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0];
async function mount(){await act(async()=>{tree=create(<CommunityCreatorActions communityId="exact"/>);});}
beforeEach(()=>{jest.resetAllMocks();mockLive=true;mockScope={userId:'creator',isCurrent:()=>mockLive};mockResolve.mockResolvedValue(actions);});
afterEach(()=>act(()=>tree?.unmount()));
it('freshly checks the exact community before selecting it and starting an event',async()=>{
 await mount();expect(mockSelected).not.toHaveBeenCalled();await act(async()=>button('Create event').props.onPress());
 expect(mockResolve).toHaveBeenLastCalledWith('exact',mockScope,true);expect(mockResolve).toHaveBeenCalledTimes(2);
 expect(mockSelected).toHaveBeenCalledWith('exact');expect(mockWorkspace).toHaveBeenCalledWith('community');expect(mockPush).toHaveBeenCalledWith(actions[0].route);
});
it('a draft or revoked event permission cannot reuse the rendered Create event action',async()=>{
 await mount();mockResolve.mockResolvedValue([{key:'setup',title:'Continue setup',route:'/setup'}]);
 await act(async()=>button('Create event').props.onPress());expect(mockPush).not.toHaveBeenCalled();expect(mockSelected).not.toHaveBeenCalled();
 expect(button('Create event')).toBeUndefined();expect(button('Continue setup')).toBeDefined();
});
it('an account change discards an in-flight action',async()=>{
 await mount();let finish!:(value:unknown)=>void;mockResolve.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 await act(async()=>button('Edit community').props.onPress());mockLive=false;mockScope=null;
 await act(async()=>{tree.update(<CommunityCreatorActions communityId="exact"/>);finish(actions);});
 expect(mockPush).not.toHaveBeenCalled();expect(mockSelected).not.toHaveBeenCalled();expect(tree.toJSON()).toBeNull();
});
it('repeated taps share one permission check and one navigation',async()=>{
 await mount();let finish!:(value:unknown)=>void;mockResolve.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const open=button('Create event').props.onPress;await act(async()=>{open();open();});expect(mockResolve).toHaveBeenCalledTimes(2);
 await act(async()=>finish(actions));expect(mockPush).toHaveBeenCalledTimes(1);
});
it('a failed refresh removes actionable cached permissions until retry succeeds',async()=>{
 await mount();mockResolve.mockRejectedValue(Error('Offline'));await act(async()=>button('Create event').props.onPress());
 expect(button('Create event')).toBeUndefined();expect(button('Try again')).toBeDefined();expect(mockPush).not.toHaveBeenCalled();
 mockResolve.mockResolvedValue([]);await act(async()=>button('Try again').props.onPress());expect(tree.toJSON()).toBeNull();
});
