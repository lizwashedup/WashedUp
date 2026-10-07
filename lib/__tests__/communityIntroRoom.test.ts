const mockUser = jest.fn(), mockLookup = jest.fn(), mockRpc = jest.fn();
jest.mock('../supabase', () => ({ supabase: { auth: { getUser: () => mockUser() }, rpc: (...args: any[]) => mockRpc(...args), from: (table: string) => {
  const chain: any = { select: () => chain, eq: (column: string, id: string) => { mockLookup(table, column, id); return chain; }, maybeSingle: () => Promise.resolve(mockLookup()) }; return chain;
} } }));
import { getCommunityIntroRoom } from '../communityRoomHistory';
const page = '0e100000-0000-4000-8000-000000000001', topic = '0e100000-0000-4000-8000-000000000002';
const scope = { userId: 'member', isCurrent: () => true };
const layout = () => ({ community_id: page, name: 'Community', rooms: [
  { id: topic, role: 'intros', name: 'Intros', storage: 'topic', included: true, joined: true, notifications_on: false },
  { id: page, role: 'main', name: 'Main', storage: 'broadcast', included: true, joined: true, notifications_on: true },
] });
beforeEach(() => { jest.clearAllMocks(); mockUser.mockResolvedValue({ data: { user: { id: 'member' } }, error: null }); mockLookup.mockReturnValue({ data: { community_id: page }, error: null }); mockRpc.mockResolvedValue({ data: layout(), error: null }); });
it('resolves the exact mapped topic without provisioning', async () => { expect((await getCommunityIntroRoom(topic, scope))?.communityId).toBe(page); expect(mockLookup).toHaveBeenCalledWith('community_chat_layouts', 'intro_topic_id', topic); expect(mockRpc.mock.calls.map(call => call[0])).toEqual(['get_community_room_identities']); });
it('leaves unmapped and event topics on their existing reader', async () => { mockLookup.mockReturnValue({ data: null, error: null }); expect(await getCommunityIntroRoom(topic, scope)).toBeNull(); expect(mockRpc).not.toHaveBeenCalled(); });
it('a lookup failure is not interpreted as an unmapped room', async () => { mockLookup.mockReturnValue({ data: null, error: Error('Offline') }); await expect(getCommunityIntroRoom(topic, scope)).rejects.toThrow('Offline'); });
it('rejects mapping that returns a different Intros topic', async () => { const wrong = layout(); wrong.rooms[0].id = '0e100000-0000-4000-8000-000000000003'; mockRpc.mockResolvedValue({ data: wrong, error: null }); await expect(getCommunityIntroRoom(topic, scope)).rejects.toThrow('could not be confirmed'); });
it('does not dispatch after the account changes during lookup', async () => { mockUser.mockResolvedValueOnce({ data: { user: { id: 'member' } }, error: null }).mockResolvedValue({ data: { user: { id: 'other' } }, error: null }); await expect(getCommunityIntroRoom(topic, scope)).rejects.toThrow(); expect(mockRpc).not.toHaveBeenCalled(); });
