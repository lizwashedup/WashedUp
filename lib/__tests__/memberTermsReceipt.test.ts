import { getMemberTermsStatus, recordMemberTermsAcceptance } from '../participationTerms';

const mockRpc = jest.fn();
jest.mock('../supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));
beforeEach(() => mockRpc.mockReset());

it.each([
  { data: null, error: null },
  { data: [], error: null },
  { data: [{ needs_acceptance: 'false', terms_version: '3.0' }], error: null },
  { data: [{ needs_acceptance: true }], error: null },
  { data: null, error: { code: 'PGRST202' } },
  { data: null, error: { message: 'Offline' } },
])('does not block startup on an unconfirmed terms status: %p', async result => {
  mockRpc.mockResolvedValueOnce(result);
  await expect(getMemberTermsStatus()).resolves.toEqual({ needsAcceptance: false });
});
it.each([false, true])('preserves a confirmed terms status and its version: %p', async needs_acceptance => {
  mockRpc.mockResolvedValueOnce({ data: [{ needs_acceptance, terms_version: '4.0' }], error: null });
  await expect(getMemberTermsStatus()).resolves.toEqual({ needsAcceptance: needs_acceptance, termsVersion: '4.0' });
});
it.each([null, [], { id: '11111111-1111-4111-8111-111111111111' }, true])('rejects a malformed agreement receipt: %p', async data => {
  mockRpc.mockResolvedValueOnce({data, error:null});
  await expect(recordMemberTermsAcceptance('viewer', '3.0')).resolves.toBe(false);
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('record_member_terms_acceptance', {p_expected_user_id:'viewer', p_terms_version:'3.0'});
});
it('never falls back to the old writer when the held function is absent', async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } });
  await expect(recordMemberTermsAcceptance('viewer', '3.0')).resolves.toBe(false);
  expect(mockRpc).toHaveBeenCalledTimes(1);
});
