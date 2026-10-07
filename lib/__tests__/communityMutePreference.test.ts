jest.mock('../supabase', () => ({ supabase: { auth: { getUser: jest.fn() }, from: jest.fn() } }));
jest.mock('../blocking', () => ({ getBlockedWith: jest.fn() }));
import { supabase } from '../supabase';
import { getMyBroadcastMute, setTopicNotifications } from '../communityChat';
import { confirmChatMuteChange } from '../confirmChatMuteChange';

const getUser = supabase.auth.getUser as jest.Mock;
const from = supabase.from as jest.Mock;
let chain: Record<string, jest.Mock>;
beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: 'member-a' } }, error: null });
  chain = { select: jest.fn(), eq: jest.fn(), update: jest.fn(), single: jest.fn(), maybeSingle: jest.fn() };
  for (const fn of Object.values(chain)) fn.mockReturnValue(chain);
  from.mockReturnValue(chain);
});

test('a failed preference read is not interpreted as notifications on', async () => {
  chain.maybeSingle.mockResolvedValue({ data: null, error: new Error('offline') });
  await expect(getMyBroadcastMute('community-a')).rejects.toThrow('offline');
});

test('missing membership and missing preference fields remain unknown', async () => {
  for (const data of [null, {}, { broadcasts_muted: null }]) {
    chain.maybeSingle.mockResolvedValue({ data, error: null });
    await expect(getMyBroadcastMute('community-a')).rejects.toThrow('Could not check');
  }
});

test('reads the authenticated active membership and accepts explicit false as well as true', async () => {
  for (const value of [true, false]) {
    chain.maybeSingle.mockResolvedValue({ data: { broadcasts_muted: value }, error: null });
    await expect(getMyBroadcastMute('community-a', 'member-a')).resolves.toBe(value);
  }
  expect(chain.eq).toHaveBeenCalledWith('community_id', 'community-a');
  expect(chain.eq).toHaveBeenCalledWith('user_id', 'member-a');
  expect(chain.eq).toHaveBeenCalledWith('status', 'active');
});

test('does not read a different account preference under a stale screen key', async () => {
  await expect(getMyBroadcastMute('community-a', 'member-b')).rejects.toThrow('Sign in again');
  expect(from).not.toHaveBeenCalled();
  getUser.mockResolvedValue({ data: { user: null }, error: null });
  await expect(getMyBroadcastMute('community-a')).rejects.toThrow('Sign in again');
});

test('topic preference needs a matching row receipt, including after membership was removed', async () => {
  chain.single.mockResolvedValue({ data: null, error: null });
  await expect(setTopicNotifications('topic-a', false)).rejects.toThrow('Could not confirm');
  chain.single.mockResolvedValue({ data: { topic_id: 'topic-a', user_id: 'member-a', notifications_on: false }, error: null });
  await expect(setTopicNotifications('topic-a', false)).resolves.toBeUndefined();
  expect(chain.update).toHaveBeenCalledWith({ notifications_on: false });
});

test('rejects a receipt from a different topic, account or preference value', async () => {
  for (const patch of [{ topic_id: 'other' }, { user_id: 'other' }, { notifications_on: true }]) {
    chain.single.mockResolvedValue({ data: { topic_id: 'topic-a', user_id: 'member-a', notifications_on: false, ...patch }, error: null });
    await expect(setTopicNotifications('topic-a', false)).rejects.toThrow('Could not confirm');
  }
});

test('confirms a committed mute despite a lost write response, without writing an inverse', async () => {
  const write = jest.fn().mockRejectedValue(new Error('response lost'));
  const read = jest.fn().mockResolvedValue(true);
  await expect(confirmChatMuteChange(true, write, read)).resolves.toEqual({ value: true, matched: true });
  expect(write.mock.calls).toEqual([[true]]);
});

test('uses the actual readback if the requested setting did not persist', async () => {
  await expect(confirmChatMuteChange(true, async () => {}, async () => false))
    .resolves.toEqual({ value: false, matched: false });
});

test('does not claim success when the write and readback are both uncertain', async () => {
  await expect(confirmChatMuteChange(false, async () => { throw new Error('timeout'); }, async () => { throw new Error('offline'); }))
    .resolves.toEqual({ value: null, matched: false });
});
