const mockRpc = jest.fn();
jest.mock('../supabase', () => ({ supabase: { rpc: (...args: any[]) => mockRpc(...args) } }));
import { searchProfilesForInvite } from '../coCreatorInvites';
beforeEach(() => mockRpc.mockReset());
it('lets the member invitation screen distinguish an RPC failure from no matches', async () => {
 const error = { code: 'offline', message: 'unavailable' }; mockRpc.mockResolvedValue({ data: null, error });
 await expect(searchProfilesForInvite('sage', 'one', { throwOnError: true })).rejects.toBe(error);
 await expect(searchProfilesForInvite('sage', 'one')).resolves.toEqual([]);
});
it('preserves the existing intentional handle lookup and public result fields', async () => {
 mockRpc.mockResolvedValue({ data: [{ id: 'sage', first_name_display: 'Sage', profile_photo_url: null }], error: null });
 await expect(searchProfilesForInvite(' sage ', 'one', { throwOnError: true })).resolves.toEqual([{ id: 'sage', name: 'Sage', photo: null }]);
 expect(mockRpc).toHaveBeenCalledWith('search_users_by_handle', { p_query: 'sage', p_user_id: 'one' });
});
it('does not perform a broad empty/one-character directory search', async () => {
 await expect(searchProfilesForInvite(' s ', 'one', { throwOnError: true })).resolves.toEqual([]); expect(mockRpc).not.toHaveBeenCalled();
});
