import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EventSummary from '../event-summary';
const mockPush = jest.fn(), mockBack = jest.fn(), mockReplace = jest.fn();
let mockId: unknown = 'event';
let mockPageId: unknown;
const mockPageAccess = jest.fn();
jest.mock('../../../lib/pageEventSummary', () => ({ getPageEventSummaryAccess: (...args: any[]) => mockPageAccess(...args) }));
let mockViewer = 'viewer', mockEpoch = 1;
let mockIdentity: any;
const mockRegistration = jest.fn(), mockRsvps = jest.fn();
jest.mock('../../../lib/eventRsvpGuests', () => ({ getEventRegistrationKind: (...args: any[]) => mockRegistration(...args), getEventRsvpSummary: (...args: any[]) => mockRsvps(...args) }));
const mockEvent = jest.fn(), mockAccess = jest.fn(), mockTickets = jest.fn(), mockGross = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: any[]) => mockPush(...args), back: () => mockBack(), replace: (...args: any[]) => mockReplace(...args), canGoBack: () => false }, useLocalSearchParams: () => ({ id: mockId, pageId: mockPageId }), useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]) }));
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => mockIdentity }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').AfterglowFonts }) }));
jest.mock('../../../lib/creatorEvents', () => ({ getOperatorEvent: (...args: any[]) => mockEvent(...args) }));
jest.mock('../../../lib/creatorMode', () => ({ getCreatorAccess: (...args: any[]) => mockAccess(...args) }));
jest.mock('../../../lib/eventSummaryGross', () => ({ getEventSummaryTickets: (...args: any[]) => mockTickets(...args), getEventSummaryGross: (...args: any[]) => mockGross(...args) }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: () => {} }));
jest.mock('../../../lib/ticketing', () => ({ formatCents: (value: number) => '$' + (value / 100).toFixed(2) }));
jest.mock('../../../constants/FeatureFlags', () => ({ COMMUNITY_CHAT_GROUPING_ENABLED: true, INVITE_AUDIENCE_ENABLED: true }));
jest.mock('../../../components/ProfileButton',()=>()=>null);
let mockClock=false;
let tree: ReactTestRenderer;
let client: QueryClient;
const event = { id: 'event', title: 'A Sunday by the ocean', status: 'Live', event_date: '2030-09-20', start_time: null, venue: 'Ocean Park', community_id: 'one', host_user_id: 'viewer' };
const access = (role = 'leader', community = 'one') => ({ ledCommunities: [{ id: community, role }], hasEventHostGrant: false });
function identity() { const viewerId = mockViewer, epoch = mockEpoch; mockIdentity = { viewerId, epoch, isLoading: false, error: null, retry: jest.fn(), isCurrent: () => viewerId === mockViewer && epoch === mockEpoch }; }
function render() { return <QueryClientProvider client={client}><EventSummary /></QueryClientProvider>; }
const flush = async () => { await act(async () => { if(mockClock)await jest.advanceTimersByTimeAsync(20);else await new Promise(resolve => setTimeout(resolve, 20)); }); };
const mount = async () => { await act(async () => { tree = create(render()); }); await flush(); await flush(); };
const copy = () => JSON.stringify(tree.toJSON());
const button = (label: string) => tree.root.findAll(node => typeof node.type !== 'string' && node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label)[0];
beforeEach(() => { jest.useRealTimers();mockClock=false;jest.clearAllMocks(); mockPageId = undefined; mockRegistration.mockReset().mockResolvedValue({freeRsvp:false,hasTickets:true}); mockRsvps.mockReset().mockResolvedValue(0); mockPageAccess.mockReset().mockResolvedValue({pageId:'page', entry:'owner', events:true, audience:true, finance:true}); mockEvent.mockReset().mockResolvedValue(event); mockAccess.mockReset().mockResolvedValue(access()); mockTickets.mockReset().mockResolvedValue({ sold: 12, checkedIn: 3 }); mockGross.mockReset().mockResolvedValue(42000); mockId = 'event'; mockViewer = 'viewer'; mockEpoch = 1; identity(); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); });
afterEach(() => { if (tree) act(() => tree.unmount()); client.clear();jest.useRealTimers(); });
it('renders confirmed counts and preserves every existing destination and exact ID parameter', async () => {
 await mount(); expect(copy()).toContain('$420.00'); expect(copy()).toContain('Active tickets');
 for (const [label, path, parameter] of [['Attendees', 'attendees', 'id'], ['Tickets', 'tickets', 'id'], ['Check in', 'check-in', 'id'], ['Messages', 'event-messages', 'id'], ['Invite people', 'invite-audience', 'id'], ['Earnings', 'event-money', 'id'], ['Edit event', 'event-form', 'id'], ['Duplicate', 'event-form', 'duplicateFrom']]) {
  act(() => button(label).props.onPress()); expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/creator/' + path, params: { [parameter]: 'event' } });
 }
});
it('keeps failed sales separate from confirmed tickets and retries only the sales read', async () => {
 mockGross.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(2500); await mount();
 expect(copy()).toContain('Ticket sales couldn’t load.'); expect(copy()).not.toContain('$0.00'); expect(copy()).toContain('12');
 const ticketReads = mockTickets.mock.calls.length;
 act(() => button('Retry sales').props.onPress()); await flush(); await flush();
 expect(copy()).toContain('$25.00'); expect(mockTickets).toHaveBeenCalledTimes(ticketReads);
});
it('keeps ticket read failure distinct from zero and the healthy event usable', async () => {
 mockTickets.mockRejectedValue(new Error('offline')); await mount(); expect(copy()).toContain('Ticket counts couldn’t load.'); expect(copy()).toContain('A Sunday by the ocean'); expect(button('Attendees').props.disabled).toBe(false);
});
it('shows loading dashes before secondary reads resolve', async () => {
 mockGross.mockImplementation(() => new Promise(() => {})); mockTickets.mockImplementation(() => new Promise(() => {})); await mount(); expect(copy()).toContain('Loading tickets…'); expect(copy()).toContain('Loading sales…'); expect(copy()).not.toContain('$0.00');
});
it('does not fetch attendee or money data for unrelated community access', async () => {
 mockAccess.mockResolvedValue(access('leader', 'other')); await mount(); expect(copy()).toContain('Event tools unavailable'); expect(mockTickets).not.toHaveBeenCalled(); expect(mockGross).not.toHaveBeenCalled();
});
it('keeps finance-only access separate from event management', async () => {
 mockAccess.mockResolvedValue(access('finance')); await mount(); expect(button('Earnings')).toBeTruthy(); expect(button('Edit event')).toBeUndefined(); expect(mockTickets).not.toHaveBeenCalled(); expect(mockGross).toHaveBeenCalled();
});
it('does not expose finance to an events-only team member', async () => {
 mockAccess.mockResolvedValue(access('events')); await mount(); expect(button('Attendees')).toBeTruthy(); expect(button('Earnings')).toBeUndefined(); expect(mockGross).not.toHaveBeenCalled();
});
it('does not disguise an initial event error as a missing event', async () => {
 mockEvent.mockRejectedValue(new Error('offline')); await mount(); expect(copy()).toContain('Couldn’t load the overview'); expect(copy()).not.toContain('Event unavailable'); expect(mockTickets).not.toHaveBeenCalled();
});
it('invalid entries make no event reads and have a real back destination', async () => {
 mockId = ['one', 'two']; await mount(); expect(mockEvent).not.toHaveBeenCalled(); expect(copy()).toContain('Choose an event');
 act(() => button('Back to events').props.onPress()); expect(mockReplace).toHaveBeenCalledWith('/(creator)/events');
});
it('retires old-account navigation synchronously and discards late totals', async () => {
 let resolveGross!: (value: number) => void;
 mockGross.mockImplementationOnce(() => new Promise(resolve => { resolveGross = resolve; })); await mount();
 const oldAction = button('Edit event').props.onPress;
 mockViewer = 'other'; mockEpoch++; identity(); mockAccess.mockResolvedValue(access('member_care'));
 act(() => { oldAction(); tree.update(render()); }); expect(mockPush).not.toHaveBeenCalled();
 await act(async () => resolveGross(999999)); await flush(); await flush();
 expect(copy()).not.toContain('$9999.99'); expect(copy()).toContain('Event tools unavailable');
});
it('signed-out accounts make no event or secondary reads', async () => {
 mockIdentity = { ...mockIdentity, viewerId: null }; await mount(); expect(copy()).toContain('Sign in to continue'); expect(mockEvent).not.toHaveBeenCalled(); expect(mockTickets).not.toHaveBeenCalled(); expect(mockGross).not.toHaveBeenCalled();
});
it('shows confirmed zero values for a successful empty event', async () => {
 mockTickets.mockResolvedValue({ sold: 0, checkedIn: 0 }); mockGross.mockResolvedValue(0); await mount(); expect(copy()).toContain('$0.00'); expect(copy()).not.toContain('couldn’t load');
});
it('keeps cached event visible after refresh failure but disables navigation', async () => {
 await mount(); mockEvent.mockRejectedValue(new Error('offline'));
 await act(async () => { await client.invalidateQueries({ queryKey: ['creator-event-overview', 'viewer', 1, 'event', 'event'] }); }); await flush();
 expect(copy()).toContain('A Sunday by the ocean'); expect(copy()).toContain('Couldn’t refresh this event'); expect(button('Edit event').props.disabled).toBe(true);
});
it('old callbacks cannot navigate after same-account role removal or unmount', async () => {
 await mount(); const oldAction = button('Earnings').props.onPress;
 mockAccess.mockResolvedValue(access('events'));
 await act(async () => { await client.invalidateQueries({ queryKey: ['creator-event-overview', 'viewer', 1, 'event', 'access'] }); }); await flush();
 act(() => oldAction()); expect(mockPush).not.toHaveBeenCalled();
 const edit = button('Edit event').props.onPress; act(() => tree.unmount()); act(() => edit()); expect(mockPush).not.toHaveBeenCalled();
});

it('connects page management and messages without requiring a global creator grant', async () => {
 mockPageId='page'; await mount(); expect(mockAccess).not.toHaveBeenCalled();
 act(()=>button('Messages').props.onPress()); expect(mockPush).toHaveBeenLastCalledWith({pathname:'/creator/event-messages',params:{id:'event',pageId:'page'}});
 act(()=>button('Edit event').props.onPress()); expect(mockPush).toHaveBeenLastCalledWith('/creator/event-form?id=event&pageId=page');
 act(()=>button('Duplicate').props.onPress()); expect(mockPush).toHaveBeenLastCalledWith('/creator/page-event-reuse?pageId=page&sourceEventId=event');
 act(()=>button('Earnings').props.onPress()); expect(mockPush).toHaveBeenLastCalledWith({pathname:'/creator/event-money',params:{id:'event',pageId:'page'}});
 act(()=>button('Ticket sales').props.onPress()); expect(mockPush).toHaveBeenLastCalledWith({pathname:'/creator/ticket-sales',params:{id:'event'}});
 act(()=>button('Back to events').props.onPress()); expect(mockReplace).toHaveBeenLastCalledWith('/creator/page?id=page');
 expect(mockTickets.mock.calls[0][2].userId).toBe('viewer');
});
it('keeps page content permission separate from ticket buyers and messages', async () => {
 mockPageId='page';mockPageAccess.mockResolvedValue({pageId:'page',entry:'team',events:true,audience:false,finance:false});await mount();
 expect(button('Edit event')).toBeTruthy();expect(button('Messages')).toBeUndefined();expect(button('Attendees')).toBeUndefined();expect(button('Ticket sales')).toBeUndefined();expect(mockTickets).not.toHaveBeenCalled();expect(mockGross).not.toHaveBeenCalled();
 act(()=>button('Edit event').props.onPress());expect(mockPush).toHaveBeenLastCalledWith('/creator/event-form?id=event&pageId=page&team=1');
 act(()=>button('Back to events').props.onPress());expect(mockReplace).toHaveBeenLastCalledWith('/creator/page-events?id=page');
});
it('does not fall back to old grants when a page read fails or is revoked', async () => {
 mockPageId='page';await mount();const oldAction=button('Messages').props.onPress;
 mockPageAccess.mockRejectedValue(new Error('access changed'));
 await act(async()=>{await client.invalidateQueries({queryKey:['creator-event-overview','viewer',1,'event','page','page-access']});});await flush();
 expect(copy()).toContain('Couldn’t load the overview');expect(copy()).not.toContain('$420.00');act(()=>oldAction());expect(mockPush).not.toHaveBeenCalled();expect(mockAccess).not.toHaveBeenCalled();
});

it('retires actions captured for a different event in the same account',async()=>{
 mockPageId='page';await mount();const oldAction=button('Messages').props.onPress;
 mockId='next';mockEvent.mockResolvedValue({...event,id:'next'});act(()=>tree.update(render()));await flush();await flush();
 act(()=>oldAction());expect(mockPush).not.toHaveBeenCalled();
 act(()=>button('Messages').props.onPress());expect(mockPush).toHaveBeenLastCalledWith({pathname:'/creator/event-messages',params:{id:'next',pageId:'page'}});
});

const deadline=async()=>{await act(async()=>{await jest.advanceTimersByTimeAsync(12000);});await flush();};
it('recovers from an unanswered event read and ignores its late result',async()=>{
 mockClock=true;jest.useFakeTimers();let finish!:(v:any)=>void;mockEvent.mockReturnValueOnce(new Promise(r=>{finish=r;}));await mount();expect(copy()).toContain('Loading event…');await deadline();
 expect(copy()).toContain('Couldn’t load the overview');mockEvent.mockResolvedValue(event);act(()=>button('Try again').props.onPress());await flush();await flush();expect(copy()).toContain(event.title);
 await act(async()=>finish({...event,title:'Obsolete late title'}));await flush();expect(copy()).not.toContain('Obsolete late title');
});
it('bounds page access checks without falling back to legacy grants',async()=>{
 mockClock=true;jest.useFakeTimers();mockPageId='page';mockPageAccess.mockReturnValueOnce(new Promise(()=>{}));await mount();await deadline();expect(copy()).toContain('Couldn’t load the overview');expect(mockAccess).not.toHaveBeenCalled();expect(mockTickets).not.toHaveBeenCalled();
 act(()=>button('Try again').props.onPress());await flush();await flush();expect(button('Messages').props.disabled).toBe(false);
});
it('bounds secondary reads and retires their scopes before explicit retry',async()=>{
 mockClock=true;jest.useFakeTimers();mockPageId='page';let finishTickets!:(v:any)=>void,finishGross!:(v:any)=>void;
 mockTickets.mockReturnValueOnce(new Promise(r=>{finishTickets=r;}));mockGross.mockReturnValueOnce(new Promise(r=>{finishGross=r;}));await mount();const ticketScope=mockTickets.mock.calls[0][2],grossScope=mockGross.mock.calls[0][2];await deadline();
 expect(copy()).toContain('Ticket counts couldn’t load.');expect(copy()).toContain('Ticket sales couldn’t load.');expect(copy()).not.toContain('$0.00');expect(ticketScope.isCurrent()).toBe(false);expect(grossScope.isCurrent()).toBe(false);
 act(()=>{button('Retry tickets').props.onPress();button('Retry sales').props.onPress();});await flush();await flush();expect(copy()).toContain('$420.00');
 await act(async()=>{finishTickets({sold:999,checkedIn:888});finishGross(999999);});await flush();expect(copy()).not.toContain('$9999.99');expect(copy()).not.toContain('999');
});
it('keeps confirmed totals visible when a refresh fails and labels them honestly',async()=>{
 await mount();mockGross.mockRejectedValue(Error('Offline'));mockTickets.mockRejectedValue(Error('Offline'));
 await act(async()=>{await client.invalidateQueries({queryKey:['creator-event-overview','viewer',1,'event','gross']});await client.invalidateQueries({queryKey:['creator-event-overview','viewer',1,'event','attendees']});});await flush();
 expect(copy()).toContain('$420.00');expect(copy()).toContain('Ticket counts couldn’t refresh.');expect(copy()).toContain('Ticket sales couldn’t refresh.');expect(copy()).toContain('12');
});
it('rejects event data belonging to another event',async()=>{
 mockEvent.mockResolvedValue({...event,id:'another-event'});await mount();expect(copy()).toContain('Couldn’t load the overview');expect(mockTickets).not.toHaveBeenCalled();expect(mockGross).not.toHaveBeenCalled();
});

it('uses actual RSVP counts for a free event without hiding its communication or editor routes',async()=>{
 mockRegistration.mockResolvedValue({freeRsvp:true,hasTickets:false});mockRsvps.mockResolvedValue(7);mockPageId='page';await mount();await flush();
 expect(copy()).toContain('Going');expect(copy()).toContain('7');expect(copy()).not.toContain('Gross ticket sales');expect(copy()).not.toContain('Active tickets');expect(button('Earnings')).toBeUndefined();expect(button('Tickets')).toBeUndefined();
 act(()=>button('RSVPs').props.onPress());expect(mockPush).toHaveBeenLastCalledWith({pathname:'/creator/event-rsvps',params:{id:'event',pageId:'page'}});expect(button('Messages')).toBeTruthy();expect(button('Edit event')).toBeTruthy();
});
it('keeps historical ticket and finance tools when a free event has orders or configured tiers',async()=>{
 mockRegistration.mockResolvedValue({freeRsvp:true,hasTickets:true});await mount();await flush();expect(button('RSVPs')).toBeTruthy();expect(button('Tickets')).toBeTruthy();expect(button('Earnings')).toBeTruthy();expect(copy()).toContain('Gross ticket sales');
});
it('does not hide financial history when registration cannot be checked',async()=>{
 mockRegistration.mockRejectedValue(Error('offline'));await mount();expect(copy()).toContain('Joining details couldn’t load');expect(button('Earnings')).toBeTruthy();expect(button('Retry details')).toBeTruthy();
});
it('never presents a failed RSVP count as zero and can retry the count',async()=>{
 mockRegistration.mockResolvedValue({freeRsvp:true,hasTickets:false});mockRsvps.mockRejectedValueOnce(Error('offline'));await mount();await flush();expect(copy()).toContain('RSVPs couldn’t load.');expect(copy()).toContain('—');mockRsvps.mockResolvedValue(4);act(()=>button('Retry RSVPs').props.onPress());await flush();await flush();expect(copy()).not.toContain('RSVPs couldn’t load.');expect(copy()).toContain('4');
});
