import { compareCommunityRoomSequence, replaceCommunitySourceWindow, chronologicalCommunityRoomItems } from '../communityRoomWindow';
import type { CommunityRoomCursor, CommunityRoomMessage } from '../communityRoomHistory';
const at = '2026-09-15T12:00:00.000001Z';
const row = (n: number, created_at = at) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, created_at });
const boundary = (source: 'broadcast' | 'topic', n = 2): CommunityRoomCursor => ({ ...row(n), source, communityId: 'page', role: 'intros' });
it('retains same UUIDs in the two original sources in server order', () => {
  const message = row(2), items = ['topic', 'broadcast'].map(source => ({ source, message, key: `${source}:${message.id}` })) as CommunityRoomMessage[];
  expect(chronologicalCommunityRoomItems(items).map(item => item.source)).toEqual(['broadcast', 'topic']);
});
it('orders timestamps with equivalent zones and preserves microseconds', () => {
  expect(compareCommunityRoomSequence({ ...row(2, '2026-09-15T05:00:00.000001-07:00'), source: 'topic' }, { ...row(1, '2026-09-15T12:00:00.000002Z'), source: 'broadcast' })).toBeLessThan(0);
  expect(compareCommunityRoomSequence({ ...row(1), source: 'topic' }, { ...row(1, '2026-09-15T05:00:00.000001-07:00'), source: 'topic' })).toBe(0);
});
it('an empty topic part removes stale topics inside a broadcast-defined newest window', () => {
  const older = row(1, '2026-09-15T11:00:00Z');
  expect(replaceCommunitySourceWindow([older, row(1), row(3)], [], 'topic', { cursor: boundary('broadcast'), hasMore: true })).toEqual([older]);
});
it('source ordering retains broadcast ties below a topic boundary', () => {
  expect(replaceCommunitySourceWindow([row(1), row(3)], [], 'broadcast', { cursor: boundary('topic'), hasMore: true })).toEqual([row(1), row(3)]);
});
it('a complete newest snapshot removes deleted older rows too', () => {
  expect(replaceCommunitySourceWindow([row(1), row(2)], [row(3)], 'topic', { cursor: boundary('topic', 3), hasMore: false })).toEqual([row(3)]);
});
it('a fully filtered newest window still preserves only rows before its raw cursor', () => {
  expect(replaceCommunitySourceWindow([row(1), row(2), row(3)], [], 'topic', { cursor: boundary('topic'), hasMore: true })).toEqual([row(1)]);
});
