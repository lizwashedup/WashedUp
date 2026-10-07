import React from 'react';import {act,create,type ReactTestRenderer} from 'react-test-renderer';import {TouchableOpacity,Text} from 'react-native';
const mockAppListeners=new Set<(value:string)=>void>();let mockAppState='active';
jest.mock('react-native',()=>new Proxy(jest.requireActual('react-native'),{get:(target,key)=>key==='AppState'?{get currentState(){return mockAppState;},addEventListener:(_:string,fn:(v:string)=>void)=>{mockAppListeners?.add(fn);return{remove:()=>mockAppListeners?.delete(fn)};}}:Reflect.get(target,key)}));
const mockList=jest.fn(),mockDelete=jest.fn(),mockLegacyDelete=jest.fn(),mockPush=jest.fn();let mockPages=true,mockCurrent=true;const mockScope={userId:'0e6e1827-0f87-4e03-b42b-7ade8219725b',isCurrent:()=>mockCurrent};
const mockOrdinary={id:'0fd00000-0000-4000-8000-000000000003',name:'Ordinary story',fields:{image_url:''},community_id:null,created_at:'2026-09-15T01:00:00Z'};
jest.mock('../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:()=>({scope:mockScope,account:{isLoading:false,error:null}})}));
jest.mock('../../../lib/creatorPageEventTemplateLibrary',()=>({...jest.requireActual('../../../lib/creatorPageEventTemplateLibrary'),listCreatorEventTemplates:(...a:unknown[])=>mockList(...a),deleteCreatorEventTemplate:(...a:unknown[])=>mockDelete(...a)}));
jest.mock('../../../lib/creatorEvents',()=>({listEventTemplates:jest.fn(),deleteEventTemplate:(...a:unknown[])=>mockLegacyDelete(...a)}));
jest.mock('../../../lib/creatorMode',()=>({getCreatorAccess:async()=>({}),getCreatorEvents:async()=>[]}));
jest.mock('../../../lib/workspaceContext',()=>({useWorkspace:()=> 'individual',eventBelongsToWorkspace:()=>true}));
jest.mock('../../../lib/selectedCommunity',()=>({useLedCommunity:()=>null}));
jest.mock('../../../components/creator/WorkspaceSwitcher',()=>({WorkspaceSwitcher:()=>null}));
jest.mock('../../../components/creator/CommunitySwitcher',()=>({CommunitySwitcher:()=>null}));
jest.mock('../../../components/events/EventMediaImage',()=>({EventMediaImage:(props:any)=>require('react').createElement(require('react-native').View,props)}));
jest.mock('../../../lib/supabase',()=>({supabase:{}}));
jest.mock('../../../lib/haptics',()=>({hapticLight:()=>{}}));
jest.mock('../../../constants/FeatureFlags',()=>({get CREATOR_PAGES_ENABLED(){return mockPages;},EVENT_SUMMARY_ENABLED:true}));
jest.mock('expo-router',()=>({useRouter:()=>({push:(...a:unknown[])=>mockPush(...a)})}));
jest.mock('@tanstack/react-query',()=>({useQuery:({queryKey}:any)=>({data:queryKey[0]==='creator-access'?{}:queryKey[0]==='event-templates'?[mockOrdinary]:[],refetch:async()=>{},isRefetching:false}),useQueryClient:()=>({invalidateQueries:async()=>{}}),useMutation:(config:any)=>({mutate:(value:any)=>config.mutationFn(value),isPending:false,isError:false})}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('expo-image',()=>({Image:require('react-native').View}));
jest.mock('lucide-react-native',()=>({Plus:()=>null,X:()=>null}));
import CreatorEventsScreen from '../events';
const page='f5d7644a-2ff5-4def-b0ab-d04b8250892b',event='0fd00000-0000-4000-8000-000000000001',id='0fd00000-0000-4000-8000-000000000004';
const pageTemplate={...mockOrdinary,id,name:'Private page story',user_id:mockScope.userId,source_page_id:page,source_event_id:event,source_updated_at:'2026-09-15T01:00:00Z',fields:{image_url:`creator-event-media:${event}/cover.jpg`}};
let tree:ReactTestRenderer;async function flush(){for(let i=0;i<6;i++)await act(async()=>{await Promise.resolve();});}
async function mount(){await act(async()=>{tree=create(<CreatorEventsScreen/>);});await flush();const tab=tree.root.findAllByType(TouchableOpacity).find(n=>n.findAllByType(Text).some(t=>t.props.children==='Templates'))!;act(()=>tab.props.onPress());await flush();}
beforeEach(()=>{jest.clearAllMocks();mockPages=true;mockCurrent=true;mockAppState='active';mockAppListeners.clear();mockList.mockResolvedValue([pageTemplate,{...mockOrdinary,user_id:mockScope.userId,source_page_id:null,source_event_id:null,source_updated_at:null}]);mockDelete.mockResolvedValue(undefined);});
afterEach(()=>act(()=>tree?.unmount()));
it('page templates open source-aware private-draft preparation while ordinary templates keep their route',async()=>{await mount();act(()=>tree.root.findByProps({accessibilityLabel:'Private page story'}).props.onPress());expect(mockPush).toHaveBeenLastCalledWith(`/creator/page-event-reuse?pageId=${page}&sourceEventId=${event}&templateId=${id}`);act(()=>tree.root.findByProps({accessibilityLabel:'Ordinary story'}).props.onPress());expect(mockPush).toHaveBeenLastCalledWith(`/creator/event-form?templateId=${mockOrdinary.id}`);});
it('protected library artwork receives the source event identity',async()=>{await mount();const media=require('../../../components/events/EventMediaImage').EventMediaImage;expect(tree.root.findByType(media).props.eventId).toBe(event);});
it('unknown library access shows recovery instead of an empty-state claim or stale templates',async()=>{mockList.mockRejectedValue(Error('Offline'));await mount();expect(tree.root.findAllByType(Text).map(t=>t.props.children)).not.toContain('Private page story');expect(tree.root.findByProps({accessibilityLabel:'Check template library'})).toBeTruthy();});
it('retiring the account hides page templates and invalidates retained navigation callbacks',async()=>{await mount();const open=tree.root.findByProps({accessibilityLabel:'Private page story'}).props.onPress;mockCurrent=false;act(()=>tree.update(<CreatorEventsScreen/>));act(()=>open());expect(mockPush).not.toHaveBeenCalled();expect(tree.root.findAllByType(Text).map(t=>t.props.children)).not.toContain('Private page story');});
it('deleting a page template uses its current account and source-aware delete service',async()=>{await mount();await act(async()=>{await tree.root.findByProps({accessibilityLabel:'Delete template: Private page story'}).props.onPress();});expect(mockDelete).toHaveBeenCalledWith(pageTemplate,expect.objectContaining({userId:mockScope.userId}));expect(mockLegacyDelete).not.toHaveBeenCalled();});
it('the feature-off library preserves its original reader and template route',async()=>{mockPages=false;await mount();expect(mockList).not.toHaveBeenCalled();act(()=>tree.root.findByProps({accessibilityLabel:'Ordinary story'}).props.onPress());expect(mockPush).toHaveBeenCalledWith(`/creator/event-form?templateId=${mockOrdinary.id}`);});

it('returning from the background reloads permissions and retires prior template callbacks',async()=>{await mount();const open=tree.root.findByProps({accessibilityLabel:'Private page story'}).props.onPress;act(()=>{mockAppState='background';mockAppListeners.forEach(fn=>fn('background'));});mockList.mockResolvedValue([]);act(()=>{mockAppState='active';mockAppListeners.forEach(fn=>fn('active'));open();});await flush();expect(mockPush).not.toHaveBeenCalled();expect(mockList).toHaveBeenCalledTimes(2);expect(tree.root.findAllByType(Text).map(t=>t.props.children)).not.toContain('Private page story');});
