import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { TouchableOpacity, Text, AppState, ScrollView } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Screen from '../../../app/community/[id]';
import { LegacyCommunityRoomDirectory } from '../../chats/LegacyCommunityRoomDirectory';
import { BrandedAlert } from '../../BrandedAlert';
const mockPush=jest.fn(), mockBack=jest.fn(), mockJoin=jest.fn(), mockLeave=jest.fn(), mockInvalidate=jest.fn();
const mockParamsContext=React.createContext<string | null>(null);
let mockId='community-a', mockFocused=true, mockUser='account-a', mockEpoch=1, mockAccountError:Error|null=null;
const mockRetry=jest.fn(), mockMembership=jest.fn();
let mockPreview:string|undefined;
const mockAppListeners=new Set<(state:string)=>void>();
const mockPage={community:{id:'community-a',name:'Test community',handle:'test-community',status:'active'},blocks:[],events:[],memberCount:2};
jest.mock('expo-router',()=>({useRouter:()=>({push:mockPush,back:mockBack}),useLocalSearchParams:()=>({id:require('react').useContext(mockParamsContext) ?? mockId,preview:mockPreview}),useFocusEffect:(cb:any)=>require('react').useEffect(()=>mockFocused?cb():undefined,[cb,mockFocused]),Stack:{Screen:()=>null}}));
jest.mock('@react-navigation/native',()=>({useIsFocused:()=>mockFocused}));
jest.mock('../../../hooks/useObservedUser',()=>({useObservedUser:()=>{
 const epoch=mockEpoch, viewerId=mockUser;
 // Match the real observer: identity callbacks stay stable until the account changes.
 const isCurrent=require('react').useCallback(()=>epoch===mockEpoch && viewerId===mockUser,[epoch,viewerId]);
 return{viewerId,epoch,isLoading:false,error:mockAccountError,retry:mockRetry,isCurrent};
}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View,useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
jest.mock('../../../lib/communityChat',()=>({getCommunityChatPayload:async()=>({cards:[{community_id:mockId,topics:[{id:'topic-a',name:'Walks',joined:false}]}]}),joinTopic:(...args:any[])=>mockJoin(...args)}));
jest.mock('../../../lib/communityJoin',()=>({getJoinGate:async()=>null,getMyMembership:(...args:any[])=>mockMembership(...args),leaveCommunity:(...args:any[])=>mockLeave(...args)}));
jest.mock('../../../lib/communityPage',()=>({getCommunityPage:async()=>mockPage,getMemberFaces:async()=>[]}));
jest.mock('../../../lib/communityLeader',()=>({getLeaderCards:async()=>new Map()}));
jest.mock('../../../lib/creatorMode',()=>({getJoinPolicy:async()=>'approval_required',buildCommunityPublicLink:()=>''}));
jest.mock('../../../lib/haptics',()=>({hapticSuccess:jest.fn()}));
jest.mock('../../../lib/friendlyError',()=>({friendlyError:(_e:any,f:string)=>f}));
jest.mock('../../../constants/FeatureFlags',()=>({CREATOR_PAGES_ENABLED:true,COMMUNITY_CHAT_GROUPING_ENABLED:true}));
jest.mock('../../ProfileButton',()=>()=>null);
jest.mock('../../events/EventMediaImage',()=>({EventMediaImage:()=>null}));
jest.mock('../../creator/pages/PublishedPageCover',()=>({PublishedPageCover:()=>null}));
jest.mock('../CommunityPeople',()=>({CommunityCreators:()=>null,CommunityMembers:()=>null}));
jest.mock('../JoinCommunityPopup',()=>({JoinCommunityPopup:()=>null}));
jest.mock('../CommunityManageLink',()=>({CommunityManageLink:()=>null}));
jest.mock('../CommunityJoinEntry',()=>({CommunityJoinEntry:()=>null}));
jest.mock('../../chats/LegacyCommunityRoomDirectory',()=>({LegacyCommunityRoomDirectory:()=>null}));
jest.mock('../../chats/CommunityRoomDirectory',()=>({CommunityRoomDirectory:({fallback}:any)=>fallback}));
jest.mock('../../scene/GeneratedPoster',()=>({GeneratedPoster:()=>null}));
jest.mock('../../scene/CommunityClassificationSummary',()=>({CommunityClassificationSummary:()=>null}));
jest.mock('../../BrandedAlert',()=>({BrandedAlert:()=>null}));

let tree:ReactTestRenderer, client:QueryClient;
const screen=()=> <QueryClientProvider client={client}><Screen/></QueryClientProvider>;
async function flush(){await act(async()=>{await new Promise(r=>setTimeout(r,0));});}
async function mount(){await act(async()=>{tree=create(screen())});await flush();}
async function update(){await act(async()=>tree.update(screen()));await flush();}
function state(value:string){Object.defineProperty(AppState,'currentState',{configurable:true,value});for(const cb of mockAppListeners)cb(value);}
const openChat=()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Open community chat');
beforeEach(()=>{
 jest.clearAllMocks();mockFocused=true;mockId='community-a';mockUser='account-a';mockEpoch=1;mockAccountError=null;mockPreview=undefined;
 mockMembership.mockReset().mockResolvedValue({status:'active',role:'member'});
 client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:60000,gcTime:Infinity}}});
 mockAppListeners.clear();Object.defineProperty(AppState,'currentState',{configurable:true,value:'active'});
 jest.spyOn(AppState,'addEventListener').mockImplementation((_event,cb:any)=>{mockAppListeners.add(cb);return{remove:()=>{mockAppListeners.delete(cb);}};});
});
afterEach(async()=>{await act(async()=>tree?.unmount());client.clear();jest.restoreAllMocks();});
async function resume(kind:string){
 if(kind==='foreground'){act(()=>state('background'));await act(async()=>state('active'));await flush();}
 else{mockFocused=false;await update();mockFocused=true;await update();}
}
it.each(['foreground','child return'])('retires member-only page controls after removal on %s and restores them after rejoin',async kind=>{
 await mount();expect(openChat()).toBeDefined();
 mockMembership.mockResolvedValue({status:'removed',role:'member'});
 await resume(kind);expect(openChat()).toBeUndefined();expect(tree.root.findAllByType(LegacyCommunityRoomDirectory)).toHaveLength(0);
 mockMembership.mockResolvedValue({status:'active',role:'member'});
 await resume(kind);expect(openChat()).toBeDefined();
});

function deferred(){let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return{promise,resolve};}
it('preserves current member controls during a failed refresh and checks again on explicit page refresh',async()=>{
 await mount();mockMembership.mockRejectedValue(Error('Offline'));await resume('foreground');expect(openChat()).toBeDefined();
 mockMembership.mockResolvedValue({status:'removed',role:'member'});
 await act(async()=>tree.root.findByType(ScrollView).props.refreshControl.props.onRefresh());await flush();expect(openChat()).toBeUndefined();
});
it('keeps a missing membership in visitor projection without calling it removed',async()=>{
 await mount();mockMembership.mockResolvedValue(null);await resume('child return');expect(openChat()).toBeUndefined();
 expect(tree.root.findAllByType(Text).some(n=>n.props.children==='this community is not open to you right now.')).toBe(false);
});
it('does not reuse the former account membership while a new account is loading',async()=>{
 await mount();const pending=deferred();mockMembership.mockReturnValueOnce(pending.promise);mockUser='account-b';mockEpoch++;await update();
 expect(openChat()).toBeUndefined();await act(async()=>pending.resolve({status:'removed',role:'member'}));await flush();expect(openChat()).toBeUndefined();
});
it('ignores a late denial from an old account refresh',async()=>{
 await mount();const old=deferred();mockMembership.mockReturnValueOnce(old.promise);await resume('foreground');
 mockUser='account-b';mockEpoch++;await update();expect(openChat()).toBeDefined();
 await act(async()=>old.resolve({status:'removed',role:'member'}));await flush();expect(openChat()).toBeDefined();
 expect(client.getQueryData(['community-membership','community-a','account-b',2])).toMatchObject({status:'active'});
});
it('coalesces overlapping route and app returns and ignores an offscreen foreground',async()=>{
 await mount();const before=mockMembership.mock.calls.length;const pending=deferred();mockMembership.mockReturnValueOnce(pending.promise);
 await resume('foreground');await resume('child return');expect(mockMembership).toHaveBeenCalledTimes(before+1);
 await act(async()=>pending.resolve({status:'active',role:'member'}));await flush();
 mockFocused=false;await update();const settled=mockMembership.mock.calls.length;await resume('foreground');expect(mockMembership).toHaveBeenCalledTimes(settled);
});
it('keeps a legitimate leader visitor preview and retires it when leader membership is removed',async()=>{
 mockMembership.mockResolvedValue({status:'active',role:'leader'});mockPreview='visitor';await mount();
 const done=()=>tree.root.findAllByType(TouchableOpacity).some(n=>n.props.accessibilityLabel==='Done previewing');
 expect(done()).toBe(true);expect(openChat()).toBeUndefined();
 mockMembership.mockResolvedValue({status:'removed',role:'leader'});await resume('child return');expect(done()).toBe(false);expect(openChat()).toBeUndefined();
});
