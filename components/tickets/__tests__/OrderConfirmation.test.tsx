import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Text, TouchableOpacity } from 'react-native';
const mockExtras=jest.fn(),mockOrder=jest.fn(),mockPages=jest.fn(),mockProfiles=jest.fn(),mockTopic=jest.fn(),mockMarked=jest.fn(),mockPush=jest.fn(),mockQuestions=jest.fn(),mockAnswered=jest.fn(),mockNote=jest.fn(),mockRecord=jest.fn();
let mockCurrent=true;
const mockOwner={userId:'buyer',isCurrent:()=>mockCurrent};
jest.mock('../../../hooks/usePublicPageScope',()=>({usePublicPageScope:()=>({scope:mockOwner,focused:true,account:{isCurrent:()=>mockCurrent}})}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>({id:'order'}),router:{push:(...args:any[])=>mockPush(...args),replace:jest.fn()}}));
jest.mock('../../../constants/FeatureFlags',()=>({CREATOR_PAGES_ENABLED:true,COMMUNITIES_ENABLED:true,TICKET_TRANSFER_ENABLED:false}));
jest.mock('../../../lib/ticketing',()=>({...jest.requireActual('../../../lib/ticketing'),getOrder:(...args:any[])=>mockOrder(...args),getQuestions:(...args:any[])=>mockQuestions(...args),getAnsweredQuestionIds:(...args:any[])=>mockAnswered(...args),getConfirmationMessage:(...args:any[])=>mockNote(...args),recordAnswer:(...args:any[])=>mockRecord(...args)}));
jest.mock('../../../lib/publishedPageIdentity',()=>({loadPublishedEventPageIdentities:(...args:any[])=>mockPages(...args)}));
jest.mock('../../../lib/organizerProfile',()=>({getOrganizerProfiles:(...args:any[])=>mockProfiles(...args)}));
jest.mock('../../../lib/purchaseExtras',()=>({readPurchaseExtras:(...a:any[])=>mockExtras(...a)}));
jest.mock('../../../lib/communityChat',()=>({getEventTopicId:(...args:any[])=>mockTopic(...args)}));
jest.mock('../../../lib/eventRsvp',()=>({wasNudged:async()=>false,markNudged:(...args:any[])=>mockMarked(...args)}));
jest.mock('../../../lib/addToCalendar',()=>({showAddToCalendar:jest.fn()}));
jest.mock('../../../lib/pendingLink',()=>({peekPendingCheckout:async()=>null,clearPendingCheckout:jest.fn(),stashPendingDestination:jest.fn()}));
jest.mock('../../../lib/haptics',()=>({hapticLight:jest.fn(),hapticSuccess:jest.fn(),hapticError:jest.fn()}));
jest.mock('../../../lib/supabase',()=>({supabase:{}}));
jest.mock('../../events/EventMediaImage',()=>({EventMediaImage:()=>null}));
jest.mock('../../BrandedAlert',()=>({BrandedAlert:(props:any)=>props.visible?require('react').createElement(require('react-native').View,{testID:'confirmation-alert',...props}):null}));
jest.mock('react-native-reanimated',()=>require('react-native-reanimated/mock'));
import Screen from '../../../app/tickets/order/[id]';
const order={id:'order',event_id:'event',qty:1,total_cents:0,status:'paid',created_at:'2026-09-16T00:00:00Z',event_title:'Sunday together',event_date:null,event_start_time:null,event_venue:null,event_image:null,event_public_name:'Old account label',event_host_user_id:'creator',event_community_id:null,seats:[{id:'seat',position_index:1,reference_code:'WU-TEST',voided:false}]};
const page={pageId:'page',ownerId:'creator',kind:'organization',name:'Our Sunday Table',purpose:'Together',city:'Los Angeles',description:null,photoUrl:null,coverMediaId:null,publishedAt:'2026-09-16'};
let tree:ReactTestRenderer,client:QueryClient;
const content=()=>JSON.stringify(tree.toJSON());
const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,20));});
async function mount(){client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});await act(async()=>{tree=create(<QueryClientProvider client={client}><Screen/></QueryClientProvider>);});await settle();await settle();}
beforeEach(()=>{jest.clearAllMocks();mockCurrent=true;mockExtras.mockResolvedValue(new Map([['order',[]]]));mockQuestions.mockResolvedValue([]);mockAnswered.mockResolvedValue(new Map());mockNote.mockResolvedValue(null);mockRecord.mockResolvedValue({ok:true});mockOrder.mockResolvedValue({...order});mockPages.mockResolvedValue(new Map([['event',{pageId:'page',page}]]));mockProfiles.mockResolvedValue(new Map());mockTopic.mockResolvedValue('event-room');mockMarked.mockResolvedValue(undefined);});
afterEach(()=>{if(tree)act(()=>tree.unmount());client?.clear();});
it('carries the published organization name without consulting the owner account profile',async()=>{
 await mount();expect(content()).toContain('Our Sunday Table');expect(content()).not.toContain('Old account label');expect(mockProfiles).not.toHaveBeenCalled();expect(mockMarked).toHaveBeenCalledWith('event');
 const alert=tree.root.findByProps({testID:'confirmation-alert'});expect(alert.props.title).toBe('want people to go with?');
});
it('keeps the receipt while page lookup fails, then recovers its correct identity',async()=>{
 mockPages.mockRejectedValueOnce(Error('offline'));await mount();expect(content()).toContain('WU-TEST');expect(content()).toContain('The event page couldn’t be checked.');expect(content()).not.toContain('Old account label');expect(mockMarked).not.toHaveBeenCalled();
 await act(async()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Retry event page')!.props.onPress());await settle();expect(content()).toContain('Our Sunday Table');
});
it('does not replace an unavailable published page with its owner account',async()=>{
 mockPages.mockResolvedValue(new Map([['event',{pageId:'page',page:null}]]));await mount();expect(content()).toContain('Your purchase is still here.');expect(content()).not.toContain('Old account label');expect(mockProfiles).not.toHaveBeenCalled();expect(mockMarked).not.toHaveBeenCalled();
});
it('preserves confirmed legacy event identity',async()=>{
 mockPages.mockResolvedValue(new Map());await mount();expect(content()).toContain('Old account label');
});
it('waits for community chat lookup before consuming the confirmation nudge',async()=>{
 let finish!:(id:string)=>void;mockTopic.mockReturnValue(new Promise(r=>{finish=r}));mockOrder.mockResolvedValue({...order,event_community_id:'page'});mockPages.mockResolvedValue(new Map([['event',{pageId:'page',page:{...page,kind:'community'}}]]));await mount();expect(mockMarked).not.toHaveBeenCalled();
 await act(async()=>finish('event-room'));await settle();expect(mockMarked).toHaveBeenCalledTimes(1);const alert=tree.root.findByProps({testID:'confirmation-alert'});expect(alert.props.title).toBe("you're in");act(()=>alert.props.buttons[0].onPress());expect(mockPush).toHaveBeenCalledWith('/community-topic/event-room');
});
it('keeps community recovery separate from organization suggestions',async()=>{
 mockOrder.mockResolvedValue({...order,event_community_id:'page'});mockPages.mockResolvedValue(new Map([['event',{pageId:'page',page:{...page,kind:'community'}}]]));mockTopic.mockRejectedValue(Error('offline'));await mount();expect(content()).toContain('The event chat couldn’t be checked.');expect(mockMarked).not.toHaveBeenCalled();expect(content()).not.toContain('want people to go with?');
});
it('does not navigate from an old confirmation after the account retires',async()=>{
 await mount();const alert=tree.root.findByProps({testID:'confirmation-alert'});mockCurrent=false;act(()=>alert.props.buttons[0].onPress());expect(mockPush).not.toHaveBeenCalled();
});

const registration={id:'question',event_id:'event',prompt:'Anything we should know?',qtype:'short_text',options:null,required:false,scope:'per_attendee',sort_order:0,created_at:'2026-09-16',updated_at:null};
const action=(label:string)=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel===label || n.findAllByType(Text).some(t=>t.props.children===label))!;
const form=()=>tree.root.findByType(require('../QuestionForm').QuestionForm);
it('keeps tickets reachable when question reads fail and recovers without an empty-state assumption',async()=>{
 mockQuestions.mockRejectedValueOnce(Error('offline'));await mount();expect(content()).toContain('registration questions couldn’t be checked');expect(action('see your tickets')).toBeTruthy();expect(mockRecord).not.toHaveBeenCalled();
 mockQuestions.mockResolvedValue([registration]);await act(async()=>action('Retry registration questions').props.onPress());await settle();expect(content()).toContain('Anything we should know?');
});
it('does not ask previously answered slots when some attendees remain unanswered',async()=>{
 mockOrder.mockResolvedValue({...order,qty:2});mockQuestions.mockResolvedValue([registration]);mockAnswered.mockResolvedValue(new Map([['question',new Set([1])]]));await mount();expect(form().props.answeredSlots.has('question:1')).toBe(true);const inputs=form().findAllByType(require('react-native').TextInput);expect(inputs).toHaveLength(1);act(()=>inputs[0].props.onChangeText('Remaining attendee'));expect(form().props.draft['question:2'].text).toBe('Remaining attendee');expect(form().props.draft['question:1']).toBeUndefined();
});
it('does not interpret an answer-read failure as permission to ask again',async()=>{
 mockQuestions.mockResolvedValue([registration]);mockAnswered.mockRejectedValueOnce(Error('offline'));await mount();expect(content()).not.toContain('Anything we should know?');expect(action('see your tickets')).toBeTruthy();
 await act(async()=>action('Retry registration questions').props.onPress());await settle();expect(content()).toContain('Anything we should know?');
});
it('makes a failed creator note independently retryable without hiding ticket references',async()=>{
 mockNote.mockRejectedValueOnce(Error('offline'));await mount();expect(content()).toContain('WU-TEST');expect(content()).toContain('creator’s note couldn’t be loaded');mockNote.mockResolvedValue('Meet at the north entrance.');await act(async()=>action('Retry creator note').props.onPress());await settle();expect(content()).toContain('Meet at the north entrance.');
});
it('retries only missing attendee answers after a partial save',async()=>{
 mockOrder.mockResolvedValue({...order,qty:2});mockQuestions.mockResolvedValue([registration]);mockRecord.mockResolvedValueOnce({ok:true}).mockResolvedValueOnce({ok:false}).mockResolvedValue({ok:true});await mount();
 act(()=>{form().props.onCellChange('question',1,{text:'First'});form().props.onCellChange('question',2,{text:'Second'});});await act(async()=>action('send it').props.onPress());expect(mockRecord).toHaveBeenCalledTimes(2);expect(content()).toContain('Some answers haven’t saved');expect(form().props.answeredSlots.has('question:1')).toBe(true);
 await act(async()=>action('send it').props.onPress());expect(mockRecord).toHaveBeenCalledTimes(3);expect(mockRecord.mock.calls[2][3]).toBe(2);expect(content()).toContain('see your tickets');
});
it('recovers a lost acknowledgement by reading the saved slot without resending',async()=>{
 mockQuestions.mockResolvedValue([registration]);mockRecord.mockImplementation(async()=>{mockAnswered.mockResolvedValue(new Map([['question',new Set([1])]]));throw Error('lost acknowledgement');});await mount();act(()=>form().props.onCellChange('question',1,{text:'Keep original'}));await act(async()=>action('send it').props.onPress());expect(mockRecord).toHaveBeenCalledTimes(1);expect(content()).toContain('see your tickets');expect(content()).not.toContain('Some answers');
});
it('locks immediately against two presses and stops later slots after the account retires',async()=>{
 mockOrder.mockResolvedValue({...order,qty:2});mockQuestions.mockResolvedValue([registration]);let finish!:(value:any)=>void;mockRecord.mockReturnValue(new Promise(r=>{finish=r}));await mount();act(()=>{form().props.onCellChange('question',1,{text:'First'});form().props.onCellChange('question',2,{text:'Second'});});const press=action('send it').props.onPress;let pending:Promise<void>;
 await act(async()=>{pending=press();void press();await Promise.resolve();});expect(mockRecord).toHaveBeenCalledTimes(1);mockCurrent=false;await act(async()=>{finish({ok:true});await pending!;});expect(mockRecord).toHaveBeenCalledTimes(1);
});

it('shows purchased snapshot choices next to reachable ticket codes',async()=>{
 mockExtras.mockResolvedValue(new Map([['order',[{id:'extra',name:'Picnic lunch',quantity:2,unitPriceCents:1200,optionLabel:'Vegan picnic'}]]]));await mount();
 expect(content()).toContain('Picnic lunch');expect(content()).toContain('Vegan picnic');expect(content()).toContain('$24.00');expect(content()).toContain('WU-TEST');
});
it('keeps tickets visible when extras fail and recovers independently',async()=>{
 mockExtras.mockRejectedValueOnce(Error('offline'));await mount();expect(content()).toContain('WU-TEST');expect(content()).toContain('Extras couldn’t be loaded.');
 mockExtras.mockResolvedValue(new Map([['order',[{id:'extra',name:'Lunch',quantity:1,unitPriceCents:0,optionLabel:'Vegetarian'}]]]));
 await act(async()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Retry purchase extras')!.props.onPress());await settle();expect(content()).toContain('Vegetarian');expect(content()).not.toContain('Extras couldn’t be loaded.');expect(mockOrder).toHaveBeenCalledTimes(1);
});
it('does not show late purchased extras after the viewing account retires',async()=>{
 let finish!:(x:any)=>void;mockExtras.mockReturnValue(new Promise(r=>{finish=r;}));await mount();mockCurrent=false;await act(async()=>finish(new Map([['order',[{id:'extra',name:'Private purchase',quantity:1,unitPriceCents:0,optionLabel:'Private choice'}]]])));expect(content()).not.toContain('Private choice');
});

function communityOrder(){mockOrder.mockResolvedValue({...order,event_community_id:'page'});mockPages.mockResolvedValue(new Map([['event',{pageId:'page',page:{...page,kind:'community'}}]]));}
it('keeps a persistent event-chat entry after dismissing the one-time prompt',async()=>{
 communityOrder();await mount();const alert=tree.root.findByProps({testID:'confirmation-alert'});act(()=>alert.props.onClose());
 const button=tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Open event chat')!;expect(button).toBeTruthy();act(()=>button.props.onPress());expect(mockPush).toHaveBeenCalledWith('/community-topic/event-room');expect(content()).toContain('WU-TEST');
 mockCurrent=false;mockPush.mockClear();act(()=>button.props.onPress());expect(mockPush).not.toHaveBeenCalled();
});
it('preserves the ticket and unconsumed nudge while its conversation is absent, then recovers',async()=>{
 communityOrder();mockTopic.mockResolvedValue(null);await mount();expect(content()).toContain('Your event chat is not available yet.');expect(content()).toContain('WU-TEST');expect(mockMarked).not.toHaveBeenCalled();
 mockTopic.mockResolvedValue('event-room');await act(async()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Retry event chat')!.props.onPress());await settle();expect(content()).toContain('Open event chat');
});
it('removes cached conversation actions after a failed refresh and restores them on retry',async()=>{
 communityOrder();await mount();mockTopic.mockRejectedValueOnce(Error('offline'));await act(async()=>client.invalidateQueries({queryKey:['event-topic']}));await settle();expect(content()).toContain('The event chat couldn’t be checked.');expect(tree.root.findAllByType(TouchableOpacity).some(n=>n.props.accessibilityLabel==='Open event chat')).toBe(false);
 await act(async()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Retry event chat')!.props.onPress());await settle();expect(content()).toContain('Open event chat');
});
it.each(['pending','refunded'])('does not offer a conversation from a %s ticket order',async status=>{
 communityOrder();mockOrder.mockResolvedValue({...order,event_community_id:'page',status});await mount();expect(mockTopic).not.toHaveBeenCalled();expect(content()).not.toContain('Open event chat');
});
