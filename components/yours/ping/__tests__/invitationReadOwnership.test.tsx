import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PingAfterPlanModal from '../PingAfterPlanModal';
import PingInline from '../PingInline';
import { YOURS_GRID_KEYS } from '../../../../lib/yours/shapeGuard';

const mockAuth = jest.fn(), mockRead = jest.fn(), mockRpc = jest.fn();
let mockEpoch = 1, mockUser = 'alice';
jest.mock('../../../../hooks/useObservedUser', () => ({ useObservedUser: () => {
  const epoch = mockEpoch, user = mockUser;
  return { viewerId: user, epoch, isLoading: false, error: null, retry: jest.fn(), isCurrent: () => epoch === mockEpoch && user === mockUser };
} }));
jest.mock('../../../../lib/supabase', () => ({ supabase: { auth: { getUser: () => mockAuth() }, rpc: (...args: unknown[]) => {
  mockRpc(...args); const pending = mockRead(); return Object.assign(pending, { abortSignal: () => pending });
} } }));
jest.mock('../PingInline', () => ({ __esModule: true, default: (p: any) => require('react').createElement('InvitationChoices', p) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: (p: any) => require('react').createElement('SafeArea', p, p.children) }));

const friend = { ...Object.fromEntries(YOURS_GRID_KEYS.map(key => [key, null])), user_id: 'friend', first_name_display: 'Private friend', shared_count: 0 };
const answer = (data: unknown = [friend]) => ({ data, error: null });
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(yes => { resolve = yes; }); return { promise, resolve }; };

describe('post-plan private invitation choices', () => {
  let client: QueryClient, tree: ReactTestRenderer | undefined;
  const confirm = jest.fn();
  const element = () => <QueryClientProvider client={client}><PingAfterPlanModal planId="plan-a" onDone={confirm} /></QueryClientProvider>;
  const tick = async (ms = 1) => { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); };
  const mount = async () => { act(() => { tree = create(element()); }); await tick(); };
  const refresh = async () => { act(() => tree!.update(element())); await tick(); };
  const rows = () => tree!.root.findAllByType(PingInline).flatMap(node => node.props.people ?? []);
  const retry = () => tree!.root.findAll(node => typeof node.props.onPress === 'function' && node.props.accessibilityLabel === 'Retry loading your people')[0];
  beforeEach(() => {
    jest.useFakeTimers(); jest.clearAllMocks(); mockEpoch = 1; mockUser = 'alice';
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    mockAuth.mockReset().mockImplementation(() => Promise.resolve({ data: { user: { id: mockUser } }, error: null }));
    mockRead.mockReset().mockImplementation(() => Promise.resolve(answer()));
  });
  afterEach(() => { act(() => tree?.unmount()); tree = undefined; client.clear(); jest.useRealTimers(); });
  it('does not display old choices while a reopened sheet verifies a fresh list', async () => {
    await mount(); expect(rows()).toEqual([friend]); act(() => tree!.unmount()); tree = undefined;
    const pending = deferred(); mockRead.mockReturnValueOnce(pending.promise); await mount();
    expect(rows()).toEqual([]); pending.resolve(answer([])); await tick(); expect(rows()).toEqual([]);
  });
  it('does not resurrect choices on an account A-B-A roundtrip', async () => {
    await mount(); expect(rows()).toEqual([friend]);
    mockUser = 'bob'; mockEpoch++; mockRead.mockResolvedValueOnce(answer([])); await refresh();
    const pending = deferred(); mockUser = 'alice'; mockEpoch++; mockRead.mockReturnValueOnce(pending.promise); await refresh();
    expect(rows()).toEqual([]); pending.resolve(answer([])); await tick(); expect(rows()).toEqual([]);
  });
  it('rejects an account mismatch before fetching private choices', async () => {
    mockAuth.mockResolvedValueOnce({ data: { user: { id: 'bob' } }, error: null }); await mount();
    expect(mockRpc).not.toHaveBeenCalled(); expect(rows()).toEqual([]); expect(retry()).toBeDefined();
  });
  it('bounds a stalled account check and recovers only through explicit retry', async () => {
    const pending = deferred(); mockAuth.mockReturnValueOnce(pending.promise); await mount(); await tick(12001);
    expect(rows()).toEqual([]); expect(retry()).toBeDefined(); expect(mockRpc).not.toHaveBeenCalled();
    pending.resolve({ data: { user: { id: 'alice' } }, error: null }); await tick(); expect(mockRpc).not.toHaveBeenCalled();
    act(() => { void retry().props.onPress(); }); await tick(); expect(rows()).toEqual([friend]);
    expect(confirm).not.toHaveBeenCalled();
  });
  it('does not cache late private rows after the picker closes', async () => {
    const pending = deferred(); mockRead.mockReturnValueOnce(pending.promise); await mount();
    act(() => tree!.unmount()); tree = undefined; pending.resolve(answer()); await tick();
    expect(client.getQueriesData({ queryKey: ['yours', 'grid', 'alice'] }).every(([, data]) => data === undefined)).toBe(true);
  });
});
