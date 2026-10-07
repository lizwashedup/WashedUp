import type { CommunityChatRowData } from './communityChat';
import { compareCommunityRoomSequence } from './communityRoomWindow';

export interface CommunityInboxGroup {
  /** Parent presentation; title/image and identity come from the community row. */
  row: CommunityChatRowData;
  /** Mapped Intros then main and joined optional rooms; legacy order preserved. */
  rooms: CommunityChatRowData[];
  /** Original event rows, also present in the outer eventRooms array. */
  eventRooms: CommunityChatRowData[];
}

export interface CommunityInboxProjection {
  communities: CommunityInboxGroup[];
  eventRooms: CommunityChatRowData[];
  /** Legacy rows without provenance, or persistent rows without a parent. */
  unclassifiedRooms: CommunityChatRowData[];
}

const hasEvent = (row: CommunityChatRowData): boolean => typeof row.eventId === 'string' && row.eventId.trim().length > 0;
const provenance = (row: CommunityChatRowData): number => hasEvent(row) ? 2 : row.eventId === null ? 1 : 0;
const activity = (row: CommunityChatRowData): number => {
  const value = row.lastAt === null ? Number.NaN : Date.parse(row.lastAt);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
};
const compareIdentity = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const compareRows = (a: CommunityChatRowData, b: CommunityChatRowData): number => {
  const left = activity(a), right = activity(b);
  if ((a.roomRole || b.roomRole) && Number.isFinite(left) && Number.isFinite(right)) {
    const order = compareCommunityRoomSequence(
      { id: a.lastMessageId ?? a.targetId, created_at: a.lastAt!, source: a.lastMessageSource ?? (a.kind === 'community' ? 'broadcast' : 'topic') },
      { id: b.lastMessageId ?? b.targetId, created_at: b.lastAt!, source: b.lastMessageSource ?? (b.kind === 'community' ? 'broadcast' : 'topic') },
    );
    if (order) return -order;
  }
  return left !== right ? (left > right ? -1 : 1) : compareIdentity(a.targetId, b.targetId) || compareIdentity(a.key, b.key);
};
const unread = (row: CommunityChatRowData): number => Number.isFinite(row.unread) ? Math.max(0, Math.floor(row.unread)) : 0;

/**
 * Project already-authorized inbox rows only. No membership/history inference,
 * fetches, read markers, mute changes or writes occur here. In particular, an
 * attendee event row never creates a community parent.
 */
export function projectCommunityChatInbox(rows: readonly CommunityChatRowData[]): CommunityInboxProjection {
  const unique = new Map<string, CommunityChatRowData>();
  for (const row of rows) {
    const identity = `${row.kind}:${row.targetId}`, previous = unique.get(identity);
    // Card and attendee paths can name the same actual topic. Retain one source
    // object and one count. Event provenance takes priority over old cache data
    // so a known event cannot accidentally inflate a persistent parent.
    const difference = row.kind === 'room' && previous ? provenance(row) - provenance(previous) : 0;
    if (!previous || difference > 0 || (difference === 0 && compareRows(row, previous) < 0)) unique.set(identity, row);
  }

  const groups = new Map<string, CommunityInboxGroup>();
  for (const source of unique.values()) {
    if (source.kind === 'community') groups.set(source.communityId, { row: source, rooms: [source], eventRooms: [] });
  }
  const eventRooms: CommunityChatRowData[] = [], unclassifiedRooms: CommunityChatRowData[] = [];
  for (const source of unique.values()) {
    if (source.kind !== 'room') continue;
    const parent = groups.get(source.communityId);
    if (hasEvent(source)) {
      eventRooms.push(source);
      parent?.eventRooms.push(source);
    } else if (source.eventId === null && parent) {
      parent.rooms.push(source);
    } else {
      unclassifiedRooms.push(source);
    }
  }

  for (const group of groups.values()) {
    const [main, ...topics] = group.rooms;
    topics.sort((a, b) => Number(b.isDefault === true) - Number(a.isDefault === true) || compareRows(a, b));
    group.rooms = main.roomRole === 'main'
      ? [...topics.filter(room => room.roomRole === 'intros'), main, ...topics.filter(room => room.roomRole !== 'intros')]
      : [main, ...topics];
    group.eventRooms.sort(compareRows);
    // Room order and latest activity are independent. Mapped source metadata
    // follows the selected preview, including sub-millisecond ties.
    const latest = group.rooms.reduce((current, candidate) => (main.roomRole === 'main' ? compareRows(candidate, current) < 0 : activity(candidate) > activity(current)) ? candidate : current, main);
    group.row = { ...main, roomNotificationsOn: undefined, ...(main.roomRole === 'main' ? { lastMessageId: latest.lastMessageId, lastMessageSource: latest.lastMessageSource } : {}), preview: latest.preview, lastAt: latest.lastAt, unread: group.rooms.reduce((total, room) => total + unread(room), 0) };
  }
  return {
    communities: [...groups.values()].sort((a, b) => compareRows(a.row, b.row)),
    eventRooms: eventRooms.sort(compareRows),
    unclassifiedRooms: unclassifiedRooms.sort(compareRows),
  };
}
