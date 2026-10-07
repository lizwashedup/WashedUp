import type { CommunityChatRowData } from '../communityChat';
import { projectCommunityChatInbox } from '../communityChatInbox';

const main = (id = 'sunset', extra: Partial<CommunityChatRowData> = {}): CommunityChatRowData => ({
  key: `community-${id}`, kind: 'community', targetId: id, communityId: id,
  title: `${id} community`, roomName: 'Community chat', secondary: null,
  preview: 'Main message', lastAt: '2026-09-12T09:00:00Z', unread: 2,
  accent: 'existing-accent', image: 'community-cover', eventId: null, ...extra,
});
const room = (id: string, extra: Partial<CommunityChatRowData> = {}): CommunityChatRowData => ({
  ...main(), key: `room-${id}`, kind: 'room', targetId: id, title: id,
  secondary: 'sunset community', roomName: undefined, preview: `${id} message`,
  unread: 1, image: 'topic-cover', ...extra,
});

describe('community inbox projection', () => {
  it('keeps the actual main stream as the first room without inventing Intros', () => {
    const source = main('sunset', { roomName: 'After Glow' });
    const result = projectCommunityChatInbox([source]);
    expect(result.communities).toHaveLength(1);
    expect(result.communities[0].rooms[0]).toBe(source);
    expect(result.communities[0].row).toEqual(source);
    expect(result.communities[0].row).not.toBe(source);
    expect(result.eventRooms).toEqual([]);
    expect(result.unclassifiedRooms).toEqual([]);
  });

  it('aggregates persistent rooms once and uses latest content while preserving parent identity and room order', () => {
    const source = main(), recent = room('walks', { lastAt: '2026-09-12T12:00:00Z', unread: 4 });
    const defaultRoom = room('general', { isDefault: true, lastAt: '2026-09-12T10:00:00Z', unread: 3 });
    const inputs = Object.freeze([Object.freeze(recent), Object.freeze(source), Object.freeze(defaultRoom)]);
    const group = projectCommunityChatInbox(inputs).communities[0];
    expect(group.rooms).toEqual([source, defaultRoom, recent]);
    expect(group.row).toEqual({ ...source, preview: recent.preview, lastAt: recent.lastAt, unread: 9 });
    expect(group.row.title).toBe(source.title);expect(group.row.image).toBe(source.image);
    expect(inputs).toEqual([recent, source, defaultRoom]);
  });

  it('keeps event previews and counts outside the parent, sharing the original event object as its shortcut', () => {
    const source = main(), topic = room('walks', { lastAt: '2026-09-12T10:00:00Z' });
    const event = room('volleyball', { eventId: 'event-1', lastAt: '2026-09-12T18:00:00Z', unread: 99 });
    const result = projectCommunityChatInbox([event, source, topic]), group = result.communities[0];
    expect(group.row.unread).toBe(3);
    expect(group.row.preview).toBe(topic.preview);expect(group.row.lastAt).toBe(topic.lastAt);
    expect(group.rooms).toEqual([source, topic]);
    expect(result.eventRooms[0]).toBe(event);expect(group.eventRooms[0]).toBe(event);
  });

  it('preserves an attendee-only event without manufacturing community membership', () => {
    const event = room('volleyball', { eventId: 'event-1' });
    const result = projectCommunityChatInbox([event]);
    expect(result.communities).toEqual([]);expect(result.unclassifiedRooms).toEqual([]);
    expect(result.eventRooms).toEqual([event]);expect(result.eventRooms[0]).toBe(event);
  });

  it('deduplicates the same event topic from card and attendee paths without adding counts', () => {
    const old = room('volleyball', { eventId: 'event-1', unread: 3 });
    const recent = { ...old, key: 'attendee-volleyball', lastAt: '2026-09-12T12:00:00Z', unread: 5 };
    const result = projectCommunityChatInbox([main(), old, recent]);
    expect(result.eventRooms).toHaveLength(1);expect(result.eventRooms[0]).toBe(recent);
    expect(result.communities[0].eventRooms).toEqual([recent]);expect(result.communities[0].row.unread).toBe(2);
  });

  it('keeps undefined or empty event provenance separate from explicitly persistent rooms', () => {
    const legacy = room('unknown', { eventId: undefined, unread: 50 });
    const empty = room('empty', { eventId: '', unread: 40 });
    const persistent = room('walks', { eventId: null, unread: 3 });
    const result = projectCommunityChatInbox([main(), legacy, persistent, empty]);
    expect(result.communities[0].rooms.map(row => row.targetId)).toEqual(['sunset', 'walks']);
    expect(result.communities[0].row.unread).toBe(5);
    expect(result.unclassifiedRooms).toEqual([empty, legacy]);
  });

  it('deduplicates persistent topics by actual target identity and keeps the latest source snapshot', () => {
    const old = room('walks', { unread: 10 }), recent = { ...old, key: 'renamed-source-key', title: 'Beach walks', lastAt: '2026-09-12T11:00:00Z', unread: 3 };
    const group = projectCommunityChatInbox([old, main(), recent]).communities[0];
    expect(group.rooms).toHaveLength(2);expect(group.rooms[1]).toBe(recent);
    expect(group.row.unread).toBe(5);expect(group.row.preview).toBe(recent.preview);
  });

  it('does not retain removed rows or turn orphan persistent rows into a parent', () => {
    const source = main(), persistent = room('walks');
    expect(projectCommunityChatInbox([source, persistent]).communities[0].row.unread).toBe(3);
    const result = projectCommunityChatInbox([persistent]);
    expect(result.communities).toEqual([]);expect(result.unclassifiedRooms).toEqual([persistent]);
    expect(projectCommunityChatInbox([])).toEqual({ communities: [], eventRooms: [], unclassifiedRooms: [] });
  });

  it('compares timestamps chronologically across offsets and sorts missing or invalid dates stably', () => {
    const a = main('alpha', { lastAt: '2026-09-12T09:00:00-07:00' });
    const b = main('beta', { lastAt: '2026-09-12T15:59:00Z' });
    const c = main('charlie', { lastAt: null }), d = main('delta', { lastAt: 'invalid' });
    const invalidTopic = room('broken-clock', { communityId: 'alpha', lastAt: 'invalid', unread: -4 });
    const result = projectCommunityChatInbox([d, b, invalidTopic, c, a]);
    expect(result.communities.map(group => group.row.targetId)).toEqual(['alpha', 'beta', 'charlie', 'delta']);
    expect(result.communities[0].row.preview).toBe(a.preview);expect(result.communities[0].row.unread).toBe(2);
    expect(projectCommunityChatInbox([a, c, invalidTopic, b, d])).toEqual(result);
  });

  it('retains explicit event provenance when duplicate legacy or persistent snapshots disagree', () => {
    const event = room('volleyball', { eventId: 'event-1', unread: 4 });
    const legacy = { ...event, eventId: undefined, lastAt: '2026-09-12T20:00:00Z' };
    const stalePersistent = { ...legacy, eventId: null };
    const result = projectCommunityChatInbox([main(), legacy, stalePersistent, event]);
    expect(result.eventRooms).toEqual([event]);expect(result.eventRooms[0]).toBe(event);
    expect(result.unclassifiedRooms).toEqual([]);expect(result.communities[0].rooms).toHaveLength(1);
    expect(result.communities[0].row.unread).toBe(2);
  });
});

it('pins mapped Intros first and carries the actual newest source identity through parent ordering', () => {
  const at = '2026-09-15T10:00:00.000001Z';
  const first = main('alpha', { roomRole: 'main', lastAt: at, lastMessageId: '0001', lastMessageSource: 'broadcast' });
  const other = main('beta', { roomRole: 'main', lastAt: at, lastMessageId: '9999', lastMessageSource: 'broadcast' });
  const intro = room('intro', { communityId: 'alpha', roomRole: 'intros', lastAt: at, lastMessageId: '0001', lastMessageSource: 'topic', unread: 3 });
  const optional = room('optional', { communityId: 'alpha', roomRole: 'optional', lastAt: '2026-09-15T10:00:00.000000Z', unread: 4 });
  const result = projectCommunityChatInbox([other, optional, first, intro]);
  expect(result.communities.map(g => g.row.targetId)).toEqual(['alpha', 'beta']);
  expect(result.communities[0].rooms).toEqual([intro, first, optional]);
  expect(result.communities[0].row).toMatchObject({ preview: intro.preview, lastMessageId: '0001', lastMessageSource: 'topic', unread: 9 });
});
