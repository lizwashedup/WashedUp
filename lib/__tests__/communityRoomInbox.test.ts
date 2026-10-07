const mockRpc = jest.fn(), mockGetUser = jest.fn();
jest.mock('../supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args), auth: { getUser: () => mockGetUser() } } }));
jest.mock('../communityChat', () => ({ ObsoleteCommunityOperationError: class extends Error {} }));
import { getCommunityRoomInboxRows } from '../communityRoomInbox';
import { projectCommunityChatInbox } from '../communityChatInbox';
import type { CommunityChatRowData } from '../communityChat';
const id = (n: number) => `0e800000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-15T08:00:00.000001Z';
const scope = { userId: 'member', isCurrent: () => true };
const base = (n = 1): CommunityChatRowData => ({ key: `community-${id(n)}`, kind: 'community', targetId: id(n), communityId: id(n), title: 'Community', secondary: null, roomName: 'After Glow', preview: 'Old combined preview', lastAt: at, unread: 50, image: 'existing-cover', accent: 'existing-accent', eventId: null });
const topic = (n: number, extra: Partial<CommunityChatRowData> = {}): CommunityChatRowData => ({ ...base(), key: `room-${id(n)}`, kind: 'room', targetId: id(n), title: 'Old topic', ...extra });
const latest = (extra = {}) => ({ id: id(9), source: 'topic', body: 'Hello everyone', created_at: at, has_image: false, has_location: false, ...extra });
const summary = () => ({ community_id: id(1), name: 'Community', event_topics: [] as { id: string; event_id: string }[], rooms: [
  { id: id(2), role: 'intros', storage: 'topic', name: 'Introductions', joined: true, included: true, notifications_on: false, unread: 2, joined_at: at, latest: latest() },
  { id: id(1), role: 'main', storage: 'broadcast', name: 'The lounge', joined: true, included: true, notifications_on: true, unread: 3, joined_at: at, latest: latest({ source: 'broadcast', body: 'Main hello' }) },
  { id: id(3), role: 'optional', storage: 'topic', name: 'Beach walks', joined: true, included: false, notifications_on: true, unread: 4, joined_at: at, latest: latest({ body: '', has_image: true }) },
] });
beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'member' } }, error: null });
  mockRpc.mockResolvedValue({ data: [summary()], error: null });
});
it('reuses authorized identity and covers while replacing combined counts with Intros, main and joined optional counts', async () => {
  const source = Object.freeze([Object.freeze(base()), Object.freeze(topic(3, { image: 'topic-cover' }))]);
  const rows = await getCommunityRoomInboxRows(source, scope), group = projectCommunityChatInbox(rows).communities[0];
  expect(group.rooms.map(r => [r.targetId, r.roomRole, r.unread])).toEqual([[id(2), 'intros', 2], [id(1), 'main', 3], [id(3), 'optional', 4]]);
  expect(group.row).toMatchObject({ targetId: id(1), title: 'Community', unread: 9, image: 'existing-cover', accent: 'existing-accent' });
  expect(group.rooms[2]).toMatchObject({ image: 'topic-cover', preview: 'Shared a photo' });
  expect(source[0].unread).toBe(50);
  expect(mockRpc.mock.calls).toEqual([['get_my_community_room_summaries']]);
});
it('keeps event chats separate, including original provenance after the event FK is removed', async () => {
  const data = summary(); data.event_topics = [{ id: id(4), event_id: id(10) }];
  mockRpc.mockResolvedValue({ data: [data], error: null });
  const attendee = topic(5, { eventId: id(11), communityId: id(20) });
  const rows = await getCommunityRoomInboxRows([base(), topic(4, { unread: 99 }), attendee, topic(6, { unread: 88 })], scope);
  const result = projectCommunityChatInbox(rows);
  expect(result.communities[0].row.unread).toBe(9);
  expect(result.eventRooms.map(r => r.eventId).sort()).toEqual([id(10), id(11)]);
  expect(result.eventRooms).toContain(attendee);
  expect(rows.some(r => r.targetId === id(6))).toBe(false);
});
it('leaves unmapped communities and their existing rows untouched', async () => {
  mockRpc.mockResolvedValue({ data: [], error: null });
  const source = [base(), topic(3)];
  const result = await getCommunityRoomInboxRows(source, scope);
  expect(result).toEqual(source); expect(result[0]).toBe(source[0]); expect(result[1]).toBe(source[1]);
});
it('does not expose location coordinates or media URLs in previews and handles truly empty rooms', async () => {
  const data = summary(); data.rooms[0].latest = latest({ body: 'Private coordinates text', has_location: true });
  (data.rooms[1] as any).latest = null;
  mockRpc.mockResolvedValue({ data: [data], error: null });
  const rows = await getCommunityRoomInboxRows([base()], scope);
  expect(rows.map(r => r.preview)).toEqual(['Shared a location', 'Say hello.', 'Shared a photo']);
});
it('rejects missing parent authorization, malformed summaries and persistent/event identity collisions', async () => {
  await expect(getCommunityRoomInboxRows([], scope)).rejects.toThrow('could not be confirmed');
  for (const mutate of [
    (d: any) => { d.rooms[1].id = id(99); },
    (d: any) => { d.rooms[0].joined = false; },
    (d: any) => { d.rooms[0].unread = -1; },
    (d: any) => { d.rooms[0].latest.created_at = 'invalid'; },
    (d: any) => { d.event_topics = [{ id: id(2), event_id: id(10) }]; },
  ]) {
    const data = summary(); mutate(data); mockRpc.mockResolvedValue({ data: [data], error: null });
    await expect(getCommunityRoomInboxRows([base()], scope)).rejects.toThrow('could not be confirmed');
  }
  mockRpc.mockResolvedValue({ data: [summary()], error: null });
  await expect(getCommunityRoomInboxRows([base(), topic(2, { eventId: id(10) })], scope)).rejects.toThrow('could not be confirmed');
});
it('surfaces a failed summary instead of silently returning combined counts', async () => {
  mockRpc.mockResolvedValue({ data: null, error: Error('Network unavailable') });
  await expect(getCommunityRoomInboxRows([base()], scope)).rejects.toThrow('Network unavailable');
});
it('does not read for a retired visit and rejects a summary received after the account changes', async () => {
  await expect(getCommunityRoomInboxRows([base()], { ...scope, isCurrent: () => false })).rejects.toThrow();
  expect(mockRpc).not.toHaveBeenCalled(); expect(mockGetUser).not.toHaveBeenCalled();
  mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'member' } }, error: null }).mockResolvedValue({ data: { user: { id: 'other' } }, error: null });
  await expect(getCommunityRoomInboxRows([base()], scope)).rejects.toThrow();
  expect(mockRpc).toHaveBeenCalledTimes(1);
});
