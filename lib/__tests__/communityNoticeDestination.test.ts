const mockSession = jest.fn(), mockRpc = jest.fn(), mockUpdate = jest.fn(), mockHeader = jest.fn(), mockReceipt = jest.fn();
const mockQuery: any = { update: (...args: any[]) => { mockUpdate(...args); return mockQuery; }, eq: jest.fn(() => mockQuery), select: () => mockQuery, maybeSingle: () => mockQuery, setHeader: (...args: any[]) => { mockHeader(...args); return mockReceipt(); } };
jest.mock('../supabase', () => ({ supabase: { auth: { getSession: (...args: any[]) => mockSession(...args) }, rpc: (...args: any[]) => ({ setHeader: (...headers: any[]) => { mockHeader(...headers); return mockRpc(...args); } }), from: () => mockQuery } }));
import { loadCommunityNoticeRoute, markCommunityNoticeRead } from '../communityNoticeDestination';
const id = '11111111-1111-4111-8111-111111111111', community = '22222222-2222-4222-8222-222222222222', message = '33333333-3333-4333-8333-333333333333';
const target = { notificationId: id, type: 'community_broadcast', communityId: community, communityBroadcastId: message, reactionMessageId: message, reactionMessageSource: 'broadcast' };
const scope = { userId: 'author', isCurrent: () => true };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { resolve, promise }; }
beforeEach(() => { jest.clearAllMocks(); mockRpc.mockReset(); mockReceipt.mockReset(); mockSession.mockReset(); mockSession.mockResolvedValue({ data: { session: { user: { id: 'author' }, access_token: 'fixture-token' } }, error: null }); mockRpc.mockResolvedValue({ data: target, error: null }); mockReceipt.mockResolvedValue({ data: { id }, error: null }); });
it('pins the current account and resolves the exact message route', async () => {
  expect(await loadCommunityNoticeRoute(id, scope)).toBe(`/community-thread/${community}?reactionMessageId=${message}&reactionMessageSource=broadcast`);
  expect(mockRpc).toHaveBeenCalledWith('get_my_community_notice_target', { p_notification_id: id }); expect(mockHeader).toHaveBeenCalledWith('Authorization', 'Bearer fixture-token');
});
it('opens mapped legacy introductions through their own room', async () => {
  mockRpc.mockResolvedValue({ data: { ...target, topicId: community }, error: null }); expect(await loadCommunityNoticeRoute(id, scope)).toBe(`/community-topic/${community}?reactionMessageId=${message}&reactionMessageSource=broadcast`);
});
it('retains an ordinary community destination without inventing a reaction', async () => {
  mockRpc.mockResolvedValue({ data: { notificationId: id, type: 'community_broadcast', communityId: community, communityBroadcastId: message }, error: null }); expect(await loadCommunityNoticeRoute(id, scope)).toBe(`/community-thread/${community}`);
});
it('distinguishes missing permitted content from a failed lookup', async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: null }); expect(await loadCommunityNoticeRoute(id, scope)).toBeNull(); mockRpc.mockResolvedValueOnce({ data: null, error: Error('offline') }); await expect(loadCommunityNoticeRoute(id, scope)).rejects.toThrow('Try again');
});
it.each([{}, [], { ...target, notificationId: message }, { ...target, type: 'new_message' }, { ...target, communityId: '../../private' }, { ...target, reactionMessageSource: 'topic' }, { ...target, reactionMessageId: community }])('rejects malformed or mismatched target %p without a fallback route', async data => {
  mockRpc.mockResolvedValue({ data, error: null }); await expect(loadCommunityNoticeRoute(id, scope)).rejects.toThrow('could not be checked');
});
it('does not dispatch after the account changes during auth lookup', async () => {
  mockSession.mockResolvedValue({ data: { session: { user: { id: 'other' }, access_token: 'other-token' } } }); await expect(loadCommunityNoticeRoute(id, scope)).rejects.toThrow('Sign in'); expect(mockRpc).not.toHaveBeenCalled();
});
it('rejects a late destination after account replacement', async () => {
  mockSession.mockResolvedValueOnce({ data: { session: { user: { id: 'author' }, access_token: 'fixture-token' } } }).mockResolvedValueOnce({ data: { session: { user: { id: 'other' }, access_token: 'other-token' } } }); await expect(loadCommunityNoticeRoute(id, scope)).rejects.toThrow('Sign in');
});
it('retires a response after the initiating visit closes', async () => {
  let active = true; const pending = deferred<any>(); mockRpc.mockReturnValueOnce(pending.promise); const work = loadCommunityNoticeRoute(id, { ...scope, isCurrent: () => active }); await Promise.resolve(); await Promise.resolve(); active = false; pending.resolve({ data: target, error: null }); await expect(work).rejects.toThrow('no longer open');
});
it.each(['session', 'rpc', 'receipt'])('bounds a stalled %s operation', async stage => {
  jest.useFakeTimers();
  try {
    const pending = new Promise(() => {}); (stage === 'session' ? mockSession : stage === 'rpc' ? mockRpc : mockReceipt).mockReturnValueOnce(pending);
    const work = stage === 'receipt' ? markCommunityNoticeRead(id, scope) : loadCommunityNoticeRoute(id, scope); const assertion = expect(work).rejects.toThrow();
    await jest.advanceTimersByTimeAsync(12_001); await assertion;
  } finally { jest.useRealTimers(); }
});
it('marks only the initiating account and exact notice read', async () => {
  await markCommunityNoticeRead(id, scope); expect(mockUpdate).toHaveBeenCalledWith({ status: 'read' }); expect(mockQuery.eq).toHaveBeenCalledWith('id', id); expect(mockQuery.eq).toHaveBeenCalledWith('user_id', 'author'); expect(mockHeader).toHaveBeenCalledWith('Authorization', 'Bearer fixture-token');
});
it.each(['before', 'after'])('classifies receipt identity loss %s the update as required ownership', async phase => {
  if (phase === 'after') mockSession.mockResolvedValueOnce({ data: { session: { user: { id: 'author' }, access_token: 'fixture-token' } } });
  mockSession.mockResolvedValue({ data: { session: { user: { id: 'other' }, access_token: 'other-token' } } });
  await expect(markCommunityNoticeRead(id, scope)).rejects.toMatchObject({ name: 'CommunityNoticeIdentityError' });
  expect(mockUpdate).toHaveBeenCalledTimes(phase === 'after' ? 1 : 0);
});
it('still rechecks ownership after the optional receipt transport rejects', async () => {
  mockSession.mockResolvedValueOnce({ data: { session: { user: { id: 'author' }, access_token: 'fixture-token' } } }).mockResolvedValue({ data: { session: { user: { id: 'other' }, access_token: 'other-token' } } });
  mockReceipt.mockRejectedValueOnce(Error('offline'));
  await expect(markCommunityNoticeRead(id, scope)).rejects.toMatchObject({ name: 'CommunityNoticeIdentityError' });
});
it('never treats a stalled final identity check as optional read bookkeeping', async () => {
  jest.useFakeTimers();
  try {
    mockSession.mockResolvedValueOnce({ data: { session: { user: { id: 'author' }, access_token: 'fixture-token' } } }).mockReturnValueOnce(new Promise(() => {}));
    const assertion = expect(markCommunityNoticeRead(id, scope)).rejects.toMatchObject({ name: 'CommunityNoticeIdentityError' });
    await jest.advanceTimersByTimeAsync(12_001); await assertion;
  } finally { jest.useRealTimers(); }
});
it.each([{ data: null, error: null }, { data: { id: message }, error: null }, { data: null, error: Error('offline') }])('requires a matching read receipt %p', async receipt => {
  mockReceipt.mockResolvedValue(receipt); await expect(markCommunityNoticeRead(id, scope)).rejects.toThrow('dismiss');
});
