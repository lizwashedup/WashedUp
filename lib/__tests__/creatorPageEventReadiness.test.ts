const mockUser = jest.fn(), mockRpc = jest.fn();
jest.mock('../supabase', () => ({ supabase: { auth: { getUser: () => mockUser() }, rpc: (...args: unknown[]) => mockRpc(...args) } }));
import { loadCreatorPageEventReadiness } from '../creatorPageEventReadiness';
import { CreatorPageReceiptUnknown, CreatorPageScopeExpired } from '../creatorPageReview';
const page = 'f5d7644a-2ff5-4def-b0ab-d04b8250892b', event = '0f760000-0000-4000-8000-000000000011';
const scope = { userId: 'teammate', isCurrent: () => true };
const payload = { page_id: page, event_id: event, status: 'Draft', offer_type: 'ticketed_event', publish_ready: true, publish_reason: null,
  has_paid_tiers: true, has_paid_tier_on_sale: true, payout_ready: true, can_manage_tickets: false, cancellation_requires_refunds: true, can_cancel_without_refunds: false };
beforeEach(() => { jest.resetAllMocks(); mockUser.mockResolvedValue({ data: { user: { id: scope.userId } } }); mockRpc.mockResolvedValue({ data: payload }); });
it('keeps selling readiness separate from ticket administration and refundable obligations', async () => {
  await expect(loadCreatorPageEventReadiness(page, event, scope)).resolves.toMatchObject({ pageId: page, eventId: event, publishReady: true, canManageTickets: false, canCancelWithoutRefunds: false });
  expect(mockRpc).toHaveBeenCalledWith('creator_page_event_readiness', { p_page_id: page, p_event_id: event });
});
it('keeps missing offer setup explicit', async () => {
  mockRpc.mockResolvedValue({ data: { ...payload, offer_type: null, publish_ready: false, publish_reason: 'offer_setup_unavailable' } });
  await expect(loadCreatorPageEventReadiness(page, event, scope)).resolves.toMatchObject({ publishReady: false, publishReason: 'offer_setup_unavailable' });
});
it('does not read readiness as another authenticated account', async () => {
  mockUser.mockResolvedValue({ data: { user: { id: 'other' } } });
  await expect(loadCreatorPageEventReadiness(page, event, scope)).rejects.toBeInstanceOf(CreatorPageScopeExpired); expect(mockRpc).not.toHaveBeenCalled();
});
it('checks account and visit again after preflight', async () => {
  let active = true; mockUser.mockImplementation(async () => { active = false; return { data: { user: { id: scope.userId } } }; });
  await expect(loadCreatorPageEventReadiness(page, event, { ...scope, isCurrent: () => active })).rejects.toBeInstanceOf(CreatorPageScopeExpired); expect(mockRpc).not.toHaveBeenCalled();
});
it('discards a retired read response', async () => {
  let active = true; mockRpc.mockImplementation(async () => { active = false; return { data: payload }; });
  await expect(loadCreatorPageEventReadiness(page, event, { ...scope, isCurrent: () => active })).rejects.toBeInstanceOf(CreatorPageScopeExpired);
});
it('preserves denial without returning readiness or retrying', async () => {
  const error = { code: '42501' }; mockRpc.mockResolvedValue({ data: null, error });
  await expect(loadCreatorPageEventReadiness(page, event, scope)).rejects.toBe(error); expect(mockRpc).toHaveBeenCalledTimes(1);
});
it.each([
  { ...payload, page_id: event }, { ...payload, event_id: page }, { ...payload, publish_ready: 'true' },
  { ...payload, publish_reason: 'payout_setup_required' }, { ...payload, can_cancel_without_refunds: true },
  { ...payload, payout_ready: false }, { ...payload, offer_type: null }, { ...payload, has_paid_tier_on_sale: false },
  { ...payload, has_paid_tiers: false }, { ...payload, status: 'Cancelled' },
  { ...payload, publish_ready: false, publish_reason: 'new_unknown_reason' },
])('rejects ambiguous or inconsistent readiness %#', async data => {
  mockRpc.mockResolvedValue({ data }); await expect(loadCreatorPageEventReadiness(page, event, scope)).rejects.toBeInstanceOf(CreatorPageReceiptUnknown);
});
it('projects only safe readiness fields', async () => {
  mockRpc.mockResolvedValue({ data: { ...payload, stripe_account_id: 'omit', buyer_names: ['omit'] } });
  const r = await loadCreatorPageEventReadiness(page, event, scope); expect(r).not.toHaveProperty('stripe_account_id'); expect(r).not.toHaveProperty('buyer_names');
});
