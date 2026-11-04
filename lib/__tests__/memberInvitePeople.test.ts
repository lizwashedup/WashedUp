import { loadMemberInvitePeople } from '../memberInvitePeople';
const mockSession = jest.fn(), mockPeople = jest.fn(), mockMembership = jest.fn();
const mockRpc = jest.fn(), mockFrom = jest.fn(), mockHeader = jest.fn(), mockFilters = jest.fn();
jest.mock('../supabase', () => ({ supabase: {
  auth: { getSession: () => mockSession() },
  rpc: (...args: unknown[]) => { mockRpc(...args); const request = mockPeople(); return Object.assign(request, { setHeader: (...headers: unknown[]) => { mockHeader(...headers); return request; } }); },
  from: (...args: unknown[]) => {
    mockFrom(...args); const request = mockMembership(); const chain: any = { then: request.then.bind(request) };
    for (const method of ['select', 'eq', 'in', 'setHeader']) chain[method] = (...params: unknown[]) => { mockFilters(method, ...params); return chain; };
    return chain;
  },
} }));
const community = '00000000-0000-4000-8000-000000000001';
const viewer = '00000000-0000-4000-8000-000000000002';
const id = (n: number) => `00000000-0000-4000-8000-${String(n + 10).padStart(12, '0')}`;
const person = (n: number, extra = {}) => ({ user_id: id(n), first_name_display: `Person ${n}`, profile_photo_url: null, handle: null, ...extra });
let live: boolean;
const scope = { userId: viewer, isCurrent: () => live };
const pending = () => { let resolve!: (v: any) => void; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => {
  jest.clearAllMocks(); live = true;
  mockSession.mockResolvedValue({ data: { session: { user: { id: viewer }, access_token: 'fixture-token' } }, error: null });
  mockPeople.mockResolvedValue({ data: [person(0), person(1, { handle: 'connected.handle' }), person(2), person(3)], error: null });
  mockMembership.mockResolvedValue({ data: [{ user_id: id(0), status: 'active' }, { user_id: id(2), status: 'pending' }, { user_id: id(3), status: 'banned' }], error: null });
});
it('uses only accepted People and scoped membership reads; handles are optional and no mutation occurs', async () => {
  const result = await loadMemberInvitePeople(community, scope);
  expect(result.map(p => [p.id, p.membership])).toEqual([[id(0), 'active'], [id(1), null], [id(2), 'pending'], [id(3), 'banned']]);
  expect(result[0].handle).toBeNull(); expect(result[1].handle).toBe('connected.handle');
  expect(mockRpc).toHaveBeenCalledTimes(1); expect(mockRpc).toHaveBeenCalledWith('get_yours_grid', { p_user_id: viewer });
  expect(mockFrom).toHaveBeenCalledWith('community_members'); expect(mockHeader).toHaveBeenCalledWith('Authorization', 'Bearer fixture-token');
  expect(mockFilters).toHaveBeenCalledWith('eq', 'community_id', community);
  expect(mockFilters).toHaveBeenCalledWith('setHeader', 'Authorization', 'Bearer fixture-token');
});
it('excludes self, deduplicates accepted people and skips membership reads for an empty list', async () => {
  mockPeople.mockResolvedValueOnce({ data: [person(1), person(1), person(0, { user_id: viewer })], error: null });
  mockMembership.mockResolvedValue({ data: [], error: null }); expect(await loadMemberInvitePeople(community, scope)).toHaveLength(1);
  mockPeople.mockResolvedValueOnce({ data: [], error: null }); mockFrom.mockClear(); expect(await loadMemberInvitePeople(community, scope)).toEqual([]); expect(mockFrom).not.toHaveBeenCalled();
});
it('checks every membership batch rather than treating truncated results as new invitees', async () => {
  mockPeople.mockResolvedValue({ data: Array.from({ length: 205 }, (_, n) => person(n)), error: null });
  mockMembership.mockResolvedValue({ data: [], error: null });
  mockMembership.mockResolvedValueOnce({ data: [{ user_id: id(99), status: 'active' }], error: null });
  const result = await loadMemberInvitePeople(community, scope);
  expect(result).toHaveLength(205); expect(result[99].membership).toBe('active');
  const batches = mockFilters.mock.calls.filter(([method, field]) => method === 'in' && field === 'user_id');
  expect(batches.map(call => call[2].length)).toEqual([100, 100, 5]);
});
it.each([null, {}, [person(0), { user_id: 'invalid' }], [person(0, { user_id: [id(0)] })]])('rejects malformed People results without a public fallback', async data => {
  mockPeople.mockResolvedValue({ data, error: null }); await expect(loadMemberInvitePeople(community, scope)).rejects.toThrow('Couldn’t check your people'); expect(mockFrom).not.toHaveBeenCalled();
});
it('does not turn denied People or membership reads into an empty or inviteable list', async () => {
  mockPeople.mockResolvedValueOnce({ data: null, error: Error('denied') }); await expect(loadMemberInvitePeople(community, scope)).rejects.toThrow('denied'); expect(mockFrom).not.toHaveBeenCalled();
  mockMembership.mockResolvedValueOnce({ data: null, error: Error('offline') }); await expect(loadMemberInvitePeople(community, scope)).rejects.toThrow('offline');
  mockMembership.mockResolvedValueOnce({ data: [{ user_id: id(999), status: 'active' }], error: null }); await expect(loadMemberInvitePeople(community, scope)).rejects.toThrow('membership');
});
it('never dispatches a read for a mismatched or retired account', async () => {
  mockSession.mockResolvedValueOnce({ data: { session: { user: { id: 'other' }, access_token: 'other-token' } }, error: null });
  await expect(loadMemberInvitePeople(community, scope)).rejects.toThrow(); expect(mockRpc).not.toHaveBeenCalled();
  const response = pending(); mockSession.mockReturnValueOnce(response.promise); const read = loadMemberInvitePeople(community, scope); live = false;
  response.resolve({ data: { session: { user: { id: viewer }, access_token: 'fixture-token' } }, error: null }); await expect(read).rejects.toThrow(); expect(mockRpc).not.toHaveBeenCalled();
});
it('discards delayed private data after leaving and starts no follow-up membership read', async () => {
  const response = pending(); mockPeople.mockReturnValueOnce(response.promise); const read = loadMemberInvitePeople(community, scope);
  await Promise.resolve(); await Promise.resolve(); live = false; response.resolve({ data: [person(1, { handle: 'private' })], error: null });
  await expect(read).rejects.toThrow(); expect(mockFrom).not.toHaveBeenCalled();
});
it('bounds an unanswered session check and prevents later dispatch', async () => {
  jest.useFakeTimers();
  try {
    const response = pending(); mockSession.mockReturnValueOnce(response.promise); const read = loadMemberInvitePeople(community, scope);
    const failure = expect(read).rejects.toThrow('too long'); await jest.advanceTimersByTimeAsync(8_001); await failure;
    response.resolve({ data: { session: { user: { id: viewer }, access_token: 'fixture-token' } }, error: null }); await Promise.resolve(); expect(mockRpc).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});
