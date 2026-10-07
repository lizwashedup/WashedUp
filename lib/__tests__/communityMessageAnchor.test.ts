const mockBroadcasts = jest.fn(), mockTopics = jest.fn(), mockCore = jest.fn();
jest.mock('../communityChat', () => ({
  ObsoleteCommunityOperationError: class extends Error {},
  getCommunityBroadcasts: (...args: unknown[]) => mockBroadcasts(...args),
  getTopicMessages: (...args: unknown[]) => mockTopics(...args),
}));
jest.mock('../communityRoomHistory', () => ({ getCommunityRoomHistory: (...args: unknown[]) => mockCore(...args) }));
import { getCommunityMessageAnchorWindow, parseCommunityMessageAnchor, CommunityMessageUnavailableError } from '../communityMessageAnchor';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const communityId = id(1), topicId = id(2);
const scope = { userId: id(3), isCurrent: () => true };
const row = (n: number, extra = {}) => ({ id: id(n), created_at: `2026-09-21T12:00:${String(n).padStart(2, '0')}.000001+00:00`, kind: 'message', body: `Message ${n}`, ...extra });
const page = (messages: any[], hasMore = false, last = messages.at(-1)) => ({ messages, hasMore, olderCursor: last ? { id: last.id, created_at: last.created_at } : null });
const anchor = { id: id(20), source: 'topic' as const };
const topic = { kind: 'topic' as const, topicId };
beforeEach(() => {
  jest.clearAllMocks();
  const read = async (_room: string, before: unknown, _scope: unknown, options: any) => options?.messageIds ? page([row(20)]) : options?.after ? page([row(21), row(22)]) : page([row(19), row(18)]);
  mockTopics.mockImplementation(read); mockBroadcasts.mockImplementation(read);
  mockCore.mockResolvedValue({ messages: [], hasMore: false, olderCursor: null });
});
it('parses only an exact UUID and known source, including neither array-valued param', () => {
  expect(parseCommunityMessageAnchor(id(20), 'topic')).toEqual(anchor);
  for (const pair of [['bad', 'topic'], [[id(20)], 'topic'], [id(20), ['topic']], [id(20), 'message']]) expect(parseCommunityMessageAnchor(...pair as [unknown, unknown])).toBeNull();
});
it('reads a bounded old topic window with the exact source and keeps replies/reactions', async () => {
  const result = await getCommunityMessageAnchorWindow(topic, anchor, scope);
  expect(result.messages.map(item => item.message.id)).toEqual([18, 19, 20, 21, 22].map(id));
  expect(mockTopics).toHaveBeenCalledTimes(4);
  expect(mockTopics.mock.calls[0][3]).toMatchObject({ messageIds: [id(20)], strictEnrichment: true, resolveReplyParents: true });
  expect(mockTopics.mock.calls[1][1]).toMatchObject({ id: id(20), created_at: row(20).created_at });
  expect(mockTopics.mock.calls[2][3].after).toEqual({ cursor: { id: id(20), created_at: row(20).created_at, source: 'topic' }, sameTime: undefined });
  expect(result.olderCursor).toEqual({ id: id(18), created_at: row(18).created_at });
  expect(result.hasNewer).toBe(false);
});
it('uses the original combined stream for an unmapped main chat', async () => {
  await getCommunityMessageAnchorWindow({ kind: 'main', communityId, mapped: false }, { ...anchor, source: 'broadcast' }, scope);
  expect(mockCore).not.toHaveBeenCalled(); expect(mockTopics).not.toHaveBeenCalled();
  expect(mockBroadcasts.mock.calls[0][3].broadcastKind).toBeUndefined();
});
it('uses mapped main boundaries and excludes introduction broadcasts', async () => {
  await getCommunityMessageAnchorWindow({ kind: 'main', communityId, mapped: true }, { ...anchor, source: 'broadcast' }, scope);
  expect(mockCore).toHaveBeenCalledWith(communityId, 'main', scope, { communityId, role: 'main', source: 'broadcast', id: id(20), created_at: row(20).created_at });
  expect(mockBroadcasts.mock.calls.every(call => call[3].broadcastKind === 'main')).toBe(true);
});
it.each([['topic', 'broadcast'], ['main', 'topic']])('rejects wrong-source %s targets without a read', async (kind, source) => {
  await expect(getCommunityMessageAnchorWindow(kind === 'main' ? { kind, communityId, mapped: true } : topic, { id: id(20), source } as any, scope)).rejects.toBeInstanceOf(CommunityMessageUnavailableError);
  expect(mockTopics).not.toHaveBeenCalled(); expect(mockBroadcasts).not.toHaveBeenCalled();
});
it('distinguishes a deleted, blocked or inaccessible target from a failed read', async () => {
  mockTopics.mockResolvedValueOnce(page([]));
  await expect(getCommunityMessageAnchorWindow(topic, anchor, scope)).rejects.toBeInstanceOf(CommunityMessageUnavailableError);
  expect(mockTopics).toHaveBeenCalledTimes(1);
  mockTopics.mockRejectedValueOnce(Error('offline'));
  await expect(getCommunityMessageAnchorWindow(topic, anchor, scope)).rejects.toThrow('offline');
});
it('rejects a target deleted while surrounding history loads', async () => {
  let exacts = 0;
  mockTopics.mockImplementation(async (_room, _before, _scope, options) => options.messageIds ? page(++exacts === 1 ? [row(20)] : []) : page([row(21)]));
  await expect(getCommunityMessageAnchorWindow(topic, anchor, scope)).rejects.toBeInstanceOf(CommunityMessageUnavailableError);
});
it('uses the current target content when it is edited during the read', async () => {
  let exacts = 0;
  mockTopics.mockImplementation(async (_room, _before, _scope, options) => options.messageIds ? page([row(20, { body: ++exacts === 1 ? 'Old' : 'Edited' })]) : page([]));
  expect((await getCommunityMessageAnchorWindow(topic, anchor, scope)).messages[0].message.body).toBe('Edited');
});
it('retired visits do not start reads or accept completed context', async () => {
  await expect(getCommunityMessageAnchorWindow(topic, anchor, { ...scope, isCurrent: () => false })).rejects.toThrow();
  expect(mockTopics).not.toHaveBeenCalled();
  let current = true;
  mockTopics.mockImplementationOnce(async () => { current = false; return page([row(20)]); });
  await expect(getCommunityMessageAnchorWindow(topic, anchor, { ...scope, isCurrent: () => current })).rejects.toThrow();
  expect(mockTopics).toHaveBeenCalledTimes(1);
});
it('intros merges identical UUIDs by source and includes a same-time later source', async () => {
  mockBroadcasts.mockImplementation(async (_r, _b, _s, options) => options.messageIds ? page([row(20, { kind: 'intro' })]) : page([]));
  mockTopics.mockResolvedValue(page([row(20), row(21)]));
  const result = await getCommunityMessageAnchorWindow({ kind: 'intros', communityId, topicId }, { ...anchor, source: 'broadcast' }, scope);
  expect(result.messages.map(item => item.key)).toEqual([`broadcast:${id(20)}`, `topic:${id(20)}`, `topic:${id(21)}`]);
  expect(mockTopics.mock.calls[0][3].after.sameTime).toBe('all');
});
it('intros after a topic target excludes same-time earlier broadcast source', async () => {
  mockBroadcasts.mockResolvedValue(page([]));
  await getCommunityMessageAnchorWindow({ kind: 'intros', communityId, topicId }, anchor, scope);
  expect(mockBroadcasts.mock.calls[0][3].after.sameTime).toBe('none');
});
it('a full filtered stream limits the other source at its raw microsecond boundary', async () => {
  const at = '2026-09-21T12:00:20.000002+00:00';
  mockBroadcasts.mockResolvedValue(page([], true, { id: id(30), created_at: at }));
  mockTopics.mockImplementation(async (_r, _b, _s, options) => options.messageIds ? page([row(20)]) : page([row(21, { created_at: '2026-09-21T12:00:20.000003+00:00' })]));
  const result = await getCommunityMessageAnchorWindow({ kind: 'intros', communityId, topicId }, anchor, scope);
  expect(result.messages.map(item => item.key)).toEqual([`topic:${id(20)}`]); expect(result.hasNewer).toBe(true);
});
it('a moved introduction does not become a main-room notification target', async () => {
  mockBroadcasts.mockResolvedValue(page([row(20, { kind: 'intro' })]));
  await expect(getCommunityMessageAnchorWindow({ kind: 'main', communityId, mapped: true }, { ...anchor, source: 'broadcast' }, scope)).rejects.toBeInstanceOf(CommunityMessageUnavailableError);
});
