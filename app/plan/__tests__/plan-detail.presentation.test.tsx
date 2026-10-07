const mockNotificationRequest = jest.fn();
jest.mock('../../../lib/planNotificationPrompt', () => ({ requestPlanNotificationPrompt: (...args: any[]) => mockNotificationRequest(...args) }));
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Dimensions, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity } from 'react-native';
import PlanDetailScreen from '../[id]';
import { PlanDetailOverview } from '../../../components/plans/PlanDetailOverview';

let mockMemberAppearance = true;
let mockYoursEnabled = false;
jest.mock('../../../constants/MemberAppearance', () => ({ get MEMBER_REDESIGN_APPEARANCE_ENABLED() { return mockMemberAppearance; } }));

let mockPeople: any[] = [];
let mockPeopleError = false;
let mockAccount = 'viewer';
let mockEpoch = 1;
let mockPlan: any;
let mockMembers: any[];
let mockContext: any;
let mockContextReady = true;
let mockContextError = false;
let mockMembersError = false;
let mockPlanError = false;
let mockCanGoBack = false;
let mockUnconfirmed = false;
let mockViewer: any;
let mockJoinOptions: any;
let mockDepartureOptions: any;
let mockDeparture: any;
const mockLeave = jest.fn(), mockCancel = jest.fn(), mockCheckDeparture = jest.fn();
const mockJoin = jest.fn(), mockPush = jest.fn(), mockReplace = jest.fn(), mockBack = jest.fn();
const mockRetryContext = jest.fn(async () => ({})), mockRetryMembers = jest.fn(), mockRetryPlan = jest.fn();
const mockNotice = jest.fn(async () => ({ needsAssent: false }));
const mockAssent = jest.fn(async () => true);
const mockCurrent = jest.fn(() => true);
const mockQueries = new Map<string, any>();
const mockClient = { invalidateQueries: jest.fn() };
const mockSave = jest.fn();
let mockWishlist: any;
const mockMutationCalls: any[] = [];
const mockSelect = jest.fn();
const mockUpdate = jest.fn();
let mockRead: any = null;
let mockEditResponse: any = undefined, mockPlacesProps: any;
const mockPhotoUpload=jest.fn();
let mockWaitlist:any, mockWaitlistOptions:any;
const mockWaitlistChange=jest.fn(),mockWaitlistRefresh=jest.fn(),mockWaitlistRetry=jest.fn();
const mockTable: any = { select: (...args: any[]) => { mockSelect(...args); return mockTable; }, eq: () => mockTable, is: () => mockTable, update: (payload: any) => {mockUpdate(payload);return mockTable;},
  single: async () => ({ data: mockRead, error: null }), maybeSingle: () => Promise.resolve(mockEditResponse ?? { data: mockUpdate.mock.calls.length ? {...mockPlan,...mockUpdate.mock.calls.at(-1)[0]} : null, error: null }), then: (yes: any) => Promise.resolve({ data: [], error: null }).then(yes) };

let mockInterest:any,mockInterestOptions:any;
const mockInterestSend=jest.fn(),mockInterestRetry=jest.fn();
jest.mock('../../../hooks/usePlanInterest',()=>({usePlanInterest:(options:any)=>{mockInterestOptions=options;return mockInterest;}}));
// Coordination is a separate lazy bundle; its real transport and UI are exercised in the browser fixture.
jest.mock('react', () => ({ ...jest.requireActual('react'), lazy: () => () => null }));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mockClient,
  useMutation: (options: any) => { mockMutationCalls.push(options); return { isPending: false, mutate: jest.fn() }; },
  useQuery: (options: any) => {
    const key = options.queryKey.join('/'); mockQueries.set(key, options);
    const base = { isSuccess: true, isLoading: false, isError: false, error: null, refetch: jest.fn() };
    if (key.startsWith('events/detail/')) return { ...base, data: mockPlan, error: mockPlanError ? new Error('failed') : null, isError: mockPlanError, refetch: mockRetryPlan };
    if (key.startsWith('events/members/')) return { ...base, data: mockMembers, isError: mockMembersError, isSuccess: !mockMembersError, refetch: mockRetryMembers };
    if (key.startsWith('yours/grid/')) return { ...base, data: mockPeople, isError: mockPeopleError, isSuccess: !mockPeopleError };
    if (key.startsWith('plan-viewer/')) return { ...base, data: mockViewer };
    return { ...base, data: undefined };
  },
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({top:0,bottom:0,left:0,right:0}) }));
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null }, useLocalSearchParams: () => ({ id: 'plan-1' }),
  useFocusEffect: (callback: any) => { require('react').useEffect(callback, [callback]); },
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, canGoBack: () => mockCanGoBack }),
}));
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => ({ viewerId: mockAccount, epoch: mockEpoch, isLoading: false, error: null, isCurrent: mockCurrent }) }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').AfterglowFonts }) }));
jest.mock('../../../constants/FeatureFlags', () => ({ GROUPS_ENABLED: true, COMMUNITY_CHAT_GROUPING_ENABLED: true, COMMUNITIES_ENABLED: true, get YOURS_PAGE_ENABLED() { return mockYoursEnabled; } }));
jest.mock('../../../hooks/useCirclePlanContext', () => ({ useCirclePlanContext: (_id: any, options: any) => { mockQueries.set('circle-options', options); return { data: mockContext, isContextReady: mockContextReady, isError: mockContextError, refetch: mockRetryContext }; } }));
jest.mock('../../../hooks/usePlanJoin', () => ({ usePlanJoin: (options: any) => { mockJoinOptions = options; return { join: mockJoin, isPending: false, unconfirmed: mockUnconfirmed, isCurrent: mockCurrent }; } }));
let mockInvitation:any,mockInvitationOptions:any;const mockInviteDecline=jest.fn(),mockInviteRefresh=jest.fn(),mockInviteRetry=jest.fn(),mockInviteComplete=jest.fn(),mockInvitePrepare=jest.fn();
jest.mock('../../../hooks/usePlanInvitation',()=>({usePlanInvitation:(options:any)=>{mockInvitationOptions=options;return mockInvitation;}}));
jest.mock('../../../hooks/usePlanWaitlist',()=>({usePlanWaitlist:(options:any)=>{mockWaitlistOptions=options;return mockWaitlist;}}));
jest.mock('../../../hooks/usePlanDeparture', () => ({ usePlanDeparture: (options: any) => { mockDepartureOptions = options; return mockDeparture; } }));
jest.mock('../../../hooks/useFeedWishlist', () => ({ useFeedWishlist: () => mockWishlist }));
jest.mock('../../../hooks/useBlock', () => ({ useBlock: () => ({ blockUser: jest.fn() }) }));
jest.mock('../../../lib/supabase', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: { id: mockAccount } }, error: null }), refreshSession:async()=>({error:null}) }, from: () => mockTable, rpc: async () => ({ data: [], error: null }) } }));
jest.mock('../../../lib/participationTerms', () => ({ getParticipationNoticeStatus: () => mockNotice(), recordParticipationAssent: () => mockAssent() }));
jest.mock('../../../lib/logger',()=>({logError:jest.fn()}));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn(), hapticMedium: jest.fn(), hapticSuccess: jest.fn(), hapticWarning: jest.fn() }));
jest.mock('../../../lib/addToCalendar', () => ({ showAddToCalendar: jest.fn() }));
jest.mock('../../../lib/uploadPhoto', () => ({ uploadBase64ToStorage: (...args: any[])=>mockPhotoUpload(...args) }));
jest.mock('expo-location', () => ({ geocodeAsync: async () => [] }));
jest.mock('expo-image-picker', () => ({requestMediaLibraryPermissionsAsync:async()=>({status:'granted'}),launchImageLibraryAsync:async()=>({canceled:false,assets:[{uri:'file://sample'}]})}));
jest.mock('expo-image-manipulator', () => ({SaveFormat:{JPEG:'jpeg'},manipulateAsync:async()=>({base64:'sample'})}));
jest.mock('react-native-google-places-autocomplete', () => ({ GooglePlacesAutocomplete: (props:any) => {mockPlacesProps=props;return null;} }));
jest.mock('../../../components/MapView', () => ({ MapView: () => null, Marker: () => null }));
jest.mock('../../../components/MiniProfileCard', () => () => null);
jest.mock('../../../components/modals/ReportModal', () => ({ ReportModal: () => null }));
jest.mock('../../../components/modals/SharePlanModal', () => ({ SharePlanModal: () => null }));
jest.mock('../../../components/legal/ParticipationNotice', () => ({ ParticipationNotice: () => null }));
jest.mock('../../../components/circles/plan/CirclePlanCoordination', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/calendar/WashedUpCalendar', () => () => null);
jest.mock('../../../components/yours/ping/PingAfterPlanModal', () => () => null);
jest.mock('../../../components/BrandedAlert', () => ({ BrandedAlert: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

let tree: ReactTestRenderer;
const allText = () => tree.root.findAllByType(Text).flatMap(n => [n.props.children].flat(Infinity)).filter(v => typeof v === 'string' || typeof v === 'number').join(' ');
const button = (label: string) => tree.root.findAllByType(TouchableOpacity).find(n => n.findAllByType(Text).some(t => t.props.children === label))!;
async function mount() { await act(async () => { tree = create(<PlanDetailScreen />); }); }
beforeEach(() => {
  mockMemberAppearance = true; mockCanGoBack = false;
  mockPeople=[];mockPeopleError=false;
  mockInterest={entry:null,ready:true,loading:false,busy:false,phase:null,error:null,send:mockInterestSend,retry:mockInterestRetry,refresh:jest.fn()};
  mockInvitePrepare.mockReturnValue(mockInviteComplete);mockInvitation={invitation:null,attempt:null,loading:false,busy:false,ready:true,error:null,decline:mockInviteDecline,refresh:mockInviteRefresh,retry:mockInviteRetry,prepareAcceptance:mockInvitePrepare,keepInvitation:jest.fn()};
  mockWaitlist={entry:null,ready:true,loading:false,busy:false,error:null,intent:null,change:mockWaitlistChange,refresh:mockWaitlistRefresh,retry:mockWaitlistRetry,clearAfterJoining:jest.fn(),setExceptionStatus:jest.fn(),capture:()=>mockCurrent};
  mockEditResponse=undefined;mockPhotoUpload.mockReset().mockResolvedValue("https://example.test/photo.jpg");
  jest.clearAllMocks(); mockQueries.clear(); mockMutationCalls.length = 0;
  mockNotice.mockResolvedValue({ needsAssent: false }); mockAssent.mockResolvedValue(true); mockJoin.mockReset();
  mockDeparture = { leave: mockLeave, cancel: mockCancel, checkResult: mockCheckDeparture, isPending: false, isChecking: false, unknownAction: null, isCurrent: mockCurrent };
  mockYoursEnabled = false; mockAccount = 'viewer'; mockEpoch = 1; mockCurrent.mockReturnValue(true);
  mockPlan = { id: 'plan-1', title: 'Coffee with a few new faces', description: 'Meet by the park.', host_message: 'Come as you are.', circle_id: null,
    start_time: '2040-09-16T17:00:00Z', end_time: null, location_text: 'Ocean Park', location_lat: null, location_lng: null, image_url: null, primary_vibe: 'Outdoors',
    gender_rule: 'mixed', target_age_min: null, target_age_max: null, max_invites: 7, min_invites: 2, member_count: 3, creator_user_id: 'amelia',
    creator: { id: 'amelia', first_name_display: 'Amelia', profile_photo_url: null }, is_featured: false, status: 'active' };
  mockMembers = ['amelia', 'jamie', 'riley'].map(id => ({ id, user_id: id, first_name_display: id, profile_photo_url: null, joined_at: '' }));
  mockViewer = { gender: 'woman', birthday: '1990-01-01', is_official_host: false };
  mockContext = { is_circle_plan: false }; mockContextReady = true; mockContextError = false; mockMembersError = false; mockPlanError = false; mockUnconfirmed = false;
  mockWishlist = { data: [], canWrite: true, pending: () => false, toggle: mockSave };
});
afterEach(() => { if (tree) act(() => tree.unmount()); jest.restoreAllMocks(); });

it('uses the real title-first overview and retains the creator, ordinary capacity and query scopes', async () => {
  await mount(); const overview = tree.root.findByType(PlanDetailOverview);
  expect(overview.props.capacity).toBe('5 spots left'); expect(overview.props.plan.creator.first_name_display).toBe('Amelia');
  expect(allText().indexOf(mockPlan.title)).toBeLessThan(allText().indexOf('Amelia'));
  expect(mockQueries.has('events/detail/plan-1/viewer/1')).toBe(true);
  expect(mockQueries.has('events/members/plan-1/viewer/1')).toBe(true);
  expect(mockQueries.get('circle-options').event).toEqual({ id: 'plan-1', circle_id: null });
  expect(button("Let's Go →").props.disabled).toBe(false);
});
it('keeps missing provenance missing rather than manufacturing ordinary context', async () => { delete mockPlan.circle_id; mockContextReady = false; mockContext = undefined; await mount(); expect(mockQueries.get('circle-options').event.circle_id).toBeUndefined(); expect(mockJoinOptions.ready).toBe(false); });
it.each(['loading', 'error'])('does not expose join while known Circle context is %s', async mode => {
  mockPlan.circle_id = 'circle-1'; mockContextReady = false; mockContext = undefined; mockContextError = mode === 'error'; await mount();
  expect(mockJoinOptions.ready).toBe(false); expect(button("Let's Go →")).toBeUndefined();
  expect(allText()).toContain(mode === 'error' ? 'Couldn’t check the joining details.' : 'Checking the joining details…');
});
it('keeps public Circle availability separate from uncapped people going', async () => {
  mockPlan.circle_id = 'circle-1'; mockPlan.max_invites = 15; mockMembers = Array.from({length: 12}, (_,i) => ({id:String(i),user_id:String(i),first_name_display:`Friend ${i}`,profile_photo_url:null}));
  mockContext = { is_circle_plan:true,circle_id:'circle-1',circle_visibility:'open',has_own_chat:true,viewer_is_member:false,viewer_stranger_spots_left:2 }; await mount();
  const overview=tree.root.findByType(PlanDetailOverview); expect(overview.props.capacity).toBe('12 going'); expect(overview.props.capacityDetail).toBe('2 public spots open'); expect(button("Let's Go →")).toBeDefined();
});
it('does not promise the ordinary waitlist for a full Circle plan', async () => {
  mockPlan.circle_id='circle-1'; mockContext={is_circle_plan:true,circle_id:'circle-1',circle_visibility:'open',has_own_chat:true,viewer_is_member:false,viewer_stranger_spots_left:0}; await mount();
  expect(allText()).toContain('The public spots are full'); expect(button('Join waitlist')).toBeUndefined(); expect(button("Let's Go →")).toBeUndefined();
});
it('keeps the ordinary full-plan waitlist action', async () => { mockMembers=Array.from({length:8},(_,i)=>({id:String(i),user_id:String(i),first_name_display:`Person ${i}`,profile_photo_url:null})); await mount(); expect(button('Join waitlist')).toBeDefined(); });
it('does not offer a private Circle outsider any join action', async () => {
  mockPlan.circle_id='circle-1'; mockContext={is_circle_plan:true,circle_id:'circle-1',circle_visibility:'circle_only',has_own_chat:false,viewer_is_member:false,viewer_stranger_spots_left:null}; await mount();
  expect(allText()).toContain('This plan is for circle members.'); expect(mockJoinOptions.ready).toBe(false);
});
it('preserves Circle member eligibility and intro bypass', async () => {
  mockPlan.circle_id='circle-1'; mockPlan.gender_rule='men_only'; mockContext={is_circle_plan:true,circle_id:'circle-1',circle_visibility:'circle_only',has_own_chat:false,viewer_is_member:true,viewer_stranger_spots_left:null}; await mount();
  await act(async()=>button("Let's Go →").props.onPress()); expect(mockNotice).toHaveBeenCalledTimes(1); expect(mockJoin).toHaveBeenCalledWith(undefined);
});
it('routes an existing Circle plan member to the existing circle conversation when there is no own chat', async()=>{
  mockPlan.circle_id='circle-1'; mockMembers.push({id:'viewer',user_id:'viewer',first_name_display:'You',profile_photo_url:null});
  mockContext={is_circle_plan:true,circle_id:'circle-1',circle_visibility:'circle_only',has_own_chat:false,viewer_is_member:true,viewer_stranger_spots_left:null}; await mount(); act(()=>button('Open Chat').props.onPress()); expect(mockPush).toHaveBeenCalledWith('/(tabs)/chats/circle/circle-1');
});
it('keeps ordinary members in the plan conversation', async()=>{ mockMembers.push({id:'viewer',user_id:'viewer',first_name_display:'You',profile_photo_url:null}); await mount(); act(()=>button('Open Chat').props.onPress()); expect(mockPush).toHaveBeenCalledWith('/(tabs)/chats/plan-1'); });
it('offers fresh-read recovery rather than Join after an unknown receipt', async()=>{mockUnconfirmed=true;await mount();expect(button("Let's Go →")).toBeUndefined();act(()=>button('Check plan').props.onPress());expect(mockRetryMembers).toHaveBeenCalled();expect(mockJoin).not.toHaveBeenCalled();});
it('shows read failure with a retry instead of empty attendees',async()=>{mockMembersError=true;await mount();expect(allText()).toContain('Couldn’t load who’s going.');expect(mockJoinOptions.ready).toBe(false);});
it('offers retry and a cold-entry Plans fallback after detail failure',async()=>{mockPlanError=true;mockPlan=undefined;await mount();act(()=>button('Try again').props.onPress());act(()=>button('Go back').props.onPress());expect(mockRetryPlan).toHaveBeenCalled();expect(mockReplace).toHaveBeenCalledWith('/(tabs)/plans');});
it('passes saving through the established receipt-aware wishlist hook',async()=>{await mount();const save=tree.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Save plan')!;act(()=>save.props.onPress());expect(mockSave).toHaveBeenCalledWith('plan-1',mockPlan.title,false);});
it('does not dispatch a Circle join after participation checking retires the visit',async()=>{mockPlan.circle_id='circle-1';mockContext={is_circle_plan:true,circle_id:'circle-1',circle_visibility:'circle_only',has_own_chat:false,viewer_is_member:true};mockNotice.mockImplementationOnce(async()=>{mockCurrent.mockReturnValue(false);return {needsAssent:false};});await mount();await act(async()=>button("Let's Go →").props.onPress());expect(mockJoin).not.toHaveBeenCalled();});
it('does not treat a missing source event as a confirmed cancellation',async()=>{await mount();const query=mockQueries.get('plan-source-event-gone/plan-1/viewer/1');expect(await query.queryFn()).toBe(false);});

it('opens the ordinary greeting sheet and passes the retained greeting through the original participation check',async()=>{
  await mount(); act(()=>button("Let's Go →").props.onPress());
  const Sheet=require('../../../components/plans/PlanJoinSheet').PlanJoinSheet;
  let sheet=tree.root.findByType(Sheet);expect(sheet.props.visible).toBe(true);expect(sheet.props.confirmed).toBe(false);expect(mockJoin).not.toHaveBeenCalled();
  act(()=>{sheet.props.onMessage('Hello, see you there!');sheet.props.onConfirmed(true);});
  sheet=tree.root.findByType(Sheet);await act(async()=>sheet.props.onJoin());
  expect(mockNotice).toHaveBeenCalledTimes(1);expect(mockJoin).toHaveBeenCalledWith('Hello, see you there!');
});
it('retires the previous account’s greeting and controls when the account generation changes',async()=>{
  await mount();act(()=>button("Let's Go →").props.onPress());const Sheet=require('../../../components/plans/PlanJoinSheet').PlanJoinSheet;
  act(()=>tree.root.findByType(Sheet).props.onMessage('A private draft for this visit'));
  mockAccount='another-viewer';mockEpoch=2;await act(async()=>tree.update(<PlanDetailScreen/>));
  const sheet=tree.root.findByType(Sheet);expect(sheet.props.message).toBe('');expect(sheet.props.visible).toBe(false);
  expect(mockQueries.has('events/detail/plan-1/another-viewer/2')).toBe(true);
});
it('keeps the confirmed Circle conversation during a context refresh after joining',async()=>{
  mockPlan.circle_id='circle-1';mockContext={is_circle_plan:true,circle_id:'circle-1',circle_visibility:'circle_only',has_own_chat:false,viewer_is_member:true};await mount();
  act(()=>mockJoinOptions.onJoined());mockContext=undefined;mockContextReady=false;await act(async()=>tree.update(<PlanDetailScreen/>));
  const Sharing=require('../../../components/modals/SharePlanModal').SharePlanModal;
  act(()=>tree.root.findByType(Sharing).props.onClose());expect(mockPush).toHaveBeenCalledWith('/(tabs)/chats/circle/circle-1');
});
it('reveals only accepted People handles, ignoring handles supplied by public rows',async()=>{
  mockPlan.creator.handle='public.creator';mockMembers[1].handle='public.jamie';
  mockPeople=[{user_id:'amelia',handle:' @amelia.accepted '}];await mount();
  const overview=tree.root.findByType(PlanDetailOverview);
  expect(overview.props.visibleHandles).toEqual({amelia:' @amelia.accepted '});
  expect(allText()).toContain('amelia.accepted');expect(allText()).not.toMatch(/public.creator|public.jamie/);
});
it('hides handles on a People read failure even when cached data and public handles remain',async()=>{
  mockPeople=[{user_id:'amelia',handle:'amelia.accepted'}];mockPeopleError=true;mockMembers[1].handle='public.jamie';await mount();
  expect(tree.root.findByType(PlanDetailOverview).props.visibleHandles).toEqual({});
  expect(allText()).not.toMatch(/amelia.accepted|public.jamie/);
});
it('removes a handle from a mounted detail when the person is no longer accepted',async()=>{
  mockPeople=[{user_id:'amelia',handle:'amelia.accepted'}];await mount();expect(allText()).toContain('amelia.accepted');
  mockPeople=[];await act(async()=>tree.update(<PlanDetailScreen/>));expect(allText()).not.toContain('amelia.accepted');
});
it('announces confirmed participation without changing the existing chat and leave destinations',async()=>{
  mockMembers.push({id:'viewer',user_id:'viewer',first_name_display:'You',profile_photo_url:null});await mount();
  expect(tree.root.findByType(PlanDetailOverview).props.capacity).toBe('You’re going');
  expect(tree.root.findByType(PlanDetailOverview).props.capacityDetail).toBe('4 going, including you');
  act(()=>button('Open Chat').props.onPress());expect(mockPush).toHaveBeenCalledWith('/(tabs)/chats/plan-1');
});
it('retains an unconfirmed introduction after membership succeeds and waits for iOS dismissal before recovery',async()=>{
  await mount();act(()=>button("Let's Go →").props.onPress());
  act(()=>mockJoinOptions.onJoined({greetingUnconfirmed:'My original introduction'}));
  const Sheet=require('../../../components/plans/PlanJoinSheet').PlanJoinSheet;
  const Sharing=require('../../../components/modals/SharePlanModal').SharePlanModal;
  const Alert=require('../../../components/BrandedAlert').BrandedAlert;
  expect(tree.root.findByType(Sheet).props.message).toBe('My original introduction');expect(tree.root.findByType(Sharing).props.visible).toBe(false);
  act(()=>tree.root.findByType(Sheet).props.onDismiss());
  const recovery=tree.root.findAllByType(Alert).find(n=>n.props.title==='You’re in')!;
  expect(recovery.props.scrollMessage).toBe(true);expect(recovery.props.message).toContain('My original introduction');expect(recovery.props.message).toContain('Check the conversation before sending it again');
  act(()=>recovery.props.buttons[0].onPress());expect(mockPush).toHaveBeenCalledWith('/(tabs)/chats/plan-1');expect(mockJoin).not.toHaveBeenCalled();
});
it('retires an open introduction when age or gender eligibility changes',async()=>{
  await mount();act(()=>button("Let's Go →").props.onPress());mockPlan={...mockPlan,gender_rule:'men_only'};
  await act(async()=>tree.update(<PlanDetailScreen/>));const Sheet=require('../../../components/plans/PlanJoinSheet').PlanJoinSheet;
  expect(tree.root.findByType(Sheet).props.canJoin).toBe(false);expect(mockJoinOptions.ready).toBe(false);
});
it('makes a direct Circle-member participation-check failure visible without an open greeting sheet',async()=>{
  mockPlan.circle_id='circle-1';mockContext={is_circle_plan:true,circle_id:'circle-1',circle_visibility:'circle_only',has_own_chat:false,viewer_is_member:true};
  mockNotice.mockRejectedValueOnce(new Error('offline'));await mount();await act(async()=>button("Let's Go →").props.onPress());
  const Alert=require('../../../components/BrandedAlert').BrandedAlert;
  expect(tree.root.findAllByType(Alert).some(n=>n.props.visible&&n.props.message==='Couldn’t check the joining details. Try again.')).toBe(true);
  expect(mockJoin).not.toHaveBeenCalled();
});

it.each(['retired visit', 'dismissed alert', 'repeated tap'])('prevents recovery navigation from a %s',async(mode)=>{
  await mount();act(()=>mockJoinOptions.onJoined({greetingUnconfirmed:'Keep this introduction'}));
  const Alert=require('../../../components/BrandedAlert').BrandedAlert;
  const recovery=tree.root.findAllByType(Alert).find(n=>n.props.title==='You’re in')!.props;
  if(mode==='retired visit') mockCurrent.mockReturnValue(false);
  if(mode==='dismissed alert') act(()=>recovery.onClose());
  if(mode==='repeated tap') act(()=>recovery.buttons[0].onPress());
  act(()=>recovery.buttons[0].onPress());
  expect(mockPush).toHaveBeenCalledTimes(mode==='repeated tap'?1:0);
  expect(mockJoin).not.toHaveBeenCalled();
});

const joinSheet = () => tree.root.findByType(require('../../../components/plans/PlanJoinSheet').PlanJoinSheet).props;
const participation = () => tree.root.findByType(require('../../../components/legal/ParticipationNotice').ParticipationNotice).props;
const sharing = () => tree.root.findByType(require('../../../components/modals/SharePlanModal').SharePlanModal).props;
async function openTermsFromGreeting() {
  mockNotice.mockResolvedValue({ needsAssent: true }); await mount();
  act(() => button("Let's Go →").props.onPress());
  act(() => { joinSheet().onMessage('The original hello'); joinSheet().onConfirmed(true); });
  await act(async () => joinSheet().onJoin());
}

it('waits for the iOS greeting sheet dismissal before presenting participation, once', async () => {
  await openTermsFromGreeting();
  expect(joinSheet().visible).toBe(false); expect(participation().visible).toBe(false); expect(mockJoin).not.toHaveBeenCalled();
  const wrongSource = participation().onDismiss, dismiss = joinSheet().onDismiss;
  act(() => wrongSource()); expect(participation().visible).toBe(false);
  act(() => { dismiss(); dismiss(); });
  expect(participation().visible).toBe(true); expect(joinSheet().message).toBe('The original hello');
  expect(mockNotice).toHaveBeenCalledTimes(1); expect(mockAssent).not.toHaveBeenCalled();
});

it.each(['share', 'error'] as const)('waits for iOS notice dismissal before fast join %s feedback', async result => {
  await openTermsFromGreeting(); act(() => joinSheet().onDismiss());
  mockJoin.mockImplementationOnce(() => result === 'share' ? mockJoinOptions.onJoined() : mockJoinOptions.onError('Please check this plan.'));
  let agreement!: Promise<boolean>;
  await act(async () => { agreement = participation().onAgree(); });
  expect(mockAssent).toHaveBeenCalledTimes(1); expect(participation().visible).toBe(false); expect(mockJoin).not.toHaveBeenCalled(); expect(sharing().visible).toBe(false);
  act(() => joinSheet().onDismiss()); expect(mockJoin).not.toHaveBeenCalled();
  const dismiss = participation().onDismiss;
  await act(async () => { dismiss(); dismiss(); expect(await agreement).toBe(true); });
  expect(mockJoin).toHaveBeenCalledTimes(1); expect(mockJoin).toHaveBeenCalledWith('The original hello');
  if (result === 'share') expect(sharing().visible).toBe(true);
  else expect(tree.root.findAllByType(require('../../../components/BrandedAlert').BrandedAlert).some(n => n.props.visible && n.props.message === 'Please check this plan.')).toBe(true);
});

it('a retired account cannot consume a queued notice-to-join transition', async () => {
  await openTermsFromGreeting(); act(() => joinSheet().onDismiss());
  let agreement!: Promise<boolean>; await act(async () => { agreement = participation().onAgree(); });
  const oldDismiss = participation().onDismiss;
  mockAccount = 'replacement'; mockEpoch++;
  await act(async () => { tree.update(<PlanDetailScreen />); });
  await act(async () => { oldDismiss(); expect(await agreement).toBe(false); });
  expect(mockJoin).not.toHaveBeenCalled(); expect(participation().visible).toBe(false); expect(sharing().visible).toBe(false);
});

it('a retired greeting-sheet transition cannot open its pending notice', async () => {
  await openTermsFromGreeting(); const dismiss = joinSheet().onDismiss;
  mockCurrent.mockReturnValue(false); await act(async () => dismiss());
  expect(participation().visible).toBe(false); expect(mockJoin).not.toHaveBeenCalled();
  mockCurrent.mockReturnValue(true); act(() => dismiss()); expect(participation().visible).toBe(false);
});

it('cancelled participation waits for dismissal, retains the greeting and never records or joins', async () => {
  await openTermsFromGreeting(); act(() => joinSheet().onDismiss()); const oldNotice = participation();
  act(() => oldNotice.onClose()); expect(participation().visible).toBe(false); expect(joinSheet().busy).toBe(true);
  await act(async () => { expect(await oldNotice.onAgree()).toBe(false); });
  act(() => participation().onDismiss()); expect(joinSheet().busy).toBe(false);
  expect(joinSheet().message).toBe('The original hello'); expect(mockAssent).not.toHaveBeenCalled(); expect(mockJoin).not.toHaveBeenCalled();
});

it.each(['web', 'android'] as const)('preserves immediate participation transitions on %s', async platform => {
  jest.replaceProperty(Platform, 'OS', platform);
  await openTermsFromGreeting(); expect(joinSheet().visible).toBe(false); expect(participation().visible).toBe(true);
  await act(async () => { expect(await participation().onAgree()).toBe(true); });
  expect(participation().visible).toBe(false); expect(mockJoin).toHaveBeenCalledTimes(1);
});

it('keeps pending iOS greeting recovery mounted through a cached-detail refresh error', async () => {
  await mount(); act(() => button("Let's Go →").props.onPress());
  act(() => mockJoinOptions.onJoined({ greetingUnconfirmed: 'Keep this pending introduction' }));
  mockPlanError = true; await act(async () => tree.update(<PlanDetailScreen />));
  expect(joinSheet().message).toBe('Keep this pending introduction'); expect(joinSheet().canJoin).toBe(false);
  act(() => joinSheet().onDismiss());
  expect(tree.root.findAllByType(require('../../../components/BrandedAlert').BrandedAlert).some(n => n.props.visible && n.props.message.includes('Keep this pending introduction'))).toBe(true);
});

const departureSheet = () => tree.root.findByType(require('../../../components/plans/PlanDepartureSheet').PlanDepartureSheet);
it.each(['cancelled','CANCELLED','completed','COMPLETED'])('closes joining for a future %s plan',async(status)=>{
  mockPlan.status=status;await mount();expect(tree.root.findByType(PlanDetailOverview).props.capacity).toBe(status.toLowerCase()==='cancelled'?'Plan cancelled':'Plan ended');expect(tree.root.findByType(PlanDetailOverview).props.capacityDetail).toBeUndefined();expect(mockJoinOptions.status).toBe(status);expect(mockJoinOptions.ready).toBe(false);
  expect(button("Let's Go →")).toBeUndefined();expect(button('Join waitlist')).toBeUndefined();expect(mockDepartureOptions.ready).toBe(false);
});
it.each(['cancelled','completed'])('keeps existing conversation but removes creator management for %s',async(status)=>{
  mockPlan.status=status;mockPlan.creator_user_id='viewer';mockMembers.push({id:'viewer',user_id:'viewer'});await mount();
  expect(button('Manage Plan')).toBeUndefined();expect(button('Cancel this plan')).toBeUndefined();expect(button('Open Chat')).toBeDefined();
});
it('confirms leaving in one sheet and exits once only after confirmed success',async()=>{
  mockMembers.push({id:'viewer',user_id:'viewer'});await mount();act(()=>button("Can't make it?").props.onPress());
  expect(mockLeave).not.toHaveBeenCalled();act(()=>departureSheet().props.onConfirm());expect(mockLeave).toHaveBeenCalledTimes(1);
  act(()=>mockDepartureOptions.onSuccess({action:'leave',announcementUnconfirmed:true}));
  expect(departureSheet().props.result.announcementUnconfirmed).toBe(true);expect(mockReplace).not.toHaveBeenCalled();
  const done=departureSheet().props.onDone;act(()=>{done();done();});expect(mockReplace).toHaveBeenCalledTimes(1);
});
it('waits for creator Manage modal dismissal before opening cancellation on iOS',async()=>{
  mockPlan.creator_user_id='viewer';await mount();act(()=>button('Manage Plan').props.onPress());
  const manage=tree.root.findAllByType(require('react-native').Modal).find(n=>n.props.visible&&n.props.animationType==='slide')!;
  act(()=>button('Cancel plan').props.onPress());expect(mockCancel).not.toHaveBeenCalled();
  expect(tree.root.findAllByType(require('../../../components/plans/PlanDepartureSheet').PlanDepartureSheet)).toHaveLength(0);
  await act(async()=>manage.props.onDismiss());expect(departureSheet().props.action).toBe('cancel');
  act(()=>departureSheet().props.onConfirm());expect(mockCancel).toHaveBeenCalledTimes(1);
});
it('reopens unresolved departure without offering another membership action',async()=>{
  mockDeparture.unknownAction='leave';await mount();expect(button("Let's Go →")).toBeUndefined();
  act(()=>button('Check status').props.onPress());expect(departureSheet().props.unknown).toBe(true);
  act(()=>departureSheet().props.onCheck());expect(mockCheckDeparture).toHaveBeenCalledTimes(1);expect(mockLeave).not.toHaveBeenCalled();
});
it('ignores departure confirmation after the initiating visit retires',async()=>{
  mockMembers.push({id:'viewer',user_id:'viewer'});await mount();act(()=>button("Can't make it?").props.onPress());
  const confirm=departureSheet().props.onConfirm;mockCurrent.mockReturnValue(false);act(()=>confirm());expect(mockLeave).not.toHaveBeenCalled();
});

const manageInput = (value:string) => tree.root.findAllByType(require('react-native').TextInput).find(n=>n.props.value===value)!;
const manageModal = () => tree.root.findAllByType(require('react-native').Modal).find(n=>n.props.visible&&n.props.animationType==='slide')!;
async function openEditor(){mockPlan.creator_user_id='viewer';await mount();act(()=>button('Manage Plan').props.onPress());}
it('preserves custom ages and exact stored schedule on a title-only creator edit',async()=>{
  mockPlan.target_age_min=25;mockPlan.target_age_max=35;mockPlan.start_time='2040-11-04T09:30:17.123Z';mockPlan.end_time='2040-11-04T11:30:17.123Z';
  await openEditor();expect(allText()).toContain('Ages 25–35. Kept unless you choose a range.');
  act(()=>manageInput(mockPlan.title).props.onChangeText('New title'));
  await act(async()=>button('Save changes').props.onPress());expect(mockUpdate).toHaveBeenCalledTimes(1);
  const payload=mockUpdate.mock.calls[0][0];expect(payload.title).toBe('New title');
  for(const key of ['target_age_min','target_age_max','start_time','end_time','max_invites','is_featured','featured_type'])expect(payload).not.toHaveProperty(key);
});
it('allows explicit replacement of custom ages with All Ages',async()=>{
  mockPlan.target_age_min=21;mockPlan.target_age_max=null;await openEditor();act(()=>button('All Ages').props.onPress());
  await act(async()=>button('Save changes').props.onPress());expect(mockUpdate.mock.calls[0][0]).toMatchObject({target_age_min:null,target_age_max:null});
});
it('discards abandoned Featured changes each time the editor opens',async()=>{
  mockViewer.is_official_host=true;await openEditor();const Switch=require('react-native').Switch;
  act(()=>tree.root.findByType(Switch).props.onValueChange(true));act(()=>manageModal().props.onRequestClose());act(()=>button('Manage Plan').props.onPress());
  expect(tree.root.findByType(Switch).props.value).toBe(false);await act(async()=>button('Save changes').props.onPress());expect(mockUpdate.mock.calls[0][0]).not.toHaveProperty('is_featured');
});
it('does not overwrite an active Featured draft when background plan data refreshes',async()=>{
  mockViewer.is_official_host=true;await openEditor();const Switch=require('react-native').Switch;act(()=>tree.root.findByType(Switch).props.onValueChange(true));
  mockPlan={...mockPlan,is_featured:false,featured_type:'birthday_party',max_invites:4};await act(async()=>tree.update(<PlanDetailScreen/>));
  expect(tree.root.findByType(Switch).props.value).toBe(true);await act(async()=>button('Save changes').props.onPress());expect(mockUpdate.mock.calls[0][0]).toMatchObject({is_featured:true,featured_type:'washedup_event',max_invites:99});
});
it('keeps ordinary and Featured capacity editing off Circle plans',async()=>{
  mockViewer.is_official_host=true;mockPlan.circle_id='circle-1';mockPlan.max_invites=15;
  mockContext={is_circle_plan:true,circle_id:'circle-1',circle_visibility:'open',has_own_chat:true,viewer_is_member:true,viewer_stranger_spots_left:4};
  await openEditor();expect(allText()).not.toContain('How many to invite');expect(tree.root.findAllByType(require('react-native').Switch)).toHaveLength(0);
  await act(async()=>button('Save changes').props.onPress());expect(mockUpdate.mock.calls[0][0]).not.toHaveProperty('max_invites');expect(mockUpdate.mock.calls[0][0]).not.toHaveProperty('is_featured');
});

it('closes Manage only after the exact updated plan receipt',async()=>{await openEditor();act(()=>manageInput(mockPlan.title).props.onChangeText('Updated coffee'));await act(async()=>button('Save changes').props.onPress());expect(tree.root.findAllByType(Modal).some(n=>n.props.visible&&n.props.animationType==='slide')).toBe(false);expect(mockClient.invalidateQueries).toHaveBeenCalled();});
it('keeps an uncertain save visible and checks it without a second write',async()=>{mockEditResponse={data:null,error:null};await openEditor();await act(async()=>button('Save changes').props.onPress());expect(allText()).toContain('Check your changes');expect(button('Save changes')).toBeUndefined();expect(manageModal().props.visible).toBe(true);mockEditResponse=undefined;await act(async()=>button('Check changes').props.onPress());expect(mockUpdate).toHaveBeenCalledTimes(1);expect(tree.root.findAllByType(Modal).some(n=>n.props.visible&&n.props.animationType==='slide')).toBe(false);});
it('clears old map coordinates when the creator types a new location',async()=>{mockPlan.location_lat=34.005;mockPlan.location_lng=-118.487;await openEditor();act(()=>mockPlacesProps.textInputProps.onChangeText('A different cafe'));await act(async()=>button('Save changes').props.onPress());expect(mockUpdate.mock.calls[0][0]).toMatchObject({location_text:'A different cafe',location_lat:null,location_lng:null});});
it('keeps the selected place name and coordinates together',async()=>{await openEditor();act(()=>mockPlacesProps.onPress({description:'New cafe',structured_formatting:{main_text:'New cafe'}},{geometry:{location:{lat:34.1,lng:-118.2}}}));await act(async()=>button('Save changes').props.onPress());expect(mockUpdate.mock.calls[0][0]).toMatchObject({location_text:'New cafe',location_lat:34.1,location_lng:-118.2});});
it('preserves the previous photo when replacement upload fails',async()=>{mockPlan.image_url='https://example.test/old.jpg';mockPhotoUpload.mockRejectedValue(new Error('Rejected'));await openEditor();await act(async()=>button('Change photo').props.onPress());expect(mockPhotoUpload).toHaveBeenCalledTimes(1);expect(allText()).toContain('Couldn’t upload this photo');await act(async()=>button('Save changes').props.onPress());expect(mockUpdate.mock.calls[0][0]).toMatchObject({image_url:'https://example.test/old.jpg'});});

function fillOrdinaryPlan(){mockMembers=Array.from({length:8},(_,i)=>({id:String(i),user_id:String(i),first_name_display:`Person ${i}`,profile_photo_url:null}));mockPlan.allow_duplicate=false;}
it('keeps failed waitlist reads distinct from an empty waitlist',async()=>{fillOrdinaryPlan();mockWaitlist.ready=false;mockWaitlist.error='Couldn’t check your waitlist. Try again.';await mount();expect(button('Join waitlist')).toBeUndefined();act(()=>button('Try again').props.onPress());expect(mockWaitlistRefresh).toHaveBeenCalledTimes(1);expect(mockWaitlistChange).not.toHaveBeenCalled();});
it('retries the original failed waitlist intention instead of toggling',async()=>{fillOrdinaryPlan();mockWaitlist.intent={phase:'failed',desired:true};mockWaitlist.error='Couldn’t join the waitlist. Try again.';await mount();act(()=>button('Try again').props.onPress());expect(mockWaitlistRetry).toHaveBeenCalledTimes(1);expect(mockWaitlistChange).not.toHaveBeenCalled();});
it('offers read-only checking for unknown waitlist receipts',async()=>{fillOrdinaryPlan();mockWaitlist.intent={phase:'unknown',desired:true};await mount();act(()=>button('Check waitlist').props.onPress());expect(mockWaitlistRefresh).toHaveBeenCalledTimes(1);expect(mockWaitlistChange).not.toHaveBeenCalled();});
it('names waitlist removal and does not imply a reserved place',async()=>{fillOrdinaryPlan();mockWaitlist.entry={id:'entry'};await mount();expect(allText()).toContain('A place isn’t reserved yet');act(()=>button('Leave waitlist').props.onPress());expect(mockWaitlistChange).toHaveBeenCalledWith(false);});
it('does not let the ordinary waitlist controller write for a Circle',async()=>{mockPlan.circle_id='circle';mockContext={is_circle_plan:true,circle_id:'circle',circle_visibility:'public',viewer_is_circle_member:false,viewer_stranger_spots_left:0,has_own_chat:false};await mount();expect(mockWaitlistOptions.canChange()).toBe(false);});
it('preserves the creator opt-out from duplicate plans',async()=>{fillOrdinaryPlan();await mount();act(()=>button('Join waitlist').props.onPress());expect(mockWaitlistChange).toHaveBeenCalledWith(true);});

it('keeps unknown waitlist recovery reachable when a place opens',async()=>{mockWaitlist.intent={phase:'unknown',desired:true};await mount();expect(mockJoinOptions.ready).toBe(false);expect(button("Let's Go →")).toBeUndefined();act(()=>button('Check waitlist').props.onPress());expect(mockWaitlistRefresh).toHaveBeenCalledTimes(1);});
it('keeps unknown waitlist recovery ahead of a stale notified banner',async()=>{mockWaitlist.intent={phase:'unknown',desired:false};mockWaitlist.entry={id:'entry',notified:true};await mount();expect(button('Claim Your Spot')).toBeUndefined();expect(button('Check waitlist')).toBeDefined();});
it('does not block joining an open plan after a known waitlist rejection',async()=>{mockWaitlist.intent={phase:'failed',desired:true};await mount();expect(mockJoinOptions.ready).toBe(true);expect(button("Let's Go →")).toBeDefined();});

it('opens the introduction without accepting the invitation early',async()=>{mockInvitation.invitation={id:'invite'};await mount();act(()=>button('Join the plan').props.onPress());expect(joinSheet().visible).toBe(true);expect(mockInvitePrepare).toHaveBeenCalledTimes(1);expect(mockInviteComplete).not.toHaveBeenCalled();act(()=>mockJoinOptions.onJoined({}));expect(mockInviteComplete).toHaveBeenCalledTimes(1);});
it('discards invitation completion when the introduction is cancelled',async()=>{mockInvitation.invitation={id:'invite'};await mount();act(()=>button('Join the plan').props.onPress());act(()=>joinSheet().onClose());act(()=>mockJoinOptions.onJoined({}));expect(mockInviteComplete).not.toHaveBeenCalled();act(()=>button('Join the plan').props.onPress());expect(mockInvitePrepare).toHaveBeenCalledTimes(2);});
it('prevents repeated invitation taps from opening multiple handoffs',async()=>{mockInvitation.invitation={id:'invite'};await mount();const press=button('Join the plan').props.onPress;act(()=>{press();press();});expect(mockInvitePrepare).toHaveBeenCalledTimes(1);});
it('saves a decline through the invitation controller without a secrecy promise',async()=>{mockInvitation.invitation={id:'invite'};await mount();act(()=>button('Not this time').props.onPress());expect(mockInviteDecline).toHaveBeenCalledTimes(1);expect(allText()).not.toContain("We won't tell them");});
it('keeps membership and chat after an invitation acknowledgement fails',async()=>{mockMembers.push({id:'viewer',user_id:'viewer'});mockInvitation.attempt={reply:'accepted',phase:'failed'};mockInvitation.error='Couldn’t save your invitation reply. Try again.';await mount();expect(button('Open Chat')).toBeDefined();expect(allText()).toContain('You’re in this plan.');act(()=>button('Try again').props.onPress());expect(mockInviteRetry).toHaveBeenCalledTimes(1);expect(mockJoin).not.toHaveBeenCalled();});
it('keeps unknown invitation checking separate from another join',async()=>{mockInvitation.attempt={reply:'declined',phase:'unknown'};mockInvitation.error='Check this reply.';await mount();expect(mockJoinOptions.ready).toBe(false);act(()=>button('Check reply').props.onPress());expect(mockInviteRefresh).toHaveBeenCalledTimes(1);expect(mockInviteRetry).not.toHaveBeenCalled();});
it('refreshes a failed invitation read without submitting a reply',async()=>{mockInvitation.ready=false;mockInvitation.error='Couldn’t check this invitation. Try again.';await mount();act(()=>button('Try again').props.onPress());expect(mockInviteRefresh).toHaveBeenCalledTimes(1);expect(mockInviteRetry).not.toHaveBeenCalled();});

it('offers keeping a rejected invitation without pushing another join',async()=>{mockInvitation.attempt={reply:'declined',phase:'failed'};mockInvitation.error='Couldn’t save your invitation reply. Try again.';await mount();expect(button("Let's Go →")).toBeUndefined();act(()=>button('Keep invitation').props.onPress());expect(mockInvitation.keepInvitation).toHaveBeenCalledTimes(1);expect(mockJoin).not.toHaveBeenCalled();});

it('keeps Next time available for an ordinary full plan with incompatible current age rules',async()=>{mockPlan={...mockPlan,max_invites:0,age_min:80};await mount();expect(allText()).toContain('Next time');expect(mockInterestOptions.canSend()).toBe(true);act(()=>button('Next time').props.onPress());expect(mockInterestSend).toHaveBeenCalled();});
it('does not offer future interest to a private Circle outsider',async()=>{mockPlan.circle_id='circle-1';mockContext={is_circle_plan:true,circle_id:'circle-1',circle_visibility:'circle_only',viewer_is_member:false};await mount();expect(mockInterestOptions.canSend()).toBe(false);expect(allText()).not.toContain('Can’t make this one?');});
it('does not offer future interest with unknown Circle context',async()=>{mockContextReady=false;await mount();expect(mockInterestOptions.canSend()).toBe(false);});
it('does not offer future interest when the membership read failed',async()=>{mockMembersError=true;await mount();expect(mockInterestOptions.canSend()).toBe(false);});
it('uses saved interest copy without claiming that the creator has seen it',async()=>{mockInterest.entry={id:'saved'};await mount();expect(allText()).toContain('Interest saved');expect(allText()).not.toContain("knows you're interested");});
it('keeps uncertain interest checking reachable after the plan closes',async()=>{mockPlan.status='cancelled';mockInterest.phase='unknown';mockInterest.error='Your interest may be saved.';await mount();expect(allText()).toContain('Check interest');expect(mockInterestOptions.canSend()).toBe(false);act(()=>button('Check interest').props.onPress());expect(mockInterestRetry).toHaveBeenCalled();});

it('passes the saved location into the restored embedded map without changing directions', async () => {
  mockPlan.location_lat = 34.005; mockPlan.location_lng = -118.487;
  await mount();
  const overview = tree.root.findByType(PlanDetailOverview);
  expect(overview.props.mapCoords).toEqual({ latitude: 34.005, longitude: -118.487 });
  expect(tree.root.findAllByType(TouchableOpacity).find(n => n.props.accessibilityLabel === `Open map for ${mockPlan.location_text}`)).toBeDefined();
});

it('keeps the photo-first live detail and saved map while retaining the current join handler', async () => {
  mockMemberAppearance = false;
  mockPlan.location_lat = 34.005; mockPlan.location_lng = -118.487;
  await mount();
  expect(tree.root.findAllByType(PlanDetailOverview)).toHaveLength(0);
  const { MapView } = require('../../../components/MapView');
  expect(tree.root.findByType(MapView).props.initialRegion).toMatchObject({latitude:34.005,longitude:-118.487});
  expect(allText().indexOf(mockPlan.title)).toBeLessThan(allText().indexOf('amelia'));
  expect(allText()).not.toContain('POSTED');
  expect(button("Let's Go →").props.disabled).toBe(false);
  act(() => button("Let's Go →").props.onPress());
  expect(mockJoin).not.toHaveBeenCalled(); // Required introduction is not bypassed.
});
it('keeps the existing member chat destination when using the live detail presentation', async () => {
  mockMemberAppearance = false;
  mockMembers.push({id:'viewer',user_id:'viewer',first_name_display:'You',profile_photo_url:null});
  await mount(); act(()=>button('Open Chat').props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/chats/plan-1');
});

it('waits until the confirmed join share flow closes before requesting notifications', async () => {
  await mount(); act(() => mockJoinOptions.onJoined({})); expect(mockNotificationRequest).not.toHaveBeenCalled();
  const share = tree.root.findByType(require('../../../components/modals/SharePlanModal').SharePlanModal);
  act(() => share.props.onClose()); expect(mockNotificationRequest).toHaveBeenCalledTimes(1);
  expect(mockNotificationRequest.mock.calls[0][0]).toEqual({ userId: 'viewer', planId: 'plan-1', reason: 'joined' });
  expect(mockPush).toHaveBeenCalled();
});
it('waits for the ticket step after a confirmed join before requesting notifications', async () => {
  mockPlan.tickets_url = 'https://example.test/tickets'; await mount(); act(() => mockJoinOptions.onJoined({}));
  act(() => tree.root.findByType(require('../../../components/modals/SharePlanModal').SharePlanModal).props.onClose());
  expect(mockNotificationRequest).not.toHaveBeenCalled();
  act(() => button("I'll remember").props.onPress()); expect(mockNotificationRequest).toHaveBeenCalledTimes(1);
});
it('never requests notifications for an unconfirmed or failed join', async () => {
  mockUnconfirmed = true; await mount(); act(() => mockJoinOptions.onError('Check who is going.'));
  expect(mockNotificationRequest).not.toHaveBeenCalled();
});
it('does not request join notifications from a retired share callback', async () => {
  await mount(); act(() => mockJoinOptions.onJoined({}));
  const share = tree.root.findByType(require('../../../components/modals/SharePlanModal').SharePlanModal).props;
  mockCurrent.mockReturnValue(false); act(() => share.onClose()); expect(mockNotificationRequest).not.toHaveBeenCalled();
});
it('waits for the optional friend ping before requesting join notifications', async () => {
  mockYoursEnabled = true; await mount(); act(() => mockJoinOptions.onJoined({}));
  act(() => sharing().onClose()); expect(mockNotificationRequest).not.toHaveBeenCalled();
  const Ping = require('../../../components/yours/ping/PingAfterPlanModal');
  act(() => tree.root.findByType(Ping.default ?? Ping).props.onDone()); expect(mockNotificationRequest).toHaveBeenCalledTimes(1);
});
it('keeps introduction delivery recovery ahead of notifications after confirmed membership', async () => {
  await mount(); act(() => mockJoinOptions.onJoined({ greetingUnconfirmed: 'Keep this introduction' }));
  expect(mockNotificationRequest).not.toHaveBeenCalled();
  const Alert = require('../../../components/BrandedAlert').BrandedAlert;
  const recovery = tree.root.findAllByType(Alert).find(n => n.props.title === 'You’re in')!;
  act(() => recovery.props.buttons[0].onPress()); expect(mockNotificationRequest).toHaveBeenCalledTimes(1);
});

it.each([false, true])('keeps Circle creator management and Circle chat without ordinary waitlist tools (appearance %s)', async appearance => {
  mockMemberAppearance = appearance; mockPlan.creator_user_id = 'viewer'; mockPlan.circle_id = 'circle-1'; mockPlan.max_invites = 7;
  mockMembers = [{ id: 'viewer', user_id: 'viewer', first_name_display: 'You', profile_photo_url: null }];
  mockContext = { is_circle_plan: true, circle_id: 'circle-1', circle_visibility: 'circle_only', has_own_chat: false, viewer_is_member: true, viewer_stranger_spots_left: null };
  await mount();
  expect(button('Waitlist')).toBeUndefined();
  expect(button('Manage Plan')).toBeDefined(); expect(button('Cancel this plan')).toBeDefined();
  act(() => tree.root.findByProps({ accessibilityLabel: 'Go back' }).props.onPress());
  expect(mockReplace).toHaveBeenCalledWith('/(tabs)/plans'); // Existing no-history fallback stays intact.
  if (!appearance) {
    expect(allText()).toContain('1 going'); expect(allText()).toContain('Circle members can join this plan.');
    expect(allText()).not.toContain('spots left'); expect(allText()).not.toContain('Larger');
  }
  expect(mockQueries.get(require('../../../constants/QueryKeys').WAITLIST_MANAGER_KEY('plan-1').join('/')).enabled).toBe(false);
  act(() => button('Open Chat').props.onPress()); expect(mockPush).toHaveBeenCalledWith('/(tabs)/chats/circle/circle-1');
});

it('keeps live open-Circle attendance separate from public spots, without ordinary group-size copy', async () => {
  mockMemberAppearance = false; mockPlan.circle_id = 'circle-1'; mockPlan.max_invites = 7;
  mockMembers = Array.from({ length: 12 }, (_, i) => ({ id: String(i), user_id: String(i), first_name_display: `Friend ${i}`, profile_photo_url: null }));
  mockContext = { is_circle_plan: true, circle_id: 'circle-1', circle_visibility: 'open', has_own_chat: true, viewer_is_member: false, viewer_stranger_spots_left: 2 };
  await mount();
  expect(allText()).toContain('12 going'); expect(allText()).toContain('2 public spots open');
  expect(allText()).not.toContain('Larger'); expect(button("Let's Go →")).toBeDefined();
});

it.each(['context', 'members'])('does not invent Circle availability while the live %s read is unresolved', async missing => {
  mockMemberAppearance = false; mockPlan.circle_id = 'circle-1';
  mockContext = { is_circle_plan: true, circle_id: 'circle-1', circle_visibility: 'open', has_own_chat: true, viewer_is_member: false };
  if (missing === 'context') { mockContextReady = false; mockContext = undefined; } else mockMembersError = true;
  await mount(); expect(allText()).toContain('Checking availability…');
  expect(allText()).not.toContain('spots left'); expect(allText()).not.toContain('public spots open');
});

it('preserves ordinary creator waitlist access and live capacity information', async () => {
  mockMemberAppearance = false; mockPlan.creator_user_id = 'viewer'; await mount();
  expect(allText()).toContain('5 spots left'); expect(allText()).toContain('Larger');
  expect(mockQueries.get(require('../../../constants/QueryKeys').WAITLIST_MANAGER_KEY('plan-1').join('/')).enabled).toBe(true);
  act(() => button('Waitlist').props.onPress()); expect(mockPush).toHaveBeenCalledWith('/waitlist/plan-1');
});


it.each([true, false])('labels ordinary detail history honestly and keeps the existing back destination (appearance %s)', async appearance => {
  mockMemberAppearance = appearance; mockCanGoBack = true; await mount();
  const back = button('Back'); expect(back).toBeDefined();
  expect(back.props.accessibilityLabel).toBe('Go back'); expect(button('Plans')).toBeUndefined();
  act(() => back.props.onPress()); expect(mockBack).toHaveBeenCalledTimes(1); expect(mockReplace).not.toHaveBeenCalled();
});

it('retains the ordinary Plans label and destination when detail has no navigation history', async () => {
  await mount(); const back = button('Plans'); expect(back.props.accessibilityLabel).toBe('Go back to plans');
  act(() => back.props.onPress()); expect(mockReplace).toHaveBeenCalledWith('/(tabs)/plans'); expect(mockBack).not.toHaveBeenCalled();
});

it('keeps the error header truthful when the unavailable plan was opened from another screen', async () => {
  mockPlan = undefined; mockPlanError = true; mockCanGoBack = true; await mount();
  const back = tree.root.findByProps({ accessibilityLabel: 'Go back' });
  act(() => back.props.onPress()); expect(mockBack).toHaveBeenCalledTimes(1); expect(mockReplace).not.toHaveBeenCalled();
});


describe.each([true, false])('saved age audience with redesign appearance %s', appearance => {
  beforeEach(() => { mockMemberAppearance = appearance; });
  const ageLabels = () => tree.root.findAllByType(Text).filter(node => node.props.accessibilityLabel?.startsWith('Age range:')).map(node => node.props.children);

  it('shows the selected decades even when the plan has no category', async () => {
    mockPlan.primary_vibe = null;
    mockPlan.target_age_min = 20; mockPlan.target_age_max = 39;
    await mount();
    expect(ageLabels()).toEqual(['20s–30s']);
    expect(mockPlan.target_age_min).toBe(20); expect(mockPlan.target_age_max).toBe(39);
  });
  it('shows explicit All Ages using the shared unrestricted label', async () => {
    await mount(); expect(ageLabels()).toEqual(['Any age']);
  });
  it('does not describe unloaded age bounds as unrestricted', async () => {
    delete mockPlan.target_age_min; delete mockPlan.target_age_max;
    await mount(); expect(ageLabels()).toEqual([]);
  });
  it('omits ordinary age metadata for Circle plans with member bypass', async () => {
    mockPlan.circle_id = 'circle-1'; mockPlan.target_age_min = 20; mockPlan.target_age_max = 39;
    mockContext = { is_circle_plan: true, circle_id: 'circle-1', circle_visibility: 'circle_only', has_own_chat: false, viewer_is_member: true };
    await mount(); expect(ageLabels()).toEqual([]);
    expect(button("Let's Go →").props.disabled).toBe(false);
  });
});

const openCircleCopy = 'A group of friends is opening their plan to new people. Joining this plan doesn’t add you to their circle.';
it.each([false,true])('shares confirmed open-Circle explanation with appearance %s',async appearance=>{
 mockMemberAppearance=appearance;mockPlan.circle_id='circle-1';mockContext={is_circle_plan:true,circle_id:'circle-1',circle_visibility:'open',has_own_chat:true,viewer_is_member:false,viewer_stranger_spots_left:4};await mount();
 expect(allText()).toContain(openCircleCopy);expect(button("Let's Go →")).toBeDefined();expect(mockJoin).not.toHaveBeenCalled();
});
it.each(['ordinary','null','loading','context-error','plan-error','mismatch','unknown-visibility'])('does not make an open-Circle claim for %s context',async mode=>{
 mockMemberAppearance=false;mockPlan.circle_id='circle-1';mockContext={is_circle_plan:true,circle_id:'circle-1',circle_visibility:'open',has_own_chat:true,viewer_is_member:false,viewer_stranger_spots_left:4};
 if(mode==='ordinary'){mockPlan.circle_id=null;mockContext={is_circle_plan:false};}
 if(mode==='null')mockContext=null;
 if(mode==='loading')mockContextReady=false;
 if(mode==='context-error')mockContextError=true;
 if(mode==='plan-error')mockPlanError=true;
 if(mode==='mismatch')mockContext.circle_id='other-circle';
 if(mode==='unknown-visibility')mockContext.circle_visibility=undefined;
 await mount();expect(allText()).not.toContain(openCircleCopy);expect(allText()).not.toContain('A plan for this circle’s members.');
});
it('shows the confirmed private-Circle explanation without a public invitation',async()=>{
 mockMemberAppearance=false;mockPlan.circle_id='circle-1';mockContext={is_circle_plan:true,circle_id:'circle-1',circle_visibility:'circle_only',has_own_chat:false,viewer_is_member:false,viewer_stranger_spots_left:null};await mount();
 expect(allText()).toContain('A plan for this circle’s members.');expect(allText()).not.toContain(openCircleCopy);expect(button("Let's Go →")).toBeUndefined();
});
it('remeasures mounted fallback plan text in both directions while retaining the route and join control',async()=>{
 const previous=Dimensions.get('window');
 try{
  act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1}}));mockMemberAppearance=false;
  mockPlan.title='Coastal welcome walk — public Circle plan';await mount();
  const route=tree.root.findByType(PlanDetailScreen),scroll=tree.root.findAllByType(ScrollView)[0],join=button("Let's Go →");
  const copy=[mockPlan.title,"Who's going",'5 spots left',"Let's Go →",'Add to Calendar'];
  const leaf=(value:string)=>tree.root.findAllByType(Text).find(n=>n.props.children===value)!;let leaves=copy.map(leaf);expect(leaves.every(Boolean)).toBe(true);
  for(const fontScale of [1.35,1]){
   act(()=>Dimensions.set({window:{...previous,width:390,fontScale}}));
   copy.forEach((value,i)=>expect(leaf(value)).not.toBe(leaves[i]));leaves=copy.map(leaf);
   expect(tree.root.findByType(PlanDetailScreen)).toBe(route);expect(tree.root.findAllByType(ScrollView)[0]).toBe(scroll);expect(button("Let's Go →")).toBe(join);expect(mockJoin).not.toHaveBeenCalled();expect(mockNotice).not.toHaveBeenCalled();
  }
 }finally{act(()=>Dimensions.set({window:previous}));}
});
it('remeasures fallback management labels without remounting its modal or discarding typed title',async()=>{
 const previous=Dimensions.get('window');
 try{
  act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1}}));mockMemberAppearance=false;await openEditor();
  const input=tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel==='Plan title')!;
  act(()=>input.props.onChangeText('Unfinished sunset draft'));const modal=manageModal();const label=()=>tree.root.findAllByType(Text).find(n=>n.props.children==='Title')!;let text=label();
  for(const fontScale of [1.35,1]){
   act(()=>Dimensions.set({window:{...previous,width:390,fontScale}}));expect(label()).not.toBe(text);text=label();expect(manageModal()).toBe(modal);expect(tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel==='Plan title')).toBe(input);expect(input.props.value).toBe('Unfinished sunset draft');expect(mockUpdate).not.toHaveBeenCalled();
  }
 }finally{act(()=>Dimensions.set({window:previous}));}
});
