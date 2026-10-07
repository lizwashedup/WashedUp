import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mockRead=jest.fn(),mockRedirect=jest.fn();
let mockAccount='cedar',mockEpoch=1,mockAccountError:Error|null=null;
jest.mock('../../../hooks/useObservedUser',()=>({useObservedUser:()=>{const id=mockAccount,epoch=mockEpoch;return{viewerId:id,epoch,isLoading:false,error:mockAccountError,retry:async()=>{},isCurrent:()=>id===mockAccount&&epoch===mockEpoch};}}));
jest.mock('expo-router',()=>{const element=require('react')['createElement'];const Tabs=({children}:any)=>element('CreatorTabs',null,children);Tabs.Screen=()=>null;return{Tabs,Redirect:({href}:any)=>{mockRedirect(href);return null;},router:{replace:jest.fn()}};});
jest.mock('../../../lib/creatorMode',()=>({...jest.requireActual('../../../lib/creatorMode'),getCreatorAccess:(...args:any[])=>mockRead(...args)}));
jest.mock('../../../lib/supabase',()=>({supabase:{}}));
jest.mock('../../../lib/viewAs',()=>({useViewAsEventHost:()=>false,setViewAsEventHost:jest.fn(),isViewingAsEventHost:()=>false}));
jest.mock('../../../lib/selectedCommunity',()=>({hydrateSelectedCommunity:async()=>{}}));
jest.mock('../../../lib/workspaceContext',()=>({hydrateWorkspace:async()=>{},useWorkspace:(access:any)=>access?.hasLeaderGrant?'community':access?.hasEventHostGrant?'organization':null}));
jest.mock('../../../constants/FeatureFlags',()=>({COMMUNITIES_ENABLED:true,CREATOR_PAGES_ENABLED:true}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View,useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
import CreatorLayout from '../_layout';
const denied={ledCommunities:[],hasLeaderGrant:false,hasEventHostGrant:false,isRevoked:false};
let tree:ReactTestRenderer,client:QueryClient;
async function flush(){await act(async()=>{await new Promise(r=>setTimeout(r,5));});}
beforeEach(()=>{jest.clearAllMocks();mockAccount='cedar';mockEpoch=1;mockAccountError=null;client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});});
afterEach(()=>{act(()=>tree?.unmount());client.clear();});
it('rechecks a pre-approval cached denial before redirecting the approved community creator back to the chooser',async()=>{
 client.setQueryData(['creator-access'],denied);
 let resolve!:(value:any)=>void;mockRead.mockReturnValue(new Promise(r=>{resolve=r;}));
 act(()=>{tree=create(<QueryClientProvider client={client}><CreatorLayout/></QueryClientProvider>);});
 await flush();expect(mockRedirect).not.toHaveBeenCalled();expect(mockRead).toHaveBeenCalledTimes(1);
 await act(async()=>resolve({...denied,hasLeaderGrant:true}));await flush();
 expect(mockRedirect).not.toHaveBeenCalled();expect(tree.root.findAllByType('CreatorTabs' as any)).toHaveLength(1);
});

it.each(['community','organization'])('fresh %s approval wins over a still-fresh cached denial',async kind=>{
 client.setQueryData(['creator-access'],denied);mockRead.mockResolvedValue({...denied,[kind==='community'?'hasLeaderGrant':'hasEventHostGrant']:true});
 act(()=>{tree=create(<QueryClientProvider client={client}><CreatorLayout/></QueryClientProvider>);});await flush();
 expect(mockRead).toHaveBeenCalledWith('cedar');expect(mockRedirect).not.toHaveBeenCalled();expect(tree.root.findAllByType('CreatorTabs' as any)).toHaveLength(1);
});
it('waits for current-account evidence instead of borrowing a previous account approval',async()=>{
 client.setQueryData(['creator-access'],{...denied,hasLeaderGrant:true});let resolve!:(v:any)=>void;mockRead.mockReturnValue(new Promise(r=>resolve=r));
 act(()=>{tree=create(<QueryClientProvider client={client}><CreatorLayout/></QueryClientProvider>);});await flush();
 expect(tree.root.findAllByType('CreatorTabs' as any)).toHaveLength(0);expect(mockRedirect).not.toHaveBeenCalled();
 await act(async()=>resolve(denied));await flush();expect(mockRedirect).toHaveBeenCalledWith('/creator/pages');
});
it('a failed fresh access read offers retry instead of redirecting on cached denial',async()=>{
 client.setQueryData(['creator-access'],denied);mockRead.mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({...denied,hasLeaderGrant:true});
 act(()=>{tree=create(<QueryClientProvider client={client}><CreatorLayout/></QueryClientProvider>);});await flush();
 expect(mockRedirect).not.toHaveBeenCalled();const retry=tree.root.findAll(p=>p.props.accessibilityLabel==='Retry creator access'&&typeof p.props.onPress==='function')[0];expect(retry).toBeDefined();
 await act(async()=>retry.props.onPress());await flush();expect(tree.root.findAllByType('CreatorTabs' as any)).toHaveLength(1);
});
it('rejects a retired account read across an account roundtrip while current approval remains independent',async()=>{
 const pending:any[]=[];mockRead.mockImplementation(()=>new Promise(r=>pending.push(r)));const render=()=> <QueryClientProvider client={client}><CreatorLayout/></QueryClientProvider>;
 act(()=>{tree=create(render());});await flush();mockAccount='another';mockEpoch++;act(()=>tree.update(render()));await flush();mockAccount='cedar';mockEpoch++;act(()=>tree.update(render()));await flush();
 expect(pending).toHaveLength(3);await act(async()=>{pending[0]({...denied,hasLeaderGrant:true});pending[1]({...denied,hasEventHostGrant:true});});await flush();
 expect(tree.root.findAllByType('CreatorTabs' as any)).toHaveLength(0);expect(mockRedirect).not.toHaveBeenCalled();
 await act(async()=>pending[2]({...denied,hasLeaderGrant:true}));await flush();expect(tree.root.findAllByType('CreatorTabs' as any)).toHaveLength(1);
});

it('rechecks a second visit even when the same account previously had no access',async()=>{
 mockRead.mockResolvedValueOnce(denied).mockResolvedValueOnce({...denied,hasLeaderGrant:true});const render=()=> <QueryClientProvider client={client}><CreatorLayout/></QueryClientProvider>;
 act(()=>{tree=create(render());});await flush();expect(mockRedirect).toHaveBeenCalledWith('/creator/pages');act(()=>tree.unmount());mockRedirect.mockClear();
 act(()=>{tree=create(render());});await flush();expect(mockRead).toHaveBeenCalledTimes(2);expect(mockRedirect).not.toHaveBeenCalled();expect(tree.root.findAllByType('CreatorTabs' as any)).toHaveLength(1);
});
it('keeps prefix invalidation working after community creation changes the access record',async()=>{
 mockRead.mockResolvedValueOnce({...denied,hasLeaderGrant:true}).mockResolvedValueOnce({...denied,hasLeaderGrant:true,ledCommunities:[{id:'new-community',role:'leader'}]});
 act(()=>{tree=create(<QueryClientProvider client={client}><CreatorLayout/></QueryClientProvider>);});await flush();
 await act(async()=>{await client.invalidateQueries({queryKey:['creator-access']});});await flush();expect(mockRead).toHaveBeenCalledTimes(2);expect(mockRedirect).not.toHaveBeenCalled();
});
it('an identity check failure cannot expose a cached creator shell or redirect',async()=>{
 mockAccountError=Error('auth offline');client.setQueryData(['creator-access'],{...denied,hasLeaderGrant:true});
 act(()=>{tree=create(<QueryClientProvider client={client}><CreatorLayout/></QueryClientProvider>);});await flush();expect(mockRead).not.toHaveBeenCalled();expect(mockRedirect).not.toHaveBeenCalled();expect(tree.root.findAllByType('CreatorTabs' as any)).toHaveLength(0);expect(tree.root.findAll(p=>p.props.accessibilityLabel==='Retry creator access').length).toBeGreaterThan(0);
});

it('bounds a stalled fresh access read and offers recovery without a denial redirect',async()=>{
 jest.useFakeTimers({doNotFake:['queueMicrotask']});try{
  mockRead.mockReturnValue(new Promise(()=>{}));act(()=>{tree=create(<QueryClientProvider client={client}><CreatorLayout/></QueryClientProvider>);});
  await act(async()=>{await Promise.resolve();jest.advanceTimersByTime(12000);await Promise.resolve();});
  await act(async()=>{jest.advanceTimersByTime(10);});
  expect(mockRedirect).not.toHaveBeenCalled();expect(tree.root.findAll(p=>p.props.accessibilityLabel==='Retry creator access').length).toBeGreaterThan(0);
 }finally{jest.useRealTimers();}
});
