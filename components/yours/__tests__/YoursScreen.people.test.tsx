import React from 'react';
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import YoursScreen from '../YoursScreen';
import MyPlansView from '../screens/MyPlansView';
import CirclesDirectory from '../circles/CirclesDirectory';
import { MyCommunitiesList } from '../communities/MyCommunitiesList';
import { AlbumsGrid } from '../../albums/AlbumsGrid';
import { CreatorSpaceEntry } from '../../creator/pages/CreatorSpaceEntry';
import { PageAction } from '../../creator/pages/PageFrame';
import PeopleScreen from '../people/PeopleScreen';
import PeopleSearchResults from '../search/PeopleSearchResults';
import YoursTabs from '../header/YoursTabs';
import YoursHeader from '../header/YoursHeader';
import MenuCard from '../../menu/MenuCard';
import RequestBanner from '../requests/RequestBanner';
import RequestStack from '../requests/RequestStack';
import PathsSheet from '../paths/PathsSheet';
import ProfileCardSheet from '../profile/ProfileCardSheet';
import FreshStartView from '../screens/FreshStartView';
import NewUserEmptyView from '../screens/NewUserEmptyView';
import { supabase } from '../../../lib/supabase';
import { AfterglowFonts } from '../../../constants/Typography';
import { COPY } from '../state/constants';
import type { YoursGridPerson } from '../../../lib/yours/types';

let mockSuspendCircles = false;
const mockNever = new Promise(() => {});
let mockUid = 'viewer', mockFocused = true, mockLoading = false, mockRequests: unknown[] = [], mockBacklog: unknown[] = [];
let mockGridLoading = false, mockGridError: Error | null = null, mockBacklogError: Error | null = null;
const mockRefetchPeople = jest.fn(), mockRefetchBacklog = jest.fn();
const mockGetUser = jest.fn(), mockRetryIdentity = jest.fn();
let mockUseRealIdentity = false;
let mockIdentityError: Error | null = null;
let mockPeopleByAccount: Record<string, YoursGridPerson[]> = {};
let mockParams: Record<string, string> = {}, mockPeople: YoursGridPerson[];
const mockPush = jest.fn(), mockSetParams = jest.fn(), mockDm = jest.fn(), mockInvalidate = jest.fn();
const mockListeners = new Set<(event: string, session: { user: { id: string } } | null) => void>();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args), setParams: (...args: unknown[]) => mockSetParams(...args) }, useLocalSearchParams: () => mockParams }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('../../../lib/supabase', () => ({ supabase: { auth: { getUser: (...args: unknown[]) => mockGetUser(...args), onAuthStateChange: jest.fn((callback: any) => {
  mockListeners.add(callback); return { data: { subscription: { unsubscribe: () => mockListeners.delete(callback) } } };
}) } } }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: jest.requireActual('../../../constants/Typography').AfterglowFonts }) }));
jest.mock('../../../constants/FeatureFlags', () => ({ GROUPS_ENABLED: true, COMMUNITIES_ENABLED: true, COMMUNITY_CHAT_GROUPING_ENABLED: true, CREATOR_PAGES_ENABLED: true }));
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => mockUseRealIdentity
  ? jest.requireActual('../../../hooks/useObservedUser').useObservedUser()
  : { viewerId: mockUid, epoch: 0, error: mockIdentityError, isLoading: mockLoading, isCurrent: () => true, retry: mockRetryIdentity },
}));
jest.mock('../../../hooks/useYoursGrid', () => ({ useYoursGrid: (userId: string | null | undefined) => ({ data: mockUseRealIdentity ? (mockPeopleByAccount[userId ?? ''] ?? []) : mockPeople, isLoading: mockGridLoading, error: mockGridError, refetch: mockRefetchPeople }) }));
jest.mock('../../../hooks/useIncomingRequests', () => ({ useIncomingRequests: () => ({ data: mockRequests }) }));
jest.mock('../../../hooks/usePlanHistoryBacklog', () => ({ usePlanHistoryBacklog: () => ({ data: mockBacklog, error: mockBacklogError, refetch: mockRefetchBacklog }) }));
jest.mock('../../../hooks/useReferral', () => ({ useReferral: () => ({ ensureReferralCode: jest.fn() }) }));
jest.mock('../../../hooks/useGetOrCreateDm', () => ({ isObsoleteDmOperation: (error: any) => error?.code === 'obsolete-dm-fixture', useGetOrCreateDm: () => ({ mutateAsync: (...args: unknown[]) => mockDm(...args), isPending: false }) }));
jest.mock('../../../lib/yours/invite', () => ({ openInviteComposer: jest.fn() }));
jest.mock('../../../lib/haptics', () => ({ hapticSelection: jest.fn() }));
jest.mock('../../../lib/yours/requestsSeen', () => ({ markRequestsSeen: jest.fn(), REQUESTS_BADGE_KEY: ['requests'] }));
jest.mock('../../../lib/yours/tabsIntroSeen', () => ({ resolveYoursIntroVariant: () => null, hasSeenYoursIntro: jest.fn(), markYoursIntroSeen: jest.fn() }));
jest.mock('../../creator/pages/CreatorSpaceEntry', () => ({ CreatorSpaceEntry: () => null }));
jest.mock('../../albums/AlbumsGrid', () => ({ AlbumsGrid: () => null }));
jest.mock('../header/YoursHeader', () => () => null);
jest.mock('../header/YoursTabs', () => () => null);
jest.mock('../people/PeopleScreen', () => () => null);
jest.mock('../search/PeopleSearchResults', () => () => null);
jest.mock('../screens/MyPlansView', () => () => null);
jest.mock('../screens/FreshStartView', () => () => null);
jest.mock('../screens/NewUserEmptyView', () => () => null);
jest.mock('../requests/RequestBanner', () => () => null);
jest.mock('../paths/PathsSheet', () => () => null);
jest.mock('../profile/ProfileCardSheet', () => () => null);
jest.mock('../requests/RequestStack', () => () => null);
jest.mock('../circles/CirclesDirectory', () => () => { if (mockSuspendCircles) throw mockNever; return null; });
jest.mock('../communities/MyCommunitiesList', () => ({ MyCommunitiesList: () => null }));
jest.mock('../../menu/MenuCard', () => () => null);
jest.mock('../onboarding/YoursIntroPopup', () => () => null);

const person = (id: string): YoursGridPerson => ({ user_id: id, first_name_display: id, profile_photo_url: `mock:${id}`, handle: null,
  ring_bucket: 'none', shared_count: 0, milestone: null, upcoming_event_id: null, upcoming_title: null,
  upcoming_start: null, upcoming_neighborhood: null, connected_at: '2026-09-13' });
let tree: ReactTestRenderer | undefined;
const anchor = { x: 20, y: 180, width: 44, height: 44 };
const menu = () => tree!.root.findByType(MenuCard).props;
const body = () => tree!.root.findByType(PeopleScreen).props;
const tab = (value: string) => act(() => tree!.root.findByType(YoursTabs).props.onChange(value));
const open = (p = mockPeople[0]) => act(() => body().onLongPressPerson(p, anchor));
const press = (key: string, props = menu()) => act(() => { props.onClose(); props.rows.find((row: any) => row.key === key).onPress(); });
const emit = (id: string | null) => act(() => { for (const listener of mockListeners) listener(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null); });
const update = () => act(() => tree!.update(<YoursScreen />));
const flush = async () => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };
function deferred() { let resolve!: (value: unknown) => void, reject!: (error: Error) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function mount(people = true) { act(() => { tree = create(<YoursScreen />); }); if (people) tab('people'); }
beforeEach(() => {
  jest.clearAllMocks(); mockListeners.clear(); mockSuspendCircles = false; mockUid = 'viewer'; mockFocused = true; mockLoading = false;
  mockGridLoading = false; mockGridError = null; mockBacklogError = null;
  mockUseRealIdentity = false; mockIdentityError = null; mockPeopleByAccount = {};
  mockGetUser.mockReset().mockResolvedValue({ data: { user: { id: 'viewer' } }, error: null });
  mockRetryIdentity.mockReset().mockResolvedValue(undefined);
  mockRefetchPeople.mockReset().mockResolvedValue({}); mockRefetchBacklog.mockReset().mockResolvedValue({});
  mockParams = {}; mockPeople = [person('amelia'), person('jamie')]; mockRequests = []; mockBacklog = [];
  mockDm.mockReset().mockResolvedValue('dm-one'); jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => { if (tree) act(() => tree!.unmount()); tree = undefined; expect(mockListeners.size).toBe(0); jest.restoreAllMocks(); });

it('passes one staged appearance to the parent header, tabs, people and search', () => {
  mount(); const appearance = { fonts: AfterglowFonts };
  expect(tree!.root.findByType(YoursHeader).props.appearance).toEqual(appearance);
  expect(tree!.root.findByType(YoursTabs).props.appearance).toEqual(appearance);
  expect(body().appearance).toEqual(appearance);
  expect(body().searchResults.type).toBe(PeopleSearchResults);
  expect(body().searchResults.props.appearance).toEqual(appearance);
});

it.each(['plan', 'circle', 'profile'])('consumes the %s action once and uses its selected person', key => {
  mount(); open(mockPeople[1]); const props = menu(); press(key, props); press(key, props);
  expect(mockPush).toHaveBeenCalledTimes(1);
  const route = mockPush.mock.calls[0][0];
  expect(JSON.stringify(route)).toContain('jamie'); expect(JSON.stringify(route)).not.toContain('amelia');
});

it('opens one DM on repeated taps before any pending render', async () => {
  const pending = deferred(); mockDm.mockReturnValue(pending.promise); mount(); open(); const props = menu();
  press('message', props); press('message', props); expect(mockDm).toHaveBeenCalledTimes(1);
  expect(mockDm).toHaveBeenCalledWith('amelia'); expect(mockPush).not.toHaveBeenCalled();
  pending.resolve('dm-one'); await flush(); expect(mockPush).toHaveBeenCalledWith('/(tabs)/chats/circle/dm-one');
});

it.each([null, '', '   ', {}, []])('does not navigate to an unconfirmed DM receipt (%p)', async value => {
  mockDm.mockResolvedValue(value); mount(); open(); press('message'); await flush();
  expect(mockPush).not.toHaveBeenCalled(); expect(Alert.alert).toHaveBeenCalledWith('', COPY.keepMessageError);
});

it('reports a current failure and permits an explicit retry', async () => {
  mockDm.mockRejectedValueOnce(new Error('offline')); mount(); open(); press('message'); await flush();
  expect(Alert.alert).toHaveBeenCalledTimes(1); open(); press('message'); await flush();
  expect(mockDm).toHaveBeenCalledTimes(2); expect(mockPush).toHaveBeenCalledWith('/(tabs)/chats/circle/dm-one');
});

it('ignores replaced and separately dismissed menu callbacks', async () => {
  mount(); open(); const old = menu(); open(mockPeople[1]); press('profile', old);
  expect(mockPush).not.toHaveBeenCalled(); expect(menu().visible).toBe(true);
  const dismissed = menu(); act(() => dismissed.onClose()); await flush(); press('profile', dismissed);
  expect(mockPush).not.toHaveBeenCalled();
});

it.each(['account', 'auth-roundtrip', 'blur', 'tab', 'removed-person'])('retires a menu on %s', mode => {
  mount(); open(); const old = menu();
  if (mode === 'account') { mockUid = 'other'; update(); }
  if (mode === 'auth-roundtrip') { emit('other'); emit('viewer'); }
  if (mode === 'blur') { mockFocused = false; update(); }
  if (mode === 'tab') tab('myPlans');
  if (mode === 'removed-person') { mockPeople = [person('jamie')]; update(); }
  press('message', old); expect(mockDm).not.toHaveBeenCalled(); expect(mockPush).not.toHaveBeenCalled();
});

it.each(['account', 'auth-roundtrip', 'blur', 'tab', 'new-person', 'unmount'])('suppresses a delayed success after %s', async mode => {
  const pending = deferred(); mockDm.mockReturnValue(pending.promise); mount(); open(); press('message');
  if (mode === 'account') { mockUid = 'other'; update(); }
  if (mode === 'auth-roundtrip') { emit('other'); emit('viewer'); }
  if (mode === 'blur') { mockFocused = false; update(); }
  if (mode === 'tab') tab('myPlans');
  if (mode === 'new-person') open(mockPeople[1]);
  if (mode === 'unmount') { act(() => tree!.unmount()); tree = undefined; }
  pending.resolve('dm-one'); await flush(); expect(mockPush).not.toHaveBeenCalled(); expect(Alert.alert).not.toHaveBeenCalled();
});

it('suppresses an obsolete failure while allowing the newly selected DM to finish', async () => {
  const old = deferred(), next = deferred(); mockDm.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  mount(); open(); press('message'); open(mockPeople[1]); press('message');
  old.reject(new Error('late failure')); await flush(); expect(Alert.alert).not.toHaveBeenCalled();
  next.resolve('dm-jamie'); await flush(); expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/chats/circle/dm-jamie');
});

it('does not open an old cached account menu after real sign-out', () => {
  mount(); emit(null); open(); expect(menu().visible).toBe(false); expect(mockDm).not.toHaveBeenCalled();
});

it.each(['empty', 'fresh'])('keeps requests and add-people reachable with no connections in the %s state', mode => {
  mockPeople = []; mockRequests = [{ requester_id: 'new-person' }]; mockBacklog = mode === 'fresh' ? [{}] : [];
  mount(); expect(tree!.root.findAllByType(PeopleScreen)).toHaveLength(0);
  expect(tree!.root.findAllByType(mode === 'fresh' ? FreshStartView : NewUserEmptyView)).toHaveLength(1);
  act(() => tree!.root.findByType(RequestBanner).props.onPress());
  expect(tree!.root.findByType(RequestStack).props.visible).toBe(true);
  const add = tree!.root.findAll(node => node.props.accessibilityLabel === 'Add people' && typeof node.props.onPress === 'function')[0];
  act(() => add.props.onPress()); expect(tree!.root.findByType(PathsSheet).props.visible).toBe(true);
});

it('preserves one request entry on populated People and the global banner on other tabs', () => {
  mockRequests = [{}]; mount(); expect(body().pendingRequests).toBe(1);
  expect(tree!.root.findAllByType(RequestBanner)).toHaveLength(0);
  tab('myPlans'); expect(tree!.root.findByType(RequestBanner).props.count).toBe(1);
});

it('still opens a request deep-link when the user has no connections', () => {
  mockPeople = []; mockRequests = [{ requester_id: 'jamie' }]; mockParams = { tab: 'people', openRequests: '1', requesterId: 'jamie' };
  mount(false); expect(tree!.root.findByType(RequestStack).props.highlightRequesterId).toBe('jamie');
  expect(tree!.root.findByType(RequestStack).props.visible).toBe(true);
});

it('clears the old account search and auxiliary sheets when cached identity changes', () => {
  mount(); act(() => { body().onQueryChange('private search'); body().onAddPeople(); });
  expect(body().query).toBe('private search'); expect(tree!.root.findByType(PathsSheet).props.visible).toBe(true);
  mockUid = 'other'; update(); expect(body().query).toBe(''); expect(tree!.root.findByType(PathsSheet).props.visible).toBe(false);
});

it('keeps the menu and pending DM valid across a same-account token refresh', async () => {
  const pending = deferred(); mockDm.mockReturnValue(pending.promise); mount(); open();
  act(() => { for (const listener of mockListeners) listener('TOKEN_REFRESHED', { user: { id: 'viewer' } }); });
  expect(menu().visible).toBe(true); press('message');
  act(() => { for (const listener of mockListeners) listener('TOKEN_REFRESHED', { user: { id: 'viewer' } }); });
  pending.resolve('dm-one'); await flush(); expect(mockPush).toHaveBeenCalledWith('/(tabs)/chats/circle/dm-one');
});


it('shares staged appearance with request and minimal profile companions', () => {
  mockRequests = [{ requester_user_id: 'new-person' }];
  mount(false);
  const appearance = { fonts: AfterglowFonts };
  expect(tree!.root.findByType(RequestBanner).props.appearance).toEqual(appearance);
  act(() => tree!.root.findByType(RequestBanner).props.onPress());
  expect(tree!.root.findByType(RequestStack).props.appearance).toEqual(appearance);
  expect(tree!.root.findByType(ProfileCardSheet).props.appearance).toEqual(appearance);
});

it('does not alert for account-obsolete DM receipts detected before parent auth feedback', async () => {
  mockDm.mockRejectedValue(Object.assign(new Error('retired'), { code: 'obsolete-dm-fixture' }));
  mount(); open(); press('message'); await flush();
  expect(Alert.alert).not.toHaveBeenCalled(); expect(mockPush).not.toHaveBeenCalled();
});


it('keeps Plans and every other section reachable while People is still loading', () => {
  mockPeople = []; mockGridLoading = true; mount(false);
  expect(tree!.root.findByType(YoursTabs).props.active).toBe('myPlans');
  expect(tree!.root.findAllByType(MyPlansView)).toHaveLength(1);
  expect(tree!.root.findByType(CreatorSpaceEntry).props.userId).toBe('viewer');
  for (const [section, component] of [['circles', CirclesDirectory], ['communities', MyCommunitiesList], ['albums', AlbumsGrid]] as const) {
    tab(section); expect(tree!.root.findAllByType(component)).toHaveLength(1);
  }
  tab('people'); expect(tree!.root.findAllByType(NewUserEmptyView)).toHaveLength(0);
  expect(tree!.root.findAllByType(FreshStartView)).toHaveLength(0);
  expect(JSON.stringify(tree!.toJSON())).toContain('Loading your people');
});
it('keeps the full shell visible while account identity loads without starting private child reads', () => {
  mockLoading = true; mount(false);
  expect(tree!.root.findAllByType(YoursTabs)).toHaveLength(1);
  expect(tree!.root.findAllByType(MyPlansView)).toHaveLength(0);
  tab('albums'); expect(tree!.root.findAllByType(AlbumsGrid)).toHaveLength(0);
  mockLoading = false; update(); expect(tree!.root.findAllByType(AlbumsGrid)).toHaveLength(1);
});
it('never presents failed People or history reads as an empty/new-user state', () => {
  mockPeople = []; mockGridError = new Error('Offline'); mount();
  expect(tree!.root.findAllByType(NewUserEmptyView)).toHaveLength(0);
  expect(JSON.stringify(tree!.toJSON())).toContain('Your people couldn’t load');
  mockGridError = null; mockBacklogError = new Error('Offline history'); update();
  expect(tree!.root.findAllByType(NewUserEmptyView)).toHaveLength(0);
  tab('myPlans'); expect(tree!.root.findAllByType(MyPlansView)).toHaveLength(1);
});
it('retains accepted people, search, selected section and one creator entry across cached errors and detail return', () => {
  mount(); act(() => body().onQueryChange('jamie'));
  const accepted = body().people;
  act(() => body().onPersonPress(mockPeople[1])); expect(mockPush).toHaveBeenCalledWith('/person/jamie');
  mockFocused = false; update(); mockGridError = new Error('Offline'); mockFocused = true; update();
  expect(tree!.root.findByType(YoursTabs).props.active).toBe('people');
  expect(body().people).toBe(accepted); expect(body().query).toBe('jamie');
  expect(tree!.root.findAllByType(CreatorSpaceEntry)).toHaveLength(1);
  expect(JSON.stringify(tree!.toJSON())).toContain('saved connections are still here');
  tab('communities'); tab('people'); expect(body().query).toBe('jamie'); expect(body().people).toBe(accepted);
});
it('does not remount the People body when cached failure feedback appears', () => {
  mount(); const before = tree!.root.findByType(PeopleScreen);
  mockGridError = new Error('Offline'); update();
  expect(tree!.root.findByType(PeopleScreen)).toBe(before);
});
it('locks duplicate parent recovery and bounds its wait without discarding accepted rows', async () => {
  jest.useFakeTimers();
  try {
    mockGridError = new Error('Offline'); const read = deferred(); mockRefetchPeople.mockReturnValue(read.promise); mount();
    const retry = tree!.root.findAllByType(PageAction).find(node => node.props.title === 'Try again')!.props.onPress;
    await act(async () => { retry(); retry(); }); expect(mockRefetchPeople).toHaveBeenCalledTimes(1);
    expect(body().people).toHaveLength(2);
    await act(async () => { jest.advanceTimersByTime(12000); });
    expect(tree!.root.findAllByType(PageAction).find(node => node.props.title === 'Try again')!.props.disabled).toBe(false);
    tab('albums'); await act(async () => read.resolve({}));
    expect(tree!.root.findByType(YoursTabs).props.active).toBe('albums');
    expect(tree!.root.findAllByType(AlbumsGrid)).toHaveLength(1);
  } finally { jest.useRealTimers(); }
});
it('clears timed-out People recovery only after both same-scope reads confirm success', async () => {
  jest.useFakeTimers();
  try {
    mockPeople = []; mockGridError = new Error('Offline'); mockBacklogError = new Error('Offline history');
    const peopleRead = deferred(), backlogRead = deferred();
    mockRefetchPeople.mockReturnValue(peopleRead.promise); mockRefetchBacklog.mockReturnValue(backlogRead.promise);
    mount();
    const retry = tree!.root.findAllByType(PageAction).find(node => node.props.title === 'Try again')!.props.onPress;
    await act(async () => { retry(); });
    await act(async () => { jest.advanceTimersByTime(12000); });
    expect(tree!.root.findAllByType(FreshStartView)).toHaveLength(0);
    expect(tree!.root.findAllByType(NewUserEmptyView)).toHaveLength(0);
    mockGridError = null; mockBacklogError = null;
    await act(async () => { peopleRead.resolve({ isSuccess: true }); tree!.update(<YoursScreen />); });
    expect(JSON.stringify(tree!.toJSON())).toContain('Your people couldn’t load');
    expect(tree!.root.findAllByType(NewUserEmptyView)).toHaveLength(0);
    mockBacklog = [{ user_id: 'jamie' }];
    await act(async () => { backlogRead.resolve({ isSuccess: true }); tree!.update(<YoursScreen />); });
    expect(tree!.root.findByType(YoursTabs).props.active).toBe('people');
    expect(tree!.root.findByType(FreshStartView).props.backlogCount).toBe(1);
    expect(JSON.stringify(tree!.toJSON())).not.toContain('Your people couldn’t load');
    expect(mockRefetchPeople).toHaveBeenCalledTimes(1); expect(mockRefetchBacklog).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});
it.each(['myPlans', 'circles', 'communities', 'albums'])('retains %s when a child opens and focus returns', section => {
  mount(false); tab(section); mockFocused = false; update(); mockFocused = true; update();
  expect(tree!.root.findByType(YoursTabs).props.active).toBe(section);
});
it('keeps existing circle/community routes and retires ordinary People controls on another section', () => {
  mount(); const previous = body(); tab('circles');
  act(() => { previous.onAddPeople(); previous.onCreateCircle(); previous.onPersonPress(mockPeople[0]); previous.onQueryChange('stale'); });
  expect(mockPush).not.toHaveBeenCalled(); expect(tree!.root.findByType(PathsSheet).props.visible).toBe(false);
  act(() => tree!.root.findByType(CirclesDirectory).props.onOpenCircle('circle-one'));
  expect(mockPush).toHaveBeenLastCalledWith('/circle/circle-one');
  tab('communities'); act(() => tree!.root.findByType(MyCommunitiesList).props.onOpen('community-one'));
  expect(mockPush).toHaveBeenLastCalledWith('/community/community-one');
  tab('people'); expect(body().query).toBe('');
});
it('never opens a removed accepted person through a retained ordinary press', () => {
  mount(); const previous = body(); const removed = mockPeople[0]; mockPeople = [mockPeople[1]]; update();
  act(() => previous.onPersonPress(removed)); expect(mockPush).not.toHaveBeenCalled();
});
it.each([undefined, { fonts: AfterglowFonts }])('selects every actual tab with or without scoped appearance (%p)', appearance => {
  const ActualTabs = jest.requireActual('../header/YoursTabs').default;
  let selected = 'myPlans';
  function TabsHarness() { const [active, setActive] = React.useState('myPlans'); return <ActualTabs appearance={appearance} active={active} onChange={(value: string) => { selected = value; setActive(value); }} />; }
  act(() => { tree = create(<TabsHarness />); });
  const tabButtons = () => tree!.root.findAll(node => node.props.accessibilityRole === 'tab' && typeof node.props.onPress === 'function', { deep: false });
  const buttons = tabButtons();
  expect(buttons).toHaveLength(5);
  buttons.forEach((button, index) => act(() => button.props.onLayout({ nativeEvent: { layout: { x: index * 110 } } })));
  act(() => buttons[4].props.onPress()); expect(selected).toBe('albums');
  expect(tabButtons()[4].props.accessibilityState.selected).toBe(true);
  act(() => tabButtons()[0].props.onPress()); expect(selected).toBe('myPlans');
});


it('replaces a stalled identity spinner with bounded recovery and keeps the selected section', async () => {
  jest.useFakeTimers();
  try {
    mockUseRealIdentity = true;
    mockGetUser.mockReturnValue(new Promise(() => {}));
    mount(false); tab('albums');
    expect(JSON.stringify(tree!.toJSON())).toContain('Loading Yours');
    expect(tree!.root.findAllByType(AlbumsGrid)).toHaveLength(0);
    await act(async () => { jest.advanceTimersByTime(12000); });
    expect(JSON.stringify(tree!.toJSON())).not.toContain('Loading Yours');
    expect(JSON.stringify(tree!.toJSON())).toContain('Yours couldn’t load. Try again.');
    expect(tree!.root.findByType(YoursTabs).props.active).toBe('albums');
    expect(tree!.root.findAllByType(AlbumsGrid)).toHaveLength(0);
    expect(tree!.root.findAllByType(CreatorSpaceEntry)).toHaveLength(0);
    expect(tree!.root.findAllByType(PathsSheet)).toHaveLength(0);
    expect(tree!.root.findAllByType(PageAction).some(node => node.props.title === 'Try again')).toBe(true);
  } finally { jest.useRealTimers(); }
});

it('locks identity retry, reuses both existing subscriptions and ignores the retired initial result', async () => {
  jest.useFakeTimers();
  try {
    mockUseRealIdentity = true;
    const initial = deferred(), retryRead = deferred();
    mockGetUser.mockReturnValueOnce(initial.promise).mockReturnValueOnce(retryRead.promise);
    mount(false); tab('albums');
    await act(async () => { jest.advanceTimersByTime(12000); });
    const subscriptions = (supabase.auth.onAuthStateChange as jest.Mock).mock.calls.length;
    expect(mockListeners.size).toBe(2); // identity + the existing synchronous action-retirement listener
    const retry = tree!.root.findAllByType(PageAction).find(node => node.props.title === 'Try again')!.props.onPress;
    act(() => { retry(); retry(); });
    expect(mockGetUser).toHaveBeenCalledTimes(2);
    expect((supabase.auth.onAuthStateChange as jest.Mock).mock.calls).toHaveLength(subscriptions);
    expect(mockListeners.size).toBe(2);
    expect(JSON.stringify(tree!.toJSON())).toContain('Loading Yours');
    await act(async () => retryRead.resolve({ data: { user: { id: 'recovered' } }, error: null }));
    expect(tree!.root.findByType(AlbumsGrid).props.userId).toBe('recovered');
    expect(tree!.root.findByType(YoursTabs).props.active).toBe('albums');
    expect(mockListeners.size).toBe(2);
    await act(async () => initial.resolve({ data: { user: { id: 'retired-account' } }, error: null }));
    expect(tree!.root.findByType(AlbumsGrid).props.userId).toBe('recovered');
    expect(mockListeners.size).toBe(2);
    act(() => retry());
    expect(mockGetUser).toHaveBeenCalledTimes(2); // retired recovery callback cannot restart this account
  } finally { jest.useRealTimers(); }
});

it.each([
  { data: { user: null }, error: null },
  { data: { user: null }, error: new Error('Network unavailable') },
])('shows identity retry rather than an endless spinner for a settled unavailable account (%p)', async result => {
  mockUseRealIdentity = true; mockGetUser.mockResolvedValue(result);
  mount(false); await flush();
  expect(JSON.stringify(tree!.toJSON())).not.toContain('Loading Yours');
  expect(JSON.stringify(tree!.toJSON())).toContain('Yours couldn’t load. Try again.');
  expect(tree!.root.findAllByType(MyPlansView)).toHaveLength(0);
  expect(tree!.root.findAllByType(CreatorSpaceEntry)).toHaveLength(0);
  expect(tree!.root.findAllByType(PathsSheet)).toHaveLength(0);
});

it('uses observed account changes to retire prior rows, sheets, actions and pending DM results', async () => {
  mockUseRealIdentity = true;
  mockPeopleByAccount = { viewer: mockPeople, other: [person('other-only')] };
  const dm = deferred(); mockDm.mockReturnValue(dm.promise);
  mount(false); await flush(); tab('people');
  const previous = body();
  act(() => { previous.onQueryChange('private search'); previous.onAddPeople(); });
  open(); const previousMenu = menu(); press('message', previousMenu);
  emit('other');
  expect(body().people.map((p: YoursGridPerson) => p.user_id)).toEqual(['other-only']);
  expect(body().query).toBe('');
  expect(tree!.root.findByType(PathsSheet).props.visible).toBe(false);
  expect(tree!.root.findByType(CreatorSpaceEntry).props.userId).toBe('other');
  act(() => { previous.onPersonPress(mockPeople[0]); previous.onAddPeople(); previous.onCreateCircle(); });
  press('profile', previousMenu);
  await act(async () => dm.resolve('old-account-dm'));
  expect(mockPush).not.toHaveBeenCalled(); expect(Alert.alert).not.toHaveBeenCalled();
  expect(mockListeners.size).toBe(2);
  emit(null);
  expect(tree!.root.findAllByType(PeopleScreen)).toHaveLength(0);
  expect(tree!.root.findAllByType(PathsSheet)).toHaveLength(0);
  expect(JSON.stringify(tree!.toJSON())).toContain('Yours couldn’t load. Try again.');
});

it('does not let an initial identity response replace a newer signed-in account', async () => {
  mockUseRealIdentity = true;
  const initial = deferred(); mockGetUser.mockReturnValue(initial.promise);
  mount(false); emit('new-account');
  expect(tree!.root.findByType(MyPlansView).props.userId).toBe('new-account');
  await act(async () => initial.resolve({ data: { user: { id: 'old-account' } }, error: null }));
  expect(tree!.root.findByType(MyPlansView).props.userId).toBe('new-account');
});


it.each(['person', 'add'])('keeps committed People %s control usable while a competing section render is uncommitted', async control => {
  await act(async () => { tree = create(<React.Suspense fallback={null}><YoursScreen /></React.Suspense>); });
  tab('people');
  const committed = body();
  mockSuspendCircles = true;
  await act(async () => { React.startTransition(() => tree!.root.findByType(YoursTabs).props.onChange('circles')); });
  expect(body()).toBe(committed);
  // Only the old People screen committed. Its controls must still describe
  // that screen, rather than an invisible speculative Circles render.
  if (control === 'person') {
    act(() => committed.onPersonPress(mockPeople[0]));
    expect(mockPush).toHaveBeenCalledWith('/person/amelia');
  } else {
    act(() => committed.onAddPeople());
    expect(tree!.root.findByType(PathsSheet).props.visible).toBe(true);
  }
});

it.each(['focus', 'tab'])('retires old People controls and enables the new visit after a committed %s roundtrip', mode => {
  mount(); const previous = body();
  if (mode === 'focus') { mockFocused = false; update(); mockFocused = true; update(); }
  else { tab('circles'); tab('people'); }
  act(() => { previous.onPersonPress(mockPeople[0]); previous.onAddPeople(); });
  expect(mockPush).not.toHaveBeenCalled();
  expect(tree!.root.findByType(PathsSheet).props.visible).toBe(false);
  act(() => { body().onPersonPress(mockPeople[0]); body().onAddPeople(); });
  expect(mockPush).toHaveBeenCalledWith('/person/amelia');
  expect(tree!.root.findByType(PathsSheet).props.visible).toBe(true);
});

it('retires same-account pre-auth callbacks but enables the committed returning identity', async () => {
  mockUseRealIdentity = true; mockPeopleByAccount = { viewer: mockPeople };
  mount(false); await flush(); tab('people'); const previous = body();
  act(() => {
    for (const listener of mockListeners) listener('SIGNED_OUT', null);
    previous.onPersonPress(mockPeople[0]); previous.onAddPeople();
    for (const listener of mockListeners) listener('SIGNED_IN', { user: { id: 'viewer' } });
  });
  act(() => { previous.onPersonPress(mockPeople[0]); previous.onAddPeople(); });
  expect(mockPush).not.toHaveBeenCalled();
  expect(tree!.root.findByType(PathsSheet).props.visible).toBe(false);
  act(() => { body().onPersonPress(mockPeople[0]); body().onAddPeople(); });
  expect(mockPush).toHaveBeenCalledWith('/person/amelia');
  expect(tree!.root.findByType(PathsSheet).props.visible).toBe(true);
});

it.each(['people','circles'])('honors a later People notification after a consumed %s intent without resetting manual choices', first=>{
 mockParams={tab:first};mount(false);expect(tree!.root.findByType(YoursTabs).props.active).toBe(first);
 mockParams={};update();tab('albums');update();expect(tree!.root.findByType(YoursTabs).props.active).toBe('albums');
 mockParams={tab:'people'};update();expect(tree!.root.findByType(YoursTabs).props.active).toBe('people');expect(mockSetParams).toHaveBeenLastCalledWith({tab:undefined});
 mockParams={};update();tab('myPlans');update();expect(tree!.root.findByType(YoursTabs).props.active).toBe('myPlans');
});
