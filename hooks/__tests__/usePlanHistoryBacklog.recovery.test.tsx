import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePlanHistoryBacklog } from '../usePlanHistoryBacklog';
import { BACKLOG_KEYS } from '../../lib/yours/shapeGuard';

const mockRead = jest.fn(), mockRpc = jest.fn(), mockAbort = jest.fn();
jest.mock('../../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => {
  mockRpc(...args);
  const pending = mockRead();
  return Object.assign(pending, { abortSignal: (signal: AbortSignal) => { signal.addEventListener('abort', mockAbort); return pending; } });
} } }));
const person = { ...Object.fromEntries(BACKLOG_KEYS.map(key => [key, null])), user_id: 'friend' };
let client: QueryClient, tree: ReactTestRenderer | undefined, current: ReturnType<typeof usePlanHistoryBacklog>;
function Harness() { current = usePlanHistoryBacklog('viewer'); void current.data; void current.isError; void current.isFetching; return null; }
async function tick(ms = 0) { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); }
async function mount() { act(() => { tree = create(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); }); await tick(); }
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); });
afterEach(() => { act(() => tree?.unmount()); tree = undefined; client.clear(); jest.useRealTimers(); });

it('exposes a stalled initial history read as retryable failure and ignores the late response', async () => {
  let finish!: (value: unknown) => void;
  mockRead.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await mount(); await tick(12001);
  expect(current.isError).toBe(true); expect(current.error?.message).toContain('too long');
  expect(current.isFetching).toBe(false); expect(current.data).toBeUndefined(); expect(mockAbort).toHaveBeenCalledTimes(1);
  finish({ data: [person], error: null }); await tick();
  expect(current.data).toBeUndefined();
  mockRead.mockResolvedValue({ data: [person], error: null });
  await act(async () => { await current.refetch(); }); await tick();
  expect(current.isError).toBe(false); expect(current.data).toEqual([person]);
  expect(mockRpc).toHaveBeenLastCalledWith('get_plan_history_backlog', { p_user_id: 'viewer' });
});

it('retains confirmed history through a stalled refresh without accepting its late replacement', async () => {
  mockRead.mockResolvedValue({ data: [person], error: null }); await mount();
  let finish!: (value: unknown) => void;
  mockRead.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  let refresh!: ReturnType<typeof current.refetch>;
  act(() => { refresh = current.refetch(); }); await tick(12001); await refresh; await tick();
  expect(current.isError).toBe(true); expect(current.data).toEqual([person]);
  finish({ data: [], error: null }); await tick();
  expect(current.data).toEqual([person]); expect(mockRpc).toHaveBeenCalledTimes(2);
});
