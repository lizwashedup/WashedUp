import { getEventRegistrationKind, getEventRsvpGuests, getEventRsvpSummary } from '../eventRsvpGuests';
const mockAccess = jest.fn();
const mockFrom = jest.fn(), mockRpc = jest.fn();
jest.mock('../supabase', () => ({ supabase: { from: (...args: any[]) => mockFrom(...args), rpc: (...args: any[]) => mockRpc(...args) } }));
jest.mock('../creatorTicketRead', () => ({ canReadCreatorTickets: (...args: any[]) => mockAccess(...args), scopedTicketRequest: async (scope: any, make: any) => { if (!scope.isCurrent()) throw Error('retired'); const value = await make(); if (!scope.isCurrent()) throw Error('retired'); return value; } }));
const scope = { userId: 'owner', isCurrent: () => true };
function query(result: any) {
  const chain: any = { then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject) };
  for (const method of ['select', 'eq', 'maybeSingle', 'order', 'range', 'in']) chain[method] = jest.fn(() => chain);
  return chain;
}
const ownerEvent = { data: { id: 'event', title: 'Sunday supper', host_user_id: 'owner', community_id: null }, error: null };
beforeEach(() => { jest.clearAllMocks(); mockAccess.mockResolvedValue(true); });
it.each([[0, 0, false], [1, 0, true], [0, 1, true]])('preserves ticket tools for existing orders or tiers (%i/%i)', async (orders, tiers, expected) => {
  mockFrom.mockReturnValueOnce(query({ data: { id: 'event', offer_type: 'free_event' } })).mockReturnValueOnce(query({ count: orders })).mockReturnValueOnce(query({ count: tiers }));
  expect(await getEventRegistrationKind('event', scope)).toEqual({ freeRsvp: true, hasTickets: expected });
});
it('does not treat unknown ticket history as an empty event', async () => {
  mockFrom.mockReturnValueOnce(query({ data: { id: 'event', offer_type: 'free_event' } })).mockReturnValueOnce(query({ count: null })).mockReturnValueOnce(query({ count: 0 }));
  await expect(getEventRegistrationKind('event', scope)).rejects.toThrow();
});
it('returns a confirmed RSVP count without deriving it from ticket seats', async () => {
  mockFrom.mockReturnValueOnce(query(ownerEvent)).mockReturnValueOnce(query({ count: 5 }));
  expect(await getEventRsvpSummary('event', scope)).toBe(5);expect(mockFrom.mock.calls.map(call => call[0])).toEqual(['explore_events', 'explore_event_rsvps']);
});
it('rejects ticket delegates whose RSVP rows would be filtered by RLS', async () => {
  mockFrom.mockReturnValueOnce(query({ data: { ...ownerEvent.data, host_user_id: 'someone' } }));
  await expect(getEventRsvpSummary('event', scope)).rejects.toThrow('not available');expect(mockFrom).toHaveBeenCalledTimes(1);
});
it('accepts a verified community leader with the same account scope', async () => {
  mockFrom.mockReturnValueOnce(query({ data: { ...ownerEvent.data, host_user_id: 'someone', community_id: 'community' } })).mockReturnValueOnce(query({ count: 2 }));mockRpc.mockReturnValue(query({ data: true }));
  expect(await getEventRsvpSummary('event', scope)).toBe(2);expect(mockRpc).toHaveBeenCalledWith('is_community_leader', {p_community_id:'community',p_user_id:'owner'});
});
it('reads all guests in stable pages and only public profile fields', async () => {
  const ids = Array.from({ length: 200 }, (_, i) => ({ user_id: `guest-${i}` }));
  const first = query({ data: ids }), last = query({ data: [{ user_id: 'last' }] }), profiles = query({ data: [{ id: 'guest-0', first_name_display: 'Juniper', profile_photo_url: 'https://example.com/photo.jpg' }] });
  mockFrom.mockReturnValueOnce(query(ownerEvent)).mockReturnValueOnce(first).mockReturnValueOnce(profiles).mockReturnValueOnce(last).mockReturnValueOnce(query({ data: [] }));
  const result = await getEventRsvpGuests('event', scope);expect(result.guests).toHaveLength(201);expect(result.guests[0].name).toBe('Juniper');expect(result.guests[200].name).toBe('Member');expect(first.range).toHaveBeenCalledWith(0, 199);expect(last.range).toHaveBeenCalledWith(200, 399);expect(profiles.select).toHaveBeenCalledWith('id,first_name_display,profile_photo_url');
});
it('rejects denied and retired access before reading guests', async () => {
  mockAccess.mockResolvedValue(false);await expect(getEventRsvpGuests('event', scope)).rejects.toThrow();expect(mockFrom).not.toHaveBeenCalled();mockAccess.mockResolvedValue(true);await expect(getEventRsvpGuests('event', { ...scope, isCurrent: () => false })).rejects.toThrow('retired');expect(mockFrom).not.toHaveBeenCalled();
});
