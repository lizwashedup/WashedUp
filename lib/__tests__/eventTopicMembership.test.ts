import { supabase } from '../supabase';
import { getMyEventTopicMembership } from '../eventTopicMembership';

jest.mock('../supabase', () => ({ supabase: { auth: { getSession: jest.fn() }, from: jest.fn() } }));
const session = jest.mocked(supabase.auth.getSession), from = jest.mocked(supabase.from);
let alive: boolean;
const owner = { userId: 'alice', isCurrent: () => alive };
const member = { data: { topic_id: 'topic-a', user_id: 'alice' }, error: null };
const result = jest.fn();
let query: any;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { resolve, promise }; }
beforeEach(() => {
  jest.resetAllMocks(); alive = true;
  session.mockResolvedValue({ data: { session: { user: { id: 'alice' }, access_token: 'fictional-token' } }, error: null } as any);
  query = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockReturnThis(), setHeader: jest.fn(() => result()) };
  from.mockReturnValue(query); result.mockResolvedValue(member);
});
afterEach(() => jest.useRealTimers());
it('checks the exact self row with the captured session and never writes', async () => {
  await expect(getMyEventTopicMembership('topic-a', owner)).resolves.toBe(true);
  expect(query.eq.mock.calls).toEqual([['topic_id','topic-a'],['user_id','alice']]);
  expect(query.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer fictional-token');
  expect(from).toHaveBeenCalledWith('community_topic_members');
});
it('distinguishes an authoritative absent own row from unavailable reads', async () => {
  result.mockResolvedValueOnce({ data: null, error: null });
  await expect(getMyEventTopicMembership('topic-a', owner)).resolves.toBe(false);
  for (const response of [{ data: undefined, error: null }, { data: null, error: Error('offline') }, { data: { topic_id: 'other', user_id: 'alice' }, error: null }, { data: { topic_id: 'topic-a', user_id: 'bob' }, error: null }]) {
    result.mockResolvedValueOnce(response); await expect(getMyEventTopicMembership('topic-a', owner)).rejects.toThrow();
  }
});
it('does not start another account’s query after a delayed identity response', async () => {
  const wait = deferred<any>(); session.mockReturnValueOnce(wait.promise);
  const work = getMyEventTopicMembership('topic-a', owner); alive = false;
  wait.resolve({ data: { session: { user: { id: 'alice' }, access_token: 'fictional-token' } }, error: null });
  await expect(work).rejects.toThrow('visit changed'); expect(from).not.toHaveBeenCalled();
});
it('rejects a session for a different account', async () => {
  session.mockResolvedValueOnce({ data: { session: { user: { id: 'bob' }, access_token: 'fictional-other' } }, error: null } as any);
  await expect(getMyEventTopicMembership('topic-a', owner)).rejects.toThrow('account changed'); expect(from).not.toHaveBeenCalled();
});
it('ignores a membership result after route or account retirement', async () => {
  const wait = deferred<any>(); result.mockReturnValueOnce(wait.promise);
  const work = getMyEventTopicMembership('topic-a', owner); await Promise.resolve(); alive = false; wait.resolve(member);
  await expect(work).rejects.toThrow('visit changed');
});
it('bounds a stalled identity read and never continues its late query', async () => {
  jest.useFakeTimers(); const wait = deferred<any>(); session.mockReturnValueOnce(wait.promise);
  const work = getMyEventTopicMembership('topic-a', owner); const check = expect(work).rejects.toThrow();
  await jest.advanceTimersByTimeAsync(12_001); await check;
  wait.resolve({ data: { session: { user: { id: 'alice' }, access_token: 'fictional-token' } }, error: null }); await Promise.resolve(); await Promise.resolve();
  expect(from).not.toHaveBeenCalled();
});
