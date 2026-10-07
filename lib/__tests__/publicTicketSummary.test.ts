jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
import { supabase } from '../supabase';
import { computeFeePreview, getPublicTicketSummary, getTiers, isTicketSaleOpen, readPublicTierRemaining } from '../ticketing';
const from = supabase.from as jest.Mock, rpc = supabase.rpc as jest.Mock;
const empty = { onSale: false, fromCents: null, allSoldOut: false, scarcity: null };
const tier = { id: 'tier-a', price_cents: 2500, quantity_cap: null, status: 'on_sale', visibility: 'visible' };
function rows(data: unknown, error: unknown = null) {
  const chain: any = { select: jest.fn(), eq: jest.fn(), neq: jest.fn(), order: jest.fn() };
  chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain); chain.neq.mockReturnValue(chain);
  chain.order.mockResolvedValue({ data, error }); from.mockReturnValue(chain);
}
beforeEach(() => { jest.clearAllMocks(); rows([tier]); rpc.mockResolvedValue({ data: null, error: null }); });
it('distinguishes an unavailable ticket read from a confirmed empty result', async () => {
  rows(null, new Error('offline')); await expect(getPublicTicketSummary('event')).rejects.toThrow('offline');
  rows([]); await expect(getPublicTicketSummary('event')).resolves.toEqual(empty);
});
it('rejects missing data without labeling an event free', async () => {
  rows(null); await expect(getPublicTicketSummary('event')).rejects.toThrow('Could not read tickets');
});
it('does not turn an availability failure into a buyable uncapped tier', async () => {
  rpc.mockResolvedValue({ data: null, error: new Error('availability offline') });
  await expect(getPublicTicketSummary('event')).rejects.toThrow('availability offline');
});
it('respects an event-wide sellout even when the individual tier is uncapped', async () => {
  rpc.mockResolvedValue({ data: 0, error: null });
  await expect(getPublicTicketSummary('event')).resolves.toEqual({ ...empty, allSoldOut: true });
});
it('accepts confirmed unlimited availability without inventing scarcity', async () => {
  await expect(getPublicTicketSummary('event')).resolves.toEqual({ onSale: true, fromCents: computeFeePreview(2500, 0).buyerTotalCents, allSoldOut: false, scarcity: null });
});
it('does not advertise the price of the cheapest sold-out tier', async () => {
  rows([{ ...tier, price_cents: 1000 }, { ...tier, id: 'tier-b', price_cents: 3000, quantity_cap: 10 }]);
  rpc.mockImplementation((_name, args) => Promise.resolve({ data: args.p_tier_id === 'tier-a' ? 0 : 3, error: null }));
  await expect(getPublicTicketSummary('event')).resolves.toEqual({ onSale: true, fromCents: computeFeePreview(3000, 0).buyerTotalCents, allSoldOut: false, scarcity: { left: 3, cap: 10 } });
});
it.each([undefined, -1, 1.5, '2'])('rejects invalid remaining inventory (%s)', async data => {
  rpc.mockResolvedValue({ data, error: null }); await expect(readPublicTierRemaining(tier)).rejects.toThrow('Could not check ticket availability');
});
it('does not treat null capped inventory as unlimited', async () => {
  await expect(readPublicTierRemaining({ ...tier, quantity_cap: 5 })).rejects.toThrow('Could not check ticket availability');
});
it('does not fabricate a zero price for malformed ticket data', async () => {
  rows([{ ...tier, price_cents: null }]); await expect(getPublicTicketSummary('event')).rejects.toThrow('Could not check ticket prices');
});
it('uses strict checkout reads without changing the retained general helper contract', async () => {
  rows(null, new Error('offline'));
  await expect(getTiers('event')).resolves.toEqual([]);
  await expect(getTiers('event', true)).rejects.toThrow('offline');
});

it('preserves a confirmed ticketed offer when RLS exposes no on-sale tiers',async()=>{
 rows([]);await expect(getPublicTicketSummary('event',true)).resolves.toEqual({...empty,notOnSale:true});
});
it('does not advertise future or closed visible tiers',async()=>{
 rows([{...tier,sales_open_at:'2999-01-01T00:00:00Z',sales_close_at:null}]);
 await expect(getPublicTicketSummary('event')).resolves.toEqual({...empty,notOnSale:true});expect(rpc).not.toHaveBeenCalled();
 rows([{...tier,sales_open_at:null,sales_close_at:'2000-01-01T00:00:00Z'}]);
 await expect(getPublicTicketSummary('event')).resolves.toEqual({...empty,notOnSale:true});
});
it('uses the same inclusive sale-window boundaries as checkout',()=>{
 const window={sales_open_at:'2026-09-16T12:00:00Z',sales_close_at:'2026-09-16T14:00:00Z'};
 expect(isTicketSaleOpen(window,Date.parse(window.sales_open_at)-1)).toBe(false);
 expect(isTicketSaleOpen(window,Date.parse(window.sales_open_at))).toBe(true);
 expect(isTicketSaleOpen(window,Date.parse(window.sales_close_at))).toBe(true);
 expect(isTicketSaleOpen(window,Date.parse(window.sales_close_at)+1)).toBe(false);
});
it('does not call positive but insufficient group inventory sold out',async()=>{
 rows([{...tier,per_order_min:3}]);rpc.mockResolvedValue({data:2,error:null});
 await expect(getPublicTicketSummary('event')).resolves.toEqual({...empty,unavailable:true});
});
