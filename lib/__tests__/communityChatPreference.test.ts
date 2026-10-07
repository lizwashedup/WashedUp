import { supabase } from '../supabase';
import { getCommunityChatPreference, setCommunityChatPreference, CommunityChatPreferenceConflictError } from '../communityChatPreference';
jest.mock('../supabase', () => ({ supabase: { auth: { getUser: jest.fn() }, rpc: jest.fn() } }));
const getUser = jest.mocked(supabase.auth.getUser), rpc = jest.mocked(supabase.rpc);
const communityId = '774c2329-e22e-4113-8a2a-67ca854dd2c9', userId = '753c5b17-ca8d-431f-ad8f-0d9b70c0dccb';
const other = '0e6e1827-0f87-4e03-b42b-7ade8219725b';
let active = true;
const scope = { userId, isCurrent: () => active };
const observed = { communityId, userId, muted: false, version: 0 };
const raw = (muted = false, version = 0) => ({ community_id: communityId, user_id: userId, muted, version });
beforeEach(() => { jest.resetAllMocks(); active = true; getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null } as any); });
it('reads the current account preference without any mutation', async () => {
  rpc.mockResolvedValue({ data: raw(), error: null } as any);
  await expect(getCommunityChatPreference(communityId, scope)).resolves.toEqual(observed);
  expect(rpc.mock.calls).toEqual([['get_community_chat_preference', { p_community_id: communityId }]]);
});
it.each([null, {}, { ...raw(), community_id: other }, { ...raw(), user_id: other }, { ...raw(), muted: null }, { ...raw(), version: -1 }, { ...raw(), version: 0.5 }])('keeps invalid or mismatched preference %j unknown', async data => {
  rpc.mockResolvedValue({ data, error: null } as any);
  await expect(getCommunityChatPreference(communityId, scope)).rejects.toThrow('could not be confirmed');
  expect(rpc).toHaveBeenCalledTimes(1);
});
it('saves explicit desired state and observed version, without writing room preferences', async () => {
  rpc.mockResolvedValue({ data: raw(true, 1), error: null } as any);
  await expect(setCommunityChatPreference(observed, true, scope)).resolves.toEqual({ ...observed, muted: true, version: 1 });
  expect(rpc.mock.calls).toEqual([['set_community_chat_preference', { p_community_id: communityId, p_muted: true, p_expected_version: 0 }]]);
});
it('accepts exact no-op receipt without inventing a version change', async () => {
  rpc.mockResolvedValue({ data: raw(), error: null } as any);
  await expect(setCommunityChatPreference(observed, false, scope)).resolves.toEqual(observed);
});
it.each([raw(false, 1), raw(true, 0), raw(true, 2)])('rejects a wrong desired-state or version save receipt %j', async data => {
  rpc.mockResolvedValue({ data, error: null } as any);
  await expect(setCommunityChatPreference(observed, true, scope)).rejects.toThrow('could not be confirmed');
});
it('exposes a conflict for read-only reconciliation, never retries the write', async () => {
  rpc.mockResolvedValue({ data: null, error: { code: 'PT409' } } as any);
  await expect(setCommunityChatPreference(observed, true, scope)).rejects.toBeInstanceOf(CommunityChatPreferenceConflictError);
  expect(rpc).toHaveBeenCalledTimes(1);
});
it('keeps a lost save response unresolved and uses a separate read to recover', async () => {
  rpc.mockRejectedValueOnce(Error('Response lost'));
  await expect(setCommunityChatPreference(observed, true, scope)).rejects.toThrow('Response lost');
  rpc.mockResolvedValueOnce({ data: raw(true, 1), error: null } as any);
  await expect(getCommunityChatPreference(communityId, scope)).resolves.toEqual({ ...observed, muted: true, version: 1 });
  expect(rpc.mock.calls.map(call => call[0])).toEqual(['set_community_chat_preference', 'get_community_chat_preference']);
});
it('refuses wrong-account snapshots and invalid targets before dispatch', async () => {
  await expect(setCommunityChatPreference({ ...observed, userId: other }, true, scope)).rejects.toThrow('Check your notification');
  await expect(getCommunityChatPreference('bad-id', scope)).rejects.toThrow('unavailable');
  expect(rpc).not.toHaveBeenCalled();
});
it('cannot save after account changes during authentication', async () => {
  getUser.mockImplementationOnce(async () => { active = false; return { data: { user: { id: userId } }, error: null } as any; });
  await expect(setCommunityChatPreference(observed, true, scope)).rejects.toThrow('community changed');
  expect(rpc).not.toHaveBeenCalled();
});
it('rejects a different signed-in account before dispatch', async () => {
  getUser.mockResolvedValueOnce({ data: { user: { id: other } }, error: null } as any);
  await expect(setCommunityChatPreference(observed, true, scope)).rejects.toThrow('Sign in again');
  expect(rpc).not.toHaveBeenCalled();
});
it('does not accept a result after leaving the initiating scope', async () => {
  rpc.mockImplementationOnce((async () => { active = false; return { data: raw(true, 1), error: null }; }) as any);
  await expect(setCommunityChatPreference(observed, true, scope)).rejects.toThrow('community changed');
});
it('does not accept a result after the signed-in account changes', async () => {
  rpc.mockResolvedValue({ data: raw(), error: null } as any);
  getUser.mockResolvedValueOnce({ data: { user: { id: userId } }, error: null } as any).mockResolvedValueOnce({ data: { user: { id: other } }, error: null } as any);
  await expect(getCommunityChatPreference(communityId, scope)).rejects.toThrow('Sign in again');
});
