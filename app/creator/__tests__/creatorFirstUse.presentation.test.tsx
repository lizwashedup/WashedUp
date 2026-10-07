import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Dimensions, TextInput, ScrollView } from 'react-native';
const mockBack=jest.fn(),mockCreate=jest.fn(),mockSave=jest.fn();
const mockAccess={ledCommunities:[{id:'community',name:'Sunday people',role:'leader',status:'draft'}],hasLeaderGrant:true,hasEventHostGrant:false};
jest.mock('expo-router',()=>({Stack:{Screen:()=>null},router:{back:()=>mockBack()},useRouter:()=>({back:()=>mockBack()}),Redirect:()=>null}));
jest.mock('../../../components/ProfileButton',()=>()=>require('react')['createElement']('ProfileDestination'));
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:{display:'Display',regular:'Regular',medium:'Medium',semibold:'Semibold'}})}));
const mockJoiningScope={userId:'creator',isCurrent:()=>true};
const mockJoiningAccount={viewerId:'creator',epoch:1,isLoading:false,error:null,isCurrent:()=>true};
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockJoiningScope,account:mockJoiningAccount,focused:true})}));
jest.mock('../../../hooks/useCreatorAccessRead',()=>({useCreatorAccessRead:()=>({data:mockAccess,isLoading:false})}));
jest.mock('../../../lib/supabase',()=>({supabase:{rpc:async()=>({data:true,error:null})}}));
jest.mock('../../../lib/haptics',()=>({hapticSuccess:jest.fn(),hapticError:jest.fn(),hapticLight:jest.fn()}));
jest.mock('../../../lib/creatorMode',()=>({...jest.requireActual('../../../lib/creatorMode'),createCommunity:(...args:any[])=>mockCreate(...args),updateJoinGateSettings:(...args:any[])=>mockSave(...args)}));
jest.mock('../../../lib/selectedCommunity',()=>({useLedCommunity:()=>mockAccess.ledCommunities[0],setSelectedCommunityId:jest.fn()}));
jest.mock('../../../components/communities/JoinCommunityPopup',()=>({JoinCommunityPopup:()=>null}));
jest.mock('../../../components/BrandedAlert',()=>({BrandedAlert:()=>null}));
jest.mock('@tanstack/react-query',()=>({useQuery:(q:any)=>({data:q.queryKey[0]==='creator-access'?mockAccess:q.queryKey[0]==='join-gate'?{join_welcome_message:'Welcome',join_intro_question:'Tell us about you',guidelines_url:''}:undefined,isLoading:false,isFetchedAfterMount:true}),useQueryClient:()=>({invalidateQueries:async()=>{}})}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
import Setup from '../setup-community';
import JoinGate from '../join-gate';
import { ScaledText } from '../../../components/ScaledText';
let tree:ReactTestRenderer;
function scale(fontScale:number){act(()=>Dimensions.set({window:{width:390,height:844,scale:3,fontScale},screen:{width:390,height:844,scale:3,fontScale}}));}
afterEach(()=>{act(()=>tree?.unmount());scale(1);jest.clearAllMocks();});
it.each([[Setup,['Community name','City','Community purpose','Community handle']],[JoinGate,['Welcome message','Introduction question','Guidelines link']]] as const)('keeps the named inputs, values, scroll and Back while creator text resizes',async(Screen,labels)=>{
 scale(1);await act(async()=>{tree=create(<Screen/>);});const inputs=tree.root.findAllByType(TextInput),scroll=tree.root.findByType(ScrollView);
 for(const label of labels)expect(inputs.some(input=>input.props.accessibilityLabel===label)).toBe(true);
 const input=inputs[0];act(()=>input.props.onChangeText('Retained draft'));expect(tree.root.findAllByType(TextInput)[0].props.value).toBe('Retained draft');
 const profile=tree.root.findByType('ProfileDestination' as any);const back=tree.root.findAll(p=>p.props.accessibilityLabel==='Back'&&typeof p.props.onPress==='function')[0];
 expect(back).toBeDefined();expect(tree.root.findAllByType(ScaledText).length).toBeGreaterThan(5);
 for(const font of [1.35,1]){scale(font);expect(tree.root.findByType(ScrollView)).toBe(scroll);expect(tree.root.findAllByType(TextInput)[0]).toBe(input);expect(input.props.value).toBe('Retained draft');expect(tree.root.findByType('ProfileDestination' as any)).toBe(profile);}
 act(()=>back.props.onPress());expect(mockBack).toHaveBeenCalledTimes(1);expect(mockCreate).not.toHaveBeenCalled();expect(mockSave).not.toHaveBeenCalled();
});
