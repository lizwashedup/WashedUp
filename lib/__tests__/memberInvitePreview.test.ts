const mockRpc = jest.fn(), mockResponse = jest.fn();
jest.mock('../supabase', () => ({ supabase: { rpc: (...args: any[]) => mockRpc(...args) } }));
import { previewMemberInvite } from '../memberInvites';
const row = { invite_id: 'invite', community_id: 'community', community_name: 'Walk club', community_handle: 'walk', invited_by_name: 'Creator', status: 'viewed', expires_at: '2030-01-01T00:00:00Z', invite_message: null };
beforeEach(() => { jest.clearAllMocks(); mockRpc.mockReturnValue({ maybeSingle: mockResponse }); mockResponse.mockResolvedValue({ data: row, error: null }); });
it('keeps the viewed status returned by the server', async () => {
 expect(await previewMemberInvite('secret')).toMatchObject({ communityId: 'community', status: 'viewed', inviteMessage: null });
});
it('distinguishes a missing invitation from a failed request', async () => {
 mockResponse.mockResolvedValueOnce({ data: null, error: null }); expect(await previewMemberInvite('missing')).toBeNull();
 const error = { message: 'offline' }; mockResponse.mockResolvedValueOnce({ data: null, error }); await expect(previewMemberInvite('secret')).rejects.toBe(error);
});
it.each([{ expires_at: 'not a date' }, { status: 'unrecognized' }, { invite_message: {} }, { community_id: null }])('rejects malformed previews without rendering them: %j', async patch => {
 mockResponse.mockResolvedValueOnce({ data: { ...row, ...patch }, error: null }); await expect(previewMemberInvite('secret')).rejects.toThrow('Couldn’t load');
});
it('bounds a stuck preview request', async () => {
 jest.useFakeTimers();
 try {
  mockResponse.mockReturnValueOnce(new Promise(() => {})); const result = expect(previewMemberInvite('secret')).rejects.toThrow('took too long');
  await jest.advanceTimersByTimeAsync(12000); await result;
 } finally { jest.useRealTimers(); }
});
