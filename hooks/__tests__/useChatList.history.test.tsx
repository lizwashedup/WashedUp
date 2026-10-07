import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useChatList } from '../useChatList';

let mockKind: 'event' | 'circle';
let mockParents: any[];
let mockMessages: any[];
const mockRequests: any[] = [];
jest.mock('../../constants/FeatureFlags', () => ({ GROUPS_ENABLED: true, CHAT_ENGINE_ENABLED: false }));
jest.mock('../../lib/chatEngine/senderCache', () => ({ seedSender: jest.fn() }));
jest.mock('../../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    let columns = ''; let ids: string[] = []; let cap = Infinity; let embeddedCap = Infinity;
    const query: any = {
      select: (value: string) => { columns = value; return query; },
      eq: () => query, neq: () => query,
      in: (_key: string, value: string[]) => { ids = value; return query; },
      order: () => query,
      limit: (value: number, options?: { referencedTable?: string }) => {
        if (options?.referencedTable) embeddedCap = value; else cap = value;
        return query;
      },
      then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => {
        mockRequests.push({ table, columns, ids, cap, embeddedCap });
        let data: any[] = [];
        if (columns.includes('events (')) data = mockKind === 'event' ? mockParents.map(events => ({ events })) : [];
        else if (columns.includes('circles (')) data = mockKind === 'circle' ? mockParents.map(circles => ({ circles })) : [];
        else if (table === 'events' || table === 'circles') data = mockParents.filter(p => ids.includes(p.id)).map(parent => ({ id: parent.id,
          latest_message: mockMessages.filter(m => m[`${mockKind}_id`] === parent.id).slice(0, embeddedCap) })).slice(0, cap);
        else if (table === 'messages') data = mockMessages.filter(m => ids.includes(m[`${mockKind}_id`])).slice(0, cap);
        else if (table === `${mockKind}_members` && columns === `${mockKind}_id`) data = mockParents.flatMap(parent =>
          Array.from({ length: parent.member_count }, () => ({ [`${mockKind}_id`]: parent.id })));
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    }; return query;
  },
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: jest.fn(),
} }));
let tree: ReactTestRenderer;
let value: ReturnType<typeof useChatList>;
function Probe({ viewer }: { viewer: string }) { value = useChatList(viewer); return null; }
function parent(id: string, count = 2) {
  return { id, title: id, name: id, member_count: count, start_time: '2026-08-01T12:00:00Z',
    end_time: null, created_at: '2026-07-01T12:00:00Z', status: 'forming' };
}
function message(id: string, content: string, created_at: string) {
  return { [`${mockKind}_id`]: id, content, created_at, user_id: 'synthetic-peer', image_url: null, audio_url: null, message_type: 'text' };
}
beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date('2026-09-25T20:00:00Z')); mockRequests.length = 0; });
afterEach(() => { act(() => tree?.unmount()); jest.useRealTimers(); });

it.each(['event', 'circle'] as const)('keeps an older %s preview when another conversation has more than the entire global message window', async kind => {
  mockKind = kind; mockParents = [parent('busy'), parent('older')];
  mockMessages = [
    ...Array.from({ length: 50 }, (_, i) => message('busy', `Recent message ${i}`, '2026-09-24T18:00:00Z')),
    message('older', 'Our earlier conversation', '2026-08-02T18:00:00Z'),
  ];
  await act(async () => { tree = create(<Probe viewer={`history-${kind}`} />); });
  expect(value.chats.find(chat => chat.conversationId === 'older')).toEqual(expect.objectContaining({
    last_message: 'Our earlier conversation', last_message_at: '2026-08-02T18:00:00Z',
  }));
  expect(value.chats.find(chat => chat.conversationId === 'busy')?.last_message).toBe('Recent message 0');
  // A single bounded parent request handles the whole list; no per-chat N+1.
  expect(mockRequests.filter(r => r.table === `${kind}s` && r.columns.includes('latest_message'))).toHaveLength(1);
  expect(value.loadError).toBe(false);
});

it('retains joined plan history after others leave while excluding an unused single-person plan', async () => {
  mockKind = 'event'; mockParents = [parent('history', 1), parent('unused', 1)];
  mockMessages = [message('history', 'Still here to look back on', '2026-08-02T18:00:00Z')];
  await act(async () => { tree = create(<Probe viewer="retained-single-member-history" />); });
  expect(value.chats).toEqual([expect.objectContaining({ conversationId: 'history', is_past: true, member_count: 1,
    last_message: 'Still here to look back on' })]);
});
