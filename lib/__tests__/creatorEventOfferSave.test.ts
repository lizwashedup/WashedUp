const mockRpc = jest.fn(), mockFrom = jest.fn();
jest.mock('../supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args), from: (...args: unknown[]) => mockFrom(...args) } }));
import { setEventOfferType } from '../creatorEvents';
const eventId = '0f790000-0000-4000-8000-000000000011';
function fallback(data: unknown, error: unknown = null) { const q: any = {}; for (const name of ['update', 'eq', 'select']) q[name] = jest.fn(() => q); q.maybeSingle = jest.fn(async () => ({ data, error })); mockFrom.mockReturnValue(q); return q; }
beforeEach(() => jest.resetAllMocks());
it('confirms the exact RPC event and selected offer without direct table writes', async () => {
  mockRpc.mockResolvedValue({ data: { event_id: eventId, offer_type: 'free_event' } });
  await setEventOfferType(eventId, 'free_event'); expect(mockRpc).toHaveBeenCalledWith('operator_set_event_offer_type', { p_event_id: eventId, p_offer_type: 'free_event' }); expect(mockFrom).not.toHaveBeenCalled();
});
it.each([null, { event_id: 'other', offer_type: 'free_event' }, { event_id: eventId, offer_type: 'ticketed_event' }])('does not confirm ambiguous RPC result %#', async data => {
  mockRpc.mockResolvedValue({ data }); await expect(setEventOfferType(eventId, 'free_event')).rejects.toThrow('could not be confirmed'); expect(mockFrom).not.toHaveBeenCalled();
});
it('uses a checked legacy write only when the new function is absent', async () => {
  mockRpc.mockResolvedValue({ error: { code: 'PGRST202' } }); const q = fallback({ id: eventId, offer_type: 'free_event' });
  await setEventOfferType(eventId, 'free_event'); expect(q.eq).toHaveBeenCalledWith('id', eventId); expect(q.select).toHaveBeenCalledWith('id,offer_type');
});
it('rejects the legacy silent zero-row permission failure', async () => {
  mockRpc.mockResolvedValue({ error: { code: 'PGRST202' } }); fallback(null);
  await expect(setEventOfferType(eventId, 'free_event')).rejects.toThrow('could not be confirmed');
});
it('never falls back after an uncertain transport result', async () => {
  const error = { message: 'response lost' }; mockRpc.mockResolvedValue({ error });
  await expect(setEventOfferType(eventId, 'free_event')).rejects.toBe(error); expect(mockFrom).not.toHaveBeenCalled();
});
it('does not bypass explicit permission denial', async () => {
  const error = { code: '42501' }; mockRpc.mockResolvedValue({ error });
  await expect(setEventOfferType(eventId, 'free_event')).rejects.toBe(error); expect(mockFrom).not.toHaveBeenCalled();
});
it('preserves a legacy backend error', async () => {
  const error = { code: '42501' }; mockRpc.mockResolvedValue({ error: { code: 'PGRST202' } }); fallback(null, error);
  await expect(setEventOfferType(eventId, 'free_event')).rejects.toBe(error);
});
