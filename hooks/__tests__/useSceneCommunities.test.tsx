import React from 'react';
import { act,create } from 'react-test-renderer';
import { useSceneCommunities } from '../useSceneCommunities';
let mockCurrent=true,mockScope:any,mockAccount:any,mockQuery:any,mockResult:any;
const mockRead=jest.fn(),mockRetry=jest.fn();
jest.mock('../../constants/FeatureFlags',()=>({CREATOR_PAGES_ENABLED:true}));
jest.mock('../usePublicPageScope',()=>({usePublicPageScope:()=>({scope:mockScope,account:mockAccount})}));
jest.mock('../../lib/sceneDiscovery',()=>({getDiscoverableCommunities:(s:any)=>mockRead(s)}));
jest.mock('@tanstack/react-query',()=>({useQuery:(q:any)=>{mockQuery=q;return{data:[{id:'prior-page'}],isPending:false,isError:false,error:null,refetch:jest.fn()};}}));
function Harness(){mockResult=useSceneCommunities();return null;}
beforeEach(()=>{mockCurrent=true;mockScope={userId:'alice',isCurrent:()=>mockCurrent};mockAccount={viewerId:'alice',epoch:1,error:null,retry:mockRetry};jest.clearAllMocks();});
it('keys cached results to the current account and supplies its exact scope',async()=>{
 let tree:any;act(()=>{tree=create(<Harness/>);});expect(mockQuery.queryKey).toEqual(['scene-communities',1,'alice']);await mockQuery.queryFn();expect(mockRead).toHaveBeenCalledWith(mockScope);
 mockAccount={...mockAccount,viewerId:'bob',epoch:2};mockScope={...mockScope,userId:'bob'};act(()=>tree.update(<Harness/>));expect(mockQuery.queryKey).toEqual(['scene-communities',2,'bob']);act(()=>tree.unmount());
});
it('hides cached identities and pauses reads when the visit retires',()=>{
 let tree:any;act(()=>{tree=create(<Harness/>);});mockCurrent=false;act(()=>tree.update(<Harness/>));expect(mockResult.data).toEqual([]);expect(mockQuery.enabled).toBe(false);act(()=>tree.unmount());
});
it('hides cached identities on account failure and retries account resolution',()=>{
 mockScope=null;mockAccount={...mockAccount,error:Error('Account unavailable')};let tree:any;act(()=>{tree=create(<Harness/>);});expect(mockResult.data).toEqual([]);expect(mockResult.isError).toBe(true);expect(mockResult.isPending).toBe(false);mockResult.refetch();expect(mockRetry).toHaveBeenCalledTimes(1);act(()=>tree.unmount());
});
