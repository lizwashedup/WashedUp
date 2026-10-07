const mockAccess = jest.fn(), mockResult = jest.fn(), mockFrom = jest.fn(), mockOr = jest.fn(), mockLimit = jest.fn();
jest.mock('../supabase', () => ({ supabase: { from: (...a: unknown[]) => { mockFrom(...a); const q: any = { select: () => q, eq: () => q, order: () => q, limit: (...b: unknown[]) => { mockLimit(...b); return q; }, or: (...b: unknown[]) => { mockOr(...b); return q; } }; return q; } } }));
jest.mock('../creatorTicketRead', () => ({ canReadCreatorTickets: (...a: unknown[]) => mockAccess(...a), scopedTicketRequest: (_s: unknown, make: () => unknown) => { make(); return mockResult(); } }));
import { loadAttendeeMessageHistory } from '../attendeeMessageHistory';
const event = '22222222-2222-4222-8222-222222222222', id = '33333333-3333-4333-8333-333333333333', scope = { userId: 'member', isCurrent: () => true };
const row = { id, event_id: event, subject: 'Sunday update', body: 'Full message', recipient_count: 2, created_at: '2026-09-16T17:00:00.123456+00:00', queued_at: '2026-09-16T17:00:00Z' };
beforeEach(() => { jest.clearAllMocks(); mockAccess.mockResolvedValue(true); mockResult.mockResolvedValue({ data: [row], error: null }); });
it('requires exact event authority before private history', async () => { mockAccess.mockResolvedValue(false); await expect(loadAttendeeMessageHistory(event, scope)).rejects.toThrow('access'); expect(mockFrom).not.toHaveBeenCalled(); });
it('paginates with timestamp and ID, preserving microseconds and complete original bodies', async () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({ ...row, id: `33333333-3333-4333-8333-${String(i).padStart(12, '0')}` }));
  mockResult.mockResolvedValueOnce({ data: rows, error: null }); const page = await loadAttendeeMessageHistory(event, scope);
  expect(page.rows).toHaveLength(20); expect(page.next).toEqual({ id: rows[19].id, created_at: row.created_at }); expect(mockLimit).toHaveBeenCalledWith(21);
  await loadAttendeeMessageHistory(event, scope, page.next); expect(mockOr.mock.calls[0][0]).toContain(row.created_at); expect(mockOr.mock.calls[0][0]).toContain(rows[19].id);
});
it.each([{ ...row, event_id: id }, { ...row, queued_at: 'unknown' }, { ...row, recipient_count: -1 }])('rejects incomplete or mismatched history %p', async data => {
  mockResult.mockResolvedValue({ data: [data], error: null }); await expect(loadAttendeeMessageHistory(event, scope)).rejects.toThrow('confirmed');
});
it('read errors are not mistaken for empty history', async () => { mockResult.mockResolvedValue({ data: null, error: { code: '42703' } }); await expect(loadAttendeeMessageHistory(event, scope)).rejects.toThrow('loaded'); });
