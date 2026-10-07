jest.mock('@react-navigation/native',()=>({useIsFocused:()=>true}));
import React from 'react';
import { Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SceneDiscovery } from '../SceneDiscovery';
import { EventPoster } from '../EventPoster';
import { CommunityCard } from '../CommunityCard';
import { SceneFilterForm } from '../SceneFilterForm';
const mockPush=jest.fn(),mockRetry=jest.fn();
let mockFailed=false,mockActualCards=false;
let mockDimensions={width:390,height:740,fontScale:1,scale:1};
jest.mock('react-native/Libraries/Utilities/useWindowDimensions',()=>({__esModule:true,default:()=>mockDimensions}));
let mockConnectedEvents:any[]|null=null;
let mockConnectedCommunities:any[]|null=null;
const events=[{id:'music',title:'Beach music',category:'music',venue:'Santa Monica',public_name:'Sunday Table'}, {id:'art',title:'Night gallery',category:'art',public_name:'Studio'}];
const communities=[{id:'table',name:'Sunday Table',description:'Shared dinners'}, {id:'sunset',name:'Sunset Club',description:'Time outside'}];
jest.mock('../../../constants/FeatureFlags',()=>({CREATOR_PAGES_ENABLED:true}));
jest.mock('../../../hooks/usePublicPageScope',()=>({usePublicPageScope:()=>({scope:{userId:'member',isCurrent:()=>true},account:{viewerId:'member',epoch:1}})}));
jest.mock('expo-router',()=>({useRouter:()=>({push:mockPush})}));
jest.mock('@tanstack/react-query',()=>({useQuery:(q:any)=>({data:q.queryKey[0]==='scene-events'?(mockConnectedEvents??events):q.queryKey[0]==='scene-communities'?(mockConnectedCommunities??communities):new Map(),isPending:false,isError:mockFailed,error:mockFailed?Error('Offline'):null,refetch:mockRetry,isRefetching:false})}));
jest.mock('../../ProfileButton',()=>()=>null);
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View,SafeAreaProvider:require('react-native').View,initialWindowMetrics:null}));
jest.mock('../EventPoster',()=>({EventPoster:(props:any)=>mockActualCards?require('react').createElement(jest.requireActual('../EventPoster').EventPoster,props):null}));
jest.mock('../CommunityCard',()=>({CommunityCard:()=>null}));
let tree:ReactTestRenderer;
const input=(kind:string)=>tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel===`Search ${kind}`)!;
const press=(label:string)=>act(()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===label)!.props.onPress());
const type=(kind:string,text:string)=>act(()=>input(kind).props.onChangeText(text));
const submit=(kind:string)=>act(()=>input(kind).props.onSubmitEditing());
beforeEach(()=>{mockFailed=false;mockActualCards=false;mockConnectedEvents=null;mockConnectedCommunities=null;mockDimensions={width:390,height:740,fontScale:1,scale:1};jest.clearAllMocks();act(()=>{tree=create(<SceneDiscovery communitiesEnabled/>);});press('events');});
afterEach(()=>act(()=>tree.unmount()));
it('applies submitted query only, retaining selected category and exact event route',()=>{
  press('Category: music');type('events','gallery');
  expect(tree.root.findAllByType(EventPoster).map(n=>n.props.event.id)).toEqual(['music']);
  submit('events');expect(tree.root.findAllByType(EventPoster)).toHaveLength(0);
  expect(tree.root.findAllByType(Text).map(node=>node.props.children)).not.toContain('No upcoming events yet.');
  press('Clear events search');expect(tree.root.findAllByType(EventPoster).map(n=>n.props.event.id)).toEqual(['music']);
  act(()=>tree.root.findByType(EventPoster).props.onPress());expect(mockPush).toHaveBeenCalledWith('/event/music');
});
it('keeps each tab’s applied results and unfinished search draft independent',()=>{
  type('events','music');submit('events');type('events','not submitted');press('communities');
  type('communities','outside');submit('communities');type('communities','another draft');press('events');
  expect(input('events').props.value).toBe('not submitted');
  expect(tree.root.findAllByType(EventPoster).map(n=>n.props.event.id)).toEqual(['music']);
  press('communities');expect(input('communities').props.value).toBe('another draft');
  expect(tree.root.findAllByType(CommunityCard).map(n=>n.props.community.id)).toEqual(['sunset']);
});
it('clears empty event results and its category without altering the community draft',()=>{
  press('communities');type('communities','dinners');press('events');press('Category: art');type('events','no match');submit('events');
  press('Clear event filters');expect(input('events').props.value).toBe('');expect(tree.root.findAllByType(EventPoster)).toHaveLength(2);
  press('communities');expect(input('communities').props.value).toBe('dinners');
});
it('retains loaded cards through refresh errors without an application invitation',()=>{
  mockFailed=true;act(()=>tree.update(<SceneDiscovery communitiesEnabled/>));
  expect(tree.root.findAllByType(EventPoster)).toHaveLength(2);
  expect(tree.root.findAllByType(Text).some(n=>n.props.children==='Start a community or organization')).toBe(false);
  press('try again');expect(mockRetry).toHaveBeenCalledTimes(1);
});
it('opens filters from applied values, preserves an unfinished query on Cancel, and keeps area when clearing search',()=>{
  type('events','unfinished');press('Filter events');
  expect(tree.root.findByType(SceneFilterForm).props.applied.query).toBe('');
  act(()=>tree.root.findByType(SceneFilterForm).props.onCancel());expect(input('events').props.value).toBe('unfinished');
  press('Filter events');act(()=>tree.root.findByType(SceneFilterForm).props.onApply({query:'music',area:'Santa Monica',from:'',through:''}));
  expect(input('events').props.value).toBe('music');expect(tree.root.findAllByType(EventPoster).map(n=>n.props.event.id)).toEqual(['music']);
  press('Clear events search');expect(tree.root.findAllByType(EventPoster).map(n=>n.props.event.id)).toEqual(['music']);
  press('Filter events, 1 active');expect(tree.root.findByType(SceneFilterForm).props.applied.area).toBe('Santa Monica');
});

it('opens the existing application selector from the footer invitation',()=>{
  press('communities');press('Apply to be part of Scene');expect(mockPush).toHaveBeenCalledWith('/creator/apply');
});


const connectedEvents = [
  {id:'coast',title:'Sunday coastal walk',category:'community',categories:['community','outdoors'],community_id:'table',venue:'Santa Monica',event_date:'2026-10-03',public_name:'Sunday Table'},
  {id:'fitness',title:'Morning movement',category:'fitness',venue:'Venice',event_date:'2026-10-04'},
  {id:'business',title:'Meet your next collaborator',category:'community',categories:['community','business & networking'],community_id:'table',venue:'Santa Monica',event_date:'2026-10-05'},
  {id:'fun',title:'An afternoon with no agenda',category:'community',categories:['community','just for fun'],community_id:'table',venue:'Santa Monica',event_date:'2026-10-06'},
  {id:'other',title:'Bring your curious side',category:'other',venue:'Venice',event_date:'2026-10-07'},
  {id:'legacy',title:'Older outdoor gathering',category:'Fitness and Outdoors',venue:'Long Beach',event_date:'2026-10-08'},
];
const filterInput=(label:string,value:string)=>act(()=>tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel===label)!.props.onChangeText(value));
function connectCards(){mockActualCards=true;mockConnectedEvents=connectedEvents;act(()=>tree.update(<SceneDiscovery communitiesEnabled/>));}
it('connected categories retain the second-category selection through the real filter form and exact event-card return',()=>{
 connectCards();press('Category: outdoors');press('Filter events');filterInput('City or area','Santa Monica');press('Show events');
 const cards=tree.root.findAllByType(EventPoster);expect(cards.map(n=>n.props.event.id)).toEqual(['coast']);
 const actualCard=tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel?.startsWith('Sunday coastal walk,'))!;
 expect(actualCard).toBeDefined();act(()=>actualCard.props.onPress());expect(mockPush).toHaveBeenCalledWith('/event/coast');
 act(()=>tree.update(<SceneDiscovery communitiesEnabled/>));
 expect(tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Category: outdoors')!.props.accessibilityState.selected).toBe(true);
 press('Filter events, 1 active');expect(tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel==='City or area')!.props.value).toBe('Santa Monica');
 filterInput('City or area','Venice');press('Cancel filters');expect(tree.root.findAllByType(EventPoster).map(n=>n.props.event.id)).toEqual(['coast']);
});
it('connected added category choices expose real cards and keep legacy Fitness and Outdoors discoverable',()=>{
 connectCards();
 for(const [category,ids] of [['fitness',['fitness','legacy']],['outdoors',['coast','legacy']],['business & networking',['business']],['just for fun',['fun']],['other',['other']]] as const){
  press(`Category: ${category}`);expect(tree.root.findAllByType(EventPoster).map(n=>n.props.event.id)).toEqual(ids);
  expect(tree.root.findAllByType(TouchableOpacity).filter(n=>n.props.accessibilityLabel?.includes(',')&&n.props.accessibilityLabel?.startsWith(connectedEvents.find(e=>e.id===ids[0])!.title))).toHaveLength(1);
 }
});
it('connected filter Clear resets form constraints on apply while keeping the visible category axis',()=>{
 connectCards();press('Category: business & networking');press('Filter events');filterInput('City or area','Venice');press('Show events');
 expect(tree.root.findAllByType(EventPoster)).toHaveLength(0);expect(tree.root.findAllByType(Text).some(n=>typeof n.props.children==='string'&&n.props.children.includes('Try another search or clear your filters'))).toBe(true);
 press('Filter events, 1 active');press('Clear filter draft');press('Cancel filters');expect(tree.root.findAllByType(EventPoster)).toHaveLength(0);
 press('Filter events, 1 active');press('Clear filter draft');press('Show events');expect(tree.root.findAllByType(EventPoster).map(n=>n.props.event.id)).toEqual(['business']);
 press('Category: all');expect(tree.root.findAllByType(EventPoster)).toHaveLength(connectedEvents.length);
});
it('connected category refresh failure keeps cached cards and separates errors from empty results',()=>{
 connectCards();press('Category: just for fun');mockFailed=true;act(()=>tree.update(<SceneDiscovery communitiesEnabled/>));
 expect(tree.root.findAllByType(EventPoster).map(n=>n.props.event.id)).toEqual(['fun']);expect(tree.root.findAllByType(Text).some(n=>typeof n.props.children==='string'&&n.props.children.includes('Try another search or clear your filters'))).toBe(false);
 press('try again');expect(mockRetry).toHaveBeenCalledTimes(1);
});

it('connected event cards use full-width layouts on narrow screens and enlarged text',()=>{
 connectCards();
 for(const [width,fontScale,cardWidth] of [[390,1,169],[320,1,280],[390,1.35,350]]){
  mockDimensions={width,height:740,fontScale,scale:1};act(()=>tree.update(<SceneDiscovery communitiesEnabled/>));
  expect(tree.root.findAllByType(EventPoster).every(n=>n.props.width===cardWidth)).toBe(true);
 }
 press('Category: business & networking');press('Filter events');
 filterInput('City or area','Santa Monica');press('Show events');
 expect(tree.root.findAllByType(EventPoster).map(n=>n.props.event.id)).toEqual(['business']);
});


it('Community filter choices come from every eligible row before local search and combine category with area',()=>{
 mockConnectedCommunities=[
  {id:'books',name:'Reading Rainbows',description:'Meet over books',categories:['Books','Outdoors'],discovery_area:'Santa Monica'},
  {id:'sunset',name:'Sunset Club',description:'A good evening',categories:['Outdoors'],discovery_area:'Many places around LA'},
  {id:'legacy',name:'Our old community',description:'No classification yet'},
 ];
 act(()=>tree.update(<SceneDiscovery communitiesEnabled/>));press('communities');
 expect(tree.root.findAllByType(CommunityCard)).toHaveLength(3);
 type('communities','Reading');submit('communities');type('communities','an unfinished name');
 press('Filter communities, 1 active');
 expect(tree.root.findByType(SceneFilterForm).props.communityOptions).toEqual({categories:['Books','Outdoors'],areas:['Many places around LA','Santa Monica']});
 press('Community category: Outdoors');press('Community area: Santa Monica');press('Show communities');
 expect(tree.root.findAllByType(CommunityCard).map(node=>node.props.community.id)).toEqual(['books']);
 expect(input('communities').props.value).toBe('an unfinished name');
 act(()=>tree.root.findByType(CommunityCard).props.onPress());expect(mockPush).toHaveBeenCalledWith('/community/books');
 press('Filter communities, 3 active');
 expect(tree.root.findByType(SceneFilterForm).props.communityOptions.areas).toEqual(['Many places around LA','Santa Monica']);
 press('Community area: Many places around LA');press('Cancel filters');
 expect(tree.root.findAllByType(CommunityCard).map(node=>node.props.community.id)).toEqual(['books']);
 press('Filter communities, 3 active');press('Clear filter draft');press('Show communities');
 expect(tree.root.findAllByType(CommunityCard).map(node=>node.props.community.id)).toEqual(['books']);
 press('Clear communities search');expect(tree.root.findAllByType(CommunityCard)).toHaveLength(3);
});


it.each(['communities','events'] as const)('places one application footer after every %s card, with no redundant recruit entry',kind=>{
 press(kind);
 const Card=kind==='communities'?CommunityCard:EventPoster;
 const scroller=tree.root.findAllByType(ScrollView).find(node=>node.props.refreshControl&&node.findAllByType(Card as any).length>0)!;
 const order=scroller.findAll(node=>node.type===Card||(node.type===Text&&node.props.children==='Start a community or organization'));
 expect(order.filter(node=>node.type===Card)).toHaveLength(2);
 expect(order.at(-1)!.props.children).toBe('Start a community or organization');
 expect(scroller.findAllByType(TouchableOpacity).filter(node=>node.props.accessibilityLabel==='Apply to be part of Scene')).toHaveLength(1);
 expect(scroller.findAllByType(TouchableOpacity).some(node=>node.props.accessibilityLabel==='Open creator space')).toBe(false);
});
