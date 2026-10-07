import React from 'react';
import { SectionList, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import MyPlansView from '../MyPlansView';
import { PageAction } from '../../../creator/pages/PageFrame';
import { SkeletonFeed } from '../../../SkeletonCard';
import { PlanCard } from '../../../plans/PlanCard';
const mockPush = jest.fn(), mockWishlistRead = jest.fn();
let mockWishlistOptions: any;
let mockCommunitiesEnabled = true;
jest.mock('../../../../constants/FeatureFlags', () => ({get COMMUNITIES_ENABLED() {return mockCommunitiesEnabled;}, COMMUNITY_CHAT_GROUPING_ENABLED:false}));
let mockQueries: Record<string, any> = {};
jest.mock('../../../../hooks/useMyPlansData', () => ({
 useMyPlans: () => mockQueries.plans, useMyPlanDrafts: () => mockQueries.drafts,
 useWaitlistedPlans: () => mockQueries.waitlist, useInterestedPlans: () => mockQueries.interested, useSavedPlans: () => mockQueries.saved,
}));
jest.mock('@tanstack/react-query', () => ({ useQuery: (options:any) => {mockWishlistOptions=options;return mockQueries.wishlist;}, useMutation: () => ({ mutate: jest.fn() }), useQueryClient: () => ({}) }));
jest.mock('../../../creator/pages/PageFrame', () => ({ PageAction: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: {} }) }));
jest.mock('../../../../hooks/useBlock', () => ({ useBlock: () => ({ blockUser: jest.fn() }) }));
jest.mock('../../../../lib/supabase', () => ({ supabase: {from: () => ({select: () => ({eq: () => mockWishlistRead()})})} }));
jest.mock('../../../../lib/haptics', () => ({ hapticLight: jest.fn(), hapticError: jest.fn() }));
jest.mock('../../../plans/PlanCard', () => ({ PlanCard: () => null }));
jest.mock('../../../SkeletonCard', () => ({ SkeletonFeed: () => null }));
jest.mock('../../../MiniProfileCard', () => () => null);
jest.mock('../../../modals/ReportModal', () => ({ ReportModal: () => null }));
jest.mock('../../../SaveSnackbar', () => ({ SaveSnackbar: () => null }));
jest.mock('../../../ShareSheet', () => ({ ShareSheet: () => null }));
jest.mock('../../../BrandedAlert', () => ({ BrandedAlert: () => null }));

let tree: ReturnType<typeof create>, alive = false, userId = 'alice';
const plan = { id: 'p1', title: 'Sunday walk', status: 'active', start_time: '2030-09-14T20:00:00Z', end_time: '2030-09-14T22:00:00Z' };
function mount() { act(() => { tree = create(<MyPlansView userId={userId}/>); alive = true; }); }
function update() { act(() => tree.update(<MyPlansView userId={userId}/>)); }
function unmount() { if (alive) act(() => { tree.unmount(); alive = false; }); }
function words() { return tree.root.findAllByType(Text).map(n => n.props.children).join(' '); }
function action(title = 'Try again') { return tree.root.findAllByType(PageAction).find(n => n.props.title === title)!; }
function deferred<T>() { let resolve!: (value:T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function flush() { await act(async () => { for (let i=0;i<8;i++) await Promise.resolve(); }); }
beforeEach(() => {
 jest.useFakeTimers(); jest.setSystemTime(Date.parse('2030-09-14T19:00:00Z')); jest.clearAllMocks(); userId='alice'; alive=false; mockCommunitiesEnabled=true; mockWishlistRead.mockReset().mockResolvedValue({data:[],error:null});
 mockQueries = Object.fromEntries(['plans','drafts','waitlist','interested','saved','wishlist'].map(key => [key, {data:[], isLoading:false, isError:false, refetch:jest.fn().mockResolvedValue({data:[], error:null})}]));
});
afterEach(() => { unmount(); jest.clearAllTimers(); jest.useRealTimers(); });
it.each(['plans','drafts','waitlist','interested','saved','wishlist'])('does not claim an empty collection when %s fails', key => {
 mockQueries[key].isError=true; mount(); expect(words()).toContain('Your plans couldn’t load'); expect(words()).not.toContain("haven't joined"); expect(action()).toBeDefined();
});
it.each(['plans','drafts','waitlist','interested','saved','wishlist'])('waits for an incomplete %s collection before declaring empty', key => {
 mockQueries[key].data=undefined; mockQueries[key].isLoading=true; mount(); expect(tree.root.findAllByType(SkeletonFeed)).toHaveLength(1); expect(words()).not.toContain("haven't joined");
});
it('preserves cached cards and retries only failed reads once per pending attempt', async () => {
 mockQueries.plans.data=[plan]; mockQueries.saved.isError=true; const read=deferred<any>(); mockQueries.saved.refetch.mockReturnValue(read.promise); mount();
 expect(words()).toContain('Some plans couldn’t refresh'); expect(tree.root.findByType(SectionList).props.sections[0].data).toEqual([plan]);
 const retry=action().props.onPress; act(() => {retry();retry();}); expect(mockQueries.saved.refetch).toHaveBeenCalledTimes(1); expect(mockQueries.plans.refetch).not.toHaveBeenCalled(); expect(action('Retrying…').props.disabled).toBe(true);
 mockQueries.saved.isError=false; read.resolve({data:[],error:null}); await flush(); update(); expect(words()).not.toContain('couldn’t refresh'); expect(tree.root.findAllByType(PlanCard)).toHaveLength(1);
});
it('keeps partial cards visible while other collections are loading', () => {
 mockQueries.plans.data=[plan]; mockQueries.interested.isLoading=true; mount(); expect(tree.root.findAllByType(PlanCard)).toHaveLength(1); expect(words()).toContain('Loading the rest'); expect(tree.root.findAllByType(SkeletonFeed)).toHaveLength(0);
});
it('retains saved cards while their bookmark lookup is unavailable', () => {
 mockQueries.saved.data=[plan]; mockQueries.wishlist.data=undefined; mockQueries.wishlist.isError=true; mount();
 expect(tree.root.findByType(SectionList).props.sections).toEqual([{title:'Saved',data:[plan]}]); expect(words()).toContain('couldn’t refresh');
});
it('ends a stalled manual retry and ignores its late UI completion', async () => {
 mockQueries.plans.isError=true; const read=deferred<any>(); mockQueries.plans.refetch.mockReturnValue(read.promise); mount(); act(() => action().props.onPress());
 await act(async () => {jest.advanceTimersByTime(12_000);}); await flush(); expect(action().props.disabled).toBe(false);
 mockQueries.plans.isError=false; read.resolve({data:[],error:null}); await flush(); update(); expect(words()).toContain('Your plans couldn’t load');
 mockQueries.plans.refetch.mockResolvedValue({data:[],error:null}); act(() => action().props.onPress()); await flush(); expect(words()).toContain("haven't joined");
});
it.each(['account','unmount'])('retires retry and pending feedback after %s', async retirement => {
 mockQueries.plans.isError=true; const read=deferred<any>(); mockQueries.plans.refetch.mockReturnValue(read.promise); mount(); const retry=action().props.onPress; act(() => retry());
 if(retirement==='account'){userId='bob'; mockQueries.plans.isError=false; update();}else unmount();
 act(() => retry()); expect(mockQueries.plans.refetch).toHaveBeenCalledTimes(1); read.resolve({error:new Error('old failure')}); await flush();
 if(retirement==='account') expect(words()).toContain("haven't joined");
});
it.each(['account','unmount'])('retires the empty-state Browse action after %s', retirement => {
 mount(); const browse=action('Browse Plans').props.onPress;
 if(retirement==='account'){userId='bob';update();}else unmount(); act(() => browse()); expect(mockPush).not.toHaveBeenCalled();
});
it('opens the original Plans destination only after all collections succeed empty', () => {
 mount(); expect(words()).toContain("haven't joined"); act(() => action('Browse Plans').props.onPress()); expect(mockPush).toHaveBeenCalledWith('/(tabs)/plans');
});

it('ignores the disabled draft collection instead of blocking an empty list', () => {
 mockCommunitiesEnabled=false; mockQueries.drafts.isLoading=true; mockQueries.drafts.isError=true; mount(); expect(words()).toContain("haven't joined");
});
it('retains draft entries while another collection fails', () => {
 mockQueries.drafts.data=[{id:'draft',title:'A plan to finish',start_time:'2030-09-14T20:00:00Z'}]; mockQueries.saved.isError=true; mount();
 expect(words()).toContain('A plan to finish'); expect(words()).toContain('Some plans couldn’t refresh');
});
it('the bookmark read propagates database errors instead of replacing saved membership with empty', async () => {
 mount(); mockWishlistRead.mockResolvedValue({data:null,error:new Error('offline')});
 await expect(mockWishlistOptions.queryFn()).rejects.toThrow('offline'); expect(mockWishlistOptions.retry).toBe(false);
});
it('bounds the bookmark read and ignores a late empty result', async () => {
 mount(); const read=deferred<any>(); mockWishlistRead.mockReturnValue(read.promise); const request=mockWishlistOptions.queryFn();
 const outcome=expect(request).rejects.toThrow('took too long'); await act(async () => {jest.advanceTimersByTime(8000);}); await outcome;
 read.resolve({data:[],error:null}); await flush();
});

it('does not show empty while an initial collection is pending without an active fetch', () => {
 mockQueries.saved.data=undefined;mockQueries.saved.isPending=true;mount();expect(tree.root.findAllByType(SkeletonFeed)).toHaveLength(1);expect(words()).not.toContain("haven't joined");
});
