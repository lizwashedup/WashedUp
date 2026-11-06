import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Modal, Platform, Text, TouchableOpacity } from 'react-native';
import InboxModal from '../InboxModal';
import { ParticipationNotice } from '../legal/ParticipationNotice';
const mockTerms = jest.fn(), mockAssent = jest.fn(), mockAccept = jest.fn(), mockDecline = jest.fn();
const mockWaitlist = jest.fn();
const mockMembership = jest.fn(), mockAuthUser = jest.fn();
let mockException = false;
let mockNoticeType = 'member_joined';
jest.mock('../../lib/participationTerms', () => ({ getParticipationNoticeStatus: () => mockTerms(), recordParticipationAssent: (context: unknown) => mockAssent(context) }));
jest.mock('../../lib/waitlistExceptions', () => ({ ...jest.requireActual('../../lib/waitlistExceptions'), acceptWaitlistException: (id: string) => mockAccept(id), declineWaitlistException: (id: string) => mockDecline(id) }));
const mockPush = jest.fn(), mockClose = jest.fn(), mockWrite = jest.fn();
let mockCurrent = true;
let mockInvites: any[] = [];
let mockNoticeError = false;
let mockExpiresAt: string | null = null;
const mockRetryNotices = jest.fn();
const mockClient = { invalidateQueries: jest.fn().mockResolvedValue(undefined), setQueryData: jest.fn() };
const mockReadInvite = jest.fn(), mockFilters = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../../hooks/useInboxNotificationScope', () => ({ useInboxNotificationScope: () => ({ ready: true, epoch: 1, userId: 'fictional-viewer', isCurrent: () => mockCurrent }) }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => mockClient, useQuery: ({queryKey}: any) => ({
  isError: queryKey[0] === 'app-notifications' && mockNoticeError,
  data: queryKey[0] === 'app-notifications' ? mockNoticeError ? undefined : [{id:'fictional-notice',type:mockException ? 'exception_invite' : mockNoticeType,title:'Fictional reminder',expires_at:mockExpiresAt,event_id:'fictional-plan',created_at:new Date().toISOString()}] : queryKey[0] === 'pending-invites' ? mockInvites : [], refetch: queryKey[0] === 'app-notifications' ? mockRetryNotices : jest.fn(), isLoading: false,
}) }));
jest.mock('../../lib/supabase', () => ({ supabase: { auth: { getUser: () => mockAuthUser() }, from: (table: string) => {
  let writing=false;
  const chain:any={select:()=>chain,update:()=>{writing=true;return chain;},
    neq:(...a:any[])=>{mockFilters(writing,...a);return chain;}, or:()=>chain, lte:(...a:any[])=>{mockFilters(writing,...a);return chain;},
    eq:(...args:any[])=>{mockFilters(writing,...args);return chain;},
    maybeSingle:()=>writing?mockWrite():table==='event_members'?mockMembership():table==='event_waitlist'?mockWaitlist():mockReadInvite(),then:(yes:any,no:any)=>(writing ? mockWrite() : mockReadInvite()).then(yes,no)};
  return chain;
} } }));
jest.mock('expo-notifications', () => ({ setBadgeCountAsync: jest.fn(async () => {}) }));
jest.mock('../../lib/haptics', () => ({ hapticLight: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({bottom:0,top:0,left:0,right:0}) }));
jest.mock('../BrandedAlert', () => ({ BrandedAlert: () => null }));
jest.mock('../legal/ParticipationNotice', () => ({ ParticipationNotice: () => null }));
let tree: ReactTestRenderer;
const row = () => tree.root.findAllByType(TouchableOpacity).find(n => n.findAllByType(Text).some(t => t.props.children === 'Fictional reminder'))!;
beforeEach(() => { jest.clearAllMocks(); mockCurrent = true; mockNoticeType = 'member_joined'; mockInvites = []; mockNoticeError = false; mockExpiresAt = null; Platform.OS = 'ios'; mockWrite.mockResolvedValue({error:null}); act(() => { tree = create(<InboxModal visible userId="fictional-viewer" onClose={mockClose} />); }); });
afterEach(() => act(() => tree.unmount()));
it('does not open a chat before its native inbox window dismisses', async () => {
  await act(async () => row().props.onPress());
  expect(mockPush).not.toHaveBeenCalled();
  act(() => tree.root.findByType(Modal).props.onDismiss());
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/chats/fictional-plan');
  expect(mockClient.invalidateQueries).toHaveBeenCalledWith({queryKey:['app-notifications','fictional-viewer',1],exact:true});
  expect(mockClient.invalidateQueries).toHaveBeenCalledWith({queryKey:['inbox-count','fictional-viewer',1],exact:true});
});
it('does not dispatch the same row action twice in one frame', async () => {
  const press = row().props.onPress;
  await act(async () => { await Promise.all([press(), press()]); });
  expect(mockWrite).toHaveBeenCalledTimes(1);
});

const renderInbox = (visible = true, userId = 'fictional-viewer') => <InboxModal visible={visible} userId={userId} onClose={mockClose} />;
it('closes the native window first and completes a repeated dismissal only once', async () => {
  await act(async () => row().props.onPress());
  expect(tree.root.findByType(Modal).props.visible).toBe(false);
  expect(mockClose).not.toHaveBeenCalled();
  const dismiss = tree.root.findByType(Modal).props.onDismiss;
  act(() => { dismiss(); dismiss(); });
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledTimes(1);
});
it.each(['hidden', 'reopened', 'account', 'unmounted'])('retires queued navigation after the inbox is %s', async change => {
  await act(async () => row().props.onPress());
  const dismiss = tree.root.findByType(Modal).props.onDismiss;
  if (change === 'unmounted') act(() => tree.unmount());
  else if (change === 'account') act(() => tree.update(renderInbox(true, 'other')));
  else {
    act(() => tree.update(renderInbox(false)));
    if (change === 'reopened') act(() => tree.update(renderInbox()));
  }
  act(() => dismiss());
  expect(mockPush).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
});
it('does not navigate after account ownership retires before dismissal', async () => {
  await act(async () => row().props.onPress());
  mockCurrent = false;
  act(() => tree.root.findByType(Modal).props.onDismiss());
  expect(mockPush).not.toHaveBeenCalled();
});
it('allows Android to open without waiting for the iOS-only completion', async () => {
  Platform.OS = 'android';
  await act(async () => row().props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/chats/fictional-plan');
  expect(mockClose).toHaveBeenCalledTimes(1);
});
it('ignores a pending row result when the user closes the inbox', async () => {
  mockNoticeType = 'people_ping'; await act(async () => tree.update(renderInbox()));
  let resolve!: (value: any) => void;
  mockWrite.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  let pending!: Promise<void>;
  act(() => { pending = row().props.onPress(); });
  await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
  act(() => tree.root.findByType(Modal).props.onRequestClose());
  await act(async () => { resolve({error: null}); await pending; });
  act(() => tree.root.findByType(Modal).props.onDismiss());
  expect(mockPush).not.toHaveBeenCalled();
  expect(mockClose).toHaveBeenCalledTimes(1);
});
it('releases a rejected action for retry without leaving the inbox', async () => {
  mockNoticeType = 'people_ping'; await act(async () => tree.update(renderInbox()));
  mockWrite.mockRejectedValueOnce(Error('offline'));
  await act(async () => row().props.onPress());
  expect(tree.root.findByType(Modal).props.visible).toBe(true);
  expect(mockPush).not.toHaveBeenCalled();
  await act(async () => row().props.onPress());
  act(() => tree.root.findByType(Modal).props.onDismiss());
  expect(mockWrite).toHaveBeenCalledTimes(2);
  expect(mockPush).toHaveBeenCalledTimes(1);
});

it('offers a named close control that waits for native dismissal without navigation', () => {
  const close = tree.root.findAllByType(TouchableOpacity).find(n => n.props.accessibilityLabel === 'Close inbox')!;
  act(() => close.props.onPress());
  expect(tree.root.findByType(Modal).props.visible).toBe(false);
  expect(mockClose).not.toHaveBeenCalled();
  act(() => tree.root.findByType(Modal).props.onDismiss());
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(mockPush).not.toHaveBeenCalled();
});

it('opens an invitation without acknowledging acceptance before confirmed membership', async () => {
  mockInvites = [{id:'fictional-invite',event_id:'fictional-plan',recipient_id:'fictional-viewer',status:'pending',events:{title:'Fictional invited plan'}}];
  act(() => tree.update(renderInbox()));
  const open = tree.root.findAllByType(TouchableOpacity).find(n => n.findAllByType(Text).some(t => t.props.children === "Let's Go →"))!;
  await act(async () => { await open.props.onPress(); await open.props.onPress(); });
  expect(mockWrite).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
  act(() => tree.root.findByType(Modal).props.onDismiss());
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith('/plan/fictional-plan');
});

const invite = {id:'invite-one',event_id:'plan-one',recipient_id:'fictional-viewer',status:'pending',events:{title:'Sunset picnic'}};
const renderedText = () => tree.root.findAllByType(Text).map(n=>n.props.children);
const inviteButton = (label:string) => tree.root.findAllByType(TouchableOpacity).find(n=>n.findAllByType(Text).some(t=>t.props.children===label))!;
async function showInvite() {mockReadInvite.mockResolvedValue({data:invite,error:null}); mockInvites=[invite];await act(async()=>tree.update(renderInbox()));}
it('keeps a rejected invitation decline visible with a retry', async () => {
  await showInvite();
  mockWrite.mockResolvedValueOnce({error:{code:'42501',message:'decline rejected'}});
  await act(async()=>inviteButton('Not This Time').props.onPress());
  expect(renderedText()).toContain('Sunset picnic');
  expect(renderedText()).toContain('Retry decline');
  expect(mockPush).not.toHaveBeenCalled();
});
it('sends one decline for two quick taps',async()=>{
  await showInvite();
  const press=inviteButton('Not This Time').props.onPress;
  await act(async()=>{await Promise.all([press(),press()]);});
  expect(mockWrite).toHaveBeenCalledTimes(1);
});

it.each(['no receipt','different recipient','timeout'])('checks an unconfirmed decline without repeating the write: %s',async mode=>{
  await showInvite();
  if(mode==='timeout')mockWrite.mockRejectedValueOnce(Error('lost reply'));
  else mockWrite.mockResolvedValueOnce({data:mode==='no receipt'?null:{...invite,recipient_id:'another',status:'declined'},error:null});
  await act(async()=>inviteButton('Not This Time').props.onPress());
  expect(renderedText()).toContain('Check invitation');
  expect(mockClient.setQueryData).not.toHaveBeenCalled();
  mockReadInvite.mockResolvedValueOnce({data:{...invite,status:'declined'},error:null});
  await act(async()=>inviteButton('Check invitation').props.onPress());
  expect(mockWrite).toHaveBeenCalledTimes(1);
  expect(mockClient.invalidateQueries).toHaveBeenCalledWith({queryKey:['pending-invites-badge','fictional-viewer']});
  expect(mockClient.invalidateQueries).toHaveBeenCalledWith({queryKey:['inbox-count','fictional-viewer']});
});
it('requires another explicit tap after a read confirms a still-pending invitation',async()=>{
  await showInvite();mockWrite.mockResolvedValueOnce({data:null,error:null});
  await act(async()=>inviteButton('Not This Time').props.onPress());
  await act(async()=>inviteButton('Check invitation').props.onPress());
  expect(mockWrite).toHaveBeenCalledTimes(1);expect(renderedText()).toContain('Retry decline');
  mockWrite.mockResolvedValueOnce({data:{...invite,status:'declined'},error:null});
  await act(async()=>inviteButton('Retry decline').props.onPress());
  expect(mockWrite).toHaveBeenCalledTimes(2);
  for(const [key,value] of [['id',invite.id],['event_id',invite.event_id],['recipient_id',invite.recipient_id],['status','pending']])
    expect(mockFilters).toHaveBeenCalledWith(true,key,value);
});
it.each(['close/reopen','account change'])('does not submit a decline after %s during preflight',async mode=>{
  await showInvite();
  let finish!:(v:any)=>void;mockReadInvite.mockReturnValueOnce(new Promise(r=>{finish=r;}));
  let pending!:Promise<void>;act(()=>{pending=inviteButton('Not This Time').props.onPress();});
  if(mode==='close/reopen'){act(()=>tree.update(renderInbox(false)));act(()=>tree.update(renderInbox(true)));}
  else {mockCurrent=false;act(()=>tree.update(renderInbox(true,'other')));}
  await act(async()=>{finish({data:invite,error:null});await pending;});
  expect(mockWrite).not.toHaveBeenCalled();expect(mockPush).not.toHaveBeenCalled();
});
it('checks again on reopening instead of declining an already answered invitation',async()=>{
  await showInvite();mockReadInvite.mockResolvedValueOnce({data:{...invite,status:'accepted'},error:null});
  await act(async()=>inviteButton('Not This Time').props.onPress());
  expect(mockWrite).not.toHaveBeenCalled();expect(mockClient.setQueryData).toHaveBeenCalled();
});

it('times out a stalled reply and a stale failure cannot affect a reopened sheet', async()=>{
  await showInvite();
  jest.useFakeTimers();
  try {
    let finish!:(v:any)=>void;
    mockWrite.mockReturnValueOnce(new Promise(r=>{finish=r;}));
    let pending!:Promise<void>;
    await act(async()=>{pending=inviteButton('Not This Time').props.onPress();await Promise.resolve();});
    expect(renderedText()).toContain('Declining…');
    await act(async()=>{await jest.advanceTimersByTimeAsync(12_001);await pending;});
    expect(renderedText()).toContain('Check invitation');
    act(()=>tree.update(renderInbox(false)));await act(async()=>tree.update(renderInbox(true)));
    await act(async()=>{finish({error:{code:'42501'}});});
    expect(renderedText()).toContain('Not This Time');
    expect(renderedText()).not.toContain('Retry decline');
    expect(mockWrite).toHaveBeenCalledTimes(1);
  } finally {jest.useRealTimers();}
});

it('shows retry on a first notice-read failure, including alongside a loaded invitation',async()=>{
  mockNoticeError = true;
  act(()=>tree.update(renderInbox()));
  expect(renderedText()).toContain('Couldn’t refresh your notifications.');
  expect(renderedText().join(' ')).not.toMatch(/will show up here/);
  await showInvite();
  expect(renderedText()).toContain('Sunset picnic');
  act(()=>inviteButton('Retry').props.onPress());
  expect(mockRetryNotices).toHaveBeenCalledTimes(1);
});

it('removes a locally expired notice while the inbox stays open',async()=>{
  jest.useFakeTimers();
  try {
    mockExpiresAt = new Date(Date.now() + 800).toISOString();
    act(()=>tree.update(renderInbox()));
    expect(renderedText()).toContain('Fictional reminder');
    await act(async()=>{await jest.advanceTimersByTimeAsync(801);});
    expect(renderedText()).not.toContain('Fictional reminder');
  } finally {jest.useRealTimers();}
});

const clearButton = () => tree.root.findByProps({accessibilityLabel:'Clear all notifications'});
it('offers a retry when the server rejects Clear all', async()=>{
  mockWrite.mockResolvedValueOnce({data:null,error:{code:'42501'}});
  await act(async()=>clearButton().props.onPress());
  expect(renderedText()).toContain('Retry clear');
  expect(renderedText()).toContain('Fictional reminder');
});
it('submits Clear all once for two quick taps',async()=>{
  const press=clearButton().props.onPress;
  await act(async()=>{await Promise.all([press(),press()]);});
  expect(mockWrite).toHaveBeenCalledTimes(1);
});

it('checks an uncertain Clear all without another write and preserves new arrivals',async()=>{
  mockWrite.mockResolvedValueOnce({error:null,count:null});
  await act(async()=>clearButton().props.onPress());
  expect(renderedText()).toContain('Check notifications');
  expect(mockClient.setQueryData).not.toHaveBeenCalled();
  mockReadInvite.mockResolvedValueOnce({error:null,count:0});
  await act(async()=>inviteButton('Check notifications').props.onPress());
  expect(mockWrite).toHaveBeenCalledTimes(1);
  const [key, remove]=mockClient.setQueryData.mock.calls[0];
  expect(key).toEqual(['app-notifications','fictional-viewer',1]);
  expect(remove([{id:'fictional-notice'},{id:'new-arrival'}])).toEqual([{id:'new-arrival'}]);
  expect(mockClient.invalidateQueries).toHaveBeenCalledWith({queryKey:['inbox-count','fictional-viewer']});
});
it('requires an explicit retry and reuses the original cutoff after an unresolved write',async()=>{
  mockWrite.mockRejectedValueOnce(Error('lost connection'));
  await act(async()=>clearButton().props.onPress());
  const cutoff=mockFilters.mock.calls.find(([writing,key])=>writing && key==='created_at')![2];
  mockReadInvite.mockResolvedValueOnce({count:1,error:null});
  await act(async()=>inviteButton('Check notifications').props.onPress());
  expect(mockWrite).toHaveBeenCalledTimes(1);
  mockWrite.mockResolvedValueOnce({count:1,error:null});
  await act(async()=>inviteButton('Retry clear').props.onPress());
  expect(mockFilters.mock.calls.filter(([writing,key])=>writing && key==='created_at').map(row=>row[2])).toEqual([cutoff,cutoff]);
  expect(mockFilters).toHaveBeenCalledWith(true,'user_id','fictional-viewer');
  expect(mockFilters).toHaveBeenCalledWith(true,'type','new_message');
  expect(mockFilters).toHaveBeenCalledWith(true,'type','plan_invite');
});
it.each(['close/reopen','account change'])('retires a failed clear and retained tap across %s',async change=>{
  let finish!:(r:any)=>void;mockWrite.mockReturnValueOnce(new Promise(r=>{finish=r;}));
  const press=clearButton().props.onPress;let pending!:Promise<void>;act(()=>{pending=press();});
  if(change==='close/reopen'){act(()=>tree.update(renderInbox(false)));act(()=>tree.update(renderInbox(true)));}
  else {mockCurrent=false;act(()=>tree.update(renderInbox(true,'other')));}
  await act(async()=>{finish({error:{code:'42501'}});await pending;await press();});
  expect(mockWrite).toHaveBeenCalledTimes(1);expect(renderedText()).not.toContain('Retry clear');
});

const exactButton = (label: string) => tree.root.findAllByType(TouchableOpacity).find(n => n.props.accessibilityLabel === label)!;
it('keeps a rejected individual dismissal visible and only retries that notice', async()=>{
  mockWrite.mockResolvedValueOnce({error:{code:'42501'}});
  const dismiss=()=>tree.root.findAllByType(TouchableOpacity).find(n=>n.props.children?.props?.children==='Dismiss')!;
  await act(async()=>dismiss().props.onPress());
  expect(renderedText()).toContain('Retry dismiss');
  expect(renderedText()).toContain('Fictional reminder');
  mockWrite.mockResolvedValueOnce({error:null,count:1});
  await act(async()=>exactButton('Retry dismiss: Fictional reminder').props.onPress());
  expect(mockFilters.mock.calls.filter(([writing,key,value])=>writing && key==='id' && value==='fictional-notice')).toHaveLength(2);
  expect(mockPush).not.toHaveBeenCalled();
});
it('checks a single uncertain dismissal without clearing other notices or opening a plan',async()=>{
  const press=exactButton('Dismiss: Fictional reminder').props.onPress;
  mockWrite.mockResolvedValueOnce({error:null,count:null});
  await act(async()=>{await Promise.all([press(),press()]);});
  expect(renderedText()).toContain('Check status');
  mockReadInvite.mockResolvedValueOnce({error:null,count:0});
  await act(async()=>exactButton('Check status: Fictional reminder').props.onPress());
  expect(mockWrite).toHaveBeenCalledTimes(1);
  expect(mockFilters).toHaveBeenCalledWith(false,'id','fictional-notice');
  const [key,remove]=mockClient.setQueryData.mock.calls[0];
  expect(key).toEqual(['app-notifications','fictional-viewer',1]);
  expect(remove([{id:'other'},{id:'fictional-notice'}])).toEqual([{id:'other'}]);
  expect(mockPush).not.toHaveBeenCalled();
});
it('ignores an old individual dismiss callback on reopening',async()=>{
  const press=exactButton('Dismiss: Fictional reminder').props.onPress;
  act(()=>tree.update(renderInbox(false)));act(()=>tree.update(renderInbox(true)));
  await act(async()=>press());
  expect(mockWrite).not.toHaveBeenCalled();
});

describe('the inbox waitlist exception invitation', () => {
  const button = (label: string) => tree.root.findAllByType(TouchableOpacity)
    .find(n => n.props.children?.props?.children === label)!;
  const notice = () => tree.root.findByType(ParticipationNotice).props;
  function hold<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { resolve, promise };
  }
  async function startJoin() {
    let pending!: Promise<void>;
    await act(async () => { pending = button('Join the plan').props.onPress(); });
    return { pending };
  }
  const waitlistRow = {event_id:'fictional-plan', user_id:'fictional-viewer', exception_status:'invited',
    exception_invited_at:'2025-10-01T00:00:00Z', exception_expires_at:null};
  beforeEach(() => {
    mockDecline.mockReset().mockResolvedValue(undefined);
    mockWaitlist.mockReset().mockResolvedValue({error:null,data:waitlistRow});
    mockException = true;
    for (const mock of [mockAuthUser, mockTerms, mockAssent, mockAccept, mockMembership]) mock.mockReset();
    mockAuthUser.mockResolvedValue({data:{user:{id:'fictional-viewer'}},error:null});
    mockTerms.mockResolvedValue({needsAssent:false});
    mockAssent.mockResolvedValue(true);
    mockAccept.mockResolvedValue(undefined);
    mockMembership.mockResolvedValue({data:null,error:null});
    mockReadInvite.mockResolvedValue({data:null,error:null});
    act(() => tree.update(renderInbox()));
  });
  afterEach(() => { mockException = false; });
  it.each(['close', 'new account', 'close and reopen'])('retires the preflight on %s', async change => {
    const status = hold<{needsAssent:boolean}>();
    mockTerms.mockReturnValueOnce(status.promise);
    const { pending } = await startJoin();
    if (change === 'new account') act(() => tree.update(renderInbox(true,'second-viewer')));
    else if (change === 'close') act(() => tree.root.findByType(Modal).props.onRequestClose());
    else { act(() => tree.update(renderInbox(false))); act(() => tree.update(renderInbox())); }
    await act(async () => { status.resolve({needsAssent:false}); await pending; });
    expect(mockAccept).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
  });
  it('does not reopen a late participation notice', async () => {
    const status = hold<{needsAssent:boolean}>();
    mockTerms.mockReturnValueOnce(status.promise);
    const { pending } = await startJoin();
    act(() => tree.update(renderInbox(false)));
    await act(async () => { status.resolve({needsAssent:true}); await pending; });
    act(() => tree.update(renderInbox()));
    expect(notice().visible).toBe(false);
  });
  it('retires an outstanding assent on an account change', async () => {
    mockTerms.mockResolvedValueOnce({needsAssent:true});
    const receipt = hold<boolean>();
    mockAssent.mockReturnValueOnce(receipt.promise);
    await act(async () => button('Join the plan').props.onPress());
    expect(notice().visible).toBe(true);
    let agreeing!: Promise<boolean>;
    await act(async () => { agreeing = notice().onAgree(); });
    expect(mockAssent).toHaveBeenCalledTimes(1);
    act(() => tree.update(renderInbox(true,'second-viewer')));
    await act(async () => { receipt.resolve(true); await agreeing; });
    expect(mockAccept).not.toHaveBeenCalled();
    expect(notice().visible).toBe(false);
  });
  it('starts one join for two taps and opens chat despite a failed notification update', async () => {
    mockWrite.mockRejectedValueOnce(Error('notification acknowledgment unavailable'));
    const press = button('Join the plan').props.onPress;
    await act(async () => { await Promise.all([press(),press()]); });
    expect(mockTerms).toHaveBeenCalledTimes(1);
    expect(mockAccept).toHaveBeenCalledTimes(1);
    act(() => tree.root.findByType(Modal).props.onDismiss());
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/chats/fictional-plan');
  });

  it('keeps the notice after failed assent and joins only after the accepted notice dismisses', async () => {
    mockTerms.mockResolvedValueOnce({needsAssent:true});
    mockAssent.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await act(async () => button('Join the plan').props.onPress());
    await act(async () => { expect(await notice().onAgree()).toBe(false); });
    expect(notice().visible).toBe(true);
    expect(mockAccept).not.toHaveBeenCalled();
    await act(async () => { expect(await notice().onAgree()).toBe(true); });
    expect(mockAccept).not.toHaveBeenCalled();
    await act(async () => { notice().onDismiss(); notice().onDismiss(); });
    expect(mockAccept).toHaveBeenCalledTimes(1);
    expect(mockAssent).toHaveBeenCalledWith({listingType:'plan',listingId:'fictional-plan',action:'join',organizerName:'Someone',organizerUserId:null});
    act(() => tree.root.findByType(Modal).props.onDismiss());
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
  it('opens an already joined plan without repeating assent or the exception join', async () => {
    mockMembership.mockResolvedValueOnce({data:{user_id:'fictional-viewer'},error:null});
    await act(async () => button('Join the plan').props.onPress());
    expect(mockAccept).not.toHaveBeenCalled();
    expect(mockTerms).not.toHaveBeenCalled();
    act(() => tree.root.findByType(Modal).props.onDismiss());
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/chats/fictional-plan');
  });
  it('only invalidates the original membership when a dispatched join finishes after switching', async () => {
    const receipt = hold<void>();
    mockAccept.mockReturnValueOnce(receipt.promise);
    const { pending } = await startJoin();
    expect(mockAccept).toHaveBeenCalledTimes(1);
    act(() => tree.update(renderInbox(true,'second-viewer')));
    await act(async () => { receipt.resolve(); await pending; });
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockClient.invalidateQueries).toHaveBeenCalledWith({queryKey:['my-plans','fictional-viewer']});
    expect(mockClient.invalidateQueries).not.toHaveBeenCalledWith({queryKey:['my-plans','second-viewer']});
  });
  it('keeps an uncertain membership check retryable and does not join or record assent', async () => {
    mockMembership.mockResolvedValueOnce({data:null,error:{code:'42501'}});
    await act(async () => button('Join the plan').props.onPress());
    expect(mockAccept).not.toHaveBeenCalled();
    expect(mockAssent).not.toHaveBeenCalled();
    expect(button('Join the plan').props.disabled).toBe(false);
  });
  it('declines once even when tapped twice without starting assent or opening chat', async () => {
    const press = button('Not this time').props.onPress;
    await act(async () => { await Promise.all([press(),press()]); });
    expect(mockDecline).toHaveBeenCalledTimes(1);
    expect(mockAccept).not.toHaveBeenCalled();
    expect(mockTerms).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not dispatch when the authenticated account changed before its observer updated', async () => {
    mockAuthUser.mockResolvedValueOnce({data:{user:{id:'new-viewer'}},error:null});
    await act(async () => button('Join the plan').props.onPress());
    expect(mockAccept).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
  });
  it('does not replay a dispatched join when the same account reopens before it settles', async () => {
    const receipt = hold<void>();
    mockAccept.mockReturnValueOnce(receipt.promise);
    const {pending} = await startJoin();
    act(() => tree.update(renderInbox(false))); act(() => tree.update(renderInbox()));
    await act(async () => button('Join the plan').props.onPress());
    expect(mockAccept).toHaveBeenCalledTimes(1);
    await act(async () => { receipt.resolve(); await pending; });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('retains a confirmed decline after failed cleanup and reopening', async () => {
    mockWrite.mockResolvedValueOnce({error:{code:'42501'}});
    const press = button('Not this time').props.onPress;
    await act(async () => press());
    act(() => tree.update(renderInbox(false))); act(() => tree.update(renderInbox()));
    expect(renderedText()).toContain('You declined this invitation.');
    expect(button('Join the plan')).toBeUndefined();
    await act(async () => press());
    expect(mockDecline).toHaveBeenCalledTimes(1);
  });
  it.each(['declined','invited'])('checks a lost decline receipt without resending when %s', async status => {
    mockDecline.mockRejectedValueOnce(Error('lost receipt'));
    await act(async () => button('Not this time').props.onPress());
    expect(renderedText()).toContain('Check invitation');
    mockWaitlist.mockResolvedValueOnce({error:null,data:{...waitlistRow,exception_status:status}});
    const check = button('Check invitation').props.onPress;
    await act(async () => { await check(); await check(); });
    expect(mockDecline).toHaveBeenCalledTimes(1);
    expect(renderedText()).toContain(status==='declined' ? 'You declined this invitation.' : 'Not this time');
  });
  it.each(['declined','expired','past expiry','newer','missing','denied'])('does not decide a stale or unavailable invitation: %s',async mode=>{
    const row={...waitlistRow,exception_status: ['newer','past expiry'].includes(mode)?'invited':mode,
      exception_expires_at:mode==='past expiry'?'2025-10-03T00:00:00Z':null,
      exception_invited_at:mode==='newer'?'2099-01-01T00:00:00Z':waitlistRow.exception_invited_at};
    mockWaitlist.mockResolvedValueOnce({error:mode==='denied'?{code:'42501'}:null,data:mode==='missing'?null:row});
    await act(async()=>button('Not this time').props.onPress());
    expect(mockDecline).not.toHaveBeenCalled();
    expect(mockAccept).not.toHaveBeenCalled();
    expect(renderedText()).toContain(mode==='declined'?'You declined this invitation.':
      ['expired','past expiry'].includes(mode)?'This invitation expired.':mode==='newer'?'This invitation is no longer active.':'Check invitation');
  });
  it('retires an in-flight decline status check after an account switch', async () => {
    const held=hold<any>();
    mockWaitlist.mockReturnValueOnce(held.promise);
    let pending!:Promise<void>;
    await act(async()=>{pending=button('Not this time').props.onPress();});
    act(()=>tree.update(renderInbox(true,'new-viewer')));
    await act(async()=>{held.resolve({data:waitlistRow,error:null});await pending;});
    expect(mockDecline).not.toHaveBeenCalled();
    expect(renderedText()).not.toContain('You declined this invitation.');
  });
});


it.each(['member_joined', 'invite_accepted', 'event_reminder'])('opens a %s chat after dismissal even while acknowledgement is pending', async kind => {
  mockNoticeType = kind; await act(async () => tree.update(renderInbox()));
  let settle!: (r: any) => void;
  mockWrite.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  act(() => { void row().props.onPress(); });
  await act(async () => { await Promise.resolve(); });
  expect(mockPush).not.toHaveBeenCalled();
  expect(tree.root.findByType(Modal).props.visible).toBe(false);
  act(() => tree.root.findByType(Modal).props.onDismiss());
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/chats/fictional-plan');
  await act(async () => { settle({error: {message: 'offline'}}); });
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockFilters).toHaveBeenCalledWith(true, 'user_id', 'fictional-viewer');
  expect(mockFilters).toHaveBeenCalledWith(true, 'status', 'unread');
});

it('does not repeat a pending chat acknowledgement on an immediate second inbox visit', async () => {
  let finish!: (r: any) => void;
  mockWrite.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => row().props.onPress());
  act(() => tree.root.findByType(Modal).props.onDismiss());
  await act(async () => tree.update(renderInbox(false)));
  await act(async () => tree.update(renderInbox()));
  await act(async () => row().props.onPress());
  act(() => tree.root.findByType(Modal).props.onDismiss());
  expect(mockWrite).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledTimes(2); // two explicit visits
  await act(async () => { finish({error: null}); });
  expect(mockPush).toHaveBeenCalledTimes(2);
});

it('keeps Pass retryable for an open spot and checks uncertain dismissal without passing again', async () => {
  mockNoticeType = 'waitlist_spot'; await act(async () => tree.update(renderInbox()));
  const control = (label: string) => tree.root.findByProps({ accessibilityRole: 'button', accessibilityLabel: label });
  mockWrite.mockResolvedValueOnce({error:{code:'42501'}});
  await act(async () => control('Pass').props.onPress());
  expect(renderedText()).toContain('Retry pass');
  mockWrite.mockResolvedValueOnce({error:null,count:null});
  await act(async () => control('Retry pass').props.onPress());
  expect(renderedText()).toContain('Check status');
  mockReadInvite.mockResolvedValueOnce({error:null,count:0});
  await act(async () => control('Check status').props.onPress());
  expect(mockWrite).toHaveBeenCalledTimes(2);
  expect(mockClient.setQueryData.mock.calls[0][1]([{id:'fictional-notice'},{id:'other'}])).toEqual([{id:'other'}]);
  expect(mockPush).not.toHaveBeenCalled();
  expect(mockDecline).not.toHaveBeenCalled();
  expect(mockAccept).not.toHaveBeenCalled();
});
