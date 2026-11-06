import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearPendingDestination, consumePendingDestination, stashPendingDestination } from '../pendingLink';

const key = 'pendingLinkDestination';
const oldLink = '/plan/old?return_route=chat';
const newLink = '/plan/new?task=checkin';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const originalSet = jest.mocked(AsyncStorage.setItem);
const originalRemove = jest.mocked(AsyncStorage.removeItem);
beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); });

it('preserves a newer link arriving while an older consumer is reading', async () => {
  await stashPendingDestination(oldLink);
  const started = deferred<void>(), read = deferred<string | null>();
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => { started.resolve(); return read.promise; });
  const consuming = consumePendingDestination();
  await started.promise;
  const saving = stashPendingDestination(newLink);
  read.resolve(oldLink);
  const result = await consuming; await saving;
  expect(result).toBeNull();
  expect(await consumePendingDestination()).toBe(newLink);
});

it('does not erase or return an older link after its removal has started and a newer link arrives', async () => {
  await stashPendingDestination(oldLink);
  const started = deferred<void>(), removal = deferred<void>();
  const remove = originalRemove.getMockImplementation()!;
  jest.mocked(AsyncStorage.removeItem).mockImplementationOnce(async name => { started.resolve(); await removal.promise; return remove(name); });
  const consuming = consumePendingDestination(); await started.promise;
  const saving = stashPendingDestination(newLink);
  removal.resolve();
  const result = await consuming; await saving;
  expect(result).toBeNull();
  expect(await consumePendingDestination()).toBe(newLink);
});

it('allows overlapping consumers to hand off the saved route only once', async () => {
  await stashPendingDestination(oldLink);
  expect(await Promise.all([consumePendingDestination(), consumePendingDestination()])).toEqual([oldLink, null]);
  expect(AsyncStorage.removeItem).toHaveBeenCalledTimes(1);
});

it('preserves a newer link while a previously dispatched clear settles', async () => {
  await stashPendingDestination(oldLink);
  const started = deferred<void>(), removal = deferred<void>();
  const remove = originalRemove.getMockImplementation()!;
  jest.mocked(AsyncStorage.removeItem).mockImplementationOnce(async name => { started.resolve(); await removal.promise; return remove(name); });
  const clearing = clearPendingDestination(); await started.promise;
  const saving = stashPendingDestination(newLink);
  removal.resolve(); await clearing; await saving;
  expect(await consumePendingDestination()).toBe(newLink);
});

it('keeps arrival order when the first link write settles after a second stash was requested', async () => {
  const started = deferred<void>(), writing = deferred<void>();
  const set = originalSet.getMockImplementation()!;
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async (name, value) => { started.resolve(); await writing.promise; return set(name, value); });
  const first = stashPendingDestination(oldLink); await started.promise;
  const second = stashPendingDestination(newLink);
  writing.resolve(); await first; await second;
  expect(await consumePendingDestination()).toBe(newLink);
});

it('does not return a route to a caller that retired during removal', async () => {
  await stashPendingDestination(oldLink);
  let current = true;
  const started = deferred<void>(), removal = deferred<void>();
  const remove = originalRemove.getMockImplementation()!;
  jest.mocked(AsyncStorage.removeItem).mockImplementationOnce(async name => { started.resolve(); await removal.promise; return remove(name); });
  const consuming = consumePendingDestination(() => current); await started.promise;
  current = false; removal.resolve();
  expect(await consuming).toBeNull();
});

it('does not let a retired queued clear erase a still-pending link', async () => {
  await stashPendingDestination(oldLink);
  let current = true;
  let consumerCurrent = true;
  const started = deferred<void>(), read = deferred<string | null>();
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => { started.resolve(); return read.promise; });
  const consuming = consumePendingDestination(() => consumerCurrent); await started.promise;
  consumerCurrent = false;
  const clearing = clearPendingDestination(() => current);
  current = false; read.resolve(oldLink);
  await consuming; await clearing;
  expect(await consumePendingDestination()).toBe(oldLink);
});

it('recovers after a failed write or removal without replaying an automatic mutation', async () => {
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(Error('write failed'));
  await stashPendingDestination(oldLink); await stashPendingDestination(newLink);
  jest.mocked(AsyncStorage.removeItem).mockRejectedValueOnce(Error('remove failed'));
  expect(await consumePendingDestination()).toBeNull();
  expect(await AsyncStorage.getItem(key)).toBe(newLink);
  expect(await consumePendingDestination()).toBe(newLink);
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(2);
});

it('waits for an already-requested stash before consuming its destination', async () => {
  await stashPendingDestination(oldLink);
  const started = deferred<void>(), writing = deferred<void>();
  const set = originalSet.getMockImplementation()!;
  originalSet.mockImplementationOnce(async (name, value) => { started.resolve(); await writing.promise; return set(name, value); });
  const saving = stashPendingDestination(newLink); await started.promise;
  const consuming = consumePendingDestination();
  writing.resolve(); await saving;
  expect(await consuming).toBe(newLink);
  expect(await consumePendingDestination()).toBeNull();
});

it('does not retire a valid consumer when a stale caller requests a forbidden clear', async () => {
  await stashPendingDestination(oldLink);
  const started = deferred<void>(), read = deferred<string | null>();
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => { started.resolve(); return read.promise; });
  const consuming = consumePendingDestination(); await started.promise;
  await clearPendingDestination(() => false);
  read.resolve(oldLink);
  expect(await consuming).toBe(oldLink);
});

it('does not let a clear queued before a newer stash remove the new route', async () => {
  await stashPendingDestination(oldLink);
  const started = deferred<void>(), read = deferred<string | null>();
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => { started.resolve(); return read.promise; });
  const consuming = consumePendingDestination(); await started.promise;
  const clearing = clearPendingDestination();
  const saving = stashPendingDestination(newLink);
  read.resolve(oldLink);
  expect(await consuming).toBeNull();
  await clearing; await saving;
  expect(await consumePendingDestination()).toBe(newLink);
});

it('releases a stalled read without letting its late response erase a newer queued link', async () => {
  jest.useFakeTimers();
  try {
    await stashPendingDestination(oldLink);
    const started = deferred<void>(), read = deferred<string | null>();
    jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => { started.resolve(); return read.promise; });
    const consuming = consumePendingDestination(); await started.promise;
    const saving = stashPendingDestination(newLink);
    await jest.advanceTimersByTimeAsync(12_000);
    expect(await consuming).toBeNull(); await saving;
    read.resolve(oldLink); await Promise.resolve();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    expect(await consumePendingDestination()).toBe(newLink);
  } finally { jest.useRealTimers(); }
});
