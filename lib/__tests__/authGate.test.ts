jest.mock('../supabase', () => ({ supabase: { auth: { getUser: jest.fn() } } }));
import { supabase } from '../supabase';
import { getUserBounded } from '../authGate';
const getUser = supabase.auth.getUser as jest.Mock;
beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); getUser.mockReset(); });
it.each([
  { data: { user: null }, error: { message: 'network error' } },
  { data: { user: { id: 'stale' } }, error: { message: 'unavailable' } },
  null,
])('treats an errored identity response as unresolved (%j)', async (response) => {
  getUser.mockResolvedValue(response);
  await expect(getUserBounded()).resolves.toEqual({ user: null, resolved: false });
});
it('only treats an error-free missing user as a resolved missing session', async () => {
  getUser.mockResolvedValue({ data: { user: null }, error: null });
  await expect(getUserBounded()).resolves.toEqual({ user: null, resolved: true });
});
it('preserves a confirmed account', async () => {
  getUser.mockResolvedValue({ data: { user: { id: 'person-a' } }, error: null });
  await expect(getUserBounded()).resolves.toEqual({ user: { id: 'person-a' }, resolved: true });
});
it('treats rejected calls as unresolved', async () => {
  getUser.mockRejectedValue(new Error('offline'));
  await expect(getUserBounded()).resolves.toEqual({ user: null, resolved: false });
});
it('bounds a hanging identity lookup', async () => {
  jest.useFakeTimers(); getUser.mockReturnValue(new Promise(() => {}));
  const result = getUserBounded(100);
  await jest.advanceTimersByTimeAsync(100);
  await expect(result).resolves.toEqual({ user: null, resolved: false });
});
