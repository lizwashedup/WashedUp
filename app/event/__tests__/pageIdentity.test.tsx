import React from 'react';
import {Share,TouchableOpacity,Text} from 'react-native';
jest.mock('../../../components/notifications/EventMessagePreference',()=>({EventMessagePreference:()=>null}));
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mockLinkedPlans=jest.fn();
jest.mock('../../../lib/eventLinkedPlans',()=>({readEventLinkedPlans:(...a:any[])=>mockLinkedPlans(...a)}));
const mockLinks=jest.fn(),mockRelated=jest.fn(),mockPush=jest.fn(),mockQueries:any[]=[];
let mockEvent:any,mockScope:any,mockEnabled=true,mockCommunities=true;
let mockParams:any, mockPreviewAllowed=true, mockPreviewGate:any, mockPreviewPublished=true,mockPreviewAlert:any;
let mockRecoveryOverride:any=null;
let mockMembership:any=null;
beforeEach(()=>{mockMembership=null;});
beforeEach(()=>{mockRecoveryOverride=null;});
jest.mock('../../../hooks/useEventRsvpRecovery',()=>({useEventRsvpRecovery:(...a:any[])=>{const result=jest.requireActual('../../../hooks/useEventRsvpRecovery').useEventRsvpRecovery(...a);return mockRecoveryOverride??result;}}));
let mockOwnTicket:any=null,mockOwnTicketError:any=null,mockOwnTicketPending=false;
const mockOwnTicketRetry=jest.fn();
beforeEach(()=>{mockOwnTicket=null;mockOwnTicketError=null;mockOwnTicketPending=false;});
jest.mock('../../../lib/eventTicketReturn',()=>({readEventTicketReturn:(...a:unknown[])=>{mockOwnTicketRetry(...a);if(mockOwnTicketPending)return new Promise(()=>{});if(mockOwnTicketError)return Promise.reject(mockOwnTicketError);return Promise.resolve(mockOwnTicket);}}));
const mockTopicLookup=jest.fn(),mockTopicRetry=jest.fn();
let mockTopicData:any='exact-topic',mockTopicError:any=null,mockTopicPending=false,mockTopicFetching=false;
beforeEach(()=>{mockTopicData='exact-topic';mockTopicError=null;mockTopicPending=false;mockTopicFetching=false;mockTopicLookup.mockResolvedValue('exact-topic');});
jest.mock('../../../lib/communityChat',()=>({getEventTopicId:(...a:unknown[])=>mockTopicLookup(...a)}));
const mockOpenUrl=jest.fn(),mockRetryEvent=jest.fn();
let mockEventError:any=null,mockEventFetching=false;
let mockTicketData:any, mockTicketError:any=null, mockTicketFetching=false;
const mockTicketRetry=jest.fn(),mockRsvpRetry=jest.fn(),mockAccountRetry=jest.fn();
let mockRsvpData:any=null,mockRsvpError:any=null,mockRsvpPending=false,mockRsvpFetching=false,mockAccountError:any=null;
beforeEach(()=>{mockRsvpData=null;mockRsvpError=null;mockRsvpPending=false;mockRsvpFetching=false;mockAccountError=null;});
beforeEach(()=>{mockTicketData={onSale:false,fromCents:null,allSoldOut:false,scarcity:null};mockTicketError=null;mockTicketFetching=false;});
beforeEach(()=>{mockEventError=null;mockEventFetching=false;});
jest.mock('../../../lib/url',()=>({openUrl:(...a:unknown[])=>mockOpenUrl(...a)}));
jest.mock('../../../components/creator/pages/CreatorPageEventGate',()=>({__esModule:true,default:(props:any)=>{
 mockPreviewGate=props;
 return mockPreviewAllowed ? props.children({pageId:props.pageId,name:'Exact page',kind:'organization',ownerId:'owner',isPublished:mockPreviewPublished,entry:props.team?'team':'owner'}) : require('react').createElement(require('react-native').Text,null,'Page preview unavailable');
}}));
jest.mock('../../../constants/FeatureFlags',()=>({get CREATOR_PAGES_ENABLED(){return mockEnabled;},get COMMUNITIES_ENABLED(){return mockCommunities;},MEMBER_STATE_ENABLED:true,SCENE_DISCOVERY_ENABLED:true}));
jest.mock('../../../hooks/usePublicPageScope',()=>({usePublicPageScope:()=>({scope:mockScope,account:{viewerId:mockScope?.userId,isLoading:false,error:mockAccountError,retry:mockAccountRetry}})}));
jest.mock('../../../hooks/useBlock',()=>({useBlock:()=>({blockUser:jest.fn()})}));
jest.mock('../../../lib/supabase',()=>({supabase:{auth:{getUser:async()=>({data:{user:{id:'member'}}})}}}));
jest.mock('../../../lib/publishedPageIdentity',()=>({loadPublishedEventPageIdentities:(...a:unknown[])=>mockLinks(...a),publishedPageRoute:(p:any)=>`/organization/${p.pageId}?identity=page`}));
jest.mock('../../../lib/publishedOrganizationPage',()=>({loadPublishedOrganizationPage:(...a:unknown[])=>mockRelated(...a)}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>mockParams??({id:'saved-event'}),router:{push:(...a:unknown[])=>mockPush(...a),back:jest.fn()}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View,useSafeAreaInsets:()=>({top:0,bottom:0})}));
jest.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:jest.fn(),setQueryData:jest.fn()}),useMutation:()=>({mutate:jest.fn()}),useQuery:(q:any)=>{mockQueries.push(q);const key=q.queryKey[0];return {isPending:key==='event-owned-tickets'?mockOwnTicketPending:key==='event-topic'?mockTopicPending:key==='event-rsvp'&&mockRsvpPending,data:key==='community-membership'?mockMembership:key==='event-owned-tickets'?mockOwnTicket:key==='event-rsvp'?mockRsvpData:key==='event-topic'?mockTopicData:key==='public-ticket-summary'?mockTicketData:key==='explore-event'?mockEvent:q.enabled===false?undefined:key==='organizer-profile-of'?{display_name:'Old account',logo_url:'old-logo'}:key==='organizer-follow'?{available:true,following:false}:undefined,isLoading:false,error:key==='event-owned-tickets'?mockOwnTicketError:key==='event-topic'?mockTopicError:key==='event-rsvp'?mockRsvpError:key==='public-ticket-summary'?mockTicketError:key==='explore-event'?mockEventError:null,isFetching:key==='event-topic'?mockTopicFetching:key==='event-rsvp'?mockRsvpFetching:key==='public-ticket-summary'?mockTicketFetching:key==='explore-event'&&mockEventFetching,refetch:key==='event-owned-tickets'?mockOwnTicketRetry:key==='event-topic'?mockTopicRetry:key==='event-rsvp'?mockRsvpRetry:key==='public-ticket-summary'?mockTicketRetry:mockRetryEvent};}}));
jest.mock('../../../components/LinkifiedText',()=>({__esModule:true,default:()=>null}));
jest.mock('../../../components/modals/ReportModal',()=>({ReportModal:()=>null}));
jest.mock('../../../components/BrandedAlert',()=>({BrandedAlert:(p:any)=>{mockPreviewAlert=p;return null;}}));
jest.mock('../../../components/scene/GeneratedPoster',()=>({GeneratedPoster:()=>null}));
jest.mock('../../../components/legal/ParticipationNotice',()=>({ParticipationNotice:()=>null}));
jest.mock('../../../components/events/EventBodyBlocks',()=>({EventBodyBlocks:()=>null}));
jest.mock('../../../components/events/EventFaqCards',()=>({EventFaqCards:()=>null}));
jest.mock('../../../components/events/TicketCheckoutSheet',()=>({TicketCheckoutSheet:()=>null}));
let mockChooser:any;
jest.mock('../../../components/plans/PlanChooserSheet',()=>({__esModule:true,default:(props:any)=>{mockChooser=props;return null;}}));
jest.mock('../../../components/communities/JoinCommunityPopup',()=>({JoinCommunityPopup:()=>null}));
jest.mock('../../../components/creator/pages/OrganizationPageFollowControls',()=>({OrganizationPageFollowControls:()=>null}));
jest.mock('../../../components/creator/pages/PublishedPageCover',()=>({PublishedPageCover:()=>null}));
jest.mock('../../../lib/logger',()=>({}));
jest.mock('../../../lib/pendingLink',()=>({}));
jest.mock('../../../lib/addToCalendar',()=>({}));
jest.mock('../../../lib/organizerProfile',()=>({}));
jest.mock('../../../lib/organizerFollows',()=>({}));
jest.mock('../../../lib/communityLeader',()=>({}));
jest.mock('../../../lib/participationTerms',()=>({}));
jest.mock('../../../lib/ticketing',()=>({formatCents:(c:number)=>`$${(c/100).toFixed(2)}`,isLowInventory:()=>false}));
jest.mock('../../../lib/communityJoin',()=>({}));
jest.mock('../../../lib/creatorMode',()=>({}));
jest.mock('../../../lib/eventRsvp',()=>({canParticipateInSceneEvent:()=>true,isCommunityEventReleaseBlocked:()=>false}));
jest.mock('../../../lib/sceneDiscovery',()=>({eventKickerLabel:()=>null}));
import EventDetail from '../[id]';
import {OrganizationPageFollowControls} from '../../../components/creator/pages/OrganizationPageFollowControls';
import {PublishedPageCover} from '../../../components/creator/pages/PublishedPageCover';
let tree:ReactTestRenderer;
const page={pageId:'page-a',ownerId:'owner',kind:'organization',name:'Exact organization',purpose:'Dinner together',coverMediaId:'cover-a'};
const mount=async()=>{await act(async()=>{tree=create(<EventDetail/>);});};
const enabled=(key:string)=>mockQueries.filter(q=>q.queryKey[0]===key).some(q=>q.enabled!==false);
beforeEach(()=>{jest.clearAllMocks();mockLinkedPlans.mockResolvedValue({plans:[],counts:{}});mockQueries.length=0;mockEnabled=true;mockCommunities=true;mockScope={userId:'member',isCurrent:()=>true};mockEvent={id:'saved-event',title:'Saved dinner',community_id:null,host_user_id:'owner',public_name:'Old override',status:'Live',ticket_price:0,offer_type:'free_event',description:null,description_blocks:null,event_date:null,start_time:null,end_time:null};mockLinks.mockResolvedValue(new Map([['saved-event',{pageId:'page-a',page}]]));mockRelated.mockResolvedValue({page,upcomingEvents:[{id:'same-page-event',title:'Next dinner',event_date:null}],pastEvents:[]});});
afterEach(()=>{act(()=>tree?.unmount());});
it.each([null, undefined])('renders an event without artwork (%s)',async(image)=>{
 mockEvent.image_url=image;await mount();
 expect(JSON.stringify(tree.toJSON())).toContain('Saved dinner');
});
beforeEach(()=>{mockParams=undefined;mockPreviewAllowed=true;mockPreviewPublished=true;mockPreviewGate=undefined;mockPreviewAlert=undefined;});
it('retains private page identity without describing it as unavailable',async()=>{
 mockParams={id:'saved-event',preview:'guest',pageId:'page-a'};mockPreviewPublished=false;
 mockLinks.mockResolvedValue(new Map([['saved-event',{pageId:'page-a',page:null}]]));await mount();
 expect(JSON.stringify(tree.toJSON())).toContain('Exact page');expect(JSON.stringify(tree.toJSON())).toContain('Your page is still private.');
 expect(JSON.stringify(tree.toJSON())).not.toContain('page is unavailable');
});
it('does not share or open checkout links from a page preview',async()=>{
 const share=jest.spyOn(Share,'share').mockResolvedValue({action:Share.dismissedAction});
 try {
  mockParams={id:'saved-event',preview:'guest',pageId:'page-a',team:'1'};mockEvent.external_url='https://example.com/tickets';mockEvent.ticket_price=25;await mount();
  await act(async()=>{await tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Share event')!.props.onPress();});
  expect(share).not.toHaveBeenCalled();expect(mockPreviewAlert.title).toBe('just a preview');
  await act(async()=>{await tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Get external tickets')!.props.onPress();});
  expect(mockOpenUrl).not.toHaveBeenCalled();
 } finally {share.mockRestore();}
});
it('uses exact page authorization for teammate preview and keeps participation controls in preview mode',async()=>{
 mockParams={id:'saved-event',preview:'guest',pageId:'page-a',team:'1'};
 mockEvent.status='Draft';await mount();
 expect(mockPreviewGate).toMatchObject({pageId:'page-a',eventId:'saved-event',team:true});
 expect(JSON.stringify(tree.toJSON())).toContain('how your page will look once it goes up');
 expect(tree.root.findByType(OrganizationPageFollowControls).props.preview).toBe(true);
});
it('does not mount the guest renderer when the page gate denies or retires access',async()=>{
 mockParams={id:'saved-event',preview:'guest',pageId:'page-a',team:'1'};mockPreviewAllowed=false;await mount();
 expect(JSON.stringify(tree.toJSON())).toContain('Page preview unavailable');
 expect(mockQueries).toHaveLength(0);expect(mockLinks).not.toHaveBeenCalled();
});
it('ignores page hints during ordinary public browsing',async()=>{
 mockParams={id:'saved-event',pageId:'page-a',team:'1'};await mount();
 expect(mockPreviewGate).toBeUndefined();expect(tree.root.findByType(OrganizationPageFollowControls).props.preview).toBe(false);
});
it('opens the exact organization and shares its follow and protected cover targets',async()=>{await mount();const control=tree.root.findByType(OrganizationPageFollowControls);expect(control.props).toMatchObject({pageId:'page-a',ownerId:'owner',scope:mockScope});expect(tree.root.findByType(PublishedPageCover).props).toMatchObject({pageId:'page-a',mediaId:'cover-a'});const link=tree.root.findAll(v=>v.props.accessibilityLabel==='Open Exact organization'&&v.props.onPress)[0];act(()=>link.props.onPress());expect(mockPush).toHaveBeenCalledWith('/organization/page-a?identity=page');for(const key of ['organizer-profile-of','organizer-follow','follower-count','track-record','more-from'])expect(enabled(key)).toBe(false);expect(mockRelated).toHaveBeenCalledWith('page-a',mockScope);expect(JSON.stringify(tree.toJSON())).toContain('Next dinner');});
it('holds legacy attribution and follow reads while page identity is pending, then offers a read retry on failure',async()=>{let reject:any;mockLinks.mockImplementationOnce(()=>new Promise((_,r)=>{reject=r;}));await mount();expect(enabled('organizer-follow')).toBe(false);expect(tree.root.findAllByType(OrganizationPageFollowControls)).toHaveLength(0);await act(async()=>reject(Error('Offline')));expect(JSON.stringify(tree.toJSON())).toContain('could not be checked');expect(enabled('organizer-profile-of')).toBe(false);});
it('does not attribute a known unpublished page to the creator account',async()=>{mockLinks.mockResolvedValue(new Map([['saved-event',{pageId:'page-a',page:null}]]));await mount();expect(JSON.stringify(tree.toJSON())).toContain('page is unavailable');expect(JSON.stringify(tree.toJSON())).not.toContain('Old override');expect(enabled('organizer-follow')).toBe(false);});
it('keeps unlinked legacy event follow and identity behavior',async()=>{mockEvent.public_name=null;mockLinks.mockResolvedValue(new Map());await mount();expect(enabled('organizer-profile-of')).toBe(true);expect(enabled('organizer-follow')).toBe(true);expect(JSON.stringify(tree.toJSON())).toContain('Old account');expect(tree.root.findAllByType(OrganizationPageFollowControls)).toHaveLength(0);});
it('keeps community membership, event-room and join reads without organization follows',async()=>{mockEvent.community_id='community-page';mockLinks.mockResolvedValue(new Map([['saved-event',{pageId:'community-page',page:{...page,pageId:'community-page',kind:'community'}}]]));await mount();expect(enabled('community-membership')).toBe(true);expect(enabled('event-topic')).toBe(true);expect(enabled('organizer-follow')).toBe(false);expect(enabled('follower-count')).toBe(false);expect(tree.root.findAllByType(OrganizationPageFollowControls)).toHaveLength(0);});
it('keeps the release flag off path independent of page services',async()=>{mockEnabled=false;mockEvent.public_name=null;await mount();expect(mockLinks).not.toHaveBeenCalled();expect(enabled('organizer-follow')).toBe(true);});

it('does not install an old account’s page identity after the account retires',async()=>{
 let resolve:any;mockLinks.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));await mount();
 mockScope.isCurrent=()=>false;mockScope={userId:'other',isCurrent:()=>true};mockLinks.mockResolvedValue(new Map([['saved-event',{pageId:'page-a',page:null}]]));
 await act(async()=>tree.update(<EventDetail/>));await act(async()=>resolve(new Map([['saved-event',{pageId:'page-a',page}]])));
 expect(tree.root.findAllByType(OrganizationPageFollowControls)).toHaveLength(0);expect(JSON.stringify(tree.toJSON())).not.toContain('Exact organization');
});

it('keeps a new organization identity/follow available when the separate Communities release gate is off',async()=>{mockCommunities=false;await mount();expect(tree.root.findByType(OrganizationPageFollowControls).props.pageId).toBe('page-a');expect(JSON.stringify(tree.toJSON())).toContain('Exact organization');expect(JSON.stringify(tree.toJSON())).toContain('Next dinner');expect(enabled('community-membership')).toBe(false);});

it('retries a failed event read without describing the event as removed',async()=>{
 mockEvent=undefined;mockEventError=Error('Offline');await mount();
 expect(JSON.stringify(tree.toJSON())).toContain('We couldn’t load this event');
 expect(JSON.stringify(tree.toJSON())).not.toContain('not around anymore');
 const retry=tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Try again')!;
 await act(async()=>retry.props.onPress());expect(mockRetryEvent).toHaveBeenCalledTimes(1);
 mockEventFetching=true;await act(async()=>tree.update(<EventDetail/>));
 expect(tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Try again')!.props.disabled).toBe(true);
});
it('retains the unavailable state for a confirmed missing row',async()=>{
 mockEvent=undefined;mockEventError={code:'PGRST116'};await mount();
 expect(JSON.stringify(tree.toJSON())).toContain('not around anymore');
 expect(tree.root.findAllByType(TouchableOpacity).some(n=>n.props.accessibilityLabel==='Try again')).toBe(false);
});
it('keeps cached event content mounted when its background refresh fails',async()=>{
 mockEventError=Error('Offline');await mount();
 expect(JSON.stringify(tree.toJSON())).toContain('Saved dinner');
 expect(JSON.stringify(tree.toJSON())).not.toContain('We couldn’t load this event');
});

// Read recovery must never open a free-participation path by mistake.
it('waits for ticket availability before exposing participation',async()=>{
 mockTicketData=undefined;mockTicketFetching=true;await mount();const text=JSON.stringify(tree.toJSON());
 expect(text).toContain('Checking ticket availability');expect(text).not.toContain('count me in');expect(text).not.toContain('get tickets');
});
it('offers an explicit retry after a ticket read fails instead of free RSVP',async()=>{
 mockTicketData=undefined;mockTicketError=new Error('offline');await mount();const text=JSON.stringify(tree.toJSON());
 expect(text).toContain('Ticket availability could not be checked.');expect(text).not.toContain('count me in');
 act(()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Check ticket availability')!.props.onPress());
 expect(mockTicketRetry).toHaveBeenCalledTimes(1);
});
it('does not reuse a cached empty ticket result after a failed refresh',async()=>{
 mockTicketError=new Error('offline');await mount();expect(JSON.stringify(tree.toJSON())).not.toContain('count me in');
});
it('restores existing free participation only after a confirmed empty read',async()=>{
 await mount();expect(JSON.stringify(tree.toJSON())).toContain('count me in');
});
it('shows confirmed sellout without a free participation button',async()=>{
 mockTicketData={onSale:false,fromCents:null,allSoldOut:true,scarcity:null};await mount();const text=JSON.stringify(tree.toJSON());
 expect(text).toContain('sold out');expect(text).not.toContain('count me in');
});

it('keeps an explicitly ticketed page event out of the free RSVP path when sales are closed',async()=>{
 mockEvent.offer_type='ticketed_event';mockTicketData={onSale:false,fromCents:null,allSoldOut:false,scarcity:null,notOnSale:true};await mount();
 expect(JSON.stringify(tree.toJSON())).toContain('Tickets are not on sale right now.');expect(JSON.stringify(tree.toJSON())).not.toContain('count me in');
 expect(mockQueries.filter(q=>q.queryKey[0]==='public-ticket-summary').at(-1).queryKey).toContain(true);
});
it('never infers a free offer from missing page offer metadata',async()=>{
 delete mockEvent.offer_type;await mount();expect(JSON.stringify(tree.toJSON())).not.toContain('count me in');expect(JSON.stringify(tree.toJSON())).toContain('Ticket availability could not be checked.');
});


it('keeps free attendance pending until the current account status is read',async()=>{
 mockRsvpPending=true;await mount();const text=JSON.stringify(tree.toJSON());expect(text).toContain('Checking your attendance');expect(text).not.toContain('count me in');
});
it('failed attendance read offers read-only retry rather than a new RSVP',async()=>{
 mockRsvpError=Error('offline');await mount();expect(JSON.stringify(tree.toJSON())).toContain('Your attendance could not be checked.');expect(JSON.stringify(tree.toJSON())).not.toContain('count me in');
 act(()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Check attendance')!.props.onPress());expect(mockRsvpRetry).toHaveBeenCalledTimes(1);
 mockRsvpError=null;mockRsvpData='going';await act(async()=>tree.update(<EventDetail/>));expect(JSON.stringify(tree.toJSON())).toContain("you're going");
});
it('does not expose stale going/chat actions after a failed attendance refresh',async()=>{
 mockEvent.community_id='community-page';mockLinks.mockResolvedValue(new Map([['saved-event',{pageId:'community-page',page:{...page,pageId:'community-page',kind:'community'}}]]));mockRsvpData='going';mockRsvpError=Error('offline');await mount();const text=JSON.stringify(tree.toJSON());expect(text).toContain('Your attendance could not be checked.');expect(text).not.toContain('open the chat');
});
it('uses the observed account for attendance queries after account change',async()=>{
 await mount();expect(mockQueries.filter(q=>q.queryKey[0]==='event-rsvp').at(-1).queryKey).toEqual(['event-rsvp','saved-event','member']);
 mockScope.isCurrent=()=>false;mockScope={userId:'other',isCurrent:()=>true};mockRsvpPending=true;mockRsvpData=undefined;await act(async()=>tree.update(<EventDetail/>));
 expect(mockQueries.filter(q=>q.queryKey[0]==='event-rsvp').at(-1).queryKey).toEqual(['event-rsvp','saved-event','other']);expect(JSON.stringify(tree.toJSON())).toContain('Checking your attendance');
});
it('attendance recovery retries an unavailable account before its row',async()=>{
 mockAccountError=Error('offline');await mount();act(()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Check attendance')!.props.onPress());expect(mockAccountRetry).toHaveBeenCalledTimes(1);expect(mockRsvpRetry).not.toHaveBeenCalled();
});

const communityAttendance=()=>{mockEvent.community_id='community-page';mockLinks.mockResolvedValue(new Map([['saved-event',{pageId:'community-page',page:{...page,pageId:'community-page',kind:'community'}}]]));mockRsvpData='going';};
it('recovers an event chat lookup without inviting another RSVP or navigating stale data',async()=>{
 communityAttendance();mockTopicError=Error('offline');await mount();expect(JSON.stringify(tree.toJSON())).toContain('Your event chat could not be checked.');expect(JSON.stringify(tree.toJSON())).not.toContain('open the chat');
 act(()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Check event chat')!.props.onPress());expect(mockTopicRetry).toHaveBeenCalledTimes(1);expect(mockPush).not.toHaveBeenCalled();
 mockTopicError=null;await act(async()=>tree.update(<EventDetail/>));expect(JSON.stringify(tree.toJSON())).toContain('open the chat');
});
it('keeps confirmed attendance visible while checking the event conversation',async()=>{
 communityAttendance();mockTopicData=null;mockTopicPending=true;await mount();expect(JSON.stringify(tree.toJSON())).toContain("you're going");expect(JSON.stringify(tree.toJSON())).toContain('Checking your event chat');expect(tree.root.findAllByType(TouchableOpacity).some(n=>n.props.accessibilityLabel==='Check event chat')).toBe(false);
});
it('offers recovery for a missing conversation rather than removing the chat entry silently',async()=>{
 communityAttendance();mockTopicData=null;await mount();expect(JSON.stringify(tree.toJSON())).toContain('Your event chat is not available yet.');expect(tree.root.findAllByType(TouchableOpacity).some(n=>n.props.accessibilityLabel==='Check event chat')).toBe(true);
});
it('uses strict event lookup and refuses a result from a retired account or visit',async()=>{
 communityAttendance();let current=true;mockScope.isCurrent=()=>current;await mount();const query=mockQueries.filter(q=>q.queryKey[0]==='event-topic').at(-1);expect(query.queryKey).toEqual(['event-topic','saved-event','member']);
 await expect(query.queryFn()).resolves.toBe('exact-topic');expect(mockTopicLookup).toHaveBeenCalledWith('saved-event',true);
 mockTopicLookup.mockImplementation(async()=>{current=false;return 'old-room';});await expect(query.queryFn()).rejects.toThrow('Your account changed');
});

it('shows read-only recovery for an uncertain attendance write instead of another toggle',async()=>{
 const check=jest.fn(),change=jest.fn();mockRecoveryOverride={phase:'unknown',blocked:true,busy:false,error:null,check,change};communityAttendance();await mount();
 const text=JSON.stringify(tree.toJSON());expect(text).toContain('Your attendance change has not been confirmed yet.');expect(text).not.toContain('open the chat');expect(text).not.toContain('count me in');
 act(()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Check attendance change')!.props.onPress());expect(check).toHaveBeenCalledTimes(1);expect(change).not.toHaveBeenCalled();
});
it('retains cancellation confirmation and uses the recovery action only after confirmation',async()=>{
 const change=jest.fn().mockResolvedValue(true);mockRecoveryOverride={phase:'ready',blocked:false,busy:false,error:null,check:jest.fn(),change};communityAttendance();await mount();
 const button=tree.root.findAllByType(TouchableOpacity).find(n=>n.findAllByType(Text).some(t=>t.props.children==="you're going"))!;
 await act(async()=>{await button.props.onPress();});expect(change).not.toHaveBeenCalled();
 await act(async()=>{await mockPreviewAlert.buttons.find((b:any)=>b.text==='take me off').onPress();});expect(change).toHaveBeenCalledWith(false);
});

it('recognizes a ticket buyer without RSVP and returns to the exact order and chat',async()=>{
 mockOwnTicket={orderId:'original-order',quantity:2};mockEvent.community_id='community-page';mockEvent.offer_type='ticketed_event';mockTicketData={onSale:true,fromCents:2500,allSoldOut:false,scarcity:null};mockLinks.mockResolvedValue(new Map());await mount();
 const text=JSON.stringify(tree.toJSON());expect(text).toContain('Your tickets');expect(text).not.toContain('get tickets');expect(text).not.toContain('count me in');
 act(()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Your tickets')!.props.onPress());expect(mockPush).toHaveBeenCalledWith('/tickets/order/original-order');
 const chat=tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Open event chat')!;act(()=>chat.props.onPress());expect(mockPush).toHaveBeenCalledWith('/community-topic/exact-topic');
 mockPush.mockClear();mockScope.isCurrent=()=>false;act(()=>chat.props.onPress());expect(mockPush).not.toHaveBeenCalled();
});
it('retains purchased ticket access when remaining inventory is sold out',async()=>{
 mockOwnTicket={orderId:'original-order',quantity:1};mockTicketData={onSale:false,allSoldOut:true,fromCents:null,scarcity:null};await mount();expect(JSON.stringify(tree.toJSON())).toContain('Your tickets');expect(JSON.stringify(tree.toJSON())).not.toContain('sold out');
});
it('a failed ownership read suppresses cached purchase and new attendance with retry',async()=>{
 mockOwnTicket={orderId:'old-order',quantity:1};mockOwnTicketError=Error('offline');await mount();const text=JSON.stringify(tree.toJSON());expect(text).toContain('Your tickets could not be checked.');expect(text).not.toContain('count me in');expect(text).not.toContain('get tickets');
 await act(async()=>{tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Check your tickets')!.props.onPress();});expect(mockOwnTicketRetry).toHaveBeenCalled();
});
it('checks owned tickets before offering another purchase and preserves preview independence',async()=>{
 mockOwnTicketPending=true;await mount();expect(JSON.stringify(tree.toJSON())).toContain('Checking your tickets');
 mockOwnTicketRetry.mockClear();mockParams={id:'saved-event',preview:'guest',pageId:'page-a'};await act(async()=>tree.update(<EventDetail/>));expect(mockOwnTicketRetry).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).not.toContain('Checking your tickets');
});
it('keeps ticket return when event chat is unavailable and offers its existing recovery',async()=>{
 mockOwnTicket={orderId:'original-order',quantity:1};mockEvent.community_id='community-page';mockLinks.mockResolvedValue(new Map());mockTopicError=Error('offline');await mount();expect(JSON.stringify(tree.toJSON())).toContain('Your tickets');expect(JSON.stringify(tree.toJSON())).toContain('Your event chat could not be checked.');expect(tree.root.findAllByType(TouchableOpacity).some(n=>n.props.accessibilityLabel==='Open event chat')).toBe(false);
 act(()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Check event chat')!.props.onPress());expect(mockTopicRetry).toHaveBeenCalled();
});

it('rechecks purchase entitlement on a new focused visit instead of keeping old seats',async()=>{
 mockOwnTicket={orderId:'old-order',quantity:1};await mount();expect(JSON.stringify(tree.toJSON())).toContain('Your tickets');
 mockScope.isCurrent=()=>false;mockScope={userId:'member',isCurrent:()=>true};mockOwnTicket=null;await act(async()=>tree.update(<EventDetail/>));
 expect(JSON.stringify(tree.toJSON())).not.toContain('Your tickets');expect(JSON.stringify(tree.toJSON())).toContain('count me in');
});

it('preserves organization find-people and quieter additional purchase without a community chat',async()=>{
 mockOwnTicket={orderId:'original-order',quantity:1};mockEvent.offer_type='ticketed_event';mockTicketData={onSale:true,fromCents:2500,allSoldOut:false,scarcity:null};await mount();
 const text=JSON.stringify(tree.toJSON());expect(text).toContain('Your tickets');expect(text).toContain('find people');expect(text).toContain('Get more tickets');expect(tree.root.findAllByType(TouchableOpacity).some(n=>n.props.accessibilityLabel==='Open event chat')).toBe(false);
});

it.each(['active','pending'])('guest preview ignores cached %s membership without changing the real view',async(status)=>{
 mockEvent.community_id='community-page';mockMembership=status;
 mockLinks.mockResolvedValue(new Map([['saved-event',{pageId:'community-page',page:{...page,pageId:'community-page',kind:'community'}}]]));
 await mount();
 const label=status==='active'?'You’re a member':'pending';
 expect(tree.root.findAllByType(Text).some(n=>n.props.children===label)).toBe(true);
 mockParams={id:'saved-event',preview:'guest',pageId:'community-page'};
 await act(async()=>tree.update(<EventDetail/>));
 expect(mockQueries.filter(q=>q.queryKey[0]==='community-membership').at(-1).enabled).toBe(false);
 expect(tree.root.findAllByType(Text).some(n=>n.props.children===label)).toBe(false);
 const join=tree.root.findAllByType(TouchableOpacity).find(n=>n.findAllByType(Text).some(t=>t.props.children==='ask to join'));
 expect(join).toBeDefined();await act(async()=>join!.props.onPress());
 expect(mockPreviewAlert.title).toBe('just a preview');
 mockParams={id:'saved-event'};await act(async()=>tree.update(<EventDetail/>));
 expect(tree.root.findAllByType(Text).some(n=>n.props.children===label)).toBe(true);
});

const linkedPlanFixture={id:'linked-plan',title:'Meet by the pier',start_time:'2026-09-20T18:00:00Z',location_text:'Ocean Park',member_count:99,max_invites:7,status:'active',creator_user_id:'owner',creator_name:'Aster',creator_photo:null,primary_vibe:null};
const findPeople=()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Find people')!;
it('failed linked Plan read is not an empty invitation or permission to start a new Plan',async()=>{
 mockLinkedPlans.mockRejectedValue(Error('Offline'));await mount();expect(JSON.stringify(tree.toJSON())).toContain('Plans couldn’t be checked.');expect(JSON.stringify(tree.toJSON())).not.toContain('no one has posted');expect(findPeople().props.disabled).toBe(true);act(()=>findPeople().props.onPress());expect(mockPush).not.toHaveBeenCalled();
 mockLinkedPlans.mockResolvedValue({plans:[linkedPlanFixture],counts:{'linked-plan':2}});await act(async()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Retry linked plans')!.props.onPress());expect(findPeople().props.disabled).toBe(false);act(()=>findPeople().props.onPress());expect(mockChooser.visible).toBe(true);expect(mockChooser.plans[0].spotsText).toBe('6 spots left');expect(mockPush).not.toHaveBeenCalled();
});
it('waits for linked Plans before creating even when list is currently empty',async()=>{let resolve:any;mockLinkedPlans.mockImplementationOnce(()=>new Promise(r=>resolve=r));await mount();expect(findPeople().props.disabled).toBe(true);act(()=>findPeople().props.onPress());expect(mockPush).not.toHaveBeenCalled();await act(async()=>resolve({plans:[],counts:{}}));act(()=>findPeople().props.onPress());expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({pathname:'/(tabs)/post',params:expect.objectContaining({prefillExploreEventId:'saved-event'})}));});
it('the chooser opens the exact existing Plan without creating or joining it',async()=>{mockLinkedPlans.mockResolvedValue({plans:[linkedPlanFixture],counts:{'linked-plan':2}});await mount();act(()=>findPeople().props.onPress());act(()=>mockChooser.onSelectPlan('linked-plan'));expect(mockPush).toHaveBeenCalledWith('/plan/linked-plan');});
it('old handoff callbacks cannot route after account/visit retirement',async()=>{mockLinkedPlans.mockResolvedValue({plans:[linkedPlanFixture],counts:{'linked-plan':2}});await mount();const oldFind=findPeople().props.onPress;act(()=>oldFind());const oldChoose=mockChooser.onSelectPlan;mockScope.isCurrent=()=>false;mockScope={userId:'other',isCurrent:()=>true};mockLinkedPlans.mockResolvedValue({plans:[],counts:{}});await act(async()=>tree.update(<EventDetail/>));act(()=>{oldFind();oldChoose('linked-plan');});expect(mockPush).not.toHaveBeenCalled();expect(mockChooser.visible).toBe(false);});
it('community events do not query linked Plans or render a Find people alternative',async()=>{mockEvent.community_id='community-page';await mount();expect(mockLinkedPlans).not.toHaveBeenCalled();expect(findPeople()).toBeUndefined();});
