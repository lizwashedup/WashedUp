jest.mock('@react-navigation/native',()=>({useIsFocused:()=>true}));
import React from 'react';
import { Dimensions, ScrollView, Text, TextInput, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SceneDiscovery } from '../SceneDiscovery';
import { SceneFilterForm } from '../SceneFilterForm';
const mockPush=jest.fn(),mockRetry=jest.fn();
const communities=[{id:'table',name:'Sunday Table',description:'Shared dinners'}];
const events=[{id:'music',title:'Beach music',category:'music',venue:'Santa Monica'}];
jest.mock('../../../constants/FeatureFlags',()=>({CREATOR_PAGES_ENABLED:true}));
jest.mock('../../../hooks/usePublicPageScope',()=>({usePublicPageScope:()=>({scope:{userId:'member',isCurrent:()=>true},account:{viewerId:'member',epoch:1}})}));
jest.mock('../../../hooks/useSceneCommunities',()=>({useSceneCommunities:()=>({data:communities,identity:['member',1],isPending:false,isError:false,refetch:mockRetry,isRefetching:false})}));
jest.mock('expo-router',()=>({useRouter:()=>({push:mockPush})}));
jest.mock('@tanstack/react-query',()=>({useQuery:(q:any)=>({data:q.queryKey[0]==='scene-events'?events:new Map(),isPending:false,isError:false,refetch:mockRetry,isRefetching:false})}));
jest.mock('../../ProfileButton',()=>()=>null);
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View,SafeAreaProvider:require('react-native').View,initialWindowMetrics:null}));
jest.mock('../EventPoster',()=>({EventPoster:()=>null}));
jest.mock('../CommunityCard',()=>({CommunityCard:()=>null}));
let tree:ReactTestRenderer;
const control=(label:string)=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===label)!;
const press=(label:string)=>act(()=>control(label).props.onPress());
const input=(kind:string)=>tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel===`Search ${kind}`)!;
const label=(kind:string)=>control(kind).findByType(Text);
afterEach(()=>{if(tree)act(()=>tree.unmount());});
it('remeasures both tab labels through a mounted size roundtrip without losing destinations, filters, drafts or controls',()=>{
 const previous=Dimensions.get('window');act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1}}));
 try{
  act(()=>{tree=create(<SceneDiscovery communitiesEnabled/>);});
  act(()=>input('communities').props.onChangeText('community draft'));
  press('events');press('Filter events');act(()=>tree.root.findByType(SceneFilterForm).props.onApply({query:'',area:'Santa Monica',from:'',through:''}));
  act(()=>input('events').props.onChangeText('event draft'));press('communities');
  const scene=tree.root.findByType(SceneDiscovery),tabs=['communities','events'].map(control),scrolls=tree.root.findAllByType(ScrollView),inputs=[input('communities'),input('events')];
  let leaves=['communities','events'].map(label);
  for(const fontScale of [1.35,1]){
   act(()=>Dimensions.set({window:{...previous,width:390,fontScale}}));
   ['communities','events'].forEach((kind,index)=>{expect(label(kind)).not.toBe(leaves[index]);expect(label(kind).props.children).toBe(kind);expect(control(kind)).toBe(tabs[index]);});
   leaves=['communities','events'].map(label);
   expect(tree.root.findByType(SceneDiscovery)).toBe(scene);expect(control('communities').props.accessibilityState.selected).toBe(true);
   expect(tree.root.findAllByType(ScrollView)).toEqual(scrolls);expect(input('communities')).toBe(inputs[0]);expect(input('events')).toBe(inputs[1]);
   expect(input('communities').props.value).toBe('community draft');expect(input('events').props.value).toBe('event draft');
   expect(mockPush).not.toHaveBeenCalled();expect(mockRetry).not.toHaveBeenCalled();
  }
  press('events');expect(control('events').props.accessibilityState.selected).toBe(true);press('Filter events, 1 active');expect(tree.root.findByType(SceneFilterForm).props.applied.area).toBe('Santa Monica');
 }finally{act(()=>Dimensions.set({window:previous}));}
});
