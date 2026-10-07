import { getMemberChatAnchorWindow, MemberChatMessageUnavailableError, parseMemberReactionAnchor } from '../memberChatMessageAnchor';
import { supabase } from '../supabase';
import { getBlockedWith } from '../blocking';
import type { ChatMessage } from '../../hooks/useChat';

jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../blocking', () => ({ getBlockedWith: jest.fn() }));
const room = '11111111-1111-4111-8111-111111111111';
const id = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;
const message = (n: number, kind: 'event' | 'circle' = 'event'): ChatMessage => ({
  id: id(n), [kind === 'event' ? 'event_id' : 'circle_id']: room, user_id: 'author',
  content: `Message ${n}`, message_type: 'user', created_at: '2026-09-21T12:00:00.000001+00:00',
});
let rows: ChatMessage[], current: boolean, exactReads: number;
let exact: (n: number) => Promise<any>, rangeError: Error | null;
let predicates: string[], limits: number[], parents: string[];
const scope = { userId: 'viewer', isCurrent: () => current };
beforeEach(() => {
  jest.clearAllMocks(); rows = Array.from({ length: 240 }, (_, i) => message(i + 1)); current = true;
  exactReads = 0; rangeError = null; predicates = []; limits = []; parents = [];
  exact = async () => ({ data: rows[99], error: null });
  jest.mocked(getBlockedWith).mockResolvedValue(new Set());
  jest.mocked(supabase.from).mockImplementation((table: string) => {
    expect(table).toBe('messages'); let ascending = false, target = '', filter = '';
    const chain: any = {
      select: jest.fn(() => chain),
      eq: jest.fn((key, value) => { if (key === 'id') target = value; else { parents.push(key); expect(value).toBe(room); } return chain; }),
      maybeSingle: jest.fn(() => { expect(target).toBe(id(100)); return exact(++exactReads); }),
      or: jest.fn(value => { filter = value; predicates.push(value); return chain; }),
      order: jest.fn((_key, options) => { ascending = options.ascending; return chain; }),
      limit: jest.fn(async count => {
        limits.push(count);
        const boundary = filter.match(/id\.(?:lt|gt)\.([^)]*)/)![1];
        const data = rows.filter(row => ascending ? row.id > boundary : row.id < boundary)
          .sort((a, b) => ascending ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id)).slice(0, count);
        return { data, error: rangeError };
      }),
    };
    return chain;
  });
});

it.each(['event', 'circle'] as const)('reads the exact %s parent and 60 neighbors on each side, preserving timestamp precision', async kind => {
  rows = rows.map((_, i) => message(i + 1, kind));
  const window = await getMemberChatAnchorWindow({ kind, id: room }, id(100), scope);
  expect(window.messages.map(row => row.id)).toEqual(rows.slice(39, 160).map(row => row.id));
  expect(window.olderCursor!.id).toBe(id(40)); expect(window.upperCursor!.id).toBe(id(160)); expect(window.hasMore).toBe(true);
  expect(limits).toEqual([60, 60]); expect(exactReads).toBe(2);
  expect(new Set(parents)).toEqual(new Set([kind === 'circle' ? 'circle_id' : 'event_id']));
  expect(predicates).toEqual([
    `created_at.lt.${rows[99].created_at},and(created_at.eq.${rows[99].created_at},id.lt.${id(100)})`,
    `created_at.gt.${rows[99].created_at},and(created_at.eq.${rows[99].created_at},id.gt.${id(100)})`,
  ]);
});
it('keeps raw pagination cursors when blocked neighbors are filtered out', async () => {
  rows[39].user_id = 'blocked'; rows[159].user_id = 'blocked';
  jest.mocked(getBlockedWith).mockResolvedValue(new Set(['blocked']));
  const window = await getMemberChatAnchorWindow({ kind: 'event', id: room }, id(100), scope);
  expect(window.messages).toHaveLength(119); expect(window.olderCursor!.id).toBe(id(40)); expect(window.upperCursor!.id).toBe(id(160));
  expect(getBlockedWith).toHaveBeenCalledWith('viewer', expect.arrayContaining(['author', 'blocked']));
});
it('a window reaching the present has no artificial newer-history gap', async () => {
  rows = rows.slice(0, 110);
  const window = await getMemberChatAnchorWindow({ kind: 'event', id: room }, id(100), scope);
  expect(window.upperCursor).toBeNull(); expect(window.messages.at(-1)!.id).toBe(id(110));
});
it.each(['missing', 'wrong-parent', 'blocked', 'deleted-during-read', 'changed-author', 'changed-time'])('refuses a %s anchor', async cause => {
  if (cause === 'blocked') jest.mocked(getBlockedWith).mockResolvedValue(new Set(['author']));
  exact = async n => ({ data: cause === 'missing' || (cause === 'deleted-during-read' && n === 2) ? null : {
    ...rows[99], ...(cause === 'wrong-parent' ? { event_id: 'another-room' } : {}),
    ...(cause === 'changed-author' && n === 2 ? { user_id: 'other-author' } : {}),
    ...(cause === 'changed-time' && n === 2 ? { created_at: '2026-09-21T12:00:01Z' } : {}),
  }, error: null });
  await expect(getMemberChatAnchorWindow({ kind: 'event', id: room }, id(100), scope)).rejects.toBeInstanceOf(MemberChatMessageUnavailableError);
});
it('keeps a network error distinct from an unavailable message', async () => {
  rangeError = Error('offline');
  await expect(getMemberChatAnchorWindow({ kind: 'event', id: room }, id(100), scope)).rejects.toBe(rangeError);
});
it('retires a window after its visit changes before the exact read finishes', async () => {
  exact = async () => { current = false; return { data: rows[99], error: null }; };
  await expect(getMemberChatAnchorWindow({ kind: 'event', id: room }, id(100), scope)).rejects.toThrow('previous visit');
  expect(limits).toEqual([]);
});
it('does not query for malformed message identifiers', async () => {
  await expect(getMemberChatAnchorWindow({ kind: 'event', id: room }, 'not-a-message', scope)).rejects.toBeInstanceOf(MemberChatMessageUnavailableError);
  expect(supabase.from).not.toHaveBeenCalled();
});
it.each([[id(100), 'topic'], [id(100), 'broadcast'], [[id(100)], 'chat'], ['bad', 'chat'], [null, 'chat']])('ignores an invalid route %p / %p', (value, source) => {
  expect(parseMemberReactionAnchor(value, source)).toBeNull();
});
it('accepts only the member-chat source and normalizes its exact message UUID', () => {
  expect(parseMemberReactionAnchor('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', 'chat')).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});
