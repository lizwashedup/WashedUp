import React, { useState } from 'react';
import { Alert, Dimensions, ScrollView, Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import PeopleScreen from '../../people/PeopleScreen';
import PeopleSearchResults from '../PeopleSearchResults';
import PersonRow from '../../paths/PersonRow';
import { AfterglowFallbackFonts } from '../../../../constants/Typography';
import { COPY } from '../../state/constants';
import type { YoursGridPerson, SearchPerson } from '../../../../lib/yours/types';
const mockSearch=jest.fn(),mockSend=jest.fn(),mockRefetch=jest.fn();
jest.mock('../../../../hooks/usePeopleSearch',()=>({usePeopleSearch:(...args:unknown[])=>mockSearch(...args)}));
jest.mock('../../../../hooks/usePeopleConnectionMutations',()=>({usePeopleConnectionMutations:()=>({sendRequest:{mutateAsync:mockSend}}),friendlyConnectionError:()=> 'Request failed.'}));
jest.mock('expo-image',()=>({Image:(props:any)=>require('react').createElement('Photo',props)}));
jest.mock('expo-linear-gradient',()=>({LinearGradient:(props:any)=>require('react').createElement('Gradient',props)}));
jest.mock('lucide-react-native',()=>({Search:()=>null,Plus:()=>null,Users:()=>null,ChevronRight:()=>null,MoreHorizontal:()=>null}));
const appearance={fonts:AfterglowFallbackFonts};
const person:YoursGridPerson={user_id:'juniper',first_name_display:'Juniper',handle:'juniper',profile_photo_url:'https://example.invalid/juniper.jpg',shared_count:2,ring_bucket:'none',milestone:null,upcoming_event_id:null,upcoming_title:null,upcoming_start:null,upcoming_neighborhood:null,connected_at:''};
const stranger:SearchPerson={user_id:'new-juniper',first_name_display:'Juniper',handle:'juniper',profile_photo_url:null,shared_count:0,connection_state:'none'};
const onOpen=jest.fn(),onMinimal=jest.fn();
let tree:ReactTestRenderer,result:{data:SearchPerson[];isFetching:boolean;isError:boolean;refetch:typeof mockRefetch};
let previous:ReturnType<typeof Dimensions.get>;
function SearchPage({people=[],userId='viewer'}:{people?:YoursGridPerson[];userId?:string}){
 const [query,setQuery]=useState('Juniper');
 return <PeopleScreen people={people} query={query} onQueryChange={setQuery} pendingRequests={0} onRequestsPress={()=>{}} onPersonPress={()=>{}} onLongPressPerson={()=>{}} onAddPeople={()=>{}} onCreateCircle={()=>{}} appearance={appearance}
  searchResults={<PeopleSearchResults userId={userId} query={query} people={people} onOpenPerson={onOpen} onOpenMinimal={onMinimal} appearance={appearance}/>}/>;
}
function mount(people:YoursGridPerson[]=[]){act(()=>{tree=create(<SearchPage people={people}/>);});}
const leaf=(value:string)=>tree.root.findAllByType(Text).find(node=>node.props.children===value)!;
const button=(label:string)=>tree.root.findAll(node=>node.props.accessibilityLabel===label&&typeof node.props.onPress==='function')[0];
const scale=(fontScale:number)=>act(()=>Dimensions.set({window:{...previous,width:390,fontScale}}));
const settle=()=>act(()=>jest.advanceTimersByTime(300));
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(e:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();previous=Dimensions.get('window');scale(1.35);result={data:[],isFetching:false,isError:false,refetch:mockRefetch};mockSearch.mockImplementation(()=>result);mockRefetch.mockResolvedValue({});mockSend.mockResolvedValue('requested');jest.spyOn(Alert,'alert').mockImplementation(()=>{});});
afterEach(()=>{act(()=>tree?.unmount());act(()=>Dimensions.set({window:previous}));jest.restoreAllMocks();jest.useRealTimers();});
it('remeasures accepted search text through large-small-large while preserving query/input/scroll, result row and failed-photo state',()=>{
 mount([person]);settle();const input=tree.root.findByType(TextInput),scroll=tree.root.findAllByType(ScrollView)[0],results=tree.root.findByType(PeopleSearchResults),row=tree.root.findByType(PersonRow),open=button('View Juniper');
 act(()=>tree.root.findByType('Photo' as any).props.onError());
 const labels=[COPY.searchYoursSection,'Juniper','2 shared plans','J'];let leaves=labels.map(leaf);
 for(const fontScale of [1,1.35]){
  scale(fontScale);labels.forEach((label,index)=>expect(leaf(label)).not.toBe(leaves[index]));leaves=labels.map(leaf);
  expect(tree.root.findByType(TextInput)).toBe(input);expect(input.props.value).toBe('Juniper');expect(tree.root.findAllByType(ScrollView)[0]).toBe(scroll);expect(tree.root.findByType(PeopleSearchResults)).toBe(results);expect(tree.root.findByType(PersonRow)).toBe(row);expect(button('View Juniper')).toBe(open);
  expect(tree.root.findAllByType('Photo' as any)).toHaveLength(0);expect(mockSend).not.toHaveBeenCalled();expect(mockRefetch).not.toHaveBeenCalled();
 }
 act(()=>input.props.onChangeText('Juni'));expect(tree.root.findByType(TextInput)).toBe(input);expect(input.props.value).toBe('Juni');expect(mockSearch).toHaveBeenLastCalledWith('viewer','Juni');
 act(()=>open.props.onPress());expect(onOpen).toHaveBeenCalledWith('juniper');expect(onMinimal).not.toHaveBeenCalled();
});
it('remeasures pending and confirmed request copy without replacing the request owner or sending twice',async()=>{
 const pending=deferred<string>();mockSend.mockReturnValue(pending.promise);result.data=[stranger];mount();settle();
 const input=tree.root.findByType(TextInput),results=tree.root.findByType(PeopleSearchResults),row=tree.root.findByType(PersonRow),add=button('Add Juniper'),retainedAdd=add.props.onPress;
 act(()=>{retainedAdd();retainedAdd();});expect(mockSend).toHaveBeenCalledTimes(1);let sending=leaf('Sending…');
 for(const fontScale of [1,1.35]){
  scale(fontScale);expect(leaf('Sending…')).not.toBe(sending);sending=leaf('Sending…');expect(button('Sending request to Juniper')).toBe(add);expect(add.props.disabled).toBe(true);
  expect(tree.root.findByType(PeopleSearchResults)).toBe(results);expect(tree.root.findByType(PersonRow)).toBe(row);expect(tree.root.findByType(TextInput)).toBe(input);expect(input.props.value).toBe('Juniper');act(()=>retainedAdd());expect(mockSend).toHaveBeenCalledTimes(1);expect(mockRefetch).not.toHaveBeenCalled();
 }
 await act(async()=>pending.resolve('requested'));expect(leaf('Requested')).toBeDefined();expect(button('Add Juniper')).toBeUndefined();expect(mockRefetch).toHaveBeenCalledTimes(1);
 const requested=leaf('Requested');scale(1);expect(leaf('Requested')).not.toBe(requested);expect(tree.root.findByType(PersonRow)).toBe(row);expect(mockSend).toHaveBeenCalledWith({recipientId:'new-juniper',context:'handle_lookup'});
});
it('keeps stale request completions scoped to their old query after mounted scale and input changes',async()=>{
 const pending=deferred<string>();mockSend.mockReturnValue(pending.promise);result.data=[stranger];mount();settle();const input=tree.root.findByType(TextInput),oldAdd=button('Add Juniper').props.onPress;
 act(()=>oldAdd());scale(1);act(()=>input.props.onChangeText('Cedar'));scale(1.35);act(()=>oldAdd());expect(mockSend).toHaveBeenCalledTimes(1);
 await act(async()=>pending.reject(Error('offline')));expect(Alert.alert).not.toHaveBeenCalled();expect(mockRefetch).not.toHaveBeenCalled();expect(tree.root.findByType(TextInput)).toBe(input);expect(input.props.value).toBe('Cedar');expect(button('Add Juniper')).toBeUndefined();
});
it.each([
 ['loading','Looking up handle…'],['error','Couldn’t look up that handle.'],['empty','Try a name or handle.'],
] as const)('remeasures %s feedback without replacing input, restarting lookup or changing retry ownership', (state,label)=>{
 result.isFetching=state==='loading';result.isError=state==='error';mount();settle();const input=tree.root.findByType(TextInput),results=tree.root.findByType(PeopleSearchResults),retry=button('Retry handle lookup');let text=leaf(label);
 for(const fontScale of [1,1.35]){scale(fontScale);expect(leaf(label)).not.toBe(text);text=leaf(label);expect(tree.root.findByType(TextInput)).toBe(input);expect(tree.root.findByType(PeopleSearchResults)).toBe(results);expect(input.props.value).toBe('Juniper');expect(button('Retry handle lookup')).toBe(retry);expect(mockRefetch).not.toHaveBeenCalled();}
 if(retry){act(()=>retry.props.onPress());expect(mockRefetch).toHaveBeenCalledTimes(1);}expect(mockSend).not.toHaveBeenCalled();
});
