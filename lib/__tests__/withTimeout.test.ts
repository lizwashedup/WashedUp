import { withDeadline, withTimeout } from '../withTimeout';

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

it('clears a fallback timer when its request resolves early', async () => {
  await expect(withTimeout(Promise.resolve('value'), 12_000, 'fallback')).resolves.toBe('value');
  expect(jest.getTimerCount()).toBe(0);
});
it('clears a fallback timer when its request rejects early', async () => {
  await expect(withTimeout(Promise.reject(new Error('offline')), 12_000, 'fallback')).resolves.toBe('fallback');
  expect(jest.getTimerCount()).toBe(0);
});
it('clears a rejecting deadline when its request resolves early', async () => {
  await expect(withDeadline(Promise.resolve('value'), 12_000)).resolves.toBe('value');
  expect(jest.getTimerCount()).toBe(0);
});
it('preserves the original request error and clears its deadline', async () => {
  const error = new Error('offline');
  await expect(withDeadline(Promise.reject(error), 12_000)).rejects.toBe(error);
  expect(jest.getTimerCount()).toBe(0);
});
it.each(['fallback', 'deadline'] as const)('clears timers for a synchronously settling %s thenable', async kind => {
  const request = { then(resolve: (value: string) => void) { resolve('sync'); } } as PromiseLike<string>;
  await expect(kind === 'fallback' ? withTimeout(request, 12_000, 'fallback') : withDeadline(request, 12_000)).resolves.toBe('sync');
  expect(jest.getTimerCount()).toBe(0);
});
it('still returns the fallback at the deadline and ignores a later result', async () => {
  let resolve!: (value: string) => void;
  const pending = new Promise<string>(done => { resolve = done; });
  const result = withTimeout(pending, 12_000, 'fallback');
  const outcomes: string[] = []; void result.then(value => outcomes.push(value));
  jest.advanceTimersByTime(11_999); await Promise.resolve(); expect(outcomes).toEqual([]);
  jest.advanceTimersByTime(1); await expect(result).resolves.toBe('fallback');
  resolve('late'); await Promise.resolve(); expect(outcomes).toEqual(['fallback']);
  expect(jest.getTimerCount()).toBe(0);
});
it('still rejects at the deadline and consumes a later rejection', async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<string>((_done, fail) => { reject = fail; });
  const result = withDeadline(pending, 12_000, 'Creator access');
  const outcome = result.catch(error => error.message);
  jest.advanceTimersByTime(12_000);
  await expect(outcome).resolves.toBe('Creator access timed out after 12000ms');
  reject(new Error('late')); await Promise.resolve();
  expect(jest.getTimerCount()).toBe(0);
});
it('does not leave a timer backlog after a burst of completed reads', async () => {
  await Promise.all(Array.from({ length: 100 }, (_, index) => withDeadline(Promise.resolve(index), 12_000)));
  expect(jest.getTimerCount()).toBe(0);
});
