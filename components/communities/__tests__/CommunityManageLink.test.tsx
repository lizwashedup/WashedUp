import {Dimensions,Text} from 'react-native';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mockResolve=jest.fn(),mockPush=jest.fn(),mockSelected=jest.fn(),mockWorkspace=jest.fn();
let mockLive=true,mockScope:any;
jest.mock('../../../lib/communityManageEntry',()=>({resolveCommunityManageEntry:(...a:any[])=>mockResolve(...a)}));
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{isLoading:false,error:null}})}));
jest.mock('../../../constants/FeatureFlags',()=>({CREATOR_PAGES_ENABLED:true}));
jest.mock('../../../lib/selectedCommunity',()=>({setSelectedCommunityId:(...a:any[])=>mockSelected(...a)}));
jest.mock('../../../lib/workspaceContext',()=>({setWorkspace:(...a:any[])=>mockWorkspace(...a)}));
jest.mock('expo-router',()=>({router:{push:(...a:any[])=>mockPush(...a)}}));
import {CommunityManageLink} from '../CommunityManageLink';
let tree:ReactTestRenderer;
const page={kind:'page',route:'/creator/page?id=exact-page'};
const button=(name='Manage community')=>tree.root.findAll(n=>n.props.accessibilityLabel===name&&typeof n.props.onPress==='function')[0];
async function mount(){await act(async()=>{tree=create(<CommunityManageLink communityId="exact-page"/>);});}
async function press(name='Manage community'){await act(async()=>{button(name)!.props.onPress();});}
beforeEach(()=>{jest.resetAllMocks();mockLive=true;mockScope={userId:'creator',isCurrent:()=>mockLive};mockResolve.mockResolvedValue(page);});
afterEach(async()=>{if(tree)await act(async()=>tree.unmount());});
it('rechecks the exact page before opening the creator destination',async()=>{await mount();await press();expect(mockResolve).toHaveBeenCalledTimes(2);expect(mockResolve).toHaveBeenLastCalledWith('exact-page',mockScope,true);expect(mockPush).toHaveBeenCalledWith(page.route);expect(mockSelected).not.toHaveBeenCalled();});
it('sets the exact legacy community and workspace only after fresh confirmation',async()=>{mockResolve.mockResolvedValue({kind:'legacy',communityId:'exact-page',route:'/(creator)/community'});await mount();expect(mockSelected).not.toHaveBeenCalled();await press();expect(mockWorkspace).toHaveBeenCalledWith('community');expect(mockSelected).toHaveBeenCalledWith('exact-page');expect(mockPush).toHaveBeenCalledWith('/(creator)/community');});
it('revoked access between render and tap does not navigate',async()=>{await mount();mockResolve.mockResolvedValue(null);await press();expect(mockPush).not.toHaveBeenCalled();expect(button()).toBeUndefined();expect(JSON.stringify(tree.toJSON())).toContain('Access changed');});
it('late results from a retired account cannot select or navigate',async()=>{await mount();let finish:(v:any)=>void=()=>{};mockResolve.mockImplementation(()=>new Promise(r=>{finish=r;}));await press();mockLive=false;mockScope=null;await act(async()=>{tree.update(<CommunityManageLink communityId="exact-page"/>);finish({kind:'legacy',communityId:'exact-page',route:'/(creator)/community'});});expect(mockPush).not.toHaveBeenCalled();expect(mockSelected).not.toHaveBeenCalled();expect(tree.toJSON()).toBeNull();});
it('same-frame repeated taps share one fresh access check',async()=>{await mount();let finish:(v:any)=>void=()=>{};mockResolve.mockImplementation(()=>new Promise(r=>{finish=r;}));const click=button()!.props.onPress;await act(async()=>{click();click();});expect(mockResolve).toHaveBeenCalledTimes(2);await act(async()=>finish(page));expect(mockPush).toHaveBeenCalledTimes(1);});
it('read failures expose retry without reusing an old creator action',async()=>{mockResolve.mockRejectedValue(Error('Offline'));await mount();expect(button()).toBeUndefined();expect(button('Retry creator tools')).toBeDefined();mockResolve.mockResolvedValue(page);await press('Retry creator tools');expect(button()).toBeDefined();expect(mockPush).not.toHaveBeenCalled();});
it('ordinary community members have no creator action',async()=>{mockResolve.mockResolvedValue(null);await mount();expect(tree.toJSON()).toBeNull();});

it('remeasures Manage and pending Checking without replacing the access control or its operation',async()=>{
 const previous=Dimensions.get('window');act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1}}));
 try{
  await mount();const component=tree.root.findByType(CommunityManageLink),control=button(),leaf=(v:string)=>tree.root.findAllByType(Text).find(n=>n.props.children===v)!;
  for(const scale of [1.35,1]){const old=leaf('Manage');act(()=>Dimensions.set({window:{...previous,width:390,fontScale:scale}}));expect(leaf('Manage')).not.toBe(old);expect(tree.root.findByType(CommunityManageLink)).toBe(component);expect(button()).toBe(control);}
  expect(mockResolve).toHaveBeenCalledTimes(1);expect(mockPush).not.toHaveBeenCalled();
  let finish!:(v:any)=>void;mockResolve.mockImplementation(()=>new Promise(r=>{finish=r;}));await press();
  const old=leaf('Checking…');act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1.35}}));
  expect(leaf('Checking…')).not.toBe(old);expect(button()).toBe(control);expect(control.props.disabled).toBe(true);
  await press();expect(mockResolve).toHaveBeenCalledTimes(2);await act(async()=>finish(page));expect(mockPush).toHaveBeenCalledTimes(1);expect(mockPush).toHaveBeenCalledWith(page.route);
 }finally{act(()=>Dimensions.set({window:previous}));}
});
