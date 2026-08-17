import {
  CHAT_NEWEST_PAGE_SIZE,
  CHAT_REALTIME_BURST_MS,
  mergeChatBurst,
  olderChatFilter,
  oldestChatCursor,
  toChronologicalChatPage,
  replaceNewestChatPage,
} from '../../lib/chatPaging';

const at = '2026-08-16T12:00:00.000Z';
const before = '2026-08-16T11:59:59.000Z';

describe('chat paging contract', () => {
  it('keeps all same-timestamp rows ordered by id', () => {
    const page = toChronologicalChatPage([
      { id: '00000000-0000-0000-0000-000000000003', created_at: at },
      { id: '00000000-0000-0000-0000-000000000002', created_at: at },
      { id: '00000000-0000-0000-0000-000000000001', created_at: at },
      { id: '00000000-0000-0000-0000-000000000000', created_at: before },
    ]);

    expect(page.map((row) => row.id.slice(-1))).toEqual(['0', '1', '2', '3']);
    expect(oldestChatCursor(page)).toEqual({
      created_at: before,
      id: '00000000-0000-0000-0000-000000000000',
    });
  });

  it('builds the compound older-page predicate without a timestamp gap', () => {
    const cursor = { id: '00000000-0000-0000-0000-000000000002', created_at: at };
    expect(olderChatFilter(cursor)).toBe(
      'created_at.lt.2026-08-16T12:00:00.000Z,and(created_at.eq.2026-08-16T12:00:00.000Z,id.lt.00000000-0000-0000-0000-000000000002)',
    );
  });

  it('dedupes a realtime burst and keeps it chronological', () => {
    const merged = mergeChatBurst(
      [
        { id: 'old', created_at: before, value: 'kept' },
        { id: 'same', created_at: at, value: 'stale' },
      ],
      [
        { id: 'same', created_at: at, value: 'fresh' },
        { id: 'new', created_at: '2026-08-16T12:00:01.000Z', value: 'new' },
      ],
    );

    expect(merged).toEqual([
      { id: 'old', created_at: before, value: 'kept' },
      { id: 'same', created_at: at, value: 'fresh' },
      { id: 'new', created_at: '2026-08-16T12:00:01.000Z', value: 'new' },
    ]);
    expect(CHAT_NEWEST_PAGE_SIZE).toBe(60);
    expect(CHAT_REALTIME_BURST_MS).toBe(80);
  });

  it('refreshes the newest window without dropping older pages or retaining deleted rows', () => {
    expect(replaceNewestChatPage(
      [
        { id: 'older', created_at: before },
        { id: 'deleted', created_at: '2026-08-16T12:00:02.000Z' },
        { id: 'kept', created_at: '2026-08-16T12:00:01.000Z' },
      ],
      [{ id: 'kept', created_at: '2026-08-16T12:00:01.000Z' }],
    )).toEqual([
      { id: 'older', created_at: before },
      { id: 'kept', created_at: '2026-08-16T12:00:01.000Z' },
    ]);
    expect(replaceNewestChatPage([{ id: 'stale', created_at: at }], [])).toEqual([]);
  });
});
