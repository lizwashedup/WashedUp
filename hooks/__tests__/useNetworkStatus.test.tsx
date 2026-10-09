import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, create } from 'react-test-renderer';
import { useNetworkStatus } from '../useNetworkStatus';
jest.mock('../../lib/supabase', () => ({ SUPABASE_URL: 'https://local-test.invalid' }));
let tree: ReturnType<typeof create> | undefined;
let online: boolean;
let listeners: Set<(state: AppStateStatus) => void>;
const fetchMock = jest.fn();
const originalFetch = global.fetch;
const originalState = AppState.currentState;
function deferred() {
  let resolve!: (value: { status: number }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ status: number }>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function Harness() { online = useNetworkStatus().online; return null; }
function mount() { act(() => { tree = create(<Harness />); }); }
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}
function state(value: AppStateStatus) {
  Object.defineProperty(AppState, 'currentState', { configurable: true, value });
  act(() => listeners.forEach(listener => listener(value)));
}
beforeEach(() => {
  jest.useFakeTimers();
  listeners = new Set();
  global.fetch = fetchMock;
  fetchMock.mockReset().mockResolvedValue({ status: 503 });
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { listeners.add(callback); return { remove: () => { listeners.delete(callback); } }; });
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  global.fetch = originalFetch;
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: originalState });
});
it.each([true, false])('keeps the latest result %s when an older probe finishes after returning to the app', async (latest) => {
  const old = deferred(), fresh = deferred();
  fetchMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  mount();
  state('background');
  state('active');
  await act(async () => {
    if (latest) fresh.resolve({ status: 200 });
    else fresh.reject(Error('offline'));
  });
  await flush();
  expect(online).toBe(latest);
  await act(async () => {
    if (latest) old.reject(Error('old failure'));
    else old.resolve({ status: 200 });
  });
  await flush();
  expect(online).toBe(latest);
});
it('marks a stalled request offline at the deadline even when fetch ignores abort, and ignores its late success', async () => {
  const stalled = deferred();
  fetchMock.mockReturnValueOnce(stalled.promise);
  mount();
  expect(online).toBe(true);
  await act(async () => jest.advanceTimersByTime(5000));
  await flush();
  expect(online).toBe(false);
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => stalled.resolve({ status: 200 }));
  await flush();
  expect(online).toBe(false);
  await act(async () => jest.advanceTimersByTime(15000));
  await flush();
  expect(online).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('does not poll in the background and starts only one check on return', async () => {
  state('background');
  mount();
  await act(async () => jest.advanceTimersByTime(100000));
  await flush();
  expect(fetchMock).not.toHaveBeenCalled();
  state('active');
  state('active');
  await flush();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('aborts a retired foreground request without showing a false offline result', async () => {
  const old = deferred();
  fetchMock.mockReturnValueOnce(old.promise);
  mount();
  state('inactive');
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => old.reject(Error('aborted')));
  await flush();
  expect(online).toBe(true);
  await act(async () => jest.advanceTimersByTime(60000));
  await flush();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('cleans up the request, deadline, poller and listener on unmount', async () => {
  const old = deferred();
  fetchMock.mockReturnValueOnce(old.promise);
  mount();
  act(() => { tree!.unmount(); tree = undefined; });
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
  expect(listeners.size).toBe(0);
  old.resolve({ status: 200 });
  // Avoid async act here: React's own scheduler adds timers after unmount.
  for (let i = 0; i < 5; i++)
    await Promise.resolve();
  expect(jest.getTimerCount()).toBe(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('treats any received HTTP response as reachability, not backend health', async () => {
  mount();
  await flush();
  expect(online).toBe(true);
  expect(fetchMock).toHaveBeenCalledWith('https://local-test.invalid', expect.objectContaining({ method: 'HEAD' }));
});
it('contains a synchronous fetch failure and recovers on the next foreground check', async () => {
  fetchMock.mockImplementationOnce(() => { throw Error('transport unavailable'); });
  mount();
  await flush();
  expect(online).toBe(false);
  state('background');
  state('active');
  await flush();
  expect(online).toBe(true);
});
