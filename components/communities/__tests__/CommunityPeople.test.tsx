import {Dimensions,Text,View,StyleSheet} from 'react-native';
import {Image} from 'expo-image';
import React from 'react';import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mockMore=jest.fn(),mockRetry=jest.fn(),mockInfinite=jest.fn(),mockQuery=jest.fn(),mockViewer=jest.fn();
jest.mock('@tanstack/react-query',()=>({useInfiniteQuery:(...a:unknown[])=>mockInfinite(...a),useQuery:(...a:unknown[])=>mockQuery(...a)}));
jest.mock('../../../hooks/useObservedUser',()=>({useObservedUser:()=>mockViewer()}));
jest.mock('../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:{medium:'System',regular:'System'}})}));
jest.mock('../../../lib/communityPeople',()=>({readCommunityPeople:jest.fn(),readCommunityCreators:jest.fn()}));
import {CommunityMembers,CommunityCreators} from '../CommunityPeople';
let tree:ReactTestRenderer;const people=Array.from({length:12},(_,i)=>({id:`person-${i}`,name:`Person ${i}`,photo:null}));
const text=()=>JSON.stringify(tree.toJSON());
beforeEach(()=>{jest.clearAllMocks();mockViewer.mockReturnValue({viewerId:'account-a',epoch:1,isCurrent:()=>true,isLoading:false,error:null});mockInfinite.mockReturnValue({data:{pages:[{people}]},hasNextPage:true,fetchNextPage:mockMore,refetch:mockRetry});mockQuery.mockReturnValue({data:[]});});
afterEach(()=>act(()=>tree?.unmount()));
const press=(label:string)=>tree.root.findAll(n=>typeof n.props.onPress==='function'&&n.findAll(c=>String(c.type)==='Text'&&c.props.children===label).length>0)[0];
it('starts compact, expands in place and can collapse',()=>{act(()=>{tree=create(<CommunityMembers pageId="page"/>);});expect(text()).not.toContain('Person 10');act(()=>press('See all members').props.onPress());expect(text()).toContain('Person 10');act(()=>press('Show less').props.onPress());expect(text()).not.toContain('Person 10');});
it('expanded list offers real pagination',()=>{act(()=>{tree=create(<CommunityMembers pageId="page"/>);});act(()=>press('See all members').props.onPress());act(()=>press('More members').props.onPress());expect(mockMore).toHaveBeenCalledTimes(1);});
it('read failure suppresses cached member identities and offers retry',()=>{mockInfinite.mockReturnValue({data:{pages:[{people}]},error:Error('denied'),refetch:mockRetry});act(()=>{tree=create(<CommunityMembers pageId="page"/>);});expect(text()).not.toContain('Person 0');act(()=>press('Couldn’t load members · Try again').props.onPress());expect(mockRetry).toHaveBeenCalled();});
it('account change closes the prior expanded directory',()=>{act(()=>{tree=create(<CommunityMembers pageId="page"/>);});act(()=>press('See all members').props.onPress());mockViewer.mockReturnValue({viewerId:'account-b',epoch:2,isCurrent:()=>true,isLoading:false,error:null});act(()=>tree.update(<CommunityMembers pageId="page"/>));expect(text()).not.toContain('Person 10');});
it('labels creator and accepted co-creator distinctly',()=>{mockQuery.mockReturnValue({data:[{id:'a',name:'Maya',photo:null,role:'creator'},{id:'b',name:'Alex',photo:null,role:'co_creator'}]});act(()=>{tree=create(<CommunityCreators pageId="page" fallback={null}/>);});expect(text()).toContain('Creator');expect(text()).toContain('Co-creator');expect(text()).toContain('Maya');});

it('remeasures creator names and roles while preserving photo failure fallback and avatar frames',()=>{
 const previous=Dimensions.get('window');act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1}}));
 try{
  mockQuery.mockReturnValue({data:[{id:'a',name:'Aster',photo:'https://example.invalid/a.jpg',role:'creator'}]});
  act(()=>{tree=create(<CommunityCreators pageId="page" fallback={null}/>);});act(()=>tree.root.findByType(Image).props.onError());
  const component=tree.root.findByType(CommunityCreators),leaf=(v:string)=>tree.root.findAllByType(Text).find(n=>n.props.children===v)!,face=tree.root.findAllByType(View).find(n=>StyleSheet.flatten(n.props.style)?.width===36)!;
  for(const scale of [1.35,1]){const values=['Aster','Creator','A'],old=values.map(leaf);act(()=>Dimensions.set({window:{...previous,width:390,fontScale:scale}}));values.forEach((v,i)=>expect(leaf(v)).not.toBe(old[i]));expect(tree.root.findByType(CommunityCreators)).toBe(component);expect(tree.root.findAllByType(Image)).toHaveLength(0);expect(tree.root.findAllByType(View).find(n=>StyleSheet.flatten(n.props.style)?.width===36)).toBe(face);expect(StyleSheet.flatten(face.props.style)).toMatchObject({width:36,height:36,borderRadius:18});}
  expect(mockQuery).toHaveBeenCalledTimes(1);expect(mockMore).not.toHaveBeenCalled();expect(mockRetry).not.toHaveBeenCalled();
 }finally{act(()=>Dimensions.set({window:previous}));}
});
it('remeasures expanded member text without collapsing or refetching the directory',()=>{
 const previous=Dimensions.get('window');act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1}}));
 try{
  act(()=>{tree=create(<CommunityMembers pageId="page"/>);});act(()=>press('See all members').props.onPress());
  const component=tree.root.findByType(CommunityMembers),control=press('Show less'),more=press('More members'),calls=mockInfinite.mock.calls.length;
  const leaf=(v:string)=>tree.root.findAllByType(Text).find(n=>n.props.children===v)!;
  for(const scale of [1.35,1]){const values=['Who’s here','Person 10','Show less','More members'],old=values.map(leaf);act(()=>Dimensions.set({window:{...previous,width:390,fontScale:scale}}));values.forEach((v,i)=>expect(leaf(v)).not.toBe(old[i]));expect(tree.root.findByType(CommunityMembers)).toBe(component);expect(press('Show less')).toBe(control);expect(press('More members')).toBe(more);}
  expect(mockInfinite).toHaveBeenCalledTimes(calls);expect(mockMore).not.toHaveBeenCalled();expect(mockRetry).not.toHaveBeenCalled();
 }finally{act(()=>Dimensions.set({window:previous}));}
});
