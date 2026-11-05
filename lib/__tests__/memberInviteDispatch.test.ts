const mockSession = jest.fn(), mockRpc = jest.fn(), mockHeader = jest.fn();
jest.mock('../supabase', () => ({ supabase: { auth: { getSession: (...a: any[]) => mockSession(...a) }, rpc: (...a: any[]) => mockRpc(...a) } }));
import { createMemberInvite, revokeMemberInvite, MemberInviteOutcomeUnknown, acceptMemberInviteByToken, acceptMemberInviteById, MemberInviteAcceptanceUnknown } from '../memberInvites';
let scope: any;
const receipt = { invite_id: 'invite', raw_token: 'private-token', expires_at: '2027-01-01T00:00:00Z' };
beforeEach(() => {
 scope = { userId: 'one', isCurrent: () => true }; jest.clearAllMocks();
 mockSession.mockResolvedValue({ data: { session: { user: { id: 'one' }, access_token: 'owned-token' } }, error: null });
 mockHeader.mockResolvedValue({ data: receipt, error: null });
 const request = { single: () => request, setHeader: mockHeader }; mockRpc.mockReturnValue(request);
});
it('pins the invitation to the initiating account at dispatch', async () => {
 expect(await createMemberInvite('sunset', 'sage', ' Hello ', scope)).toEqual({ inviteId: 'invite', rawToken: 'private-token', expiresAt: receipt.expires_at });
 expect(mockRpc).toHaveBeenCalledWith('create_member_invite', { p_community_id: 'sunset', p_target_user_id: 'sage', p_message: 'Hello' });
 expect(mockHeader).toHaveBeenCalledWith('Authorization', 'Bearer owned-token');
});
it('never dispatches if the account or page changes during preflight', async () => {
 mockSession.mockImplementation(async () => { scope.isCurrent = () => false; return { data: { session: { user: { id: 'one' } } } }; });
 await expect(createMemberInvite('sunset', 'sage', '', scope)).rejects.toThrow(); expect(mockRpc).not.toHaveBeenCalled();
 scope.isCurrent = () => true; mockSession.mockResolvedValue({ data: { session: { user: { id: 'two' }, access_token: 'other' } } });
 await expect(revokeMemberInvite('invite', scope)).rejects.toThrow(); expect(mockRpc).not.toHaveBeenCalled();
});
it('does not retry a transport failure and marks a missing receipt as uncertain', async () => {
 mockHeader.mockRejectedValueOnce(Error('lost response'));
 await expect(createMemberInvite('sunset', 'sage', '', scope)).rejects.toBeInstanceOf(MemberInviteOutcomeUnknown); expect(mockRpc).toHaveBeenCalledTimes(1);
 mockHeader.mockResolvedValueOnce({ data: null, error: null });
 await expect(createMemberInvite('sunset', 'sage', '', scope)).rejects.toBeInstanceOf(MemberInviteOutcomeUnknown);
});
it('keeps explicit database denials distinct and suppresses receipts after a retired visit', async () => {
 const error = { code: '42501', message: 'not allowed' }; mockHeader.mockResolvedValueOnce({ data: null, error });
 await expect(createMemberInvite('sunset', 'sage', '', scope)).rejects.toBe(error);
 mockHeader.mockImplementationOnce(async () => { scope.isCurrent = () => false; return { data: receipt, error: null }; });
 await expect(createMemberInvite('sunset', 'sage', '', scope)).rejects.toThrow('no longer active');
});
it('binds cancellation to the account too', async () => {
 await revokeMemberInvite('invite', scope); expect(mockRpc).toHaveBeenCalledWith('revoke_member_invite', { p_invite_id: 'invite' }); expect(mockHeader).toHaveBeenCalledWith('Authorization', 'Bearer owned-token');
});
it('binds both acceptance paths to the initiating account and expected community', async () => {
 mockHeader.mockResolvedValue({ data: { community_id: 'sunset' }, error: null });
 expect(await acceptMemberInviteByToken('secret', scope, 'sunset')).toEqual({ communityId: 'sunset' });
 expect(mockRpc).toHaveBeenCalledWith('accept_member_invite', { p_token: 'secret' });
 expect(mockHeader).toHaveBeenCalledWith('Authorization', 'Bearer owned-token');
 await acceptMemberInviteById('invite', scope, 'sunset');
 expect(mockRpc).toHaveBeenCalledWith('accept_member_invite', { p_invite_id: 'invite' });
});
it('refuses acceptance before dispatch after an account change', async () => {
 mockSession.mockResolvedValue({ data: { session: { user: { id: 'two' }, access_token: 'other' } }, error: null });
 await expect(acceptMemberInviteByToken('secret', scope, 'sunset')).rejects.toThrow('no longer active');
 expect(mockRpc).not.toHaveBeenCalled();
});
it.each([null, { community_id: 'another-community' }])('does not report acceptance from an invalid receipt: %j', async data => {
 mockHeader.mockResolvedValue({ data, error: null });
 await expect(acceptMemberInviteByToken('secret', scope, 'sunset')).rejects.toBeInstanceOf(MemberInviteAcceptanceUnknown);
 expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('does not retry acceptance when the response is lost; preserves a definitive denial', async () => {
 mockHeader.mockRejectedValueOnce(Error('offline'));
 await expect(acceptMemberInviteByToken('secret', scope, 'sunset')).rejects.toBeInstanceOf(MemberInviteAcceptanceUnknown);
 expect(mockRpc).toHaveBeenCalledTimes(1);
 const denial = { code: '42501', message: 'Community unavailable' };
 mockHeader.mockResolvedValueOnce({ data: null, error: denial });
 await expect(acceptMemberInviteByToken('secret', scope, 'sunset')).rejects.toBe(denial);
});
it('retires an acceptance receipt after the user leaves the visit', async () => {
 mockHeader.mockImplementationOnce(async () => { scope.isCurrent = () => false; return { data: { community_id: 'sunset' }, error: null }; });
 await expect(acceptMemberInviteByToken('secret', scope, 'sunset')).rejects.toThrow('no longer active');
});
