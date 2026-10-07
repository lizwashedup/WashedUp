import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useChatList } from '../useChatList';

const mockSelects: string[] = [];
let mockEnrichment: Promise<void>;
const mockEvents = [
  { id: 'ongoing', start_time: '2026-09-19T18:00:00Z', end_time: '2026-09-21T20:00:00Z', status: 'forming' },
  { id: 'ended', start_time: '2026-09-18T18:00:00Z', end_time: '2026-09-19T19:00:00Z', status: 'forming' },
  { id: 'cancelled', start_time: '2026-09-21T18:00:00Z', end_time: '2026-09-23T20:00:00Z', status: 'cancelled' },
  { id: 'no-end', start_time: '2026-09-19T18:00:00Z', end_time: null, status: 'forming' },
].map(event => ({ ...event, title: event.id, member_count: 2 }));

jest.mock('../../constants/FeatureFlags', () => ({ GROUPS_ENABLED: false, CHAT_ENGINE_ENABLED: false }));
jest.mock('../../lib/chatEngine/senderCache', () => ({ seedSender: jest.fn() }));
jest.mock('../../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    let selection = '';
    const query: any = {
      select: (columns: string) => { selection = columns; mockSelects.push(columns); return query; },
      eq: () => query, in: () => query, order: () => query, limit: () => query,
      then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => {
        if (selection.includes('events (')) return Promise.resolve({ data: mockEvents.map(events => ({ events })), error: null }).then(resolve, reject);
        return mockEnrichment.then(() => ({ error: null, data: table === 'event_members' && selection === 'event_id'
          ? mockEvents.flatMap(event => [{ event_id: event.id }, { event_id: event.id }]) : [] })).then(resolve, reject);
      },
    };
    return query;
  },
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: jest.fn(),
} }));

it('uses the same end-first lifecycle before and after message enrichment without changing member eligibility', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-21T19:00:00Z'));
  let release!: () => void;
  mockEnrichment = new Promise(resolve => { release = resolve; });
  let value!: ReturnType<typeof useChatList>;
  let tree!: ReactTestRenderer;
  function Probe() { value = useChatList('expiry-fixture-viewer'); return null; }
  const rows = () => Object.fromEntries(value.chats.map(chat => [chat.conversationId, { isPast: chat.is_past, end: chat.end_time }]));
  try {
    await act(async () => { tree = create(<Probe />); });
    const expected = {
      ongoing: { isPast: false, end: '2026-09-21T20:00:00Z' },
      ended: { isPast: true, end: '2026-09-19T19:00:00Z' },
      cancelled: { isPast: true, end: '2026-09-23T20:00:00Z' },
      'no-end': { isPast: true, end: null },
    };
    expect(value.loading).toBe(false);
    expect(rows()).toEqual(expected);
    expect(mockSelects.some(columns => columns.includes('start_time, end_time'))).toBe(true);
    await act(async () => { release(); });
    expect(rows()).toEqual(expected);
    expect(value.chats.every(chat => chat.member_count === 2)).toBe(true);
  } finally {
    act(() => tree?.unmount());
    jest.useRealTimers();
  }
});
