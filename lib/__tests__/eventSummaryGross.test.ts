import { getEventSummaryGross, getEventSummaryTickets } from '../eventSummaryGross';
const mockRange = jest.fn();
const mockChain = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(), range: mockRange };
const mockFrom = jest.fn(() => mockChain);
jest.mock('../supabase', () => ({ supabase: { from: (...args: unknown[]) => mockFrom(...args as []) } }));
beforeEach(() => { jest.clearAllMocks(); mockRange.mockReset(); });
it('sums paid-order face values and reads no financial-provider columns', async () => {
 mockRange.mockResolvedValue({ data: [{ face_cents: 1200 }, { face_cents: 2500 }], error: null });
 expect(await getEventSummaryGross('event')).toBe(3700);
 expect(mockFrom).toHaveBeenCalledWith('ticket_orders');
 expect(mockChain.select).toHaveBeenCalledWith('id, face_cents');
 expect(mockChain.eq.mock.calls).toEqual([['event_id', 'event'], ['status', 'paid']]);
});
it.each([null, [{ face_cents: null }], [{ face_cents: -1 }], [{ face_cents: 1.5 }], [{ face_cents: Number.MAX_SAFE_INTEGER }, { face_cents: 1 }]])('rejects unknown/malformed totals %j', async data => {
 mockRange.mockResolvedValue({ data, error: null }); await expect(getEventSummaryGross('event')).rejects.toThrow();
});
it('returns zero only for confirmed empty or free orders', async () => {
 mockRange.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: [{ face_cents: 0 }], error: null });
 expect(await getEventSummaryGross('event')).toBe(0); expect(await getEventSummaryGross('event')).toBe(0);
});
it('throws read errors instead of reporting no sales', async () => {
 mockRange.mockResolvedValue({ data: [], error: new Error('offline') });
 await expect(getEventSummaryGross('event')).rejects.toThrow('offline');
 await expect(getEventSummaryTickets('event')).rejects.toThrow('offline');
});
it('reads all pages in stable order', async () => {
 mockRange.mockResolvedValueOnce({ data: Array.from({ length: 500 }, () => ({ face_cents: 100 })), error: null }).mockResolvedValueOnce({ data: [{ face_cents: 200 }], error: null });
 expect(await getEventSummaryGross('event')).toBe(50200);
 expect(mockRange.mock.calls).toEqual([[0, 499], [500, 999]]);
 expect(mockChain.order).toHaveBeenCalledWith('id', { ascending: true });
});
const seat = (id: string, extra = {}) => ({ id, voided_at: null, ticket_orders: { status: 'paid' }, ticket_checkins: [], ...extra });
it('preserves paid/nonvoided seat and once-per-seat admitted semantics without identities', async () => {
 mockRange.mockResolvedValue({ data: [seat('one'), seat('two', { ticket_checkins: [{ result: 'admitted' }, { result: 'admitted' }] }), seat('three', { voided_at: '2026-09-01' }), seat('four', { ticket_checkins: [{ result: 'denied' }] })], error: null });
 expect(await getEventSummaryTickets('event')).toEqual({ sold: 3, checkedIn: 1 });
 expect(mockChain.eq.mock.calls).toEqual([['ticket_orders.event_id', 'event'], ['ticket_orders.status', 'paid']]);
 expect(mockChain.select.mock.calls[0][0]).not.toMatch(/name|email|phone|price/);
});
it.each([null, [seat('one', { ticket_orders: null })], [seat('one', { ticket_checkins: null })]])('does not invent empty ticket counts for %j', async data => {
 mockRange.mockResolvedValue({ data, error: null }); await expect(getEventSummaryTickets('event')).rejects.toThrow();
});
it('does not query a missing event', async () => { await expect(getEventSummaryGross(' ')).rejects.toThrow(); await expect(getEventSummaryTickets('')).rejects.toThrow(); expect(mockFrom).not.toHaveBeenCalled(); });
it('stops pagination after the initiating account changes', async () => {
 let current = true;
 mockRange.mockImplementationOnce(async () => { current = false; return { data: Array.from({ length: 500 }, () => ({ face_cents: 100 })), error: null }; });
 await expect(getEventSummaryGross('event', () => current)).rejects.toThrow('account changed');
 expect(mockRange).toHaveBeenCalledTimes(1);
});
