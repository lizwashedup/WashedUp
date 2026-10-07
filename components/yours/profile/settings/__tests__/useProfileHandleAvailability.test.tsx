import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useProfileHandleAvailability } from '../useProfileHandleAvailability';

const mockUser = jest.fn(), mockLookup = jest.fn();
jest.mock('../../../../../lib/supabase', () => ({ supabase: {
  auth: { getUser: (...args: unknown[]) => mockUser(...args) },
  from: (table: string) => ({ select: (fields: string) => ({ eq: (key: string, value: string) => ({ neq: (exclude: string, id: string) => ({ maybeSingle: () => mockLookup({ table, fields, key, value, exclude, id }) }) }) }) }),
} }));
jest.mock('../../../../../lib/uploadPhoto', () => ({ uploadBase64ToStorage: jest.fn() }));
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
let tree: ReactTestRenderer | undefined, result: ReturnType<typeof useProfileHandleAvailability>, active = true;
let props: Parameters<typeof useProfileHandleAvailability>[0];
function Harness() { result = useProfileHandleAvailability(props); return null; }
const flush = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); };
const update = async (next: Partial<typeof props>) => { props = { ...props, ...next }; act(() => { tree!.update(<Harness/>); }); await flush(); };
const tick = async () => { act(() => { jest.advanceTimersByTime(500); }); await flush(); };
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); active = true;
  mockUser.mockReset().mockResolvedValue({ data: { user: { id: 'account-a' } }, error: null });
  mockLookup.mockReset().mockResolvedValue({ data: null, error: null });
  props = { enabled: true, handle: 'new_name', currentHandle: 'liz', scope: { userId: 'account-a', isCurrent: () => active } };
  act(() => { tree = create(<Harness/>); });
});
afterEach(() => { act(() => tree?.unmount()); jest.useRealTimers(); });

it('blocks saving immediately, then checks the original normalized exact lookup after the debounce', async () => {
  expect(result!.status).toBe('checking'); expect(result!.canSave).toBe(false);
  act(() => { jest.advanceTimersByTime(499); }); expect(mockLookup).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(1); }); await flush();
  expect(mockLookup).toHaveBeenCalledWith({ table: 'profiles', fields: 'id', key: 'handle', value: 'new_name', exclude: 'id', id: 'account-a' });
  expect(result!.status).toBe('available'); expect(result!.canSave).toBe(true);
});
it('shows taken only from a current matching row', async () => {
  mockLookup.mockResolvedValue({ data: { id: 'other' }, error: null }); await tick();
  expect(result!.status).toBe('taken'); expect(result!.canSave).toBe(false);
});
it('keeps a rejected availability lookup unknown, and retries explicitly', async () => {
  mockLookup.mockRejectedValueOnce(new Error('offline')); await tick();
  expect(result!.status).toBe('error'); expect(result!.canSave).toBe(false);
  act(() => result!.retry()); expect(result!.status).toBe('checking'); await tick();
  expect(result!.status).toBe('available'); expect(mockLookup).toHaveBeenCalledTimes(2);
});
it('does not reuse Available when input moves A to B to A', async () => {
  await tick(); expect(result!.status).toBe('available');
  const b = deferred<any>(); mockLookup.mockReturnValueOnce(b.promise);
  await update({ handle: 'different' }); await tick();
  const a = deferred<any>(); mockLookup.mockReturnValueOnce(a.promise);
  await update({ handle: 'new_name' }); expect(result!.status).toBe('checking'); expect(result!.canSave).toBe(false);
  await tick(); b.resolve({ data: { id: 'other' }, error: null }); await flush(); expect(result!.status).toBe('checking');
  a.resolve({ data: null, error: null }); await flush(); expect(result!.status).toBe('available');
});
it('requires fresh availability after reopening the same value in a new edit visit', async () => {
  await tick(); const oldRetry = result!.retry;
  await update({ enabled: false }); expect(result!.status).toBe('idle');
  await update({ enabled: true, scope: { userId: 'account-a', isCurrent: () => active } });
  expect(result!.status).toBe('checking'); expect(result!.canSave).toBe(false);
  act(() => oldRetry()); await tick(); expect(mockLookup).toHaveBeenCalledTimes(2); expect(result!.status).toBe('available');
});
it('also retires the same-value reply when only the current edit scope changes', async () => {
  await tick(); await update({ scope: { userId: 'account-a', isCurrent: () => active } });
  expect(result!.status).toBe('checking'); expect(result!.canSave).toBe(false);
  await tick(); expect(result!.status).toBe('available');
});
it('does not let an earlier query change a later value or its error state', async () => {
  const old = deferred<any>(); mockLookup.mockReturnValueOnce(old.promise); await tick();
  mockLookup.mockResolvedValueOnce({ data: null, error: new Error('offline') });
  await update({ handle: 'second' }); await tick(); expect(result!.status).toBe('error');
  old.resolve({ data: null, error: null }); await flush(); expect(result!.status).toBe('error');
});
it('does not dispatch a lookup after the account check returns for a closed visit', async () => {
  const auth = deferred<any>(); mockUser.mockReturnValueOnce(auth.promise); await tick(); active = false;
  auth.resolve({ data: { user: { id: 'account-a' } }, error: null }); await flush(); expect(mockLookup).not.toHaveBeenCalled();
});
it('does not query a different authenticated account', async () => {
  mockUser.mockResolvedValue({ data: { user: { id: 'account-b' } }, error: null }); await tick(); expect(mockLookup).not.toHaveBeenCalled();
  expect(result!.canSave).toBe(false);
});
it('preserves unchanged handles, including an absent existing handle, and rejects a changed one-character handle', async () => {
  await update({ handle: '@LIZ' }); expect(result!.status).toBe('unchanged'); expect(result!.canSave).toBe(true);
  await update({ currentHandle: null, handle: '' }); expect(result!.canSave).toBe(true);
  await update({ handle: 'a' }); expect(result!.status).toBe('invalid'); expect(result!.canSave).toBe(false);
  await tick(); expect(mockLookup).not.toHaveBeenCalled();
});
