jest.mock('../../ProfileButton', () => ({ __esModule: true, default: () => null }));
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useQuery } from '@tanstack/react-query';
import PlanChatScreen from '../../../app/(tabs)/chats/[id]';
import { showAddToCalendar } from '../../../lib/addToCalendar';
import { openUrl } from '../../../lib/url';

let mockThreadProps: any;
let mockAnchor: string | undefined;
let mockViewerId: string | null = 'account-a', mockEpoch = 1, mockIdentityLoading = false, mockIdentityError: Error | null = null;
const mockIdentityRetry = jest.fn();
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => {
  const viewerId = mockViewerId, epoch = mockEpoch;
  const isCurrent = require('react').useCallback(() => viewerId === mockViewerId && epoch === mockEpoch, [viewerId, epoch]);
  return { viewerId, epoch, isCurrent, isLoading: mockIdentityLoading, error: mockIdentityError, retry: mockIdentityRetry };
} }));
const mockPush = jest.fn(), mockBack = jest.fn();
jest.mock('../ChatThread', () => ({ __esModule: true, default: (props: any) => {
  mockThreadProps = props;
  return require('react').createElement(require('react-native').View, null, props.renderHeaderBanner?.());
} }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'plan-a', reactionMessageId: mockAnchor, reactionMessageSource: mockAnchor ? 'chat' : undefined }), useRouter: () => ({ push: mockPush, back: mockBack }) }));
jest.mock('@tanstack/react-query', () => ({ useQuery: jest.fn() }));
jest.mock('../../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../../lib/addToCalendar', () => ({ showAddToCalendar: jest.fn() }));
jest.mock('../../../lib/url', () => ({ openUrl: jest.fn() }));
jest.mock('../../../constants/FeatureFlags', () => ({ COMMUNITY_CHAT_GROUPING_ENABLED: true }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const event = { id: 'plan-a', title: 'Volleyball', start_time: '2026-09-19T21:00:00Z', end_time: '2026-09-19T23:00:00Z', location_text: 'Ocean Park', status: 'active', tickets_url: 'https://example.test/tickets', member_count: 12, explore_event_id: 'event-a', members: [{ id: 'sample', first_name: 'Amelia', avatar_url: null }] };
let tree: ReactTestRenderer;
beforeEach(() => {
  mockAnchor = undefined; mockThreadProps = undefined; mockViewerId = 'account-a'; mockEpoch = 1; mockIdentityLoading = false; mockIdentityError = null;
  (useQuery as jest.Mock).mockImplementation(({ queryKey }) => ({ data: queryKey[0] === 'event-info' ? event : queryKey[0] === 'event-header-members' ? event.members : { id: 'event-a', title: 'Summer tournament' }, isError: false }));
});
afterEach(() => { act(() => tree?.unmount()); jest.clearAllMocks(); });

it('moves the same calendar action into compact chrome without removing members, tickets or the parent event', () => {
  act(() => { tree = create(<PlanChatScreen />); });
  const buttons = tree.root.findAllByType(TouchableOpacity);
  expect(buttons.some(button => button.props.accessibilityLabel === 'Add Plan to calendar')).toBe(false);
  expect(mockThreadProps.members).toBe(event.members);
  expect(mockThreadProps.locationLabel).toBe(event.location_text);
  expect(mockThreadProps.headerMenu).toEqual({ type: 'report' });
  act(() => {
    mockThreadProps.onViewContext();
    mockThreadProps.calendarAction.onPress();
    buttons.find(button => button.props.accessibilityLabel === 'View event Summer tournament')!.props.onPress();
    buttons.find(button => button.findAllByType(Text).some(text => text.props.children === 'Get Tickets'))!.props.onPress();
  });
  expect(mockPush.mock.calls).toEqual([['/plan/plan-a'], ['/event/event-a']]);
  expect(showAddToCalendar).toHaveBeenCalledWith(event.title, event.start_time, event.end_time, event.location_text);
  expect(openUrl).toHaveBeenCalledWith(event.tickets_url);
});

it('retains the existing calendar banner with the staged flag off', () => {
  const flags = jest.requireMock('../../../constants/FeatureFlags');
  flags.COMMUNITY_CHAT_GROUPING_ENABLED = false;
  try {
    act(() => { tree = create(<PlanChatScreen />); });
    expect(tree.root.findAllByType(TouchableOpacity).filter(button => button.props.accessibilityLabel === 'Add Plan to calendar')).toHaveLength(1);
  } finally { flags.COMMUNITY_CHAT_GROUPING_ENABLED = true; }
});

it('keeps the load-error gate before conversation and calendar actions', () => {
  (useQuery as jest.Mock).mockReturnValue({ isError: true });
  act(() => { tree = create(<PlanChatScreen />); });
  expect(mockThreadProps).toBeUndefined();
  expect(showAddToCalendar).not.toHaveBeenCalled();
  expect(tree.root.findAllByType(Text).map(text => text.props.children)).toContain('Chat couldn’t load');
});

it('shows a recoverable loading entrance instead of an unfinished conversation', () => {
  (useQuery as jest.Mock).mockReturnValue({ data: undefined, isError: false, isLoading: true });
  act(() => { tree = create(<PlanChatScreen/>); });
  expect(mockThreadProps).toBeUndefined();
  expect(tree.root.findAllByType(Text).map(text => text.props.children)).toContain('Opening your chat');
  act(() => tree.root.findAllByType(TouchableOpacity).find(button => button.props.accessibilityLabel === 'Back to Chats')!.props.onPress());
  expect(mockBack).toHaveBeenCalledTimes(1);
});
it('retries the same Plan metadata read after an entrance error', () => {
  const retry = jest.fn();
  (useQuery as jest.Mock).mockReturnValue({ isError: true, refetch: retry });
  act(() => { tree = create(<PlanChatScreen/>); });
  act(() => tree.root.findAllByType(TouchableOpacity).find(button => button.props.accessibilityLabel === 'Retry opening chat')!.props.onPress());
  expect(retry).toHaveBeenCalledTimes(1);expect(mockThreadProps).toBeUndefined();
});

it('ends a stalled Plan metadata read and does not automatically restart its deadline', async () => {
  jest.useFakeTimers();
  const db = jest.requireMock('../../../lib/supabase').supabase;
  const stalled = new Promise(() => {});
  const read: any = { select: () => read, eq: () => read, maybeSingle: () => stalled, limit: () => stalled };
  db.from = jest.fn(() => read);
  try {
    act(() => { tree = create(<PlanChatScreen/>); });
    const options = (useQuery as jest.Mock).mock.calls.find(([value]) => value.queryKey[0] === 'event-info')![0];
    const outcome = options.queryFn().catch((error: Error) => error);
    await act(async () => { jest.advanceTimersByTime(12_000); });
    const error = await outcome;
    expect(error.name).toBe('RequestDeadlineError');
    expect(options.retry(0,error)).toBe(false);
  } finally { delete db.from; jest.useRealTimers(); }
});

it('keeps member-read failure in the independent optional header query', async () => {
  const db = jest.requireMock('../../../lib/supabase').supabase;
  const failure = new Error('Member read failed');
  db.from = jest.fn((table: string) => {
    const read: any = {select:()=>read,eq:()=>read,
      maybeSingle:async()=>({data:event,error:null}),
      limit:async()=>({data:null,error:failure})};
    return read;
  });
  try {
    act(() => { tree = create(<PlanChatScreen/>); });
    const options = (useQuery as jest.Mock).mock.calls.find(([value]) => value.queryKey[0] === 'event-header-members')![0];
    await expect(options.queryFn()).rejects.toBe(failure);
    expect(db.from).not.toHaveBeenCalledWith('profiles_public');
  } finally { delete db.from; }
});


it('keeps the same conversation mounted when its cached Plan details fail to refresh', () => {
  const retry = jest.fn();
  act(() => { tree = create(<PlanChatScreen/>); });
  const thread = tree.root.findByType(jest.requireMock('../ChatThread').default);
  (useQuery as jest.Mock).mockImplementation(({queryKey}) => ({data:queryKey[0] === 'event-info' ? event : queryKey[0] === 'event-header-members' ? event.members : null, isError:queryKey[0] === 'event-info', refetch:retry}));
  act(() => tree.update(<PlanChatScreen/>));
  expect(tree.root.findByType(jest.requireMock('../ChatThread').default)).toBe(thread);
  expect(mockThreadProps.title).toBe(event.title);
  act(() => tree.root.findAllByType(TouchableOpacity).find(button => button.props.accessibilityLabel === 'Retry Plan details')!.props.onPress());
  expect(retry).toHaveBeenCalledTimes(1);
});

it('partitions Plan and parent-event metadata by account and identity generation', () => {
  act(() => { tree = create(<PlanChatScreen/>); });
  expect((useQuery as jest.Mock).mock.calls.map(([options]) => options.queryKey)).toContainEqual(['event-info','plan-a','account-a',1]);
  mockViewerId = 'account-b'; mockEpoch++;
  act(() => tree.update(<PlanChatScreen/>));
  expect((useQuery as jest.Mock).mock.calls.map(([options]) => options.queryKey)).toContainEqual(['event-info','plan-a','account-b',2]);
  expect((useQuery as jest.Mock).mock.calls.map(([options]) => options.queryKey)).toContainEqual(['chat-parent-event','event-a','account-b',2]);
});

it.each(['loading','error','signed-out'])('does not open cached chat chrome while identity is %s', state => {
  mockIdentityLoading = state === 'loading'; mockIdentityError = state === 'error' ? new Error('Offline') : null;
  if (state === 'signed-out') mockViewerId = null;
  act(() => { tree = create(<PlanChatScreen/>); });
  expect(mockThreadProps).toBeUndefined();
  expect((useQuery as jest.Mock).mock.calls.every(([options]) => !options.enabled)).toBe(true);
});

it('rejects a Plan read that finishes after the account changes', async () => {
  const db = jest.requireMock('../../../lib/supabase').supabase;
  let resolve!: (value: unknown) => void;
  const pending = new Promise(done => { resolve = done; });
  db.from = jest.fn(() => {const read:any={select:()=>read,eq:()=>read,maybeSingle:()=>pending,limit:async()=>({data:[],error:null})};return read;});
  try {
    act(() => { tree = create(<PlanChatScreen/>); });
    const options = (useQuery as jest.Mock).mock.calls.find(([value]) => value.queryKey[0] === 'event-info')![0];
    const outcome = options.queryFn();
    mockViewerId = 'account-b'; mockEpoch++;
    resolve({data:event,error:null});
    await expect(outcome).rejects.toThrow('This chat visit changed.');
  } finally { delete db.from; }
});

it('bounds parent-event reads and offers retry without hiding the conversation', async () => {
  jest.useFakeTimers(); const db = jest.requireMock('../../../lib/supabase').supabase; const retry = jest.fn();
  const stalled = new Promise(() => {});const read:any={select:()=>read,eq:()=>read,maybeSingle:()=>stalled};db.from=jest.fn(()=>read);
  (useQuery as jest.Mock).mockImplementation(({queryKey})=>({data:queryKey[0]==='event-info'?event:queryKey[0]==='event-header-members'?event.members:undefined,isError:queryKey[0]==='chat-parent-event',refetch:retry}));
  try {
    act(() => { tree = create(<PlanChatScreen/>); });
    expect(mockThreadProps.title).toBe(event.title);
    act(() => tree.root.findAllByType(TouchableOpacity).find(button=>button.props.accessibilityLabel==='Retry linked event')!.props.onPress());
    expect(retry).toHaveBeenCalledTimes(1);
    const options=(useQuery as jest.Mock).mock.calls.find(([value])=>value.queryKey[0]==='chat-parent-event')![0];
    const outcome=options.queryFn().catch((error:Error)=>error);
    await act(async()=>{jest.advanceTimersByTime(12_000);});
    const error=await outcome;expect(error.name).toBe('RequestDeadlineError');expect(options.retry(0,error)).toBe(false);
  } finally {delete db.from;jest.useRealTimers();}
});

it('surfaces failed report-member reads and excludes the current account', async () => {
  const db=jest.requireMock('../../../lib/supabase').supabase;const failure=new Error('Offline');let shouldFail=true;const selectedIds:string[][]=[];
  db.from=jest.fn((table:string)=>{const result=table==='event_members'?{data:[{user_id:'account-a'},{user_id:'member-b'}],error:shouldFail?failure:null}:{data:[{id:'member-b',first_name_display:'Jamie'}],error:null};const read:any={select:()=>read,eq:()=>read,in:(_key:string,ids:string[])=>{selectedIds.push(ids);return Promise.resolve(result);},then:(yes:any,no:any)=>Promise.resolve(result).then(yes,no)};return read;});
  try {
    act(()=>{tree=create(<PlanChatScreen/>);});
    await expect(mockThreadProps.fetchReportMembers()).rejects.toBe(failure);
    shouldFail=false;
    await expect(mockThreadProps.fetchReportMembers()).resolves.toEqual([{id:'member-b',name:'Jamie'}]);
    expect(selectedIds).toEqual([['member-b']]);
    mockViewerId='account-b';mockEpoch++;
    await expect(mockThreadProps.fetchReportMembers()).rejects.toThrow('This chat visit changed.');
  } finally {delete db.from;}
});

it('passes the exact reaction target through the admitted Plan route', () => {
  mockAnchor='33333333-3333-4333-8333-000000000100';
  act(() => { tree=create(<PlanChatScreen/>); });
  expect(mockThreadProps.reactionMessageId).toBe(mockAnchor);
  expect(mockThreadProps.reactionMessageSource).toBe('chat');
});
