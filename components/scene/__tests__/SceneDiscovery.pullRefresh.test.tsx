import React from 'react';
import { ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SceneDiscovery } from '../SceneDiscovery';
import { SceneFilterForm } from '../SceneFilterForm';
const mockPush=jest.fn(),mockRetry=jest.fn();
let mockFocused=true,mockAutomatic=false,mockIdentity=['member',1];
jest.mock('@react-navigation/native',()=>({useIsFocused:()=>mockFocused}));
const communities=[{id:'table',name:'Sunday Table',description:'Shared dinners'}];
const events=[{id:'music',title:'Beach music',category:'music',venue:'Santa Monica'}];
jest.mock('../../../constants/FeatureFlags',()=>({CREATOR_PAGES_ENABLED:true}));
jest.mock('../../../hooks/usePublicPageScope',()=>({usePublicPageScope:()=>({scope:{userId:'member',isCurrent:()=>true},account:{viewerId:mockIdentity[0],epoch:mockIdentity[1]}})}));
jest.mock('../../../hooks/useSceneCommunities',()=>({useSceneCommunities:()=>({data:communities,identity:mockIdentity,isPending:false,isError:false,refetch:mockRetry,isRefetching:mockAutomatic})}));
jest.mock('expo-router',()=>({useRouter:()=>({push:mockPush})}));
jest.mock('@tanstack/react-query',()=>({useQuery:(q:any)=>({data:q.queryKey[0]==='scene-events'?events:new Map(),isPending:false,isError:false,refetch:mockRetry,isRefetching:mockAutomatic})}));
jest.mock('../../ProfileButton',()=>()=>null);
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View,SafeAreaProvider:require('react-native').View,initialWindowMetrics:null}));
jest.mock('../EventPoster',()=>({EventPoster:()=>null}));
jest.mock('../CommunityCard',()=>({CommunityCard:()=>null}));
let tree:ReactTestRenderer;
const control=(label:string)=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===label)!;
const press=(label:string)=>act(()=>control(label).props.onPress());
const input=(kind:string)=>tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel===`Search ${kind}`)!;
const refresh=(kind:string)=>tree.root.findAllByType(ScrollView).find(n=>n.props.refreshControl&&n.findAllByType(TextInput).some(i=>i.props.accessibilityLabel===`Search ${kind}`))!.props.refreshControl.props;
const held=()=>{let resolve!:(v?:unknown)=>void,reject!:(e:Error)=>void;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const update=()=>act(()=>tree.update(<SceneDiscovery communitiesEnabled/>));
beforeEach(()=>{jest.clearAllMocks();mockFocused=true;mockAutomatic=false;mockIdentity=['member',1];mockRetry.mockResolvedValue(undefined);act(()=>{tree=create(<SceneDiscovery communitiesEnabled/>);});press('events');press('communities');});
afterEach(()=>act(()=>tree.unmount()));
it.each(['communities','events'])('does not present %s native refresh for automatic refetch but retains explicit pull until settlement',async kind=>{
 press(kind);act(()=>input(kind).props.onChangeText('retained draft'));const field=input(kind),scrolls=tree.root.findAllByType(ScrollView);
 mockAutomatic=true;update();expect(refresh(kind).refreshing).toBe(false);expect(mockRetry).not.toHaveBeenCalled();
 const read=held();mockRetry.mockReturnValue(read.promise);let completion:Promise<void>;
 act(()=>{completion=refresh(kind).onRefresh();refresh(kind).onRefresh();});
 expect(refresh(kind).refreshing).toBe(true);expect(mockRetry).toHaveBeenCalledTimes(1);expect(input(kind)).toBe(field);expect(field.props.value).toBe('retained draft');expect(tree.root.findAllByType(ScrollView)).toEqual(scrolls);
 mockAutomatic=false;update();expect(refresh(kind).refreshing).toBe(true);
 await act(async()=>{read.resolve();await completion!;});expect(refresh(kind).refreshing).toBe(false);expect(mockPush).not.toHaveBeenCalled();
});
it('ends a rejected pull and allows a new explicit pull without changing query Retry',async()=>{
 const first=held();mockRetry.mockReturnValueOnce(first.promise);let done:Promise<void>;act(()=>{done=refresh('communities').onRefresh();});
 await act(async()=>{first.reject(Error('Offline'));await done!;});expect(refresh('communities').refreshing).toBe(false);
 await act(async()=>{await refresh('communities').onRefresh();});expect(mockRetry).toHaveBeenCalledTimes(2);expect(refresh('communities').refreshing).toBe(false);
});
it.each(['account','focus','destination'])('retires the old %s pull and callback without clearing a newer attempt',async boundary=>{
 const first=held(),second=held();mockRetry.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);const oldPull=refresh('communities').onRefresh;let oldDone:Promise<void>,newDone:Promise<void>;
 act(()=>{oldDone=oldPull();});expect(refresh('communities').refreshing).toBe(true);
 if(boundary==='account'){mockIdentity=['other',2];update();mockIdentity=['member',3];update();}
 if(boundary==='focus'){mockFocused=false;update();expect(refresh('communities').refreshing).toBe(false);mockFocused=true;update();}
 if(boundary==='destination'){press('events');expect(refresh('communities').refreshing).toBe(false);press('communities');}
 expect(refresh('communities').refreshing).toBe(false);await act(async()=>{await oldPull();});expect(mockRetry).toHaveBeenCalledTimes(1);
 act(()=>{newDone=refresh('communities').onRefresh();});expect(mockRetry).toHaveBeenCalledTimes(2);expect(refresh('communities').refreshing).toBe(true);
 await act(async()=>{first.resolve();await oldDone!;});expect(refresh('communities').refreshing).toBe(true);
 await act(async()=>{second.resolve();await newDone!;});expect(refresh('communities').refreshing).toBe(false);
});
