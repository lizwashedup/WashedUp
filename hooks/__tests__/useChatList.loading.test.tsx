import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useChatList } from '../useChatList';

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
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
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
