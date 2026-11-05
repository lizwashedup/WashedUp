import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRequestsSeenAt, markRequestsSeen } from '../requestsSeen';
beforeEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});
it('one account opening requests does not hide another account requests', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(1000);
  await markRequestsSeen('alice');
  expect(await getRequestsSeenAt('alice')).toBe(1000);
  expect(await getRequestsSeenAt('bob')).toBe(0);
});
it('ignores the unowned legacy device marker', async () => {
  await AsyncStorage.setItem('yours.requestsSeenAtV1', '5000');
  expect(await getRequestsSeenAt('alice')).toBe(0);
  expect(await getRequestsSeenAt('bob')).toBe(0);
});
it('persists each account marker through subsequent reads', async () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
  await markRequestsSeen('alice');
  clock.mockReturnValue(2000);
  await markRequestsSeen('bob');
  expect(await getRequestsSeenAt('alice')).toBe(1000);
  expect(await getRequestsSeenAt('bob')).toBe(2000);
});
it('does not read or write a personal marker without an account', async () => {
  await markRequestsSeen('');
  expect(await getRequestsSeenAt('')).toBe(0);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
});
it('failed storage writes do not pretend that requests were seen', async () => {
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(Error('disk'));
  await markRequestsSeen('alice');
  expect(await getRequestsSeenAt('alice')).toBe(0);
});
it('corrupt or negative markers do not suppress requests', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockResolvedValueOnce('NaN').mockResolvedValueOnce('-5');
  expect(await getRequestsSeenAt('alice')).toBe(0);
  expect(await getRequestsSeenAt('alice')).toBe(0);
});
