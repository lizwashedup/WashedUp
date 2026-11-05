import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCreateCircle } from '../useCreateCircle';
import { useCreateCirclePlan } from '../useCreateCirclePlan';
import { useInviteToCircle } from '../useInviteToCircle';
import { useUpdateCircle } from '../useUpdateCircle';
import { useLeaveCircle } from '../useLeaveCircle';

const mockAuth = jest.fn(), mockRpc = jest.fn();
jest.mock('../../lib/supabase', () => ({ supabase: {
  auth: { getUser: () => mockAuth(), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  rpc: (...args: unknown[]) => mockRpc(...args),
} }));
jest.mock('../../lib/uploadPhoto', () => ({ uploadBase64ToStorage: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '22222222-2222-4222-8222-222222222222' }));
jest.mock('../../lib/chatListSignal', () => ({ markChatListDirty: jest.fn() }));

const ID = '11111111-1111-4111-8111-111111111111';
const account = () => ({ data: { user: { id: 'alice' } }, error: null });
const circleArgs = { name: 'Friends', description: null, memberUserIds: ['bob'], invitePolicy: 'only_me' as const, adminUserIds: [], coverBase64: null };
const modes = ['create', 'plan', 'invite', 'update', 'leave'] as const;
type Mode = typeof modes[number];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
let client: QueryClient, tree: ReactTestRenderer | undefined, submit: () => Promise<unknown>, pending: boolean;
let live: boolean;
const scope = { userId: 'alice', isCurrent: () => live };
function Probe({ mode }: { mode: Mode }) {
  const createCircle = useCreateCircle('alice');
  const plan = useCreateCirclePlan();
  const invite = useInviteToCircle(ID, 'alice', scope);
  const update = useUpdateCircle(ID, 'alice', scope);
  const leave = useLeaveCircle('alice', scope);
  const actions = {
    create: () => createCircle.mutateAsync(circleArgs, { scope }),
    plan: () => plan.mutateAsync({ circleId: ID, title: 'Walk', creatorMessage: 'Meet by the beach entrance.', startTime: '2040-09-15T23:00:00Z', visibility: 'circle_only', scope }),
    invite: () => invite.mutateAsync(['bob']),
    update: () => update.mutateAsync({ name: 'Friends again', description: null }),
    leave: () => leave.mutateAsync(ID),
  };
  submit = actions[mode]; pending = { create: createCircle, plan, invite, update, leave }[mode].isPending;
  return null;
}
async function tick(ms = 0) { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); }
async function mount(mode: Mode) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  act(() => { tree = create(<QueryClientProvider client={client}><Probe mode={mode}/></QueryClientProvider>); });
  await tick();
}
beforeEach(() => {
  jest.useFakeTimers(); live = true;
  mockAuth.mockReset().mockResolvedValue(account());
  mockRpc.mockReset().mockImplementation(async (name: string) => ({ data: name === 'create_circle' ? ID : name === 'create_circle_plan' ? { event_id: ID, has_own_chat: false } : name === 'invite_to_circle' ? 1 : name === 'leave_circle' ? 'left' : null, error: null, status: 200 }));
});
afterEach(() => { act(() => tree?.unmount()); tree = undefined; client?.clear(); jest.useRealTimers(); });

it.each(modes)('%s recovers a stalled account check without dispatching its late response', async mode => {
  const gate = deferred<ReturnType<typeof account>>(); mockAuth.mockReturnValueOnce(gate.promise); await mount(mode);
  let outcome: unknown = 'unsettled'; act(() => { void submit().then(value => { outcome = value; }, error => { outcome = error; }); });
  await tick(12001);
  expect(outcome).toBeInstanceOf(Error); expect(pending).toBe(false); expect(mockRpc).not.toHaveBeenCalled();
  await act(async () => { gate.resolve(account()); }); await tick(1); expect(mockRpc).not.toHaveBeenCalled();
  await act(async () => { await submit(); }); await tick(1);
  expect(mockRpc).toHaveBeenCalledTimes(1); expect(pending).toBe(false);
});

it.each(modes)('%s keeps a dispatched mutation pending beyond the account-read deadline', async mode => {
  const gate = deferred<{ data: unknown; error: null; status: number }>(); const result = await mockRpc(mode === 'create' ? 'create_circle' : mode === 'plan' ? 'create_circle_plan' : mode === 'invite' ? 'invite_to_circle' : mode === 'leave' ? 'leave_circle' : 'update_circle'); mockRpc.mockClear().mockReturnValueOnce(gate.promise);
  await mount(mode); let settled = false;
  act(() => { void submit().then(() => { settled = true; }, () => { settled = true; }); }); await tick(20000);
  expect(pending).toBe(true); expect(settled).toBe(false); expect(mockRpc).toHaveBeenCalledTimes(1);
  await act(async () => { gate.resolve(result); }); await tick(1); expect(settled).toBe(true);
});

it('keeps confirmed Circle creation when optional policy verification stalls and retries only setup', async () => {
  const gate = deferred<ReturnType<typeof account>>(); mockAuth.mockResolvedValueOnce(account()).mockReturnValueOnce(gate.promise);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: Infinity } } });
  let hook!: ReturnType<typeof useCreateCircle>;
  function Setup() { hook = useCreateCircle('alice'); return null; }
  act(() => { tree = create(<QueryClientProvider client={client}><Setup/></QueryClientProvider>); });
  let receipt: any; act(() => { void hook.mutateAsync({ ...circleArgs, invitePolicy: 'everyone' }, { scope }).then(value => { receipt = value; }); });
  await tick(12001);
  expect(receipt).toEqual({ circleId: ID, policyApplied: false, coverApplied: true });
  await act(async () => { gate.resolve(account()); }); await tick(1); expect(mockRpc).toHaveBeenCalledTimes(1);
  await act(async () => { receipt = await hook.retrySetupAsync(ID); });
  expect(receipt.policyApplied).toBe(true); expect(mockRpc.mock.calls.map(([name]) => name)).toEqual(['create_circle', 'update_circle']);
});
