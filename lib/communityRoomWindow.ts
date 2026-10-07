import type { CommunityRoomCursor, CommunityRoomMessage } from './communityRoomHistory';
export type RoomSequence = { source: 'broadcast' | 'topic'; id: string; created_at: string };
/** PostgreSQL timestamp/source/UUID order, including microseconds and zones. */
export function compareCommunityRoomSequence(a: RoomSequence, b: RoomSequence): number {
  const micros = (value: string) => Number((value.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? '').padEnd(6, '0').slice(3, 6));
  const lexical = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  return Date.parse(a.created_at) - Date.parse(b.created_at) || micros(a.created_at) - micros(b.created_at)
    || lexical(a.source, b.source) || lexical(a.id.toLowerCase(), b.id.toLowerCase());
}
/** A mixed page's raw boundary, not the oldest visible row of one source,
 * defines which cached rows that newest snapshot replaces. */
export function replaceCommunitySourceWindow<T extends { id: string; created_at: string }>(
  current: readonly T[], page: readonly T[], source: RoomSequence['source'],
  window: { cursor: CommunityRoomCursor | null; hasMore: boolean },
): T[] {
  const older = window.hasMore && window.cursor
    ? current.filter(message => compareCommunityRoomSequence({ ...message, source }, window.cursor!) < 0) : [];
  const rows = new Map([...older, ...page].map(message => [message.id, message]));
  return [...rows.values()].sort((a, b) => compareCommunityRoomSequence({ ...a, source }, { ...b, source }));
}
export function chronologicalCommunityRoomItems(items: readonly CommunityRoomMessage[]): CommunityRoomMessage[] {
  return [...new Map(items.map(item => [item.key, item])).values()].sort((a, b) =>
    compareCommunityRoomSequence({ ...a.message, source: a.source }, { ...b.message, source: b.source }));
}
