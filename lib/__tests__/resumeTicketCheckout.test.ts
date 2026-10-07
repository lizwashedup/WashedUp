const mockSession = jest.fn(), mockInvoke = jest.fn();
jest.mock('../supabase', () => ({ supabase: { auth: { getSession: () => mockSession() }, functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } } }));
import { resumeTicketCheckout } from '../resumeTicketCheckout';
const id = '7dba2000-0000-4000-8000-000000000001';
const owner = { userId: 'buyer', isCurrent: () => true };
beforeEach(() => {
  jest.clearAllMocks();
  mockSession.mockResolvedValue({ data: { session: { user: { id: 'buyer' }, access_token: 'synthetic-token' } }, error: null });
  mockInvoke.mockResolvedValue({ data: { order_id: id, url: 'https://checkout.stripe.com/original' }, error: null });
});
it('resumes only the original order with a captured account token and no new selection/key', async () => {
  expect(await resumeTicketCheckout(id, owner)).toEqual({ kind: 'checkout', orderId: id, url: 'https://checkout.stripe.com/original' });
  expect(mockInvoke).toHaveBeenCalledWith('create-ticket-checkout', { body: { order_id: id, return_mode: 'native' }, headers: { Authorization: 'Bearer synthetic-token' } });
});
it('refuses an account change before dispatch', async () => {
  expect((await resumeTicketCheckout(id, { ...owner, userId: 'other' })).kind).toBe('error'); expect(mockInvoke).not.toHaveBeenCalled();
});
it('retired initial visit never reads the account', async () => {
  expect((await resumeTicketCheckout(id, { ...owner, isCurrent: () => false })).kind).toBe('error'); expect(mockSession).not.toHaveBeenCalled();
});
it('retirement during session read prevents dispatch', async () => {
  let current = true; mockSession.mockImplementation(async () => { current = false; return { data: { session: { user: { id: 'buyer' }, access_token: 'synthetic-token' } } }; });
  expect((await resumeTicketCheckout(id, { ...owner, isCurrent: () => current })).kind).toBe('error'); expect(mockInvoke).not.toHaveBeenCalled();
});
it('retirement during provider response prevents browser handoff', async () => {
  let current = true; mockInvoke.mockImplementation(async () => { current = false; return { data: { order_id: id, url: 'https://checkout.stripe.com/original' } }; });
  expect((await resumeTicketCheckout(id, { ...owner, isCurrent: () => current })).kind).toBe('error');
});
for (const data of [null, { order_id: 'other', url: 'https://checkout.stripe.com/a' }, { order_id: id, url: 'http://checkout.stripe.com/a' }, { order_id: id, url: 'https://checkout.stripe.com.evil.invalid/a' }, { order_id: id, url: 'https://x:y@checkout.stripe.com/a' }, { order_id: id, url: 'nonsense' }]) it(`rejects unconfirmed or unsafe receipt ${JSON.stringify(data)}`, async () => {
  mockInvoke.mockResolvedValue({ data, error: null }); expect((await resumeTicketCheckout(id, owner)).kind).toBe('error');
});
for (const status of ['paid', 'canceled', 'refunded']) it(`refreshes original ${status} order without opening another payment`, async () => {
  mockInvoke.mockResolvedValue({ data: { order_id: id, status } }); expect(await resumeTicketCheckout(id, owner)).toEqual({ kind: 'updated', orderId: id });
});
it('confirmed free settlement refreshes the original order', async () => {
  mockInvoke.mockResolvedValue({ data: { order_id: id, free: true } }); expect(await resumeTicketCheckout(id, owner)).toEqual({ kind: 'updated', orderId: id });
});
it('parses actual FunctionsHttpError Response body for same-order expired receipt', async () => {
  mockInvoke.mockResolvedValue({ error: { context: { json: async () => ({ code: 'checkout_expired', order_id: id }) } } }); expect((await resumeTicketCheckout(id, owner)).kind).toBe('updated');
});
it('foreign expiration receipt cannot clear or refresh a different purchase', async () => {
  mockInvoke.mockResolvedValue({ error: { context: { json: async () => ({ code: 'checkout_expired', order_id: 'other' }) } } }); expect((await resumeTicketCheckout(id, owner)).kind).toBe('error');
});
it('provider transport error preserves uncertainty without exposing raw diagnostics', async () => {
  mockInvoke.mockRejectedValue(Error('secret raw provider details')); const result = await resumeTicketCheckout(id, owner); expect(result.kind).toBe('error'); expect(JSON.stringify(result)).not.toContain('secret');
});
it('changed event is explained without claiming cancellation', async () => {
  mockInvoke.mockResolvedValue({ error: { context: { json: async () => ({ code: 'checkout_event_unavailable', order_id: id }) } } }); expect(await resumeTicketCheckout(id, owner)).toMatchObject({ kind: 'error', message: expect.stringContaining('not accepting payments') });
});
