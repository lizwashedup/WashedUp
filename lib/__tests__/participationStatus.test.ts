import { getParticipationNoticeStatus, recordParticipationAssent } from '../participationTerms';

const mockRpc = jest.fn();
jest.mock('../supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));

it.each([null, [], {}, [null], [{needs_assent:null}], [{needs_assent:false}, {needs_assent:true}], {needs_assent:'false'}].map(data => ({data})))(
  'does not authorize joining on an unreadable status: %p', async ({data}) => {
    mockRpc.mockResolvedValueOnce({ data, error:null });
    await expect(getParticipationNoticeStatus()).rejects.toThrow('Couldn’t check');
  },
);
it.each([false,true])('uses the explicit server decision %p', async needs_assent => {
  for (const data of [[{needs_assent}], {needs_assent}]) {
    mockRpc.mockResolvedValueOnce({data,error:null});
    await expect(getParticipationNoticeStatus()).resolves.toEqual({needsAssent:needs_assent});
  }
});

const ctx = {listingType:'plan' as const, listingId:'plan', organizerUserId:null, organizerName:'Sample',
  action:'join' as const, versions:{notice:'1.0',terms:'3.0'}};
it.each([null,{},true,{id:'not-a-uuid'},[], 'not-a-uuid'].map(data=>({data})))('does not accept a missing or malformed assent receipt: %p',async ({data})=>{
  mockRpc.mockResolvedValueOnce({data,error:null});
  await expect(recordParticipationAssent(ctx,'viewer')).resolves.toBe(false);
});
it('only accepts the scalar receipt for the scoped overload; it never falls back to an older writer',async()=>{
  mockRpc.mockClear();
  mockRpc.mockResolvedValueOnce({data:null,error:{code:'PGRST202'}});
  await expect(recordParticipationAssent(ctx,'viewer')).resolves.toBe(false);
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('record_participation_assent',expect.objectContaining({p_expected_user_id:'viewer',p_notice_version:'1.0',p_terms_version:'3.0'}));
});

it('requires the versions returned for the notice and passes them back on an explicit agreement', async () => {
  mockRpc.mockClear();
  mockRpc.mockResolvedValueOnce({ data: [{ needs_assent: true, notice_version: '2.0', terms_version: '4.0' }], error: null });
  const status = await getParticipationNoticeStatus();
  mockRpc.mockResolvedValueOnce({ data: '11111111-1111-4111-8111-111111111111', error: null });
  await expect(recordParticipationAssent({ ...ctx, versions: status.versions }, 'viewer')).resolves.toBe(true);
  expect(mockRpc).toHaveBeenLastCalledWith('record_participation_assent', expect.objectContaining({
    p_expected_user_id: 'viewer', p_notice_version: '2.0', p_terms_version: '4.0',
  }));
  await expect(recordParticipationAssent({ ...ctx, versions: undefined }, 'viewer')).resolves.toBe(false);
  expect(mockRpc).toHaveBeenCalledTimes(2);
});
