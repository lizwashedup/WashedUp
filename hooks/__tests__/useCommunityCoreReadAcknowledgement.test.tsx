import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCommunityCoreReadAcknowledgement } from '../useCommunityCoreReadAcknowledgement';
import { getCommunityCoreReadState, markCommunityCoreRoomRead, type CommunityCoreReadState, type CommunityReadTargets } from '../../lib/communityRoomHistory';
jest.mock('../../lib/communityRoomHistory', () => ({ ...jest.requireActual('../../lib/communityRoomHistory'), getCommunityCoreReadState: jest.fn(), markCommunityCoreRoomRead: jest.fn() }));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
const mark = jest.mocked(markCommunityCoreRoomRead), read = jest.mocked(getCommunityCoreReadState);
const low = { id: '00000000-0000-4000-8000-000000000001', created_at: '2026-09-15T12:00:00.000001Z' };
const high = { id: '00000000-0000-4000-8000-000000000002', created_at: '2026-09-15T12:00:00.000002Z' };
const empty = { through_at: null, through_id: null, legacy_read_at: null };
const state = (targets: CommunityReadTargets = {}, role: 'main' | 'intros' = 'main'): CommunityCoreReadState => ({ communityId: 'page', role, unread: 0,
  broadcast: targets.broadcast ? { ...empty, through_at: targets.broadcast.created_at, through_id: targets.broadcast.id } : empty,
  topic: role === 'main' ? null : targets.topic ? { ...empty, through_at: targets.topic.created_at, through_id: targets.topic.id } : empty });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let tree: ReactTestRenderer, client: QueryClient, result: ReturnType<typeof useCommunityCoreReadAcknowledgement>, available: boolean, scope: { userId: string; isCurrent: () => boolean }, enabled: boolean, role: 'main' | 'intros';
function Harness() { result = useCommunityCoreReadAcknowledgement('page', role, scope, enabled); return null; }
const view = () => <QueryClientProvider client={client}><Harness /></QueryClientProvider>;
async function flush() { await act(async () => { await Promise.resolve(); }); }
async function mount() { await act(async () => { tree = create(view()); }); }
async function acknowledge(targets: CommunityReadTargets) { await act(async () => result.acknowledge(targets)); }
beforeEach(() => {
  jest.clearAllMocks(); available = true; enabled = true; role = 'main'; scope = { userId: 'alice', isCurrent: () => available };
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mark.mockImplementation(async (_id, targetRole, targets) => state(targets, targetRole)); read.mockResolvedValue(state());
});
afterEach(async () => { await act(async () => tree?.unmount()); client.clear(); });
it('mounting and re-rendering do not acknowledge anything', async () => { await mount(); await act(async () => tree.update(view())); expect(mark).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); });
it('does not dispatch for a disabled or inactive visit', async () => { enabled = false; await mount(); await acknowledge({ broadcast: high }); expect(mark).not.toHaveBeenCalled(); enabled = true; await act(async () => tree.update(view())); available = false; await acknowledge({ broadcast: high }); expect(mark).not.toHaveBeenCalled(); });
it('acknowledges visible source IDs once and skips already covered visibility', async () => { await mount(); await acknowledge({ broadcast: high }); await acknowledge({ broadcast: high }); await acknowledge({ broadcast: low }); expect(mark).toHaveBeenCalledTimes(1); expect(mark.mock.calls[0][2]).toEqual({ broadcast: high }); });
it('queues the newest microsecond position while an acknowledgement is pending', async () => {
  const first = deferred<CommunityCoreReadState>(); mark.mockReturnValueOnce(first.promise); await mount();
  await acknowledge({ broadcast: low }); await acknowledge({ broadcast: high }); await acknowledge({ broadcast: low }); expect(mark).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve(state({ broadcast: low }))); await flush();
  expect(mark.mock.calls.map(call => call[2])).toEqual([{ broadcast: low }, { broadcast: high }]);
});
it('does not retry an uncertain write when further messages become visible', async () => {
  mark.mockRejectedValueOnce(Error('Lost response')); await mount(); await acknowledge({ broadcast: low }); await acknowledge({ broadcast: high });
  expect(result.uncertain).toBe(true); expect(mark).toHaveBeenCalledTimes(1); expect(read).not.toHaveBeenCalled();
});
it('checks a lost successful acknowledgement without resending or draining queued writes', async () => {
  mark.mockRejectedValueOnce(Error('Lost response')); read.mockResolvedValue(state({ broadcast: low })); await mount(); await acknowledge({ broadcast: low }); await acknowledge({ broadcast: high });
  await act(async () => result.checkReadPosition()); expect(result.uncertain).toBe(false); expect(mark).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(1);
  await acknowledge({ broadcast: high }); expect(mark).toHaveBeenCalledTimes(2);
});
it('an uncommitted result needs an explicit retry after the read-only check', async () => {
  mark.mockRejectedValueOnce(Error('Disconnected')); await mount(); await acknowledge({ broadcast: high });
  await act(async () => result.checkReadPosition()); expect(result.retryReady).toBe(true); expect(mark).toHaveBeenCalledTimes(1);
  await act(async () => result.retryAcknowledgement()); expect(mark).toHaveBeenCalledTimes(2); expect(mark.mock.calls[1][2]).toEqual({ broadcast: high }); expect(result.uncertain).toBe(false);
});
it('a failed read-only check retains the uncertain target', async () => {
  mark.mockRejectedValueOnce(Error('Lost')); read.mockRejectedValueOnce(Error('Offline')); await mount(); await acknowledge({ broadcast: high });
  await act(async () => result.checkReadPosition()); expect(result.uncertain).toBe(true); expect(result.checking).toBe(false); expect(mark).toHaveBeenCalledTimes(1);
});
it('retired callbacks cannot dispatch or update a new account', async () => {
  const pending = deferred<CommunityCoreReadState>(); mark.mockReturnValueOnce(pending.promise); await mount(); const old = result;
  await acknowledge({ broadcast: low }); scope = { userId: 'bob', isCurrent: () => true }; await act(async () => tree.update(view()));
  await act(async () => { old.acknowledge({ broadcast: high }); pending.reject(Error('Lost old write')); });
  expect(result.uncertain).toBeFalsy(); expect(mark).toHaveBeenCalledTimes(1); await acknowledge({ broadcast: high }); expect(mark.mock.calls[1][3].userId).toBe('bob');
});
it('keeps both Intros source targets while coalescing queued visible messages', async () => {
  role = 'intros'; const first = deferred<CommunityCoreReadState>(); mark.mockReturnValueOnce(first.promise); await mount();
  await acknowledge({ broadcast: low }); await acknowledge({ topic: high }); await acknowledge({ broadcast: high });
  await act(async () => first.resolve(state({ broadcast: low }, 'intros'))); await flush(); expect(mark.mock.calls[1][2]).toEqual({ broadcast: high, topic: high });
});
it('retiring a visit while checking cannot change later read state', async () => {
  mark.mockRejectedValueOnce(Error('Lost')); const pending = deferred<CommunityCoreReadState>(); read.mockReturnValueOnce(pending.promise); await mount(); await acknowledge({ broadcast: high });
  let check!: Promise<void>; act(() => { check = result.checkReadPosition(); });
  scope = { userId: 'bob', isCurrent: () => true }; await act(async () => tree.update(view())); await act(async () => { pending.resolve(state()); await check; }); expect(result.uncertain).toBeFalsy(); expect(result.retryReady).toBeFalsy();
});

it('a visit paused during a write retains uncertainty and can check on return', async () => {
  const pending = deferred<CommunityCoreReadState>(); mark.mockReturnValueOnce(pending.promise); await mount(); await acknowledge({ broadcast: high }); available = false;
  await act(async () => pending.reject(Error('Lost while away'))); available = true;
  expect(result.uncertain).toBe(true); read.mockResolvedValue(state({ broadcast: high })); await act(async () => result.checkReadPosition()); expect(result.uncertain).toBe(false); expect(mark).toHaveBeenCalledTimes(1);
});
