import React from 'react';import {act,create,type ReactTestRenderer} from 'react-test-renderer';import {TextInput,TouchableOpacity,Text} from 'react-native';
let mockEntryProps:any, mockRouteParams:Record<string,string>|undefined,mockPagesEnabled=true;
const mockPageId='f5d7644a-2ff5-4def-b0ab-d04b8250892b',mockEventId='0f860000-0000-4000-8000-000000000001',mockUser='0e6e1827-0f87-4e03-b42b-7ade8219725b';
const mockStorageRemove=jest.fn(),mockLegacyRead=jest.fn();
const mockTemplateSave=jest.fn(),mockTemplateRead=jest.fn(),mockLegacyTemplate=jest.fn();let mockTemplate:any=null;
const mockPoster=jest.fn();let mockTeamEntry=false;const mockPush=jest.fn(),mockReplace=jest.fn(),mockDismissTo=jest.fn(),mockCanGoBack=jest.fn();
let mockEventStatus='Draft';let mockStatusReceipt:any=null;const mockStatusWrite=jest.fn(),mockStatusRead=jest.fn(),mockRefundAccess=jest.fn(),mockRefund=jest.fn();
let mockCurrent=true;let mockAlert:any;const mockReadiness=jest.fn(),mockPayout=jest.fn(),mockTiers=jest.fn();
const mockScope={userId:mockUser,isCurrent:()=>mockCurrent},mockBack=jest.fn(),mockPublish=jest.fn(),mockLegacyUpdate=jest.fn(),mockSave=jest.fn(),mockStateRead=jest.fn(),mockAttemptRead=jest.fn(),mockStorage=new Map<string,string>();let mockCounter=0;
jest.mock('expo-router',()=>({useRouter:()=>({back:mockBack,push:mockPush,replace:mockReplace,dismissTo:mockDismissTo,canGoBack:mockCanGoBack}),useLocalSearchParams:()=>mockRouteParams??({pageId:mockPageId,id:mockEventId,team:mockTeamEntry?'1':undefined}),useFocusEffect:(fn:()=>void)=>require('react').useEffect(fn,[fn]),Stack:{Screen:()=>null},Redirect:()=>null}));
jest.mock('@react-navigation/native',()=>({useIsFocused:()=>true}));
jest.mock('@tanstack/react-query',()=>({useQuery:()=>({data:undefined}),useQueryClient:()=>({invalidateQueries:async()=>{}})}));
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
jest.mock('../../../lib/selectedCommunity',()=>({useLedCommunity:()=>null}));
jest.mock('../../../lib/supabase',()=>({supabase:{auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe:()=>{}}}}),getUser:async()=>({data:{user:{id:mockUser}},error:null})}}}));
jest.mock('../../../lib/ticketing',()=>({getTiers:()=>mockTiers(),getMyPayoutState:(...a:unknown[])=>mockPayout(...a),isPayoutReady:()=>true,getRefundAccess:(...a:unknown[])=>mockRefundAccess(...a),refundLiveOrdersOnCancel:(...a:unknown[])=>mockRefund(...a)}));
jest.mock('../../../lib/creatorEvents',()=>({pickAndUploadEventImage:(...a:unknown[])=>mockPoster(...a),EVENT_CATEGORIES:['Social'],saveEventTemplate:(...a:unknown[])=>mockLegacyTemplate(...a),getOperatorEvent:(...a:unknown[])=>mockLegacyRead(...a),updateOperatorEvent:(...a:unknown[])=>mockLegacyUpdate(...a),probeConfirmationMessage:async()=>({open:true,value:null}),probeOfferType:async()=>({open:true,value:'ticketed_event'}),probeTicketCapacityRpc:async()=>true}));
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
const button=(label:string)=>tree.root.findAllByType(TouchableOpacity).find(n=>n.findAllByType(Text).some(t=>t.props.children===label));
beforeEach(()=>{jest.clearAllMocks();mockStateRead.mockReset();mockLegacyRead.mockReset();mockLegacyRead.mockImplementation(async()=>({...saved,id:mockEventId}));mockStorageRemove.mockImplementation(async(k:string)=>{mockStorage.delete(k);});mockRouteParams=undefined;mockEntryProps=undefined;mockPagesEnabled=true;mockTemplate=null;mockTemplateRead.mockImplementation(async()=>mockTemplate);mockTemplateSave.mockImplementation(async a=>{mockTemplate={id:a.templateId,userId:mockUser,sourcePageId:a.pageId,sourceEventId:a.eventId,sourceUpdatedAt:a.expectedUpdatedAt,name:a.name,fields:{...saved.fields,event_date:'',start_time:null,end_time:null}};return mockTemplate;});mockTeamEntry=false;mockCanGoBack.mockReturnValue(true);mockEventStatus='Draft';mockStatusReceipt=null;mockStatusRead.mockImplementation(async()=>mockStatusReceipt);mockStatusWrite.mockImplementation(async(p,e,r,input)=>{mockStatusReceipt={pageId:p,eventId:e,requestId:r,userId:mockUser,...input,updatedAt:'2026-09-15T03:00:00Z'};saved={...saved,status:input.status,updatedAt:mockStatusReceipt.updatedAt};return mockStatusReceipt;});mockRefundAccess.mockResolvedValue({isOwner:true,isDelegate:false,canRefund:true});mockRefund.mockImplementation(async(_id,options)=>{await options?.beforeEach?.();return {refundedCount:0,failedCount:0};});mockReadiness.mockReset();mockCurrent=true;mockTiers.mockResolvedValue([]);mockPayout.mockResolvedValue(null);mockReadiness.mockResolvedValue({publishReady:true,publishReason:null,canManageTickets:true});jest.useFakeTimers();mockStorage.clear();mockCounter=0;receipt=null;saved={pageId:mockPageId,eventId:mockEventId,fields,updatedAt:'2026-09-15T01:00:00Z',status:'Draft',offerType:'free_event',ticketCapacity:null,latitude:null,longitude:null,canManageTickets:true};mockStateRead.mockImplementation(async()=>saved);mockAttemptRead.mockImplementation(async()=>receipt);mockSave.mockImplementation(async(_p,_e,id,input)=>{receipt={...saved,...input,updatedAt:`2026-09-15T01:01:${String(mockCounter).padStart(2,'0')}Z`,requestId:id,userId:mockUser};saved=receipt;return receipt;});});
afterEach(()=>{act(()=>tree?.unmount());jest.useRealTimers();});
it('seeds editable content and settings from one snapshot without an initial autosave',async()=>{await mount();expect(JSON.stringify(tree.toJSON())).toContain('Atomic snapshot title');expect(JSON.stringify(tree.toJSON())).not.toContain('Earlier gate content');await advance();expect(mockSave).not.toHaveBeenCalled();expect(mockLegacyUpdate).not.toHaveBeenCalled();});
it('capacity-only changes autosave the complete page event without publishing',async()=>{await mount();act(()=>tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel==='Event capacity')!.props.onChangeText('25'));await advance();expect(mockSave).toHaveBeenCalledTimes(1);expect(mockSave.mock.calls[0][3]).toMatchObject({ticketCapacity:25,offerType:'free_event',fields:{title:'Atomic snapshot title',description_blocks:fields.description_blocks,confirmation_message:'Welcome'}});expect(mockPublish).not.toHaveBeenCalled();expect(mockLegacyUpdate).not.toHaveBeenCalled();});
it('explicit keep-draft saves the full event through the same atomic path',async()=>{await mount();expect(button('keep it a draft')!.props.disabled).toBe(false);await act(async()=>{await button('keep it a draft')!.props.onPress();});expect(mockSave).toHaveBeenCalledTimes(1);expect(mockPublish).not.toHaveBeenCalled();expect(mockBack).toHaveBeenCalledTimes(1);});
it('separate explicit publication occurs only after a complete save',async()=>{await mount();mockPublish.mockImplementation(async()=>{expect(mockSave).toHaveBeenCalledTimes(1);return mockEventId;});await act(async()=>{await button('Publish into Scene')!.props.onPress();});expect(mockPublish).toHaveBeenCalledWith({pageId:mockPageId,eventId:mockEventId},expect.objectContaining({userId:mockUser,isCurrent:expect.any(Function)}));expect(mockLegacyUpdate).not.toHaveBeenCalled();});
it('read-only recovery of an interrupted autosave does not schedule that save again',async()=>{await mount();const save=mockSave.getMockImplementation()!;mockSave.mockImplementationOnce(async(...a:any[])=>{await save(...a);throw Error('Response lost');});act(()=>tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel==='Event capacity')!.props.onChangeText('25'));await advance();expect(mockSave).toHaveBeenCalledTimes(1);const check=tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Check complete event save')!;await act(async()=>{await check.props.onPress();});await advance();expect(mockSave).toHaveBeenCalledTimes(1);expect(mockStorage.size).toBe(0);expect(mockPublish).not.toHaveBeenCalled();});
it('an offer-only change reaches autosave with the same saved event content',async()=>{await mount();act(()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='multi-week course')!.props.onPress());await advance();expect(mockSave).toHaveBeenCalledTimes(1);expect(mockSave.mock.calls[0][3]).toMatchObject({offerType:'course',ticketCapacity:null,fields:{title:'Atomic snapshot title'}});expect(mockPublish).not.toHaveBeenCalled();});
it('failed complete save never proceeds to publication or navigation',async()=>{await mount();mockSave.mockRejectedValue(Error('Interrupted'));await act(async()=>{await button('Publish into Scene')!.props.onPress();});expect(mockPublish).not.toHaveBeenCalled();expect(mockBack).not.toHaveBeenCalled();expect(tree.root.findAllByType(TouchableOpacity).some(n=>n.props.accessibilityLabel==='Check complete event save')).toBe(true);expect(tree.root.findAllByType(TouchableOpacity).some(n=>n.props.accessibilityLabel==='Check saved event status')).toBe(false);});
it('clearing the page confirmation sends the existing explicit-clear value',async()=>{await mount();act(()=>tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel==='Event confirmation message')!.props.onChangeText(''));await advance();expect(mockSave.mock.calls[0][3].fields.confirmation_message).toBe('');});

it('checks the financial organizer through saved readiness, without reading the acting account payout',async()=>{
  await mount();
  mockReadiness.mockImplementation(async(...args)=>{expect(args).toEqual([mockPageId,mockEventId,expect.objectContaining({userId:mockUser,isCurrent:expect.any(Function)})]);expect(mockSave).toHaveBeenCalledTimes(1);return {publishReady:true,publishReason:null,canManageTickets:false,hasPaidTiers:true,payoutReady:true};});
  await act(async()=>{await button('Publish into Scene')!.props.onPress();});
  expect(mockPublish).toHaveBeenCalledTimes(1);expect(mockPayout).not.toHaveBeenCalled();
});
it.each(Object.keys(pageEventPublishGuidance) as PageEventPublishReason[])('keeps the saved event private and explains %s',async reason=>{
  await mount();mockReadiness.mockResolvedValue({publishReady:false,publishReason:reason,canManageTickets:false});
  await act(async()=>{await button('Publish into Scene')!.props.onPress();});
  expect(mockSave).toHaveBeenCalledTimes(1);expect(mockPublish).not.toHaveBeenCalled();expect(mockBack).not.toHaveBeenCalled();
  expect(mockAlert).toMatchObject(pageEventPublishGuidance[reason]);expect(mockAlert.buttons.map((b:any)=>b.text)).toEqual(['OK']);
});
it('offers existing ticket setup only when the backend grants ticket management',async()=>{
  await mount();mockReadiness.mockResolvedValue({publishReady:false,publishReason:'paid_ticket_required',canManageTickets:true});
  await act(async()=>{await button('Publish into Scene')!.props.onPress();});
  expect(mockAlert.buttons.map((b:any)=>b.text)).toEqual(['not now','set it up']);expect(mockPublish).not.toHaveBeenCalled();
});
it('checks an immediately changed course format after saving that format',async()=>{
  await mount();act(()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='multi-week course')!.props.onPress());
  mockReadiness.mockImplementation(async()=>{expect(saved.offerType).toBe('course');return {publishReady:false,publishReason:'course_dates_required',canManageTickets:true};});
  await act(async()=>{await button('Publish into Scene')!.props.onPress();});expect(mockPublish).not.toHaveBeenCalled();expect(mockAlert.title).toBe('Add the course dates');
});
it('readiness failure preserves the successful save without claiming publication is uncertain',async()=>{
  await mount();mockReadiness.mockRejectedValue(Error('Unavailable'));
  await act(async()=>{await button('Publish into Scene')!.props.onPress();});
  expect(mockSave).toHaveBeenCalledTimes(1);expect(mockPublish).not.toHaveBeenCalled();expect(mockAlert.title).toBe('Could not check publication');
  expect(tree.root.findAllByType(TouchableOpacity).some(n=>n.props.accessibilityLabel==='Check saved event status')).toBe(false);
});
it('does not publish or show a retired readiness result after leaving the page',async()=>{
  await mount();mockReadiness.mockImplementation(async()=>{mockCurrent=false;return {publishReady:true,publishReason:null};});
  await act(async()=>{await button('Publish into Scene')!.props.onPress();});expect(mockPublish).not.toHaveBeenCalled();expect(mockBack).not.toHaveBeenCalled();
});
it('does not dispatch readiness while a complete save is unconfirmed',async()=>{
  await mount();mockSave.mockRejectedValue(Error('Response lost'));
  await act(async()=>{await button('Publish into Scene')!.props.onPress();});expect(mockReadiness).not.toHaveBeenCalled();expect(mockPublish).not.toHaveBeenCalled();
});

async function mountLive(){mockEventStatus='Live';saved={...saved,status:'Live'};await mount();}
it('previews the same saved draft after saving its current edits without publishing',async()=>{
 await mount();
 act(()=>tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel==='Event confirmation message')!.props.onChangeText('Bring a blanket'));
 await act(async()=>{await button('preview as guest')!.props.onPress();});
 expect(mockSave).toHaveBeenCalledTimes(1);
 expect(saved.fields.confirmation_message).toBe('Bring a blanket');
 expect(mockPush).toHaveBeenCalledWith(`/event/${mockEventId}?preview=guest&pageId=${mockPageId}`);
 expect(mockPublish).not.toHaveBeenCalled();expect(mockLegacyUpdate).not.toHaveBeenCalled();
});
it('keeps edits in the form when the preview save cannot be confirmed',async()=>{
 await mount();
 act(()=>tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel==='Event confirmation message')!.props.onChangeText('Bring a blanket'));
 mockSave.mockRejectedValueOnce(Error('Connection lost'));
 await act(async()=>{await button('preview as guest')!.props.onPress();});
 expect(mockPush).not.toHaveBeenCalled();expect(mockPublish).not.toHaveBeenCalled();
 expect(mockAlert.title).toBe('Preview is not ready');
 expect(tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel==='Event confirmation message')!.props.value).toBe('Bring a blanket');
});
it('previews a live event without saving or publishing unsaved edits',async()=>{
 await mountLive();
 act(()=>tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel==='Event confirmation message')!.props.onChangeText('Unsaved changes'));
 await act(async()=>{await button('preview as guest')!.props.onPress();});
 expect(mockPush).toHaveBeenCalledWith(`/event/${mockEventId}?preview=guest&pageId=${mockPageId}`);
 expect(mockSave).not.toHaveBeenCalled();expect(mockPublish).not.toHaveBeenCalled();expect(mockLegacyUpdate).not.toHaveBeenCalled();
});
it('retains the exact page and teammate reader when opening guest preview',async()=>{
 mockTeamEntry=true;await mount();
 await act(async()=>{await button('preview as guest')!.props.onPress();});
 expect(mockPush).toHaveBeenCalledWith(`/event/${mockEventId}?preview=guest&pageId=${mockPageId}&team=1`);
 expect(mockPublish).not.toHaveBeenCalled();
});
async function confirmCancel(){await act(async()=>{await button('cancel this event')!.props.onPress();});const confirm=mockAlert.buttons.find((b:any)=>b.text==='cancel it');await act(async()=>{await confirm.onPress();});}
it('a free page event saves completely and cancels by versioned status without any refund call',async()=>{
  await mountLive();await confirmCancel();expect(mockSave).toHaveBeenCalledTimes(1);expect(mockStatusWrite).toHaveBeenCalledTimes(1);
  const completedSave=await mockSave.mock.results[0].value;expect(mockStatusWrite.mock.calls[0][3]).toEqual({status:'Cancelled',expectedUpdatedAt:completedSave.updatedAt});
  expect(mockRefund).not.toHaveBeenCalled();expect(mockLegacyUpdate).not.toHaveBeenCalled();expect(mockBack).toHaveBeenCalledTimes(1);
});
it('the financial owner uses existing bulk refunds only after the intent is persisted',async()=>{
  await mountLive();let outstanding=true;mockReadiness.mockImplementation(async()=>({publishReady:true,cancellationRequiresRefunds:outstanding}));
  mockRefund.mockImplementation(async(_id,options)=>{expect([...mockStorage.keys()].some(k=>k.startsWith('creator-page-event-status:'))).toBe(true);await options.beforeEach();outstanding=false;return {refundedCount:2,failedCount:0};});
  await confirmCancel();expect(mockRefund).toHaveBeenCalledTimes(1);expect(mockStatusWrite).toHaveBeenCalledTimes(1);expect(mockBack).toHaveBeenCalledTimes(1);
});
it('page event access alone cannot invoke money even if ticket management is true',async()=>{
  await mountLive();mockReadiness.mockResolvedValue({publishReady:true,cancellationRequiresRefunds:true,canManageTickets:true});mockRefundAccess.mockResolvedValue({isOwner:false,isDelegate:false,canRefund:false});
  await confirmCancel();expect(mockStatusWrite).not.toHaveBeenCalled();
  // The existing helper's beforeEach guard rejects before attendee reads/refunds.
  expect(mockRefund).toHaveBeenCalledTimes(1);expect(mockAlert.title).toBe('Check this event action');
  await act(async()=>{await tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Check event action')!.props.onPress();});
  expect(tree.root.findAllByType(TouchableOpacity).some(n=>n.props.accessibilityLabel==='Finish original event action')).toBe(false);
});
it('separately granted refund delegates retain their reason/review flow and cannot use owner bulk cancellation',async()=>{
  await mountLive();mockReadiness.mockResolvedValue({publishReady:true,cancellationRequiresRefunds:true});mockRefundAccess.mockResolvedValue({isOwner:false,isDelegate:true,canRefund:true});
  await confirmCancel();expect(mockStatusWrite).not.toHaveBeenCalled();expect(mockAlert.message).toContain('financial organizer');
});
it('a repeated confirmation callback cannot dispatch a second cancellation or save',async()=>{
  await mountLive();await act(async()=>{button('cancel this event')!.props.onPress();});const confirm=mockAlert.buttons.find((b:any)=>b.text==='cancel it').onPress;
  await act(async()=>{await Promise.all([confirm(),confirm()]);});expect(mockSave).toHaveBeenCalledTimes(1);expect(mockStatusWrite).toHaveBeenCalledTimes(1);
});
it('an interrupted status response survives reopening and checks the original without another refund or status write',async()=>{
  await mountLive();const original=mockStatusWrite.getMockImplementation()!;mockStatusWrite.mockImplementationOnce(async(...a:any[])=>{await original(...a);throw Error('Lost response');});await confirmCancel();
  expect(mockStatusWrite).toHaveBeenCalledTimes(1);act(()=>tree.unmount());await mount();expect(mockStatusWrite).toHaveBeenCalledTimes(1);expect(mockRefund).not.toHaveBeenCalled();expect(mockStorage.size).toBe(0);
});
it('partial owner refunds keep the existing follow-up message after confirmed cancellation',async()=>{
  await mountLive();mockReadiness.mockResolvedValue({publishReady:true,cancellationRequiresRefunds:true});mockRefund.mockImplementation(async(_id,options)=>{await options.beforeEach();return {refundedCount:1,failedCount:1};});
  await confirmCancel();expect(mockStatusWrite).toHaveBeenCalledTimes(1);expect(mockAlert.title).toBe('some refunds need a follow-up');expect(mockBack).not.toHaveBeenCalled();
});
it('completion uses the saved version without invoking cancellation refunds',async()=>{
  await mountLive();await act(async()=>{button('mark completed')!.props.onPress();});await act(async()=>{await mockAlert.buttons.find((b:any)=>b.text==='complete it').onPress();});
  expect(mockStatusWrite.mock.calls[0][3].status).toBe('Completed');expect(mockRefund).not.toHaveBeenCalled();
});

it('teammates retain complete event publishing without ticket-management controls',async()=>{
 mockTeamEntry=true;saved={...saved,canManageTickets:false};await mount();
 expect(JSON.stringify(tree.toJSON())).toContain('a private draft. publish when it’s ready.');expect(JSON.stringify(tree.toJSON())).not.toContain('only you see it');
 expect(tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel==='Event capacity')!.props.editable).toBe(false);
 expect(tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='multi-week course')!.props.disabled).toBe(true);
 await act(async()=>{await button('Publish into Scene')!.props.onPress();});expect(mockPublish).toHaveBeenCalledTimes(1);
});
it('page team navigation stays on the selected page rather than the legacy community invite route',async()=>{
 mockTeamEntry=true;await mount();const team=tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Page and team')!;
 act(()=>team.props.onPress());expect(mockPush).toHaveBeenCalledWith(`/creator/page-team?id=${mockPageId}`);
 expect(tree.root.findAllByType(TouchableOpacity).some(n=>n.props.accessibilityLabel==='Co-creators')).toBe(false);
});
it('cold teammate entry returns to this page’s event workspace',async()=>{
 mockTeamEntry=true;mockCanGoBack.mockReturnValue(false);await mount();await act(async()=>{await button('keep it a draft')!.props.onPress();});expect(mockReplace).toHaveBeenCalledWith(`/creator/page-events?id=${mockPageId}`);expect(mockBack).not.toHaveBeenCalled();
});

it('cover entry passes the exact page media guard and synchronously blocks a duplicate picker',async()=>{
  await mount();let finish:any;mockPoster.mockImplementation(()=>new Promise(r=>{finish=r;}));
  const pick=tree.root.findByProps({accessibilityLabel:'Choose event cover'}).props.onPress;
  await act(async()=>{void pick();void pick();});expect(mockPoster).toHaveBeenCalledTimes(1);
  await mockPoster.mock.calls[0][0].check();expect(mockStateRead).toHaveBeenLastCalledWith(mockPageId,mockEventId,mockScope);
  await act(async()=>{finish(null);});
});
it('cover result cannot change the draft after the page visit retires',async()=>{
  await mount();let finish:any;mockPoster.mockImplementation(()=>new Promise(r=>{finish=r;}));
  await act(async()=>{void tree.root.findByProps({accessibilityLabel:'Choose event cover'}).props.onPress();});
  mockCurrent=false;await act(async()=>{finish('https://test.invalid/late-cover.jpg');});
  expect(JSON.stringify(tree.toJSON())).not.toContain('late-cover.jpg');expect(mockSave).not.toHaveBeenCalled();
});

it('page publication and save cannot leave before the current cover picker settles',async()=>{
 await mount();let finish!:(v:any)=>void;mockPoster.mockImplementation(()=>new Promise(r=>{finish=r;}));
 const publish=button('Publish into Scene')!.props.onPress,keep=button('keep it a draft')!.props.onPress;
 let picking!:Promise<void>;await act(async()=>{picking=tree.root.findByProps({accessibilityLabel:'Choose event cover'}).props.onPress();await publish();await keep();});
 expect(mockSave).not.toHaveBeenCalled();expect(mockPublish).not.toHaveBeenCalled();expect(mockBack).not.toHaveBeenCalled();
 expect(button('Publish into Scene')!.props.disabled).toBe(true);expect(button('keep it a draft')!.props.disabled).toBe(true);
 await act(async()=>{finish(null);await picking;});expect(button('Publish into Scene')!.props.disabled).toBe(false);
});

it('the mounted page editor routes picked cover through durable private work and the original complete save',async()=>{
 const attempts=require('../../../lib/creatorPageEventMediaAttempt'),media=require('../../../lib/creatorPageEventMedia'),transfer=require('../../../lib/creatorPageEventMediaTransfer');
 const attempt={mediaId:'original-cover',pageId:mockPageId,eventId:mockEventId,userId:mockUser,purpose:'cover'};let pending:any[]=[],finish!:(v:any)=>void;
 const read=jest.spyOn(attempts,'readPageEventMediaAttempts').mockImplementation(async()=>pending);
 const prepare=jest.spyOn(attempts,'preparePageEventMediaAttempt').mockImplementation(async()=>{pending=[attempt];return{attempt,created:true};});
 const start=jest.spyOn(transfer,'startPageEventMediaTransfer').mockImplementation(()=>({done:new Promise(r=>{finish=r;}),cancel:jest.fn()}));
 const reference='creator-event-media:event/original-cover.jpg';
 const get=jest.spyOn(media,'getPageEventMediaAttempt').mockImplementation(async()=>({objectName:'event/original-cover.jpg',readyAt:'time',objectPresent:true,abandonedAt:null,attached:saved.fields.image_url===reference}));
 const clear=jest.spyOn(attempts,'clearPageEventMediaAttempt').mockImplementation(async()=>{pending=[];return true;});
 try{
  await mount();mockPoster.mockImplementation((_guard,writer)=>writer('file:///cropped-cover.jpg'));
  let picking!:Promise<void>;await act(async()=>{picking=tree.root.findByProps({accessibilityLabel:'Choose event cover'}).props.onPress();});await settle();
  expect(prepare).toHaveBeenCalledWith(mockPageId,mockEventId,'cover','image/jpeg','file:///cropped-cover.jpg',mockScope);
  expect(start).toHaveBeenCalledWith(attempt,mockScope,expect.any(Function));expect(button('Publish into Scene')!.props.disabled).toBe(true);expect(mockSave).not.toHaveBeenCalled();
  await act(async()=>{finish({objectName:'event/original-cover.jpg'});await picking;});await advance();
  expect(mockSave).toHaveBeenCalledTimes(1);expect(mockSave.mock.calls[0][3].fields.image_url).toBe(reference);expect(mockLegacyUpdate).not.toHaveBeenCalled();expect(mockPublish).not.toHaveBeenCalled();
  expect(clear).toHaveBeenCalledWith(attempt,mockScope);expect(pending).toEqual([]);
 }finally{act(()=>tree.unmount());[read,prepare,start,get,clear].forEach(s=>s.mockRestore());}
});

it('a whole description-photo batch holds page publication and cover selection until it releases',async()=>{
 await mount();const component=require('../../../components/creator/DescriptionBlocksEditor').DescriptionBlocksEditor;
 const editor=tree.root.findByType(component);let release!:(()=>void);
 const publish=button('Publish into Scene')!.props.onPress,pick=tree.root.findByProps({accessibilityLabel:'Choose event cover'}).props.onPress;
 await act(async()=>{release=editor.props.beginMediaWork();expect(editor.props.beginMediaWork()).toBeNull();await publish();await pick();});
 expect(mockSave).not.toHaveBeenCalled();expect(mockPublish).not.toHaveBeenCalled();expect(mockPoster).not.toHaveBeenCalled();expect(button('Publish into Scene')!.props.disabled).toBe(true);
 expect(tree.root.findByType(component).props).toMatchObject({pageId:mockPageId,pageScope:mockScope,mediaBusy:true,savedBlocks:fields.description_blocks});
 act(()=>release());expect(button('Publish into Scene')!.props.disabled).toBe(false);
});


it('page template save first saves the complete event, then uses its confirmed version and page authority',async()=>{
 await mount();expect(JSON.stringify(tree.toJSON())).toContain('Saving a template also saves this draft.');await act(async()=>{await button('save it as a template')!.props.onPress();});
 expect(mockSave).toHaveBeenCalledTimes(1);expect(mockTemplateSave).toHaveBeenCalledTimes(1);
 expect(mockTemplateSave.mock.calls[0]).toEqual([{version:1,userId:mockUser,pageId:mockPageId,eventId:mockEventId,
  templateId:mockTemplate.id,name:fields.title,expectedUpdatedAt:receipt.updatedAt},expect.objectContaining({userId:mockUser,isCurrent:expect.any(Function)})]);
 expect(mockTemplate.fields.description_blocks).toEqual(fields.description_blocks);expect(mockTemplate.fields.confirmation_message).toBe('Welcome');
 expect(mockLegacyTemplate).not.toHaveBeenCalled();expect(mockLegacyUpdate).not.toHaveBeenCalled();expect(mockPublish).not.toHaveBeenCalled();
 expect(mockBack).not.toHaveBeenCalled();expect(mockStorage.size).toBe(0);expect(mockAlert.title).toBe('saved as a template');
});
it('a rapid template tap holds save, publication and the whole body picker until confirmation',async()=>{
 await mount();let finish!:(value:any)=>void;const original=mockTemplateSave.getMockImplementation()!;
 mockTemplateSave.mockImplementationOnce(async(...a:any[])=>{const result=await original(...a);await new Promise(r=>{finish=r;});return result;});
 const createTemplate=button('save it as a template')!.props.onPress,keep=button('keep it a draft')!.props.onPress,publish=button('Publish into Scene')!.props.onPress;
 let pending!:Promise<void>;await act(async()=>{pending=createTemplate();await createTemplate();await keep();await publish();});await settle();
 const editor=tree.root.findByType(require('../../../components/creator/DescriptionBlocksEditor').DescriptionBlocksEditor);
 expect(editor.props.beginMediaWork()).toBeNull();expect(mockSave).toHaveBeenCalledTimes(1);expect(mockTemplateSave).toHaveBeenCalledTimes(1);expect(mockPublish).not.toHaveBeenCalled();
 expect(button('save it as a template')!.props.disabled).toBe(true);await act(async()=>{finish(null);await pending;});
});
it('an unknown template result survives remount; check confirms the original without another event save',async()=>{
 await mount();const original=mockTemplateSave.getMockImplementation()!;mockTemplateSave.mockImplementationOnce(async(...a:any[])=>{await original(...a);throw Error('Lost response');});
 await act(async()=>{await button('save it as a template')!.props.onPress();});expect(mockStorage.size).toBe(1);
 act(()=>tree.unmount());await mount();expect(button('save it as a template')!.props.disabled).toBe(true);expect(button('Publish into Scene')!.props.disabled).toBe(true);
 await advance();expect(mockSave).toHaveBeenCalledTimes(1);expect(mockTemplateSave).toHaveBeenCalledTimes(1);
 await act(async()=>{await tree.root.findByProps({accessibilityLabel:'Check original template'}).props.onPress();});await settle();
 expect(mockSave).toHaveBeenCalledTimes(1);expect(mockTemplateSave).toHaveBeenCalledTimes(1);expect(mockStorage.size).toBe(0);expect(JSON.stringify(tree.toJSON())).toContain('Your template is saved.');
});
it('missing original template requires explicit retry and keeps the original source version',async()=>{
 await mount();mockTemplateSave.mockRejectedValueOnce(Error('Offline'));
 await act(async()=>{await button('save it as a template')!.props.onPress();});const first=mockTemplateSave.mock.calls[0];
 await act(async()=>{await tree.root.findByProps({accessibilityLabel:'Check original template'}).props.onPress();});await settle();
 expect(mockTemplateSave).toHaveBeenCalledTimes(1);await act(async()=>{await tree.root.findByProps({accessibilityLabel:'Retry original template'}).props.onPress();});
 expect(mockTemplateSave.mock.calls[1][0]).toEqual(first[0]);expect(mockSave).toHaveBeenCalledTimes(1);expect(mockPublish).not.toHaveBeenCalled();
});
it('an unconfirmed complete source save prevents template dispatch and preserves event recovery',async()=>{
 await mount();mockSave.mockRejectedValueOnce(Error('Lost event response'));
 await act(async()=>{await button('save it as a template')!.props.onPress();});
 expect(mockTemplateSave).not.toHaveBeenCalled();expect(mockLegacyTemplate).not.toHaveBeenCalled();expect(mockStorage.size).toBe(1);
 expect(button('save it as a template')!.props.disabled).toBe(true);
});
it('retiring the page while its source saves prevents template dispatch and late success feedback',async()=>{
 await mount();let finish!:(value:any)=>void;const original=mockSave.getMockImplementation()!;mockSave.mockImplementationOnce(async(...a:any[])=>{const result=await original(...a);await new Promise(r=>{finish=r;});return result;});
 let pending!:Promise<void>;await act(async()=>{pending=button('save it as a template')!.props.onPress();});await settle();
 mockCurrent=false;await act(async()=>{finish(null);await pending;});expect(mockTemplateSave).not.toHaveBeenCalled();expect(mockAlert.visible).toBe(false);expect(mockBack).not.toHaveBeenCalled();
});

it('a long event title stays complete while its template gets a valid short label',async()=>{
 saved={...saved,fields:{...fields,title:'A'.repeat(79)+'🌴'+' Keep the whole event title'}};await mount();
 await act(async()=>{await button('save it as a template')!.props.onPress();});
 expect(mockTemplateSave.mock.calls[0][0].name).toBe('A'.repeat(79));
 expect(mockTemplate.fields.title).toBe('A'.repeat(79)+'🌴'+' Keep the whole event title');
});
it('a stale cover callback cannot open a picker while a template is unresolved',async()=>{
 await mount();const pick=tree.root.findByProps({accessibilityLabel:'Choose event cover'}).props.onPress;
 mockTemplateSave.mockRejectedValueOnce(Error('Unknown template result'));
 await act(async()=>{await button('save it as a template')!.props.onPress();await pick();});
 expect(mockPoster).not.toHaveBeenCalled();expect(mockTemplateSave).toHaveBeenCalledTimes(1);
});

it('live template entry explains that saving also updates the current event',async()=>{
 await mountLive();expect(JSON.stringify(tree.toJSON())).toContain('If it is live, people will see those changes.');
 await act(async()=>{await tree.root.findByProps({accessibilityLabel:'Save event as template'}).props.onPress();});
 expect(mockSave).toHaveBeenCalledTimes(1);expect(mockTemplateSave).toHaveBeenCalledTimes(1);expect(mockPublish).not.toHaveBeenCalled();
});

it.each([['id','edit'],['duplicateFrom','duplicate'],['templateId','template']])('existing %s links reach the shared page-classification gate before any editor save',async(parameter,kind)=>{
 mockRouteParams={[parameter]:mockEventId,openPhotos:'1',returnToTickets:'1'};await mount();
 expect(mockEntryProps).toMatchObject({intent:{kind,id:mockEventId},openPhotos:true,returnToTickets:true});
 expect(mockSave).not.toHaveBeenCalled();expect(mockTemplateSave).not.toHaveBeenCalled();expect(mockLegacyUpdate).not.toHaveBeenCalled();
});
it('malformed old event links cannot enter either editor',async()=>{
 mockRouteParams={duplicateFrom:'not-an-event'};await mount();expect(mockEntryProps).toBeUndefined();expect(mockSave).not.toHaveBeenCalled();expect(tree.toJSON()).toBeNull();
});
it('feature-off ordinary entry does not invoke page-classification services',async()=>{
 mockPagesEnabled=false;mockRouteParams={templateId:mockEventId};await mount();expect(mockEntryProps).toBeUndefined();expect(mockSave).not.toHaveBeenCalled();
});

it.each([false,true])('changed-source template returns explicitly to the same page, teammate=%s',async team=>{
 mockTeamEntry=team;await mount();mockTemplateSave.mockRejectedValueOnce(Error('Lost response'));
 await act(async()=>{await button('save it as a template')!.props.onPress();});const original=mockTemplateSave.mock.calls[0][0];
 saved={...saved,updatedAt:'2026-09-15T04:00:00Z',fields:{...saved.fields,title:'Newer event'}};
 await act(async()=>{await tree.root.findByProps({accessibilityLabel:'Check original template'}).props.onPress();});
 expect(JSON.stringify(tree.toJSON())).toContain('This event changed');expect(tree.root.findAllByProps({accessibilityLabel:'Retry original template'})).toHaveLength(0);
 expect(mockReplace).not.toHaveBeenCalled();expect(button('save it as a template')!.props.disabled).toBe(true);
 mockTemplateSave.mockRejectedValueOnce({code:'PT409'});
 await act(async()=>{await tree.root.findByProps({accessibilityLabel:'Return to page and review the latest event'}).props.onPress();});
 expect(mockDismissTo).toHaveBeenCalledWith(`${team?'/creator/page-events':'/creator/page'}?id=${mockPageId}`);expect(mockReplace).not.toHaveBeenCalled();expect(mockTemplateSave.mock.calls[1][0]).toEqual(original);
 await advance();expect(mockSave).toHaveBeenCalledTimes(1);expect(saved.fields.title).toBe('Newer event');expect(mockPublish).not.toHaveBeenCalled();expect(mockStorage.size).toBe(0);
});
it('a source changed immediately after its save never produces a template success alert',async()=>{
 await mount();const original=mockSave.getMockImplementation()!;mockSave.mockImplementationOnce(async(...a:any[])=>{const r=await original(...a);saved={...saved,updatedAt:'2026-09-15T04:00:00Z'};return r;});
 await act(async()=>{await button('save it as a template')!.props.onPress();});expect(mockTemplateSave).not.toHaveBeenCalled();expect(mockAlert.title).not.toBe('saved as a template');expect(JSON.stringify(tree.toJSON())).toContain('This event changed');expect(mockReplace).not.toHaveBeenCalled();
});
it('unknown retirement never navigates or repeats the source save',async()=>{
 await mount();mockTemplateSave.mockRejectedValueOnce(Error('Lost response'));await act(async()=>{await button('save it as a template')!.props.onPress();});saved={...saved,updatedAt:'2026-09-15T04:00:00Z'};
 await act(async()=>{await tree.root.findByProps({accessibilityLabel:'Check original template'}).props.onPress();});mockTemplateSave.mockRejectedValueOnce(Error('Offline'));
 await act(async()=>{await tree.root.findByProps({accessibilityLabel:'Return to page and review the latest event'}).props.onPress();});expect(mockReplace).not.toHaveBeenCalled();expect(mockDismissTo).not.toHaveBeenCalled();expect(mockStorage.size).toBe(1);expect(JSON.stringify(tree.toJSON())).toContain('Its attempt is kept');await advance();expect(mockSave).toHaveBeenCalledTimes(1);
});

it.each([false,true])('cold Save & return resumes tickets for the same saved event (team=%s)',async(team)=>{
 mockTeamEntry=team;mockCanGoBack.mockReturnValue(false);mockRouteParams={pageId:mockPageId,id:mockEventId,returnToTickets:'1',...(team?{team:'1'}:{})};await mount();await act(async()=>{await button('Save & return')!.props.onPress();});
 expect(mockSave).toHaveBeenCalledTimes(1);expect(mockReplace).toHaveBeenCalledWith(`/creator/tickets?id=${mockEventId}`);expect(mockBack).not.toHaveBeenCalled();expect(mockPublish).not.toHaveBeenCalled();
});
it('Save & return preserves a real ticket-editor history entry',async()=>{
 mockRouteParams={pageId:mockPageId,id:mockEventId,returnToTickets:'1'};await mount();await act(async()=>{await button('Save & return')!.props.onPress();});expect(mockBack).toHaveBeenCalledTimes(1);expect(mockReplace).not.toHaveBeenCalled();expect(mockPublish).not.toHaveBeenCalled();
});
it('failed Save & return keeps the event editor open and does not publish',async()=>{
 mockCanGoBack.mockReturnValue(false);mockRouteParams={pageId:mockPageId,id:mockEventId,returnToTickets:'1'};await mount();mockSave.mockRejectedValueOnce(Error('lost'));await act(async()=>{await button('Save & return')!.props.onPress();});expect(mockBack).not.toHaveBeenCalled();expect(mockReplace).not.toHaveBeenCalled();expect(mockPublish).not.toHaveBeenCalled();
});


it('shows read recovery instead of an endless spinner and resumes without saving or publishing',async()=>{
  mockStateRead.mockRejectedValueOnce(Error('Offline'));
  await mount();
  expect(JSON.stringify(tree.toJSON())).toContain('Your event couldn’t load');
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  const retry=tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Check complete event save');
  expect(retry).toBeDefined();
  await act(async()=>{await retry!.props.onPress();});
  await settle();
  expect(JSON.stringify(tree.toJSON())).toContain('Atomic snapshot title');
  expect(JSON.stringify(tree.toJSON())).not.toContain('Your event couldn’t load');
  await advance();
  expect(mockSave).not.toHaveBeenCalled();
  expect(mockPublish).not.toHaveBeenCalled();
  expect(mockLegacyUpdate).not.toHaveBeenCalled();
});

it('an interrupted autosave unlocks visible recovery, keeps edited details and checks without saving twice',async()=>{
 await mount();const original=mockSave.getMockImplementation()!;
 mockSave.mockImplementationOnce(async(...args:any[])=>{await original(...args);return new Promise(()=>{});});
 act(()=>tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel==='Event capacity')!.props.onChangeText('25'));
 await advance();expect(mockSave).toHaveBeenCalledTimes(1);
 await act(async()=>{jest.advanceTimersByTime(25_000);});await settle();
 const recovery=tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Check complete event save');
 expect(recovery).toBeDefined();expect(recovery!.props.disabled).toBe(false);
 expect(tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel==='Event capacity')!.props.value).toBe('25');
 await act(async()=>recovery!.props.onPress());await advance();
 expect(mockSave).toHaveBeenCalledTimes(1);expect(mockPublish).not.toHaveBeenCalled();expect(mockBack).not.toHaveBeenCalled();
 expect(JSON.stringify(tree.toJSON())).toContain('saved just now');
});
it('a timed-out event read shows reachable recovery and never falls back to legacy fields',async()=>{
 mockStateRead.mockReturnValueOnce(new Promise(()=>{}));await mount();
 await act(async()=>{jest.advanceTimersByTime(12_000);});await settle();
 expect(JSON.stringify(tree.toJSON())).toContain('Your event couldn’t load');
 const retry=tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Check complete event save')!;
 expect(retry.props.disabled).toBe(false);await act(async()=>retry.props.onPress());await settle();
 expect(JSON.stringify(tree.toJSON())).toContain('Atomic snapshot title');expect(JSON.stringify(tree.toJSON())).not.toContain('Earlier gate content');
 expect(mockSave).not.toHaveBeenCalled();expect(mockLegacyUpdate).not.toHaveBeenCalled();expect(mockPublish).not.toHaveBeenCalled();
});
it('a checked missing receipt offers explicit original-save retry while preserving another status check',async()=>{
 await mount();mockSave.mockRejectedValueOnce(Error('Lost'));
 act(()=>tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel==='Event capacity')!.props.onChangeText('25'));await advance();
 const recovery=()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Check complete event save')!;
 await act(async()=>recovery().props.onPress());
 expect(JSON.stringify(tree.toJSON())).toContain('No confirmation yet. Retry the same changes.');expect(recovery()).toBeDefined();
 const retry=tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Retry original event save')!;
 expect(retry.props.disabled).toBe(false);await act(async()=>retry.props.onPress());await advance();
 expect(mockSave).toHaveBeenCalledTimes(2);expect(mockSave.mock.calls[1].slice(0,4)).toEqual(mockSave.mock.calls[0].slice(0,4));expect(mockPublish).not.toHaveBeenCalled();expect(mockBack).not.toHaveBeenCalled();
});

it('confirmed autosave with failed local cleanup never shows a contradictory not-saved message',async()=>{
 await mount();mockStorageRemove.mockRejectedValueOnce(Error('Storage unavailable'));
 act(()=>tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel==='Event capacity')!.props.onChangeText('25'));await advance();
 const output=JSON.stringify(tree.toJSON());expect(output).toContain('The event saved.');expect(output).toContain('saved just now');expect(output).not.toContain('not saved yet.');
 expect(mockSave).toHaveBeenCalledTimes(1);expect(mockPublish).not.toHaveBeenCalled();
});

it('confirmed explicit save with failed cleanup asks for status without claiming it did not save',async()=>{
 await mount();mockStorageRemove.mockRejectedValueOnce(Error('Storage unavailable'));
 await act(async()=>button('keep it a draft')!.props.onPress());await settle();
 expect(mockAlert.title).toBe('Check saved status');expect(JSON.stringify(tree.toJSON())).toContain('The event saved.');
 expect(mockSave).toHaveBeenCalledTimes(1);expect(mockBack).not.toHaveBeenCalled();expect(mockPublish).not.toHaveBeenCalled();
});

it('a timed out cancellation returns to a visible status check and never replays refunds',async()=>{
 await mountLive();const original=mockStatusWrite.getMockImplementation()!;let resolve!:()=>void;
 mockStatusWrite.mockImplementationOnce(async(...a:any[])=>{await original(...a);return new Promise<void>(r=>{resolve=r;});});
 act(()=>{button('cancel this event')!.props.onPress();});let action!:Promise<void>;
 act(()=>{action=mockAlert.buttons.find((b:any)=>b.text==='cancel it').onPress();});await settle();
 await act(async()=>{jest.advanceTimersByTime(25_001);});await settle();await action;
 expect(mockBack).not.toHaveBeenCalled();expect(mockStatusWrite).toHaveBeenCalledTimes(1);
 const check=tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Check event action')!;
 expect(check.props.disabled).toBe(false);await act(async()=>{await check.props.onPress();});
 expect(JSON.stringify(tree.toJSON())).toContain('Your event is cancelled.');
 expect(mockRefund).not.toHaveBeenCalled();expect(mockStatusWrite).toHaveBeenCalledTimes(1);
 resolve();await settle();expect(mockBack).not.toHaveBeenCalled();
 await act(async()=>{tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Return to the page')!.props.onPress();});expect(mockBack).toHaveBeenCalledTimes(1);
});
it('a stalled owner refund check cannot start financial work after the cancellation times out',async()=>{
 await mountLive();let resolve!:(value:any)=>void;
 mockReadiness.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 act(()=>{button('cancel this event')!.props.onPress();});let action!:Promise<void>;
 act(()=>{action=mockAlert.buttons.find((b:any)=>b.text==='cancel it').onPress();});await settle();
 await act(async()=>{jest.advanceTimersByTime(25_001);});await settle();await action;
 resolve({cancellationRequiresRefunds:true});await settle();
 expect(mockRefund).not.toHaveBeenCalled();
 expect(mockStatusWrite).not.toHaveBeenCalled();expect(mockRefundAccess).not.toHaveBeenCalled();expect(mockBack).not.toHaveBeenCalled();
});
it('a confirmed cancellation with failed marker cleanup remains confirmed and recoverable',async()=>{
 await mountLive();mockStorageRemove.mockImplementation(async(k:string)=>{if(k.startsWith('creator-page-event-status:'))throw Error('Device storage unavailable');mockStorage.delete(k);});
 await confirmCancel();expect(mockStatusWrite).toHaveBeenCalledTimes(1);
 expect(JSON.stringify(tree.toJSON())).toContain('The event action was recorded.');expect(mockAlert.message).toContain('The event action was recorded.');
 expect(JSON.stringify(tree.toJSON())).not.toContain('This action is unconfirmed.');expect(mockBack).not.toHaveBeenCalled();
});

it('refund review access times out without navigating late and supports an explicit retry',async()=>{
 await mountLive();mockReadiness.mockResolvedValue({cancellationRequiresRefunds:true});mockRefundAccess.mockResolvedValue({isOwner:false,canRefund:false});
 await confirmCancel();await act(async()=>{await tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Check event action')!.props.onPress();});
 let resolve!:(value:any)=>void;mockRefundAccess.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 const review=()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Review remaining ticket refunds')!;
 let pending!:Promise<void>;act(()=>{pending=review().props.onPress();});await settle();
 await act(async()=>{jest.advanceTimersByTime(12_001);});await settle();await pending;
 expect(review().props.disabled).toBe(false);expect(mockPush).not.toHaveBeenCalled();
 resolve({isOwner:true,canRefund:true});await settle();expect(mockPush).not.toHaveBeenCalled();
 mockRefundAccess.mockResolvedValue({isOwner:true,canRefund:true});await act(async()=>{await review().props.onPress();});
 expect(mockPush).toHaveBeenCalledWith(`/creator/attendees?id=${mockEventId}`);
 expect(mockStatusWrite).not.toHaveBeenCalled();
});

it('template timeout recovers the original receipt without repeating source save or publishing',async()=>{
 await mount();const original=mockTemplateSave.getMockImplementation()!;let finish!:()=>void;
 mockTemplateSave.mockImplementationOnce(async(...a:any[])=>{const receipt=await original(...a);await new Promise<void>(r=>{finish=r;});return receipt;});
 act(()=>{void button('save it as a template')!.props.onPress();});await settle();await act(async()=>{jest.advanceTimersByTime(25000);});await settle();
 expect(mockAlert.title).toBe('Check saved status');expect(mockAlert.message).toContain('Check its saved status before continuing');expect(tree.root.findByProps({accessibilityLabel:'Check original template'}).props.disabled).toBe(false);
 finish();await settle();await act(async()=>{await tree.root.findByProps({accessibilityLabel:'Check original template'}).props.onPress();});
 expect(mockTemplateSave).toHaveBeenCalledTimes(1);expect(mockSave).toHaveBeenCalledTimes(1);expect(mockPublish).not.toHaveBeenCalled();
 await act(async()=>{tree.root.findByProps({accessibilityLabel:'Return to the page after saving template'}).props.onPress();});expect(mockBack).toHaveBeenCalledTimes(1);
});
it('template cleanup timeout keeps confirmed copy in the notice and alert',async()=>{
 await mount();let finish!:()=>void;mockStorageRemove.mockImplementation(async(k:string)=>{if(k.startsWith('creator-page-event-template:'))await new Promise<void>(r=>{finish=r;});mockStorage.delete(k);});
 act(()=>{void button('save it as a template')!.props.onPress();});await settle();await act(async()=>{jest.advanceTimersByTime(3000);});await settle();
 expect(mockAlert.message).toContain('Your template is saved');expect(JSON.stringify(tree.toJSON())).toContain('Your template is saved');expect(button('save it as a template')!.props.disabled).toBe(true);
 finish();await settle();await act(async()=>{await tree.root.findByProps({accessibilityLabel:'Check original template'}).props.onPress();});
 expect(tree.root.findAllByType(TouchableOpacity).filter(n=>n.props.accessibilityLabel==='Return to the page after saving template')).toHaveLength(1);expect(mockTemplateSave).toHaveBeenCalledTimes(1);expect(mockPublish).not.toHaveBeenCalled();
});

it('publication readiness timeout releases the editor and cannot publish a late result',async()=>{
 await mount();let finish!:(v:any)=>void;mockReadiness.mockReturnValueOnce(new Promise(r=>{finish=r;}));
 act(()=>{void button('Publish into Scene')!.props.onPress();});await settle();await act(async()=>{jest.advanceTimersByTime(25000);});await settle();
 expect(mockAlert.title).toBe('Could not check publication');expect(button('Publish into Scene')!.props.disabled).toBe(false);expect(mockPublish).not.toHaveBeenCalled();
 finish({publishReady:true,publishReason:null});await settle();expect(mockPublish).not.toHaveBeenCalled();expect(mockBack).not.toHaveBeenCalled();
});
it('publication timeout blocks an older publish callback and ignores its late receipt',async()=>{
 await mount();let finish!:(v:string)=>void;mockPublish.mockReturnValueOnce(new Promise(r=>{finish=r;}));const publish=button('Publish into Scene')!.props.onPress;
 act(()=>{void publish();});await settle();await act(async()=>{jest.advanceTimersByTime(25000);});await settle();
 expect(tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Check saved event status')!.props.disabled).toBe(false);
 expect(JSON.stringify(tree.toJSON())).toContain('Your event is saved. Check whether it’s live.');expect(JSON.stringify(tree.toJSON())).not.toContain('a private draft. publish when it’s ready.');expect(JSON.stringify(tree.toJSON())).not.toContain('Your event stays private until you publish it.');
 await act(async()=>{await publish();});expect(mockPublish).toHaveBeenCalledTimes(1);finish(mockEventId);await settle();expect(mockBack).not.toHaveBeenCalled();
});
it('publication status timeout cannot navigate on a late result and explicit check never republishes',async()=>{
 await mount();mockPublish.mockRejectedValueOnce(Error('Lost response'));await act(async()=>{await button('Publish into Scene')!.props.onPress();});
 let finish!:(v:any)=>void;const pending=new Promise(r=>{finish=r;});mockStateRead.mockReturnValueOnce(pending);mockLegacyRead.mockReturnValueOnce(pending);
 act(()=>{void tree.root.findByProps({accessibilityLabel:'Check saved event status'}).props.onPress();});await settle();await act(async()=>{jest.advanceTimersByTime(12000);});await settle();
 expect(mockAlert.title).toBe('Could not check the event');expect(tree.root.findByProps({accessibilityLabel:'Check saved event status'}).props.disabled).toBe(false);
 saved={...saved,status:'Live'};await act(async()=>{await tree.root.findByProps({accessibilityLabel:'Check saved event status'}).props.onPress();});
 expect(mockBack).toHaveBeenCalledTimes(1);finish({...saved,status:'Draft'});await settle();expect(mockBack).toHaveBeenCalledTimes(1);expect(mockPublish).toHaveBeenCalledTimes(1);expect(mockSave).toHaveBeenCalledTimes(1);
});
it('confirmed private status allows another explicit publish without automatically publishing',async()=>{
 await mount();mockPublish.mockRejectedValueOnce(Error('Lost response'));await act(async()=>{await button('Publish into Scene')!.props.onPress();});
 await act(async()=>{await tree.root.findByProps({accessibilityLabel:'Check saved event status'}).props.onPress();});
 expect(mockAlert.title).toBe('Still a private draft');expect(button('Publish into Scene')!.props.disabled).toBe(false);expect(mockPublish).toHaveBeenCalledTimes(1);expect(mockBack).not.toHaveBeenCalled();
});

it('publication recovery rejects a different page event without navigating or clearing uncertainty',async()=>{
 await mount();mockPublish.mockRejectedValueOnce(Error('Lost response'));await act(async()=>{await button('Publish into Scene')!.props.onPress();});
 mockStateRead.mockResolvedValueOnce({...saved,status:'Live',eventId:mockPageId});await act(async()=>{await tree.root.findByProps({accessibilityLabel:'Check saved event status'}).props.onPress();});
 expect(mockBack).not.toHaveBeenCalled();expect(mockAlert.title).toBe('Could not check the event');expect(button('Publish into Scene')!.props.disabled).toBe(true);expect(mockPublish).toHaveBeenCalledTimes(1);
});
