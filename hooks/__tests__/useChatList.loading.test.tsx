jest.mock('../../lib/memberChatBlockPreferences', () => ({ readMemberChatBlockPreferences: jest.fn(async () => new Set<string>()) }));
import React from 'react';
import { readMemberChatBlockPreferences } from '../../lib/memberChatBlockPreferences';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { chatListMemoryCache, removeDepartedPlanPreview } from '../../lib/chatListCache';
import { useChatList } from '../useChatList';

let mockIncoming: (payload: any) => Promise<void>;
let mockMembership: (viewer: string) => Promise<any>;
let mockCircles: (viewer: string) => Promise<any>;
let mockEnrichment: (table: string, columns: string, viewer: string) => Promise<any>;
const event = { id: 'sunset', title: 'Sunset plans', member_count: 2, start_time: '2026-09-20T20:00:00Z', end_time: null, status: 'forming' };
const membership = (title = event.title) => ({ data: [{ events: { ...event, title } }], error: null });
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; };
jest.mock('../../constants/FeatureFlags', () => ({ GROUPS_ENABLED: true, CHAT_ENGINE_ENABLED: false }));
jest.mock('../../lib/chatEngine/senderCache', () => ({ seedSender: jest.fn() }));
jest.mock('../../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    let columns = '', viewer = '';
    const query: any = {
      select: (value: string) => { columns = value; return query; },
      eq: (key: string, value: string) => { if (key === 'user_id') viewer = value; return query; },
      neq: () => query, in: () => query, order: () => query, limit: () => query,
      then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => {
        if (columns.includes('events (')) return mockMembership(viewer).then(resolve, reject);
        if (table === 'circle_members' && columns.includes('circles (')) return mockCircles(viewer).then(resolve, reject);
        return mockEnrichment(table, columns, viewer).then(result => result ?? { data: table === 'event_members' && columns === 'event_id' ? [{ event_id: 'sunset' }, { event_id: 'sunset' }] : [], error: null }).then(resolve, reject);
      },
    }; return query;
  },
  channel: () => { const channel = { on: (_e: any, _f: any, cb: any) => { mockIncoming = cb; return channel; }, subscribe: () => channel }; return channel; },
  removeChannel: jest.fn(),
} }));
let tree: ReactTestRenderer;
let value: ReturnType<typeof useChatList>;
function Probe({ viewer }: { viewer: string }) { value = useChatList(viewer); return null; }
beforeEach(() => {
  jest.useFakeTimers();
  mockMembership = async () => membership();
  mockCircles = async () => ({ data: [], error: null });
  mockEnrichment = async () => undefined;
});
afterEach(() => { act(() => tree?.unmount()); jest.useRealTimers(); });
const mount = async (viewer: string) => { await act(async () => { tree = create(<Probe viewer={viewer} />); }); };

it('ends a stalled first load with retry available and recovers on retry', async () => {
  mockMembership = () => new Promise(() => {});
  await mount('first-stalled'); expect(value.loading).toBe(true);
  await act(async () => { jest.advanceTimersByTime(12_000); });
  expect(value.loading).toBe(false); expect(value.loadError).toBe(true); expect(value.chats).toEqual([]);
  mockMembership = async () => membership();
  await act(async () => { await value.refetch(true); });
  expect(value.loadError).toBe(false); expect(value.chats[0].title).toBe(event.title);
});

it('keeps the previous list when enrichment fails instead of reporting an empty inbox', async () => {
  await mount('enrichment-error');
  mockEnrichment = async () => ({ data: null, error: new Error('Offline') });
  await act(async () => { await value.refetch(true); });
  expect(value.loading).toBe(false); expect(value.loadError).toBe(true); expect(value.chats[0].title).toBe(event.title);
});

it('bounds a stalled circle read while leaving loaded plan chats usable', async () => {
  mockCircles = () => new Promise(() => {});
  await mount('circles-stalled');
  expect(value.chats[0].title).toBe(event.title);
  await act(async () => { jest.advanceTimersByTime(12_000); });
  expect(value.loading).toBe(false); expect(value.loadError).toBe(true); expect(value.chats).toHaveLength(1);
});

it('rejects late account results and does not retain the previous account list', async () => {
  const old = deferred(); mockMembership = viewer => viewer === 'account-old' ? old.promise : Promise.resolve({ data: [], error: null });
  await mount('account-old');
  await act(async () => tree.update(<Probe viewer="account-new" />));
  expect(value.chats).toEqual([]);
  await act(async () => old.resolve(membership('Old account private plan')));
  expect(value.chats).toEqual([]); expect(value.loadError).toBe(false);
});

it('keeps a newer retry when an earlier request resolves last', async () => {
  const old = deferred(); mockMembership = () => old.promise;
  await mount('request-order');
  mockMembership = async () => membership('Current title');
  await act(async () => { await value.refetch(true); });
  await act(async () => old.resolve(membership('Outdated title')));
  expect(value.chats[0].title).toBe('Current title'); expect(value.loadError).toBe(false);
});

it('does not erase cached circles when their read fails', async () => {
  mockCircles = async () => ({ data: [{ circles: { id: 'circle-a', name: 'Sunday people', created_at: '2026-09-19T20:00:00Z' } }], error: null });
  await mount('cached-circle');
  expect(value.chats.some(chat => chat.kind === 'circle')).toBe(true);
  mockCircles = async () => ({ data: null, error: new Error('Offline') });
  await act(async () => { await value.refetch(true); });
  expect(value.chats.some(chat => chat.kind === 'circle')).toBe(true); expect(value.loadError).toBe(true);
});

// Each fixture is synthetic. Timers stay frozen while a completed branch must
// become useful: another branch's 12-second deadline must not hold it back.
const circleMembership = (name = 'Coastal circle') => ({
  data: [{ circles: { id: 'circle-independent', name, created_at: '2026-09-19T20:00:00Z' } }],
  error: null,
});
function useDetailedEnrichment(eventText = 'Plan preview', circleText = 'Circle preview') {
  mockEnrichment = async (table, columns) => {
    const kind = table === 'circles' || columns.includes('circle_id') ? 'circle' : 'event';
    const id = kind === 'circle' ? 'circle-independent' : event.id;
    const key = kind === 'circle' ? 'circle_id' : 'event_id';
    if (table === `${kind}_members` && columns === key) {
      return { data: [{ [key]: id }, { [key]: id }], error: null };
    }
    if (table === 'events' || table === 'circles') {
      return { data: [{ id, latest_message: [{ [key]: id, content: kind === 'circle' ? circleText : eventText,
        created_at: '2026-09-20T21:00:00Z', user_id: 'synthetic-peer',
        image_url: null, audio_url: null, message_type: 'text' }] }], error: null };
    }
    if (table === `${kind}_members` && columns.includes('profiles_public')) {
      return { data: [{ [key]: id, user_id: 'synthetic-peer',
        profiles_public: { first_name_display: 'Aster', profile_photo_url: null } }], error: null };
    }
    return { data: [], error: null };
  };
}

it.each(['failed', 'stalled'] as const)('publishes available circles while event membership is %s', async failure => {
  mockMembership = failure === 'failed'
    ? async () => ({ data: null, error: new Error('Event membership unavailable') })
    : () => new Promise(() => {});
  mockCircles = async () => circleMembership();
  useDetailedEnrichment();
  await mount(`independent-circle-${failure}`);
  const circle = value.chats.find(chat => chat.kind === 'circle');
  expect(circle).toEqual(expect.objectContaining({ title: 'Coastal circle', last_message: 'Aster: Circle preview' }));
  expect(value.loading).toBe(false);
});

it.each(['failed', 'stalled'] as const)('publishes enriched plans promptly while circle membership is %s', async failure => {
  mockCircles = failure === 'failed'
    ? async () => ({ data: null, error: new Error('Circle membership unavailable') })
    : () => new Promise(() => {});
  useDetailedEnrichment('Enriched plan arrived');
  await mount(`independent-plan-${failure}`);
  expect(value.chats.find(chat => chat.kind === 'event')).toEqual(expect.objectContaining({
    title: event.title, last_message: 'Aster: Enriched plan arrived', last_message_at: '2026-09-20T21:00:00Z',
  }));
  expect(value.loading).toBe(false);
});

it('keeps cached plan history on a cold remount while fresh circles load and event membership fails', async () => {
  jest.setSystemTime(new Date('2026-09-25T20:00:00Z'));
  mockCircles = async () => circleMembership();
  useDetailedEnrichment('Saved older plan preview', 'Cached circle preview');
  await mount('cold-history-event-failure');
  const savedPlan = value.chats.find(chat => chat.kind === 'event');
  expect(savedPlan).toEqual(expect.objectContaining({ is_past: true, last_message: 'Aster: Saved older plan preview' }));
  act(() => tree.unmount());
  mockMembership = async () => ({ data: null, error: new Error('Membership offline') });
  useDetailedEnrichment('Must not replace history', 'Fresh circle preview');
  await mount('cold-history-event-failure');
  expect(value.chats.find(chat => chat.kind === 'event')).toEqual(savedPlan);
  expect(value.chats.find(chat => chat.kind === 'circle')?.last_message).toBe('Aster: Fresh circle preview');
  expect(value.loadError).toBe(true);
});

it('retains cached circles on a cold remount when their branch fails and refreshes plan history', async () => {
  jest.setSystemTime(new Date('2026-09-25T20:00:00Z'));
  mockCircles = async () => circleMembership();
  useDetailedEnrichment('Old plan history', 'Saved circle history');
  await mount('cold-history-circle-failure');
  const savedCircle = value.chats.find(chat => chat.kind === 'circle');
  expect(savedCircle?.last_message).toBe('Aster: Saved circle history');
  act(() => tree.unmount());
  mockCircles = async () => ({ data: null, error: new Error('Circle offline') });
  useDetailedEnrichment('Fresh older plan preview');
  await mount('cold-history-circle-failure');
  expect(value.chats.find(chat => chat.kind === 'circle')).toEqual(savedCircle);
  expect(value.chats.find(chat => chat.kind === 'event')).toEqual(expect.objectContaining({
    is_past: true, last_message: 'Aster: Fresh older plan preview',
  }));
  expect(value.loadError).toBe(true);
});

it('ignores a late circle result after a different account has loaded', async () => {
  const oldCircle = deferred();
  mockMembership = async () => ({ data: [], error: null });
  mockCircles = viewer => viewer === 'late-circle-old-account' ? oldCircle.promise : Promise.resolve(circleMembership('New account circle'));
  useDetailedEnrichment();
  await mount('late-circle-old-account');
  await act(async () => tree.update(<Probe viewer="late-circle-new-account" />));
  expect(value.chats.map(chat => chat.title)).toEqual(['New account circle']);
  await act(async () => oldCircle.resolve(circleMembership('Old account private circle')));
  expect(value.chats.map(chat => chat.title)).toEqual(['New account circle']);
  expect(value.loadError).toBe(false);
});

it('ignores an earlier circle completion after the newer same-account retry', async () => {
  const oldCircle = deferred();
  mockMembership = async () => ({ data: [], error: null });
  mockCircles = () => oldCircle.promise;
  useDetailedEnrichment();
  await mount('late-circle-request');
  mockCircles = async () => circleMembership('Current circle title');
  await act(async () => { await value.refetch(true); });
  expect(value.chats.map(chat => chat.title)).toEqual(['Current circle title']);
  await act(async () => oldCircle.resolve(circleMembership('Stale circle title')));
  expect(value.chats.map(chat => chat.title)).toEqual(['Current circle title']);
  expect(value.loadError).toBe(false);
});


it('keeps a live plan preview when the slower circle branch completes', async () => {
  const circle = deferred(); mockCircles = () => circle.promise;
  useDetailedEnrichment('Initial preview');
  await mount('live-preview-circle-race');
  await act(async () => { await mockIncoming({ new: { event_id: event.id, user_id: 'synthetic-peer', content: 'New arrival', created_at: '2026-09-20T22:00:00Z' } }); });
  expect(value.chats[0].last_message).toBe('Aster: New arrival');
  await act(async () => circle.resolve(circleMembership()));
  expect(value.chats.find(chat => chat.kind === 'event')).toEqual(expect.objectContaining({ last_message: 'Aster: New arrival', unread_count: 1 }));
});

it('keeps the latest live preview through a failed refresh', async () => {
  useDetailedEnrichment('Initial preview');
  await mount('live-preview-failed-refresh');
  await act(async () => { await mockIncoming({ new: { event_id: event.id, user_id: 'synthetic-peer', content: 'New arrival', created_at: '2026-09-20T22:00:00Z' } }); });
  mockMembership = async () => ({ data: null, error: new Error('Offline') });
  await act(async () => { await value.refetch(true); });
  expect(value.chats[0]).toEqual(expect.objectContaining({ last_message: 'Aster: New arrival', unread_count: 1 }));
  expect(value.loadError).toBe(true);
});


it('keeps a removed conversation absent when the next refresh fails', async () => {
  useDetailedEnrichment();
  await mount('removed-chat-cache');
  act(() => value.removeChat(event.id));
  expect(value.chats).toEqual([]);
  mockMembership = async () => ({ data: null, error: new Error('Offline') });
  await act(async () => { await value.refetch(true); });
  expect(value.chats).toEqual([]);
});

it('ignores an old account removal callback after switching accounts', async () => {
  useDetailedEnrichment();
  await mount('remove-account-old');
  const oldRemove = value.removeChat;
  await act(async () => tree.update(<Probe viewer="remove-account-new" />));
  act(() => oldRemove(event.id));
  expect(value.chats).toHaveLength(1);
});

it('does not restore a confirmed circle departure from a refresh that started before leaving', async () => {
  mockCircles = async () => circleMembership(); useDetailedEnrichment();
  await mount('removed-circle-pending-read');
  const stale = deferred(); mockCircles = () => stale.promise;
  let refresh!: Promise<void>;
  act(() => { refresh = value.refetch(true); });
  act(() => value.removeChat('circle-independent'));
  expect(value.chats.some(chat => chat.kind === 'circle')).toBe(false);
  await act(async () => { stale.resolve(circleMembership()); await refresh; });
  expect(value.chats.some(chat => chat.kind === 'circle')).toBe(false);
  expect(value.chats.some(chat => chat.kind === 'event')).toBe(true);
  expect(value.loading).toBe(false); expect(value.loadError).toBe(false);
  // A later explicit read may reflect a real rejoin; removal is not a lifetime ban.
  mockCircles = async () => circleMembership('Rejoined circle');
  await act(async () => { await value.refetch(true); });
  expect(value.chats.find(chat => chat.kind === 'circle')?.title).toBe('Rejoined circle');
});

it('retains a live ordinary preview on remount when the server is offline', async () => {
  useDetailedEnrichment('Initial preview');
  await mount('live-preview-remount');
  await act(async () => { await mockIncoming({ new: { event_id: event.id, user_id: 'synthetic-peer', content: 'New arrival', created_at: '2026-09-20T22:00:00Z' } }); });
  act(() => tree.unmount());
  mockMembership = async () => ({ data: null, error: new Error('Offline') });
  await mount('live-preview-remount');
  expect(value.chats[0]).toEqual(expect.objectContaining({ last_message: 'Aster: New arrival', unread_count: 1 }));
});

it.each(['event', 'circle'] as const)('keeps a newer live %s preview when an older successful read finishes last', async kind => {
  mockCircles = async () => circleMembership(); useDetailedEnrichment();
  await mount(`live-${kind}-successful-read-race`);
  const originalEnrichment = mockEnrichment, stale = deferred();
  const id = kind === 'event' ? event.id : 'circle-independent';
  mockEnrichment = (table, columns, viewer) => table === `${kind}s` ? stale.promise : originalEnrichment(table, columns, viewer);
  let refresh!: Promise<void>; act(() => { refresh = value.refetch(true); });
  await act(async () => { await mockIncoming({ new: { [`${kind}_id`]: id, user_id: 'synthetic-peer', content: 'Newest arrival', created_at: '2026-09-20T22:00:00Z' } }); });
  await act(async () => { stale.resolve({ data: [{ id, latest_message: [{ content: 'Older snapshot', user_id: 'synthetic-peer', created_at: '2026-09-20T21:00:00Z' }] }], error: null }); await refresh; });
  expect(value.chats.find(chat => chat.conversationId === id)).toEqual(expect.objectContaining({ last_message: 'Aster: Newest arrival', last_message_at: '2026-09-20T22:00:00Z', unread_count: 1 }));
  expect(value.loadError).toBe(false);
  // A subsequent authoritative refresh may reflect a deletion/edit or a read
  // on another device. Live previews must not become permanent overrides.
  mockEnrichment = originalEnrichment;
  await act(async () => { await value.refetch(true); });
  expect(value.chats.find(chat => chat.conversationId === id)?.unread_count).toBe(0);
  expect(value.chats.find(chat => chat.conversationId === id)?.last_message).toBe(kind === 'event' ? 'Aster: Plan preview' : 'Aster: Circle preview');
});

it('lets a successful read remove a conversation even when its preview changed during the read', async () => {
  useDetailedEnrichment(); await mount('live-preview-membership-removal');
  const pending = deferred(); mockMembership = () => pending.promise;
  let refresh!: Promise<void>; act(() => { refresh = value.refetch(true); });
  await act(async () => { await mockIncoming({ new: { event_id: event.id, user_id: 'synthetic-peer', content: 'New arrival', created_at: '2026-09-20T22:00:00Z' } }); });
  await act(async () => { pending.resolve({ data: [], error: null }); await refresh; });
  expect(value.chats).toEqual([]);
});

it('uses a caught-up read without double-counting the live arrival', async () => {
  useDetailedEnrichment(); await mount('live-preview-caught-up-read');
  const originalEnrichment = mockEnrichment, pending = deferred();
  mockEnrichment = (table, columns, viewer) => table === 'events' ? pending.promise : table === 'messages'
    ? Promise.resolve({ data: [{ event_id: event.id, created_at: '2026-09-20T22:00:00Z' }], error: null })
    : originalEnrichment(table, columns, viewer);
  let refresh!: Promise<void>; act(() => { refresh = value.refetch(true); });
  await act(async () => { await mockIncoming({ new: { event_id: event.id, user_id: 'synthetic-peer', content: 'New arrival', created_at: '2026-09-20T22:00:00Z' } }); });
  await act(async () => { pending.resolve({ data: [{ id: event.id, latest_message: [{ content: 'New arrival', user_id: 'synthetic-peer', created_at: '2026-09-20T22:00:00Z' }] }], error: null }); await refresh; });
  expect(value.chats[0]).toEqual(expect.objectContaining({ last_message: 'Aster: New arrival', unread_count: 1 }));
});

it('keeps loading when a private preview needs a fresh privacy check on return', async () => {
  const viewer = 'private-only-reentry';
  chatListMemoryCache.set(viewer, [{
    kind: 'circle', conversationId: 'dm', title: 'Private conversation', is_dm: true,
    category: null, image_url: null, start_time: '', member_count: 2, last_message: 'Private preview',
    last_message_at: null, unread_count: 0, is_past: false, ticket_url: null, member_avatars: [],
  }]);
  const plans = deferred();
  const circles = deferred();
  mockMembership = () => plans.promise;
  mockCircles = () => circles.promise;
  await mount(viewer);
  expect(value.chats).toEqual([]);
  expect(value.loading).toBe(true);
  await act(async () => { plans.resolve(membership()); });
  expect(value.loading).toBe(false);
  expect(value.chats.map(chat => chat.title)).toEqual([event.title]);
  await act(async () => { circles.resolve({ data: [], error: null }); });
});

it('retires a departed plan after a confirmed membership read even if the remaining previews fail', async () => {
  const viewer = 'confirmed-departure-during-refresh';
  const coffee = { ...event, id: 'coffee', title: 'Coffee chat' };
  const joined = (...events: typeof event[]) => ({ data: events.map(e => ({ events: e })), error: null });
  mockMembership = async () => joined(event, coffee);
  const counts = async (table: string, columns: string) => table === 'event_members' && columns === 'event_id'
    ? { data: [event, event, coffee, coffee].map(e => ({ event_id: e.id })), error: null } : undefined;
  mockEnrichment = counts;
  await mount(viewer);
  const ids = () => value.chats.map(chat => chat.conversationId);
  expect(ids()).toEqual(expect.arrayContaining([event.id, coffee.id]));
  mockMembership = async () => joined(coffee);
  const preview = deferred();
  mockEnrichment = (table, cols) => table === 'events' ? preview.promise : counts(table, cols);
  let refresh!: Promise<void>;
  await act(async () => { refresh = value.refetch(true); });
  expect(ids()).toEqual([coffee.id]);
  await act(async () => { preview.resolve({ data: null, error: new Error('Preview unavailable') }); await refresh; });
  expect(ids()).toEqual([coffee.id]); expect(value.loadError).toBe(true);
  expect(chatListMemoryCache.get(viewer)?.map(chat => chat.conversationId)).toEqual([coffee.id]);
  mockEnrichment = counts;
  await act(async () => { await value.refetch(true); });
  expect(value.loadError).toBe(false); expect(ids()).toEqual([coffee.id]);
});

it('does not restore a departed plan from an earlier inbox request, but allows a new membership', async () => {
  const viewer = 'leave-with-an-inbox-request';
  await mount(viewer);
  expect(value.chats[0].conversationId).toBe(event.id);
  const old = deferred();
  mockMembership = () => old.promise;
  let refresh!: Promise<void>;
  await act(async () => { refresh = value.refetch(true); });
  mockMembership = async () => ({ data: null, error: new Error('Offline') });
  await act(async () => { removeDepartedPlanPreview(viewer, event.id); });
  await act(async () => { old.resolve(membership()); await refresh; });
  expect(value.chats).toEqual([]);
  expect(value.loadError).toBe(true);
  mockMembership = async () => membership();
  await act(async () => { await value.refetch(true); });
  expect(value.chats[0].conversationId).toBe(event.id);
});

it('withholds warm snippets while checking a new visit and leaves the joined row retryable offline',async()=>{
  const owner='warm-privacy-retry';useDetailedEnrichment();await mount(owner);expect(value.chats[0].last_message).toContain('Plan preview');
  act(()=>tree.unmount());const hold=deferred();jest.mocked(readMemberChatBlockPreferences).mockReturnValueOnce(hold.promise);
  await mount(owner);expect(value.chats[0]).toMatchObject({title:event.title,last_message:null,unread_count:0});
  await act(async()=>hold.resolve(new Set(['synthetic-peer'])));expect(value.chats[0].last_message).toBeNull();
  jest.mocked(readMemberChatBlockPreferences).mockRejectedValueOnce(Error('Offline'));
  await act(async()=>{await value.refetch(true);});expect(value.loadError).toBe(true);expect(value.chats[0].last_message).toBeNull();
});
it('does not apply an earlier account’s delayed block preferences to the active account',async()=>{
  const hold=deferred();jest.mocked(readMemberChatBlockPreferences).mockReturnValueOnce(hold.promise);
  useDetailedEnrichment('Account A');await mount('old-prefs');expect(value.chats[0].last_message).toBeNull();
  useDetailedEnrichment('Account B');await act(async()=>tree.update(<Probe viewer="new-prefs"/>));
  await act(async()=>hold.resolve(new Set(['synthetic-peer'])));
  expect(value.chats[0].last_message).toContain('Account B');
});

it.each(['events','circles'])('retains verified %s snippets and badges on a missing activity response and recovers on retry',async table=>{
  mockCircles=async()=>circleMembership();useDetailedEnrichment();
  await mount('missing-activity-'+table);
  const eligible=value.chats.map(row=>({title:row.title,text:row.last_message,count:row.unread_count}));
  const normal=mockEnrichment;mockEnrichment=async(t,cols,viewer)=>t===table?{data:null,error:null}:normal(t,cols,viewer);
  await act(async()=>{await value.refetch(true);});
  expect(value.chats.map(row=>({title:row.title,text:row.last_message,count:row.unread_count}))).toEqual(eligible);
  expect(value.loadError).toBe(true);
  // PostgREST represents a valid parent with no messages as an empty child array.
  mockEnrichment=async(t,cols,viewer)=>t===table?{data:[{id:table==='events'?event.id:'circle-independent',latest_message:[]}],error:null}:normal(t,cols,viewer);
  await act(async()=>{await value.refetch(true);});
  expect(value.loadError).toBe(false);
  expect(value.chats.find(row=>row.kind===(table==='events'?'event':'circle'))?.last_message).toBeNull();
  expect(value.chats.find(row=>row.kind!==(table==='events'?'event':'circle'))?.last_message).toContain('preview');
});

it('keeps a first-visit plan reachable without labelling unknown history as empty', async () => {
  mockEnrichment = async table => table === 'events' ? {data:null,error:null} : undefined;
  await mount('missing-first-activity');
  expect(value.loadError).toBe(true);
  expect(value.chats[0]).toMatchObject({title:event.title, last_message:null, preview_unavailable:true});
  useDetailedEnrichment();
  await act(async()=>{await value.refetch(true);});
  expect(value.loadError).toBe(false);
  expect(value.chats[0].last_message).toContain('Plan preview');
});
