jest.mock('../../lib/memberChatBlockPreferences', () => ({ readMemberChatBlockPreferences: jest.fn(async () => new Set<string>()) }));
import React from 'react';
import {readMemberChatBlockPreferences} from '../../lib/memberChatBlockPreferences';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useChatList } from '../useChatList';

let mockKind: 'event' | 'circle';
let mockParents: any[];
let mockMessages: any[];
let mockReads: any[];
const mockRequests: any[] = [];
jest.mock('../../constants/FeatureFlags', () => ({ GROUPS_ENABLED: true, CHAT_ENGINE_ENABLED: false }));
jest.mock('../../lib/chatEngine/senderCache', () => ({ seedSender: jest.fn() }));
jest.mock('../../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    let excluded: string[] = []; let columns = ''; let ids: string[] = []; let cap = Infinity; let embeddedCap = Infinity, peerCap = Infinity, excludedPeer = '';
    const query: any = {
      select: (value: string) => { columns = value; return query; },
      eq: () => query, neq: (k:string,v:string) => { if(k==='peer_activity.user_id') excludedPeer=v; return query; },
      not: (key:string,op:string,values:string) => {
        expect(key).toBe('latest_message.user_id');expect(op).toBe('in');
        excluded=JSON.parse('['+values.slice(1,-1)+']');return query;
      },
      in: (_key: string, value: string[]) => { ids = value; return query; },
      order: () => query,
      limit: (value: number, options?: { referencedTable?: string }) => {
        if (options?.referencedTable === 'peer_activity') peerCap = value; else if (options?.referencedTable) embeddedCap = value; else cap = value;
        return query;
      },
      then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => {
        mockRequests.push({ table, columns, ids, cap, embeddedCap });
        let data: any[] = [];
        if (columns.includes('events (')) data = mockKind === 'event' ? mockParents.map(events => ({ events })) : [];
        else if (columns.includes('circles (')) data = mockKind === 'circle' ? mockParents.map(circles => ({ circles })) : [];
        else if (table === 'events' || table === 'circles') data = mockParents.filter(p => ids.includes(p.id)).map(parent => ({ id: parent.id,
          peer_activity: mockMessages.filter(m => m[`${mockKind}_id`] === parent.id && m.user_id !== excludedPeer).slice(0,peerCap),
          latest_message: mockMessages.filter(m => m[`${mockKind}_id`] === parent.id && !excluded.includes(m.user_id)).slice(0, embeddedCap) })).slice(0, cap);
        else if (table === 'chat_reads') data = mockReads;
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
beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date('2026-09-25T20:00:00Z')); mockRequests.length = 0; mockReads = []; });
afterEach(() => { act(() => tree?.unmount()); jest.useRealTimers(); });

it.each(['event', 'circle'] as const)('keeps an older %s preview when another conversation has more than the entire global message window', async kind => {
  mockKind = kind; mockParents = [parent('busy'), parent('older')];
  mockReads = [{ [`${kind}_id`]: 'busy', last_read_at: '2026-09-24T18:01:00Z' }];
  mockMessages = [
    ...Array.from({ length: 50 }, (_, i) => message('busy', `Recent message ${i}`, '2026-09-24T18:00:00Z')),
    message('older', 'Our earlier conversation', '2026-08-02T18:00:00Z'),
  ];
  await act(async () => { tree = create(<Probe viewer={`history-${kind}`} />); });
  expect(value.chats.find(chat => chat.conversationId === 'older')).toEqual(expect.objectContaining({
    unread_count: 1, last_message: 'Our earlier conversation', last_message_at: '2026-08-02T18:00:00Z',
  }));
  expect(value.chats.find(chat => chat.conversationId === 'busy')).toMatchObject({last_message:'Recent message 0',unread_count:0});
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

const unreadCases = [
  ['newer offset message', '2026-09-24T21:00:00Z', '2026-09-24T13:00:00.100-08:00', 1],
  ['older offset message', '2026-09-24T13:00:00.100-08:00', '2026-09-24T21:00:00Z', 0],
  ['same instant, different offset', '2026-09-24T13:00:00-08:00', '2026-09-24T21:00:00Z', 0],
  ['same instant, fractional padding', '2026-09-24T21:00:00.100000+00:00', '2026-09-24T21:00:00.100Z', 0],
  ['newer microsecond', '2026-09-24T21:00:00.123Z', '2026-09-24T21:00:00.123001+00:00', 1],
  ['older microsecond', '2026-09-24T21:00:00.123001+00:00', '2026-09-24T21:00:00.123Z', 0],
  ['never read', null, '2026-09-24T21:00:00Z', 1],
  ['exactly read', '2026-09-24T21:00:00Z', '2026-09-24T21:00:00Z', 0],
] as const;
describe.each(['event', 'circle'] as const)('%s unread timestamps', kind => {
  it.each(unreadCases)('%s', async (label, readAt, sentAt, expected) => {
    mockKind = kind; mockParents = [parent('timestamp-check')];
    mockReads = readAt ? [{ [`${kind}_id`]: 'timestamp-check', last_read_at: readAt }] : [];
    mockMessages = [message('timestamp-check', 'Fictional message', sentAt)];
    await act(async () => { tree = create(<Probe viewer={`unread-${kind}-${label}`} />); });
    expect(value.loadError).toBe(false);
    expect(value.chats).toHaveLength(1);
    expect(value.chats[0].unread_count).toBe(expected);
  });
});

it('keeps both joined plans while removing a newly blocked author’s preview, including after refresh',async()=>{
  const {removeBlockedPrivateChatPreviews}=require('../../lib/chatListCache');
  const viewer='local-preview-owner';mockKind='event';mockParents=[parent('sunset'),parent('coffee')];mockReads=[];
  mockMessages=[message('sunset','Fictional lighthouse','2026-11-06T12:00:00Z'),{...message('coffee','Fictional umbrella','2026-11-06T11:00:00Z'),user_id:'other-allowed-author'}];
  await act(async()=>{tree=create(<Probe viewer={viewer}/>);});
  const snippets=()=>value.chats.map(row=>row.last_message).join(' | ');
  expect(snippets()).toContain('Fictional lighthouse');expect(snippets()).toContain('Fictional umbrella');
  await act(async()=>removeBlockedPrivateChatPreviews(viewer,'synthetic-peer'));
  expect(value.chats).toHaveLength(2);expect(snippets()).not.toContain('Fictional lighthouse');expect(snippets()).toContain('Fictional umbrella');
  await act(async()=>{await value.refetch(true);});
  expect(snippets()).not.toContain('Fictional lighthouse');expect(snippets()).toContain('Fictional umbrella');
});

it.each(['event','circle'] as const)('uses the preceding permitted %s message and counts only permitted unread authors',async kind=>{
  jest.mocked(readMemberChatBlockPreferences).mockResolvedValueOnce(new Set(['synthetic-peer']));
  mockKind=kind;mockParents=[parent('sunset')];mockReads=[];
  mockMessages=[message('sunset','blocked','2026-11-06T12:00:00Z'),{...message('sunset','Earlier allowed','2026-11-06T11:00:00Z'),user_id:'allowed'}];
  await act(async()=>{tree=create(<Probe viewer="pre-existing-block"/>);});
  expect(value.chats[0]).toMatchObject({title:'sunset',last_message:'Earlier allowed',unread_count:1});
});

it.each(['event','circle'] as const)('keeps an unread peer in %s when many newer messages were sent by the viewer', async kind => {
  const viewer='local-own-arrivals-'+kind;
  mockKind=kind;mockParents=[parent('quiet')];
  mockReads=[{[`${kind}_id`]:'quiet',last_read_at:'2026-08-02T12:00:00Z'}];
  mockMessages=[
    ...Array.from({length:60},()=>({...message('quiet','My reminder','2026-09-02T12:00:00Z'),user_id:viewer})),
    message('quiet','Meet at the fountain','2026-08-02T12:00:00.000001Z')
  ];
  await act(async()=>{tree=create(<Probe viewer={viewer}/>);});
  expect(value.chats[0]).toMatchObject({last_message:'You: My reminder',unread_count:1});
});
