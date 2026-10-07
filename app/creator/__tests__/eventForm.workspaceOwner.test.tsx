import React from 'react';import {act,create,type ReactTestRenderer} from 'react-test-renderer';import {TextInput,TouchableOpacity,Text} from 'react-native';
let mockEntryProps:any, mockRouteParams:Record<string,string>|undefined,mockPagesEnabled=true;
const mockPageId='f5d7644a-2ff5-4def-b0ab-d04b8250892b',mockEventId='0f860000-0000-4000-8000-000000000001',mockUser='0e6e1827-0f87-4e03-b42b-7ade8219725b';
let mockAccess:any=null,mockSource:any=null,mockSourceTemplate:any=null;const mockCreate=jest.fn();
const mockStorageRemove=jest.fn(),mockLegacyRead=jest.fn();
const mockTemplateSave=jest.fn(),mockTemplateRead=jest.fn(),mockLegacyTemplate=jest.fn();let mockTemplate:any=null;
const mockPoster=jest.fn();let mockTeamEntry=false;const mockPush=jest.fn(),mockReplace=jest.fn(),mockDismissTo=jest.fn(),mockCanGoBack=jest.fn();
let mockEventStatus='Draft';let mockStatusReceipt:any=null;const mockStatusWrite=jest.fn(),mockStatusRead=jest.fn(),mockRefundAccess=jest.fn(),mockRefund=jest.fn();
let mockCurrent=true;let mockAlert:any;const mockReadiness=jest.fn(),mockPayout=jest.fn(),mockTiers=jest.fn();
const mockScope={userId:mockUser,isCurrent:()=>mockCurrent},mockBack=jest.fn(),mockPublish=jest.fn(),mockLegacyUpdate=jest.fn(),mockSave=jest.fn(),mockStateRead=jest.fn(),mockAttemptRead=jest.fn(),mockStorage=new Map<string,string>();let mockCounter=0;
jest.mock('expo-router',()=>({useRouter:()=>({back:mockBack,push:mockPush,replace:mockReplace,dismissTo:mockDismissTo,canGoBack:mockCanGoBack}),useLocalSearchParams:()=>mockRouteParams??({pageId:mockPageId,id:mockEventId,team:mockTeamEntry?'1':undefined}),useFocusEffect:(fn:()=>void)=>require('react').useEffect(fn,[fn]),Stack:{Screen:()=>null},Redirect:()=>null}));
jest.mock('@react-navigation/native',()=>({useIsFocused:()=>true}));
jest.mock('@tanstack/react-query',()=>({useQuery:(q:any)=>({data:q.queryKey[0]==='creator-access'?mockAccess:q.queryKey[0]==='operator-event'?mockSource:q.queryKey[0]==='event-template'?mockSourceTemplate:undefined}),useQueryClient:()=>({invalidateQueries:async()=>{}})}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('expo-image',()=>({Image:require('react-native').View}));
jest.mock('lucide-react-native',()=>({ArrowLeft:()=>null,Check:()=>null,Plus:()=>null,ChevronRight:()=>null}));
jest.mock('../../../components/ProfileButton',()=>({__esModule:true,default:()=>null}));
jest.mock('../../../components/BrandedAlert',()=>({BrandedAlert:(props:any)=>{mockAlert=props;return null;}}));
jest.mock('../../../components/keyboard/KeyboardDoneBar',()=>({KEYBOARD_DONE_ACCESSORY_ID:'done'}));
jest.mock('../../../components/creator/DescriptionBlocksEditor',()=>({DescriptionBlocksEditor:()=>null}));
jest.mock('../../../components/composer/EditorialTitleField',()=>({__esModule:true,default:(p:any)=>require('react').createElement(require('react-native').TextInput,p)}));
jest.mock('../../../components/composer/CollapsibleCalendar',()=>({__esModule:true,default:()=>null}));
jest.mock('../../../components/composer/TimePicker',()=>({__esModule:true,default:()=>null}));
jest.mock('../../../components/creator/EventPlaceSearch',()=>({__esModule:true,default:()=>null}));
jest.mock('../../../components/creator/EventLocationMap',()=>({EventLocationMap:()=>null}));
jest.mock('../../../lib/haptics',()=>({hapticLight:()=>{},hapticSuccess:()=>{}}));
jest.mock('../../../lib/creatorMode',()=>({getCreatorAccess:async()=>null,canManageEvents:()=>true,creatorLandingRoute:()=>'/'}));
jest.mock('../../../constants/FeatureFlags',()=>({get CREATOR_PAGES_ENABLED(){return mockPagesEnabled;},CO_CREATOR_INVITES_ENABLED:true}));
jest.mock('../../../lib/selectedCommunity',()=>({useLedCommunity:()=>mockAccess?.ledCommunities[0]??null}));
jest.mock('../../../lib/supabase',()=>({supabase:{auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe:()=>{}}}}),getUser:async()=>({data:{user:{id:mockUser}},error:null})}}}));
jest.mock('../../../lib/ticketing',()=>({getTiers:()=>mockTiers(),getMyPayoutState:(...a:unknown[])=>mockPayout(...a),isPayoutReady:()=>true,getRefundAccess:(...a:unknown[])=>mockRefundAccess(...a),refundLiveOrdersOnCancel:(...a:unknown[])=>mockRefund(...a)}));
jest.mock('../../../lib/creatorEvents',()=>({createOperatorEvent:(...a:unknown[])=>mockCreate(...a),pickAndUploadEventImage:(...a:unknown[])=>mockPoster(...a),EVENT_CATEGORIES:['Social'],saveEventTemplate:(...a:unknown[])=>mockLegacyTemplate(...a),getOperatorEvent:(...a:unknown[])=>mockLegacyRead(...a),updateOperatorEvent:(...a:unknown[])=>mockLegacyUpdate(...a),probeConfirmationMessage:async()=>({open:false,value:null}),probeOfferType:async()=>({open:false,value:null}),probeTicketCapacityRpc:async()=>false}));
jest.mock('../../../lib/creatorPageReview',()=>({CreatorPageScopeExpired:class extends Error{},publishCreatorPageEvent:(...a:unknown[])=>mockPublish(...a)}));
jest.mock('../../../components/creator/pages/CreatorPageEventGate',()=>({__esModule:true,default:({children}:any)=>children({pageId:mockPageId,name:'Page',ownerId:mockUser,kind:'organization',isPublished:true,entry:mockTeamEntry?'team':'owner'},mockScope,{id:mockEventId,title:'Earlier gate content',status:mockEventStatus,community_id:null})}));
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{getItem:async(k:string)=>mockStorage.get(k)??null,setItem:async(k:string,v:string)=>{mockStorage.set(k,v);},removeItem:(k:string)=>mockStorageRemove(k)}}));
jest.mock('expo-crypto',()=>({randomUUID:()=>`0f860000-0000-4000-8000-${String(++mockCounter).padStart(12,'0')}`}));
jest.mock('../../../lib/creatorPageEventSave',()=>({...jest.requireActual('../../../lib/creatorPageEventSave'),getPageEventSaveState:(...a:unknown[])=>mockStateRead(...a),getPageEventSaveAttempt:(...a:unknown[])=>mockAttemptRead(...a),savePageEvent:(...a:unknown[])=>mockSave(...a)}));
jest.mock('../../../lib/creatorPageEventReadiness',()=>({...jest.requireActual('../../../lib/creatorPageEventReadiness'),loadCreatorPageEventReadiness:(...a:unknown[])=>mockReadiness(...a)}));
jest.mock('../../../lib/creatorPageEventStatus',()=>({...jest.requireActual('../../../lib/creatorPageEventStatus'),setPageEventStatus:(...a:unknown[])=>mockStatusWrite(...a),getPageEventStatusAttempt:(...a:unknown[])=>mockStatusRead(...a)}));
import {pageEventPublishGuidance,type PageEventPublishReason} from '../../../lib/creatorPageEventReadiness';
jest.mock('../../../lib/creatorPageEventTemplate',()=>({getPageEventTemplate:(...a:unknown[])=>mockTemplateRead(...a),savePageEventTemplate:(...a:unknown[])=>mockTemplateSave(...a)}));
jest.mock('../../../components/creator/pages/CreatorEventEntryGate',()=>({__esModule:true,default:(props:any)=>{mockEntryProps=props;return null;}}));
import EventForm from '../event-form';
const fields={title:'Atomic snapshot title',description:'Full story',image_url:'',event_date:'2027-01-10',start_time:'2027-01-10T20:00:00Z',end_time:'2027-01-10T21:00:00Z',venue:'LA',venue_address:'Venue',category:'Social',external_url:'',ticket_price:'',public_name:'Page',pin_to_chat:true,description_blocks:[{type:'text',content:'Keep story'}],confirmation_message:'Welcome'};
let saved:any,receipt:any,tree:ReactTestRenderer;
async function settle(){for(let i=0;i<5;i++)await act(async()=>{await Promise.resolve();});}
async function mount(){await act(async()=>{tree=create(<EventForm/>);});await settle();}
async function advance(){await act(async()=>{jest.advanceTimersByTime(1600);});await settle();}
const button=(label:string)=>tree.root.findAllByType(TouchableOpacity).find(n=>n.findAllByType(Text).some(t=>(Array.isArray(t.props.children)?t.props.children.join(''):t.props.children)===label));
beforeEach(()=>{jest.clearAllMocks();mockStateRead.mockReset();mockLegacyRead.mockReset();mockLegacyRead.mockImplementation(async()=>({...saved,id:mockEventId}));mockStorageRemove.mockImplementation(async(k:string)=>{mockStorage.delete(k);});mockRouteParams={};mockCreate.mockResolvedValue(mockEventId);mockAccess=null;mockSource=null;mockSourceTemplate=null;mockEntryProps=undefined;mockPagesEnabled=true;mockTemplate=null;mockTemplateRead.mockImplementation(async()=>mockTemplate);mockTemplateSave.mockImplementation(async a=>{mockTemplate={id:a.templateId,userId:mockUser,sourcePageId:a.pageId,sourceEventId:a.eventId,sourceUpdatedAt:a.expectedUpdatedAt,name:a.name,fields:{...saved.fields,event_date:'',start_time:null,end_time:null}};return mockTemplate;});mockTeamEntry=false;mockCanGoBack.mockReturnValue(true);mockEventStatus='Draft';mockStatusReceipt=null;mockStatusRead.mockImplementation(async()=>mockStatusReceipt);mockStatusWrite.mockImplementation(async(p,e,r,input)=>{mockStatusReceipt={pageId:p,eventId:e,requestId:r,userId:mockUser,...input,updatedAt:'2026-09-15T03:00:00Z'};saved={...saved,status:input.status,updatedAt:mockStatusReceipt.updatedAt};return mockStatusReceipt;});mockRefundAccess.mockResolvedValue({isOwner:true,isDelegate:false,canRefund:true});mockRefund.mockImplementation(async(_id,options)=>{await options?.beforeEach?.();return {refundedCount:0,failedCount:0};});mockReadiness.mockReset();mockCurrent=true;mockTiers.mockResolvedValue([]);mockPayout.mockResolvedValue(null);mockReadiness.mockResolvedValue({publishReady:true,publishReason:null,canManageTickets:true});jest.useFakeTimers();mockStorage.clear();mockCounter=0;receipt=null;saved={pageId:mockPageId,eventId:mockEventId,fields,updatedAt:'2026-09-15T01:00:00Z',status:'Draft',offerType:'free_event',ticketCapacity:null,latitude:null,longitude:null,canManageTickets:true};mockStateRead.mockImplementation(async()=>saved);mockAttemptRead.mockImplementation(async()=>receipt);mockSave.mockImplementation(async(_p,_e,id,input)=>{receipt={...saved,...input,updatedAt:`2026-09-15T01:01:${String(mockCounter).padStart(2,'0')}Z`,requestId:id,userId:mockUser};saved=receipt;return receipt;});});
afterEach(()=>{act(()=>tree?.unmount());jest.useRealTimers();});

import { setWorkspace } from '../../../lib/workspaceContext';
const community={id:'community-id',name:'Sunday Table',handle:'sunday',role:'leader',status:'active'};
it.each([
 ['community-only','community',true,false,[community],'community-id'],
 ['organization-only','organization',false,true,[],null],
 ['both-organization','organization',true,true,[community],null],
 ['both-community','community',true,true,[community],'community-id'],
] as const)('new private event retains the selected %s workspace ownership',async(_label,workspace,leader,organizer,led,expected)=>{
 mockAccess={hasLeaderGrant:leader,hasEventHostGrant:organizer,ledCommunities:[...led],isRevoked:false};setWorkspace(workspace);await mount();
 act(()=>tree.root.findAllByType(TextInput).find(n=>n.props.placeholder==='sunset rooftop social')!.props.onChangeText('Selected workspace event'));
 act(()=>tree.root.findAll(n=>n.props.accessibilityLabel==='Category: music'&&typeof n.props.onPress==='function')[0].props.onPress());
 await act(async()=>{await button('save it as a draft')!.props.onPress();});
 expect(mockCreate).toHaveBeenCalledTimes(1);expect(mockCreate.mock.calls[0][1]).toBe(expected);expect(mockCreate.mock.calls[0][2]).toBe(false);expect(mockBack).toHaveBeenCalledTimes(1);
});

it.each(['duplicate','template'] as const)('keeps stored %s community ownership even when Organization is selected',async kind=>{
 mockPagesEnabled=false;mockAccess={hasLeaderGrant:true,hasEventHostGrant:true,ledCommunities:[community],isRevoked:false};setWorkspace('organization');
 mockRouteParams=kind==='duplicate'?{duplicateFrom:mockEventId}:{templateId:'template'};mockSource={...fields,id:mockEventId,status:'Draft',community_id:community.id};mockSourceTemplate={fields,community_id:community.id};await mount();
 await act(async()=>{await button('save it as a draft')!.props.onPress();});expect(mockCreate).toHaveBeenCalledTimes(1);expect(mockCreate.mock.calls[0][1]).toBe(community.id);
});
it.each(['duplicate','template'] as const)('keeps stored %s organization ownership even when Community is selected',async kind=>{
 mockPagesEnabled=false;mockAccess={hasLeaderGrant:true,hasEventHostGrant:true,ledCommunities:[community],isRevoked:false};setWorkspace('community');
 mockRouteParams=kind==='duplicate'?{duplicateFrom:mockEventId}:{templateId:'template'};mockSource={...fields,id:mockEventId,status:'Draft',community_id:null};mockSourceTemplate={fields,community_id:null};await mount();
 await act(async()=>{await button('save it as a draft')!.props.onPress();});expect(mockCreate).toHaveBeenCalledTimes(1);expect(mockCreate.mock.calls[0][1]).toBeNull();
});
it('retains an explicit ownership choice through subsequent renders',async()=>{
 mockAccess={hasLeaderGrant:true,hasEventHostGrant:true,ledCommunities:[community],isRevoked:false};setWorkspace('organization');await mount();
 act(()=>button('from Sunday Table')!.props.onPress());act(()=>tree.root.findAllByType(TextInput).find(n=>n.props.placeholder==='sunset rooftop social')!.props.onChangeText('Explicit community event'));
 await act(async()=>{await button('save it as a draft')!.props.onPress();});expect(mockCreate.mock.calls[0][1]).toBe(community.id);
});
