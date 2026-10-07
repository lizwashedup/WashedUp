import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { TouchableOpacity, Text, ScrollView, Share, StyleSheet, Dimensions } from 'react-native';
import Screen from '../../../app/community/[id]';
import { LegacyCommunityRoomDirectory } from '../../chats/LegacyCommunityRoomDirectory';
import { BrandedAlert } from '../../BrandedAlert';
const mockPush=jest.fn(), mockBack=jest.fn(), mockJoin=jest.fn(), mockLeave=jest.fn(), mockInvalidate=jest.fn();
const mockParamsContext=React.createContext<string | null>(null);
const initialDimensions=Dimensions.get('window');
const mockPage={community:{id:'community-a',name:'Our Sunday Table',handle:'our-sunday-table',status:'active'},classification:{discovery_area:'Santa Monica',categories:['food and drink']},blocks:[{id:'header',block_type:'header',content:{tagline:'People sharing good food'}},{id:'about',block_type:'about',content:{text:'A table for meeting your neighbours.'}}],events:[],memberCount:2};
let mockId='community-a', mockFocused=true, mockUser='account-a', mockEpoch=1, mockAccountError:Error|null=null;
const mockRetry=jest.fn();
jest.mock('expo-router',()=>({useRouter:()=>({push:mockPush,back:mockBack}),useLocalSearchParams:()=>({id:require('react').useContext(mockParamsContext) ?? mockId}),useFocusEffect:(cb:any)=>require('react').useEffect(()=>mockFocused?cb():undefined,[cb,mockFocused]),Stack:{Screen:()=>null}}));
jest.mock('@react-navigation/native',()=>({useIsFocused:()=>mockFocused}));
jest.mock('../../../hooks/useObservedUser',()=>({useObservedUser:()=>{const epoch=mockEpoch;return{viewerId:mockUser,epoch,isLoading:false,error:mockAccountError,retry:mockRetry,isCurrent:()=>epoch===mockEpoch};}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View,useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
jest.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:mockInvalidate}),useQuery:({queryKey}:any)=>({isLoading:false,isRefetching:false,refetch:jest.fn(),data:queryKey[0]==='community-page'?mockPage:queryKey[0]==='community-membership'?{status:'active',role:'member'}:queryKey[0]==='community-chat-cards'?{cards:[{community_id:mockId,topics:[{id:'topic-a',name:'Walks',joined:false}]}]}:queryKey[0]==='community-faces'?[]:null})}));
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
afterEach(()=>{act(()=>tree?.unmount());act(()=>Dimensions.set({window:initialDimensions}));jest.restoreAllMocks();});
beforeEach(()=>{act(()=>Dimensions.set({window:{...initialDimensions,width:390,fontScale:1}}));});

const textLeaf=(value:string)=>tree.root.findAllByType(Text).find(n=>n.props.children===value)!;
const button=(label:string)=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===label)!;
it('remeasures published text through mounted enlargement and shrink while retaining the selected tab and page controls',async()=>{
 await mount();act(()=>button('About').props.onPress());
 const labels=['Our Sunday Table','Santa Monica','Food and drink','Home','Events','About','Share','People sharing good food','A table for meeting your neighbours.'];
 const page=tree.root.findByType(Screen),scroll=tree.root.findByType(ScrollView);
 const names=['Home','Events','About','Share community','Back','Open community chat'];const controls=names.map(button);
 for(const scale of [1.35,1]){
  const prior=labels.map(textLeaf);prior.forEach(n=>expect(n).toBeDefined());
  act(()=>Dimensions.set({window:{...initialDimensions,width:390,fontScale:scale}}));await settle();
  labels.forEach((label,index)=>expect(textLeaf(label)).not.toBe(prior[index]));
  expect(tree.root.findByType(Screen)).toBe(page);expect(tree.root.findByType(ScrollView)).toBe(scroll);
  controls.forEach((control,index)=>expect(button(names[index])).toBe(control));
  expect(button('About').props.accessibilityState.selected).toBe(true);
  expect(mockJoin).not.toHaveBeenCalled();expect(mockLeave).not.toHaveBeenCalled();expect(mockPush).not.toHaveBeenCalled();expect(mockBack).not.toHaveBeenCalled();
 }
 act(()=>button('Open community chat').props.onPress());expect(mockPush).toHaveBeenCalledWith('/community-thread/community-a');
 act(()=>button('Back').props.onPress());expect(mockBack).toHaveBeenCalledTimes(1);
});
it('keeps Share intrinsically sized in its wrapping parent and preserves one pending share through remeasurement',async()=>{
 const pending=deferred(),share=jest.spyOn(Share,'share').mockReturnValue(pending.promise);await mount();
 const control=button('Share community');
 expect(StyleSheet.flatten(control.props.style)).toMatchObject({flexShrink:0,minHeight:44});
 expect(StyleSheet.flatten(textLeaf('Share').props.style)).toMatchObject({flexShrink:0});
 expect(textLeaf('Share').props.numberOfLines).toBe(1);
 const parent=control.parent!;expect(StyleSheet.flatten(parent.props.style)).toMatchObject({flexDirection:'row',flexWrap:'wrap'});
 act(()=>{control.props.onPress();control.props.onPress();});expect(share).toHaveBeenCalledTimes(1);
 const opening=textLeaf('Opening…');act(()=>Dimensions.set({window:{...initialDimensions,width:390,fontScale:1.35}}));await settle();
 expect(textLeaf('Opening…')).not.toBe(opening);expect(button('Share community')).toBe(control);expect(control.props.disabled).toBe(true);
 await act(async()=>pending.resolve({action:'sharedAction'}));expect(textLeaf('Share')).toBeDefined();expect(control.props.disabled).toBe(false);
 expect(mockJoin).not.toHaveBeenCalled();expect(mockLeave).not.toHaveBeenCalled();expect(mockPush).not.toHaveBeenCalled();
});
