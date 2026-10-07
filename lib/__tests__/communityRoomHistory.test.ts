const mockRpc = jest.fn();
const mockGetUser = jest.fn();
const mockBroadcasts = jest.fn();
const mockTopics = jest.fn();
jest.mock('../supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args), auth: { getUser: () => mockGetUser() } } }));
jest.mock('../communityChat', () => ({
  ObsoleteCommunityOperationError: class extends Error {},
  getCommunityBroadcasts: (...args: unknown[]) => mockBroadcasts(...args),
  getTopicMessages: (...args: unknown[]) => mockTopics(...args),
}));
import { getCommunityRoomHistory, getCommunityRoomIdentities, getCommunityCoreReadState, markCommunityCoreRoomRead, communityCoreReadCovers, type CommunityCoreReadState, type CommunityRoomCursor } from '../communityRoomHistory';
const page = '0e100000-0000-4000-8000-000000000001';
const topic = '0e100000-0000-4000-8000-000000000002';
const message = '0e100000-0000-4000-8000-000000000003';
const at = '2026-09-15T12:00:00.000001+00:00';
const scope = { userId: 'member', isCurrent: () => true };
const layout = () => ({ community_id: page, name: 'Community', rooms: [
  { id: topic, role: 'intros', name: 'Say hello', storage: 'topic', included: true, joined: true, notifications_on: false },
  { id: page, role: 'main', name: 'The lounge', storage: 'broadcast', included: true, joined: true, notifications_on: true },
] });
const result = (messages: unknown[]) => ({ messages, hasMore: false, olderCursor: null });
const ref = (source = 'broadcast', id = message) => ({ source, id, created_at: at });
beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'member' } }, error: null });
  mockRpc.mockImplementation(async (name: string) => ({ data: name === 'get_community_room_identities' ? layout() : [ref()], error: null }));
  mockBroadcasts.mockResolvedValue(result([{ id: message, kind: 'intro', body: 'Standard introduction', reactions: [{ emoji: '❤', count: 1, mine: false }], reply_count: 1 }]));
  mockTopics.mockResolvedValue(result([{ id: message, body: 'Historical topic message', reply_to: { id: 'original-parent', body: 'Original parent' } }]));
});
describe('source-preserving community room reader', () => {
  it('retains both original IDs and actions when UUIDs match across sources', async () => {
    mockRpc.mockImplementation(async (name: string) => ({ data: name === 'get_community_room_identities' ? layout() : [ref('topic'), ref()], error: null }));
    const pageResult = await getCommunityRoomHistory(page, 'intros', scope);
    expect(pageResult.messages.map(m => m.key)).toEqual([`topic:${message}`, `broadcast:${message}`]);
    expect(pageResult.messages[0].message).toMatchObject({ id: message, reply_to: { id: 'original-parent' } });
    expect(pageResult.messages[1].message).toMatchObject({ id: message, reply_count: 1 });
    expect(mockTopics).toHaveBeenCalledWith(topic, undefined, scope, { messageIds: [message], strictEnrichment: true, resolveReplyParents: true });
    expect(mockBroadcasts).toHaveBeenCalledWith(page, undefined, scope, { messageIds: [message], strictEnrichment: true });
  });
  it('publishes main text in authoritative order before enrichment completes', async () => {
    const other = '0e100000-0000-4000-8000-000000000004';
    mockRpc.mockImplementation(async (name: string) => ({ data: name === 'get_community_room_identities' ? layout() : [ref('broadcast', other), ref()], error: null }));
    const basic = jest.fn();
    mockBroadcasts.mockImplementation(async (_id, _cursor, _scope, options) => {
      await options.onBasicPage(result([{ id: message, kind: 'message', metadata_pending: true }, { id: other, kind: 'message', metadata_pending: true }]));
      expect(basic).toHaveBeenCalledTimes(1);
      expect(basic.mock.calls[0][0].messages.map((row: any) => row.message.id)).toEqual([other, message]);
      return result([{ id: other, kind: 'message' }, { id: message, kind: 'message' }]);
    });
    await getCommunityRoomHistory(page, 'main', scope, undefined, { onBasicPage: basic });
    expect(basic.mock.calls[0][0].olderCursor).toMatchObject({ id: message, source: 'broadcast', role: 'main' });
  });
  it.each(['account', 'wrong room'])('refuses early mapped text after %s changes', async reason => {
    const basic = jest.fn();
    mockBroadcasts.mockImplementation(async (_id, _cursor, _scope, options) => {
      if (reason === 'account') mockGetUser.mockResolvedValue({ data: { user: { id: 'other' } }, error: null });
      await options.onBasicPage(result([{ id: message, kind: reason === 'wrong room' ? 'intro' : 'message' }]));
      return result([]);
    });
    await expect(getCommunityRoomHistory(page, 'main', scope, undefined, { onBasicPage: basic })).rejects.toThrow();
    expect(basic).not.toHaveBeenCalled();
  });
  it('uses stable roles even when the creator renames included rooms', async () => {
    const rooms = await getCommunityRoomIdentities(page, scope);
    expect(rooms?.rooms.map(r => [r.id, r.role, r.name])).toEqual([[topic, 'intros', 'Say hello'], [page, 'main', 'The lounge']]);
  });
  it('retains room IDs even when topic and broadcast namespaces use the same UUID', async () => {
    const same = layout(); same.rooms[0].id = page;
    mockRpc.mockResolvedValue({ data: same, error: null });
    expect((await getCommunityRoomIdentities(page, scope))?.rooms.map(r => r.id)).toEqual([page, page]);
  });
  it('returns missing provisioning distinctly without inventing or writing a room', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    expect(await getCommunityRoomIdentities(page, scope)).toBeNull();
    await expect(getCommunityRoomHistory(page, 'intros', scope)).rejects.toThrow('not ready');
    expect(mockRpc.mock.calls.every(([name]) => name === 'get_community_room_identities')).toBe(true);
  });
  it('rejects a map that replaces the original main identity', async () => {
    const bad = layout(); bad.rooms[1].id = message;
    mockRpc.mockResolvedValue({ data: bad, error: null });
    await expect(getCommunityRoomIdentities(page, scope)).rejects.toThrow('could not be confirmed');
  });
  it('does not begin a read for a retired visit', async () => {
    await expect(getCommunityRoomHistory(page, 'intros', { ...scope, isCurrent: () => false })).rejects.toThrow();
    expect(mockGetUser).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled();
  });
  it('discards a map if the account changes before its result is accepted', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'member' } }, error: null }).mockResolvedValue({ data: { user: { id: 'other' } }, error: null });
    await expect(getCommunityRoomHistory(page, 'intros', scope)).rejects.toThrow();
    expect(mockRpc).toHaveBeenCalledTimes(1); expect(mockBroadcasts).not.toHaveBeenCalled();
  });
  it('does not start topic enrichment after an account switch during broadcast enrichment', async () => {
    mockRpc.mockImplementation(async (name: string) => ({ data: name === 'get_community_room_identities' ? layout() : [ref(), ref('topic')], error: null }));
    mockBroadcasts.mockImplementation(async () => { mockGetUser.mockResolvedValue({ data: { user: { id: 'other' } }, error: null }); return result([]); });
    await expect(getCommunityRoomHistory(page, 'intros', scope)).rejects.toThrow();
    expect(mockTopics).not.toHaveBeenCalled();
  });
  it('retains a cursor when all records in a full page were blocked or removed', async () => {
    const refs = Array.from({ length: 60 }, (_, i) => ref('broadcast', `0e100000-0000-4000-8000-${String(i).padStart(12, '0')}`));
    mockRpc.mockImplementation(async (name: string) => ({ data: name === 'get_community_room_identities' ? layout() : refs, error: null }));
    mockBroadcasts.mockResolvedValue(result([]));
    const pageResult = await getCommunityRoomHistory(page, 'intros', scope);
    expect(pageResult.messages).toEqual([]); expect(pageResult.hasMore).toBe(true);
    expect(pageResult.olderCursor).toEqual({ communityId: page, role: 'intros', ...refs[59] });
  });
  it('does not turn a failed enrichment into an empty or partially successful history', async () => {
    mockBroadcasts.mockRejectedValue(Error('reactions unavailable'));
    await expect(getCommunityRoomHistory(page, 'intros', scope)).rejects.toThrow('reactions unavailable');
  });
  it('keeps source and microsecond timestamp in the next-page request', async () => {
    const cursor: CommunityRoomCursor = { communityId: page, role: 'intros', ...ref(), source: 'broadcast' };
    await getCommunityRoomHistory(page, 'intros', scope, cursor);
    expect(mockRpc).toHaveBeenCalledWith('get_community_room_message_refs', { p_community_id: page, p_role: 'intros', p_limit: 60, p_before_created_at: at, p_before_source: 'broadcast', p_before_id: message });
  });
  it('rejects a cursor from a different room before any request', async () => {
    const cursor: CommunityRoomCursor = { communityId: page, role: 'main', ...ref(), source: 'broadcast' };
    await expect(getCommunityRoomHistory(page, 'intros', scope, cursor)).rejects.toThrow('another chat');
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it('rejects a duplicate source reference instead of duplicating a rendered message', async () => {
    mockRpc.mockImplementation(async (name: string) => ({ data: name === 'get_community_room_identities' ? layout() : [ref(), ref()], error: null }));
    await expect(getCommunityRoomHistory(page, 'intros', scope)).rejects.toThrow('could not be confirmed');
    expect(mockBroadcasts).not.toHaveBeenCalled();
  });
  it('rejects a topic reference in main instead of importing another conversation', async () => {
    mockRpc.mockImplementation(async (name: string) => ({ data: name === 'get_community_room_identities' ? layout() : [ref('topic')], error: null }));
    await expect(getCommunityRoomHistory(page, 'main', scope)).rejects.toThrow('could not be confirmed');
  });
  it('rejects a changed broadcast kind instead of placing it in the wrong room', async () => {
    mockBroadcasts.mockResolvedValue(result([{ id: message, kind: 'message' }]));
    await expect(getCommunityRoomHistory(page, 'intros', scope)).rejects.toThrow('no longer belongs');
  });
  it('does not dispatch history requests after a layout failure', async () => {
    mockRpc.mockResolvedValue({ data: null, error: Error('offline') });
    await expect(getCommunityRoomHistory(page, 'intros', scope)).rejects.toThrow('offline');
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
  it('reads an empty room without fetching another source or marking it read', async () => {
    mockRpc.mockImplementation(async (name: string) => ({ data: name === 'get_community_room_identities' ? layout() : [], error: null }));
    expect(await getCommunityRoomHistory(page, 'main', scope)).toEqual({ messages: [], hasMore: false, olderCursor: null });
    expect(mockBroadcasts).not.toHaveBeenCalled(); expect(mockTopics).not.toHaveBeenCalled();
    expect(mockRpc.mock.calls.map(([name]) => name)).toEqual(['get_community_room_identities', 'get_community_room_message_refs']);
  });
});

const emptyRead = () => ({ through_at: null, through_id: null, legacy_read_at: null });
const state = (role: 'intros' | 'main' = 'intros') => ({ community_id: page, role, unread: 2, broadcast: emptyRead(), topic: role === 'intros' ? emptyRead() : null });
describe('independent core room read acknowledgment', () => {
  it('loads unread state without marking messages read', async () => {
    mockRpc.mockResolvedValue({ data: state(), error: null });
    expect((await getCommunityCoreReadState(page, 'intros', scope)).unread).toBe(2);
    expect(mockRpc).toHaveBeenCalledWith('get_community_core_read_state', { p_community_id: page, p_role: 'intros' });
  });
  it('acknowledges actual source IDs without submitting a phone-clock timestamp', async () => {
    mockRpc.mockResolvedValue({ data: { ...state(), broadcast: { through_at: at, through_id: message, legacy_read_at: null } }, error: null });
    await markCommunityCoreRoomRead(page, 'intros', { broadcast: { id: message, created_at: at } }, scope);
    expect(mockRpc).toHaveBeenCalledWith('mark_community_core_room_read', { p_community_id: page, p_role: 'intros', p_broadcast_id: message, p_topic_id: null });
  });
  it('rejects a stale acknowledgment instead of clearing unread UI optimistically', async () => {
    mockRpc.mockResolvedValue({ data: state(), error: null });
    await expect(markCommunityCoreRoomRead(page, 'intros', { broadcast: { id: message, created_at: at } }, scope)).rejects.toThrow('could not be confirmed');
  });
  it('does not silently retry an unknown read acknowledgment', async () => {
    mockRpc.mockResolvedValue({ data: null, error: Error('response lost') });
    await expect(markCommunityCoreRoomRead(page, 'intros', { broadcast: { id: message, created_at: at } }, scope)).rejects.toThrow('response lost');
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
  it('requires both source positions before confirming a mixed-source read', () => {
    const s: CommunityCoreReadState = { communityId: page, role: 'intros', unread: 1, broadcast: { through_id: message, through_at: at, legacy_read_at: null }, topic: emptyRead() };
    expect(communityCoreReadCovers(s, { broadcast: { id: message, created_at: at }, topic: { id: message, created_at: at } })).toBe(false);
  });
  it('retains microsecond ordering when a later message has a lower UUID', () => {
    const s: CommunityCoreReadState = { communityId: page, role: 'main', unread: 0, broadcast: { through_id: topic, through_at: '2026-09-15T12:00:00.000002+00:00', legacy_read_at: null }, topic: null };
    expect(communityCoreReadCovers(s, { broadcast: { id: message, created_at: at } })).toBe(true);
  });
  it('does not confuse an earlier microsecond with a later UUID', () => {
    const s: CommunityCoreReadState = { communityId: page, role: 'main', unread: 1, broadcast: { through_id: message, through_at: at, legacy_read_at: null }, topic: null };
    expect(communityCoreReadCovers(s, { broadcast: { id: topic, created_at: '2026-09-15T12:00:00.000002+00:00' } })).toBe(false);
  });
  it('honors an inclusive historical read marker without inventing a new cursor', () => {
    const s: CommunityCoreReadState = { communityId: page, role: 'main', unread: 0, broadcast: { ...emptyRead(), legacy_read_at: at }, topic: null };
    expect(communityCoreReadCovers(s, { broadcast: { id: message, created_at: at } })).toBe(true);
  });
  it('rejects topic reads for main before any network request', async () => {
    await expect(markCommunityCoreRoomRead(page, 'main', { topic: { id: message, created_at: at } }, scope)).rejects.toThrow('does not belong');
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it('rejects a response for another room', async () => {
    mockRpc.mockResolvedValue({ data: state('main'), error: null });
    await expect(getCommunityCoreReadState(page, 'intros', scope)).rejects.toThrow('could not be confirmed');
  });
  it('does not accept negative or malformed unread counts', async () => {
    mockRpc.mockResolvedValue({ data: { ...state(), unread: -1 }, error: null });
    await expect(getCommunityCoreReadState(page, 'intros', scope)).rejects.toThrow('could not be confirmed');
  });
  it('does not accept a mark response after the initiating account changed', async () => {
    mockRpc.mockImplementation(async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'other' } }, error: null });
      return { data: { ...state(), broadcast: { through_at: at, through_id: message, legacy_read_at: null } }, error: null };
    });
    await expect(markCommunityCoreRoomRead(page, 'intros', { broadcast: { id: message, created_at: at } }, scope)).rejects.toThrow();
  });
});
