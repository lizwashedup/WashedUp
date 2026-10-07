import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
let mockPagesEnabled = true;
let mockQuery:any, mockWorkspace='community';
const mockRetry=jest.fn();
jest.mock('react-native-safe-area-context',()=>({...jest.requireActual('react-native-safe-area-context'),useSafeAreaInsets:()=>({top:59,bottom:34,left:0,right:0})}));
jest.mock('expo-router',()=>{
 const Tabs=(props:any)=>require('react').createElement('ManagementTabs',props,props.children);
 Tabs.Screen=(props:any)=>require('react').createElement('ManagementScreen',props);
 return {Redirect:(props:any)=>require('react').createElement('RouteRedirect',props),Tabs,router:{replace:jest.fn()}};
});
jest.mock('@tanstack/react-query',()=>({useQuery:()=>mockQuery,useQueryClient:()=>({invalidateQueries:jest.fn()})}));
jest.mock('../../../constants/FeatureFlags',()=>({COMMUNITIES_ENABLED:true,get CREATOR_PAGES_ENABLED(){return mockPagesEnabled;}}));
jest.mock('../../../lib/supabase',()=>({supabase:{}}));
jest.mock('../../../lib/selectedCommunity',()=>({hydrateSelectedCommunity:jest.fn()}));
jest.mock('../../../lib/workspaceContext',()=>({hydrateWorkspace:jest.fn(),useWorkspace:()=>mockWorkspace}));
jest.mock('../../../lib/viewAs',()=>({useViewAsEventHost:()=>false,setViewAsEventHost:jest.fn()}));
import Layout from '../../../app/(creator)/_layout';
let tree:ReactTestRenderer;
const access=(extra={})=>({ledCommunities:[],hasLeaderGrant:false,hasEventHostGrant:false,isRevoked:false,...extra});
function mount(){act(()=>{tree=create(<Layout/>)});}
function screen(name:string){return tree.root.findAllByType('ManagementScreen' as any).find(node=>node.props.name===name);}
beforeEach(()=>{mockPagesEnabled=true;mockWorkspace='community';mockRetry.mockReset();mockQuery={data:access(),isLoading:false,isError:false,isFetching:false,refetch:mockRetry};});
afterEach(()=>act(()=>tree?.unmount()));
it('waits for legacy entitlement instead of redirecting an unknown account',()=>{
 mockQuery={...mockQuery,data:undefined,isLoading:true};mount();expect(tree.root.findAllByType('RouteRedirect' as any)).toHaveLength(0);expect(tree.root.findAllByType('ManagementTabs' as any)).toHaveLength(0);
});
it('allows an existing live community creator through without a redirect loop',()=>{
 mockQuery.data=access({ledCommunities:[{id:'live',role:'leader',status:'active'}]});mount();
 expect(tree.root.findAllByType('RouteRedirect' as any)).toHaveLength(0);expect(screen('today')?.props.options.href).toBeUndefined();expect(screen('community')?.props.options.href).toBeUndefined();
});
it('retains approved organizer access and its established role-specific destinations',()=>{
 mockQuery.data=access({hasEventHostGrant:true});mockWorkspace='organization';mount();expect(tree.root.findAllByType('RouteRedirect' as any)).toHaveLength(0);expect(screen('organizer-home')?.props.options.href).toBeUndefined();expect(screen('today')?.props.options.href).toBeNull();expect(screen('community')?.props.options.href).toBeNull();
});
it('does not grant the legacy shell to new-page-only or unapproved users',()=>{
 mount();expect(tree.root.findByType('RouteRedirect' as any).props.href).toBe('/creator/pages');expect(tree.root.findAllByType('ManagementTabs' as any)).toHaveLength(0);
});
it('keeps failed access separate from denial and exposes its existing retry',()=>{
 mockQuery={...mockQuery,data:undefined,isError:true};mount();expect(tree.root.findAllByType('RouteRedirect' as any)).toHaveLength(0);
 const retry=tree.root.findAll(p=>p.props.accessibilityLabel==='Retry creator access'&&typeof p.props.onPress==='function')[0];act(()=>retry.props.onPress());expect(mockRetry).toHaveBeenCalledTimes(1);
});
it('keeps revocation visible instead of treating it as a new applicant',()=>{
 mockQuery.data=access({isRevoked:true});mount();expect(tree.root.findAllByType('RouteRedirect' as any)).toHaveLength(0);expect(tree.root.findAllByType('ManagementTabs' as any)).toHaveLength(0);expect(JSON.stringify(tree.toJSON())).toMatch(/paused|revoked/i);
});
it('preserves the older disabled-pages redirect for unapproved accounts',()=>{
 mockPagesEnabled=false;mount();expect(tree.root.findByType('RouteRedirect' as any).props.href).toBe('/(tabs)/profile');
});
