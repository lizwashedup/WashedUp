import { supabase } from '../supabase';
import { getMyTopicMute, setMyTopicMute, type TopicNotificationScope } from '../topicNotificationPreference';
jest.mock('../supabase', () => ({ supabase: { auth: { getUser: jest.fn() }, from: jest.fn() } }));
const getUser = jest.mocked(supabase.auth.getUser);
const from = jest.mocked(supabase.from);
let current: boolean;
let scope: TopicNotificationScope;
let chain: any;
const row = (notifications_on: boolean) => ({ topic_id: 'topic-a', user_id: 'alice', notifications_on });
beforeEach(() => {
  jest.resetAllMocks(); current = true;
  scope = { topicId: 'topic-a', userId: 'alice', isCurrent: () => current };
  getUser.mockResolvedValue({ data: { user: { id: 'alice' } }, error: null } as any);
  chain = {};
  for (const name of ['select', 'eq', 'update', 'maybeSingle', 'single']) chain[name] = jest.fn(() => chain);
  from.mockReturnValue(chain);
});

it.each([true, false])('reads only the current topic membership and inverts notifications_on=%s', async on => {
  chain.maybeSingle.mockResolvedValue({ data: row(on), error: null });
  await expect(getMyTopicMute(scope)).resolves.toBe(!on);
  expect(from).toHaveBeenCalledWith('community_topic_members');
  expect(chain.eq.mock.calls).toEqual([['topic_id', 'topic-a'], ['user_id', 'alice']]);
});

it.each([null, {}, { notifications_on: false }, { ...row(true), user_id: 'bob' }, { ...row(true), topic_id: 'topic-b' }, { ...row(true), notifications_on: null }])('keeps missing or mismatched preferences unknown (%j)', async data => {
  chain.maybeSingle.mockResolvedValue({ data, error: null });
  await expect(getMyTopicMute(scope)).rejects.toThrow('Could not check');
  expect(chain.update).not.toHaveBeenCalled();
});

it('propagates auth/read failures and does not use a different account', async () => {
  getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('Offline') } as any);
  await expect(getMyTopicMute(scope)).rejects.toThrow('Offline');
  getUser.mockResolvedValueOnce({ data: { user: { id: 'bob' } }, error: null } as any);
  await expect(setMyTopicMute(scope, true)).rejects.toThrow('Sign in again');
  expect(from).not.toHaveBeenCalled();
  chain.maybeSingle.mockResolvedValue({ data: null, error: new Error('Read failed') });
  await expect(getMyTopicMute(scope)).rejects.toThrow('Read failed');
});

it('updates only notifications_on on the existing account/topic row and requires a matching receipt', async () => {
  chain.single.mockResolvedValue({ data: row(false), error: null });
  await expect(setMyTopicMute(scope, true)).resolves.toBeUndefined();
  expect(chain.update).toHaveBeenCalledWith({ notifications_on: false });
  expect(chain.eq.mock.calls).toEqual([['topic_id', 'topic-a'], ['user_id', 'alice']]);
  chain.single.mockResolvedValue({ data: null, error: null });
  await expect(setMyTopicMute(scope, true)).rejects.toThrow('Could not confirm');
  chain.single.mockResolvedValue({ data: row(true), error: null });
  await expect(setMyTopicMute(scope, true)).rejects.toThrow('Could not confirm');
});

it('cannot issue a write after the account/room epoch changes during authentication', async () => {
  let resolve!: (value: any) => void;
  getUser.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  const write = setMyTopicMute(scope, true);
  current = false;
  resolve({ data: { user: { id: 'alice' } }, error: null });
  await expect(write).rejects.toThrow('Sign in again');
  expect(from).not.toHaveBeenCalled();
});

it('does not accept a preference response from a retired scope', async () => {
  chain.maybeSingle.mockImplementation(async () => { current = false; return { data: row(false), error: null }; });
  await expect(getMyTopicMute(scope)).rejects.toThrow('This chat changed');
});
