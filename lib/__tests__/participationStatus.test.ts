import { getParticipationNoticeStatus } from '../participationTerms';

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
