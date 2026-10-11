import { AuthClient } from '@supabase/supabase-js';
import { createSupabaseFetch } from '../supabaseFetch';

const baseUrl = 'https://fixture.invalid';
const transport = createSupabaseFetch(baseUrl);
const refreshUrl = `${baseUrl}/auth/v1/token?grant_type=refresh_token`;
const clients: InstanceType<typeof AuthClient>[] = [];
let network: jest.SpyInstance;
function reply(status: number, body: object = {}) {
  return new Response(JSON.stringify(body), { status, headers: {
    'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01',
  } });
}
async function savedClient() {
  const key = `auth-fixture-${clients.length}`;
  const session = {
    access_token: 'fixture-access', refresh_token: 'fixture-refresh',
    token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'fixture-user', aud: 'authenticated' },
  };
  const values = new Map([[key, JSON.stringify(session)]]);
  const events: string[] = [];
  const auth = new AuthClient({
    url: `${baseUrl}/auth/v1`, storageKey: key, autoRefreshToken: false,
    persistSession: true, detectSessionInUrl: false, fetch: transport,
    storage: {
      getItem: name => values.get(name) ?? null,
      setItem: (name, value) => { values.set(name, value); },
      removeItem: name => { values.delete(name); },
    },
  });
  clients.push(auth);
  await auth.initialize();
  auth.onAuthStateChange(event => { events.push(event); });
  return { auth, values, key, events, session };
}
beforeEach(() => {
  jest.useFakeTimers();
  network = jest.spyOn(global, 'fetch');
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  for (const client of clients.splice(0)) await client.stopAutoRefresh();
  jest.restoreAllMocks(); jest.useRealTimers();
});

it('the installed SDK recovers from a refresh 500 and persists the rotated session without signing out', async () => {
  const { auth, values, key, events, session } = await savedClient();
  network.mockResolvedValueOnce(reply(500, { code: 'unexpected_failure', message: 'unexpected EOF' }))
    .mockResolvedValueOnce(reply(200, { ...session, access_token: 'rotated-access', refresh_token: 'rotated-refresh' }));
  const pending = auth.refreshSession();
  await jest.advanceTimersByTimeAsync(1000);
  expect((await pending).error).toBeNull();
  expect(JSON.parse(values.get(key)!)).toMatchObject({ access_token: 'rotated-access', refresh_token: 'rotated-refresh' });
  expect(events).toContain('TOKEN_REFRESHED');
  expect(events).not.toContain('SIGNED_OUT');
  expect(network).toHaveBeenCalledTimes(2);
});

it('persistent server failures exhaust the SDK budget but retain the saved session for later recovery', async () => {
  const { auth, values, key, events } = await savedClient();
  network.mockImplementation(async () => reply(500, { code: 'unexpected_failure' }));
  const pending = auth.refreshSession();
  await jest.advanceTimersByTimeAsync(60000);
  expect((await pending).error?.name).toBe('AuthRetryableFetchError');
  expect(values.has(key)).toBe(true);
  expect(events).not.toContain('SIGNED_OUT');
  expect(network.mock.calls.length).toBeGreaterThan(1);
  const count = network.mock.calls.length;
  await jest.advanceTimersByTimeAsync(60000);
  expect(network).toHaveBeenCalledTimes(count);
});

it('an expired-session read recovers through the SDK refresh path before returning an identity', async () => {
  const { auth, values, key, events, session } = await savedClient();
  values.set(key, JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) - 1 }));
  network.mockResolvedValueOnce(reply(500, { code: 'unexpected_failure' }))
    .mockResolvedValueOnce(reply(200, { ...session, access_token: 'fresh-access', refresh_token: 'fresh-refresh' }));
  const pending = auth.getSession();
  await jest.advanceTimersByTimeAsync(1000);
  expect(await pending).toMatchObject({ data: { session: { access_token: 'fresh-access', user: { id: 'fixture-user' } } }, error: null });
  expect(events).not.toContain('SIGNED_OUT');
});

it('a failed expired-session read returns an error, never a falsely authenticated session', async () => {
  const { auth, values, key, events, session } = await savedClient();
  values.set(key, JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) - 1 }));
  network.mockImplementation(async () => reply(500));
  const pending = auth.getSession();
  await jest.advanceTimersByTimeAsync(60000);
  expect(await pending).toMatchObject({ data: { session: null }, error: { name: 'AuthRetryableFetchError' } });
  expect(values.has(key)).toBe(true);
  expect(events).not.toContain('SIGNED_OUT');
});

it.each([400, 401, 403])('a genuine token rejection (%s) still removes the session', async status => {
  const { auth, values, key, events } = await savedClient();
  network.mockResolvedValue(reply(status, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token' }));
  expect((await auth.refreshSession()).error?.name).toBe('AuthApiError');
  expect(values.has(key)).toBe(false);
  expect(events).toContain('SIGNED_OUT');
  expect(network).toHaveBeenCalledTimes(1);
});

it.each([500, 502, 503, 504, 520])('marks refresh HTTP %s as retryable without exposing request or response contents', async status => {
  network.mockResolvedValue(reply(status, { secret: 'server-fixture-secret' }));
  const error = await transport(refreshUrl, { method: 'POST', body: 'fixture-refresh-secret' }).catch(e => e);
  expect(error).toMatchObject({ name: 'AuthServiceUnavailableError', status });
  expect(String(error)).not.toMatch(/fixture-refresh-secret|server-fixture-secret/);
  expect(network).toHaveBeenCalledTimes(1); // Retries belong to auth-js, not this adapter.
});

it.each([
  [`${baseUrl}/auth/v1/otp`, 'POST'],
  [`${baseUrl}/auth/v1/verify`, 'POST'],
  [`${baseUrl}/auth/v1/token?grant_type=password`, 'POST'],
  [`${baseUrl}/auth/v1/token?grant_type=pkce`, 'POST'],
  [`${baseUrl}/auth/v1/user`, 'GET'],
  [`${baseUrl}/rest/v1/profiles`, 'PATCH'],
  ['https://other.invalid/auth/v1/token?grant_type=refresh_token', 'POST'],
  [refreshUrl, 'GET'],
])('does not reclassify or retry another operation: %s %s', async (url, method) => {
  const response = reply(500); network.mockResolvedValue(response);
  expect(await transport(url, { method })).toBe(response);
  expect(network).toHaveBeenCalledTimes(1);
});

it.each([[`${baseUrl}/auth/v1/user`, 8000], [refreshUrl, 9000]])('aborts a stalled request at its existing ceiling: %s', async (url, ceiling) => {
  network.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const pending = expect(transport(url, { method: 'POST' })).rejects.toThrow('aborted');
  await jest.advanceTimersByTimeAsync(Number(ceiling) - 1);
  expect(network.mock.calls[0][1].signal.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1); await pending;
  expect(jest.getTimerCount()).toBe(0);
});

it('removes its caller abort listener after success and after failure', async () => {
  const caller = new AbortController();
  const remove = jest.spyOn(caller.signal, 'removeEventListener');
  network.mockResolvedValueOnce(reply(200)).mockRejectedValueOnce(new Error('offline'));
  await transport(`${baseUrl}/auth/v1/user`, { signal: caller.signal });
  await expect(transport(`${baseUrl}/auth/v1/user`, { signal: caller.signal })).rejects.toThrow('offline');
  expect(remove).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
});

it('honors a caller cancellation and does not impose auth timeouts on storage', async () => {
  const caller = new AbortController();
  network.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const pending = expect(transport(`${baseUrl}/auth/v1/user`, { signal: caller.signal })).rejects.toThrow('aborted');
  caller.abort(); await pending;
  const response = reply(200); network.mockResolvedValue(response);
  expect(await transport(`${baseUrl}/storage/v1/object/photo`, { signal: caller.signal })).toBe(response);
  expect(network.mock.calls[1][1].signal).toBe(caller.signal);
  expect(jest.getTimerCount()).toBe(0);
});
