const mockGetUser = jest.fn();
jest.mock('../supabase', () => ({ supabase: { auth: { getUser: () => mockGetUser() } } }));
import { readObservedUser, retireObservedUserRead } from '../observedUserRead';
const result = { data: { user: { id: 'a' } }, error: null };
function pending() { let resolve!: (value: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => { mockGetUser.mockReset(); retireObservedUserRead(); });
afterEach(() => { retireObservedUserRead(); jest.useRealTimers(); });
it('an obsolete completion cannot erase a newer pending read', async () => {
  const old = pending(), current = pending();
  mockGetUser.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const first = readObservedUser(); retireObservedUserRead();
  const second = readObservedUser(); old.resolve(result); await first;
  expect(readObservedUser()).toBe(second); expect(mockGetUser).toHaveBeenCalledTimes(2);
  current.resolve(result); await second;
});
it('a stalled shared read expires and the next attempt verifies again', async () => {
  jest.useFakeTimers(); mockGetUser.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(result);
  const first = readObservedUser(); const failed = expect(first).rejects.toMatchObject({ name: 'RequestDeadlineError' });
  expect(readObservedUser()).toBe(first);
  await jest.advanceTimersByTimeAsync(12000); await failed;
  await expect(readObservedUser()).resolves.toEqual(result); expect(mockGetUser).toHaveBeenCalledTimes(2);
});
it('a failed request is not retained as an authentication result', async () => {
  mockGetUser.mockRejectedValueOnce(new Error('Network failed')).mockResolvedValue(result);
  await expect(readObservedUser()).rejects.toThrow('Network failed');
  await expect(readObservedUser()).resolves.toEqual(result);
});
