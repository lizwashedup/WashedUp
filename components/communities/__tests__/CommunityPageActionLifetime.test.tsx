import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { TouchableOpacity, Text } from 'react-native';
import Screen from '../../../app/community/[id]';
import { LegacyCommunityRoomDirectory } from '../../chats/LegacyCommunityRoomDirectory';
import { BrandedAlert } from '../../BrandedAlert';
const mockPush=jest.fn(), mockBack=jest.fn(), mockJoin=jest.fn(), mockLeave=jest.fn(), mockInvalidate=jest.fn();
const mockParamsContext=React.createContext<string | null>(null);
let mockId='community-a', mockFocused=true, mockUser='account-a', mockEpoch=1, mockAccountError:Error|null=null;
const mockRetry=jest.fn();
jest.mock('expo-router',()=>({useRouter:()=>({push:mockPush,back:mockBack}),useLocalSearchParams:()=>({id:require('react').useContext(mockParamsContext) ?? mockId}),useFocusEffect:(cb:any)=>require('react').useEffect(()=>mockFocused?cb():undefined,[cb,mockFocused]),Stack:{Screen:()=>null}}));
jest.mock('@react-navigation/native',()=>({useIsFocused:()=>mockFocused}));
jest.mock('../../../hooks/useObservedUser',()=>({useObservedUser:()=>{const epoch=mockEpoch;return{viewerId:mockUser,epoch,isLoading:false,error:mockAccountError,retry:mockRetry,isCurrent:()=>epoch===mockEpoch};}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View,useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
jest.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:mockInvalidate}),useQuery:({queryKey}:any)=>({isLoading:false,isRefetching:false,refetch:jest.fn(),data:queryKey[0]==='community-page'?{community:{id:mockId,name:'Test community',handle:'test-community',status:'active'},blocks:[],events:[],memberCount:2}:queryKey[0]==='community-membership'?{status:'active',role:'member'}:queryKey[0]==='community-chat-cards'?{cards:[{community_id:mockId,topics:[{id:'topic-a',name:'Walks',joined:false}]}]}:queryKey[0]==='community-faces'?[]:null})}));
jest.mock('../../../lib/communityChat',()=>({getCommunityChatPayload:jest.fn(),joinTopic:(...args:any[])=>mockJoin(...args)}));
jest.mock('../../../lib/communityJoin',()=>({getJoinGate:jest.fn(),getMyMembership:jest.fn(),leaveCommunity:(...args:any[])=>mockLeave(...args)}));
jest.mock('../../../lib/communityPage',()=>({getCommunityPage:jest.fn(),getMemberFaces:jest.fn()}));
jest.mock('../../../lib/communityLeader',()=>({getLeaderCards:jest.fn()}));
jest.mock('../../../lib/creatorMode',()=>({getJoinPolicy:jest.fn(),buildCommunityPublicLink:()=>''}));
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
let tree:ReactTestRenderer;
function deferred(){let resolve!:(x?:any)=>void,reject!:(x?:any)=>void;const promise=new Promise<any>((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};}
async function mount(){await act(async()=>{tree=create(<Screen/>)});}
async function update(){await act(async()=>{tree.update(<Screen/>)});}
async function settle(){await act(async()=>{for(let i=0;i<12;i++)await Promise.resolve()});}
const room=()=>tree.root.findByType(LegacyCommunityRoomDirectory).props;
const alert=()=>tree.root.findByType(BrandedAlert).props;
function leave(){const button=tree.root.findAllByType(TouchableOpacity).find(n=>n.findAllByType(Text).some(t=>t.props.children==='leave community'))!;act(()=>button.props.onPress());return alert().buttons.find((b:any)=>b.text==='leave').onPress;}
beforeEach(()=>{jest.clearAllMocks();mockId='community-a';mockFocused=true;mockUser='account-a';mockEpoch=1;mockAccountError=null;mockJoin.mockReset().mockResolvedValue(undefined);mockLeave.mockReset().mockResolvedValue(undefined);mockInvalidate.mockReset().mockResolvedValue(undefined);});
afterEach(()=>{act(()=>tree?.unmount());});
it.each(['blur','room','account','unmount'] as const)('does not reopen an old topic after pending join and %s retirement',async change=>{
 const pending=deferred();mockJoin.mockReturnValueOnce(pending.promise);await mount();act(()=>room().onJoinTopic('topic-a'));
 if(change==='blur'){mockFocused=false;await update();mockFocused=true;await update();}
 if(change==='room'){mockId='community-b';await update();mockId='community-a';await update();}
 if(change==='account'){mockUser='account-b';mockEpoch++;await update();mockUser='account-a';mockEpoch++;await update();}
 if(change==='unmount')act(()=>tree.unmount());
 await act(async()=>pending.resolve());await settle();expect(mockPush).not.toHaveBeenCalled();
});
it('does not navigate after route retirement during join invalidation',async()=>{
 const pending=deferred();mockInvalidate.mockReturnValueOnce(pending.promise);await mount();act(()=>room().onJoinTopic('topic-a'));await settle();
 mockFocused=false;await update();await act(async()=>pending.resolve());await settle();expect(mockPush).not.toHaveBeenCalled();
});
it('starts only one legacy join for retained duplicate callbacks and keeps the current destination',async()=>{
 const pending=deferred();mockJoin.mockReturnValue(pending.promise);await mount();const join=room().onJoinTopic;
 act(()=>{join('topic-a');join('topic-a')});expect(mockJoin).toHaveBeenCalledTimes(1);
 await act(async()=>pending.resolve());await settle();expect(mockPush).toHaveBeenCalledWith('/community-topic/topic-a');
});
it('an old result cannot release a new visit join lock',async()=>{
 const old=deferred(),fresh=deferred();mockJoin.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);await mount();act(()=>room().onJoinTopic('topic-a'));
 mockFocused=false;await update();mockFocused=true;await update();act(()=>room().onJoinTopic('topic-a'));
 await act(async()=>old.resolve());await settle();expect(room().joiningTopicId).toBe('topic-a');expect(mockPush).not.toHaveBeenCalled();
 await act(async()=>fresh.resolve());await settle();expect(room().joiningTopicId).toBeNull();expect(mockPush).toHaveBeenCalledTimes(1);
});
it('does not pop another route after a pending leave finishes',async()=>{
 const pending=deferred();mockLeave.mockReturnValueOnce(pending.promise);await mount();const confirm=leave();act(()=>{void confirm()});
 mockFocused=false;await update();await act(async()=>pending.resolve());await settle();expect(mockBack).not.toHaveBeenCalled();
});
it('a retired leave confirmation cannot dispatch after the account round trip',async()=>{
 await mount();const confirm=leave();mockUser='account-b';mockEpoch++;await update();mockUser='account-a';mockEpoch++;await update();
 await act(async()=>confirm());expect(mockLeave).not.toHaveBeenCalled();
});
it('starts one current leave and preserves its Back destination',async()=>{
 const pending=deferred();mockLeave.mockReturnValue(pending.promise);await mount();const confirm=leave();act(()=>{confirm();confirm()});expect(mockLeave).toHaveBeenCalledTimes(1);
 await act(async()=>pending.resolve());await settle();expect(mockBack).toHaveBeenCalledTimes(1);
});
it('a current join error releases the same visit for an explicit later action',async()=>{
 mockJoin.mockRejectedValueOnce(Error('offline'));await mount();act(()=>room().onJoinTopic('topic-a'));await settle();expect(room().joiningTopicId).toBeNull();expect(alert().visible).toBe(true);
 act(()=>room().onJoinTopic('topic-a'));await settle();expect(mockJoin).toHaveBeenCalledTimes(2);expect(mockPush).toHaveBeenCalledTimes(1);
});


it('a retained Join cannot start after leaving and returning to the same page', async () => {
 await mount(); const join=room().onJoinTopic;
 mockFocused=false; await update(); mockFocused=true; await update();
 act(()=>join('topic-a')); await settle(); expect(mockJoin).not.toHaveBeenCalled();
});
it('suppresses a retired join failure and preserves the new visit feedback', async () => {
 const pending=deferred(); mockJoin.mockReturnValueOnce(pending.promise); await mount(); act(()=>room().onJoinTopic('topic-a'));
 mockId='community-b'; await update();
 await act(async()=>pending.reject(Error('Old offline'))); await settle(); expect(alert().visible).toBe(false); expect(room().joiningTopicId).toBeNull();
});
it('keeps a current join callback usable during a suspended other-community render', async () => {
 const never=new Promise(()=>{}); function Pending({suspend}:{suspend:boolean}){if(suspend)throw never;return null;}
 const render=(suspend:boolean)=><React.Suspense fallback={null}><mockParamsContext.Provider value={suspend?'community-b':'community-a'}><Screen/></mockParamsContext.Provider><Pending suspend={suspend}/></React.Suspense>;
 await act(async()=>{tree=create(render(false))});const join=room().onJoinTopic;
 await act(async()=>{React.startTransition(()=>tree.update(render(true)))});
 expect(room().onJoinTopic).toBe(join);
 act(()=>join('topic-a'));await settle();expect(mockJoin).toHaveBeenCalledTimes(1);expect(mockPush).toHaveBeenCalledWith('/community-topic/topic-a');
});


it('shows explicit account recovery instead of silently ignoring Join when the account read failed', async () => {
 mockAccountError=Error('Cannot check account');await mount();act(()=>room().onJoinTopic('topic-a'));await settle();
 expect(mockJoin).not.toHaveBeenCalled();expect(alert().visible).toBe(true);
 expect(alert().title).toBe('could not check your account');act(()=>alert().buttons[0].onPress());expect(mockRetry).toHaveBeenCalledTimes(1);
});
it('retires account-retry feedback with its initiating visit', async () => {
 mockAccountError=Error('Cannot check account');await mount();act(()=>room().onJoinTopic('topic-a'));await settle();const retry=alert().buttons[0].onPress;
 mockFocused=false;await update();mockFocused=true;await update();act(()=>retry());expect(mockRetry).not.toHaveBeenCalled();
});
