import React from 'react';
import { act, create } from 'react-test-renderer';
import { usePostPlanInvitations } from '../usePostPlanInvitations';
import type { ObservedUser } from '../../../hooks/useObservedUser';

const mockSend = jest.fn();
jest.mock('../../../hooks/useInvitePeopleToPlan', () => ({ useInvitePeopleToPlan: () => ({ mutateAsync: mockSend }) }));
let revision = 1;
const viewer = (id: string | undefined = 'alice'): ObservedUser => {
  const epoch = revision;
  return { viewerId: id, epoch, error: null, isLoading: false, retry: jest.fn(), isCurrent: () => revision === epoch };
};
const cleanup: Array<() => void> = [];
function mount() {
  let api!: ReturnType<typeof usePostPlanInvitations>;
  let tree!: ReturnType<typeof create>;
  let unmounted = false;
  function Harness({ identity }: { identity: ObservedUser }) { api = usePostPlanInvitations(identity); return null; }
  act(() => { tree = create(<Harness identity={viewer()} />); });
  const unmount = () => { if (!unmounted) act(() => tree.unmount()); unmounted = true; };
  cleanup.push(unmount);
  return { get api() { return api; }, unmount, update: (id = 'alice') => act(() => tree.update(<Harness identity={viewer(id)} />)) };
}
function deferred() {
  let resolve!: (value: number) => void;
  const promise = new Promise<number>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => { jest.clearAllMocks(); revision = 1; mockSend.mockReset().mockResolvedValue(1); });
afterEach(() => cleanup.splice(0).forEach(close => close()));

it('waits for a saved plan and confirms only after the original batch RPC resolves', async () => {
  const fixture = mount(), pending = deferred();
  mockSend.mockReturnValue(pending.promise);
  let request!: ReturnType<typeof fixture.api.prepare>;
  act(() => { request = fixture.api.prepare(['bob', 'carol']); });
  expect(fixture.api.status).toBe('waiting');
  expect(mockSend).not.toHaveBeenCalled();
  let promise!: Promise<void>;
  act(() => { promise = fixture.api.send(request, 'saved-plan', 'alice'); });
  expect(fixture.api.status).toBe('sending');
  expect(mockSend).toHaveBeenCalledWith({ eventId: 'saved-plan', recipientIds: ['bob', 'carol'] });
  await act(async () => { pending.resolve(0); await promise; });
  expect(fixture.api.status).toBe('confirmed');
  expect(fixture.api.canRetry).toBe(false);
});

it('retains the frozen original batch and saved plan for an explicit retry, never automatically repeating', async () => {
  const fixture = mount();
  const input = ['bob', 'carol'];
  let request!: ReturnType<typeof fixture.api.prepare>;
  act(() => { request = fixture.api.prepare(input); });
  input.push('outsider');
  mockSend.mockRejectedValueOnce(new Error('unknown response'));
  await act(async () => { await fixture.api.send(request, 'saved-plan', 'alice'); });
  expect(fixture.api.status).toBe('unconfirmed');
  expect(fixture.api.canRetry).toBe(true);
  expect(mockSend).toHaveBeenCalledTimes(1);
  await act(async () => { await fixture.api.retry(); });
  expect(mockSend.mock.calls).toEqual([
    [{ eventId: 'saved-plan', recipientIds: ['bob', 'carol'] }],
    [{ eventId: 'saved-plan', recipientIds: ['bob', 'carol'] }],
  ]);
  expect(fixture.api.status).toBe('confirmed');
});

it('serializes rapid initial requests and rapid retries', async () => {
  const fixture = mount();
  let request!: ReturnType<typeof fixture.api.prepare>;
  act(() => { request = fixture.api.prepare(['bob']); });
  mockSend.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { await Promise.all([fixture.api.send(request, 'saved-plan', 'alice'), fixture.api.send(request, 'saved-plan', 'alice')]); });
  expect(mockSend).toHaveBeenCalledTimes(1);
  const pending = deferred();
  mockSend.mockReturnValue(pending.promise);
  let first!: Promise<void>, second!: Promise<void>;
  act(() => { first = fixture.api.retry(); second = fixture.api.retry(); });
  expect(fixture.api.canContinue()).toBe(false);
  expect(mockSend).toHaveBeenCalledTimes(2);
  await act(async () => { pending.resolve(1); await Promise.all([first, second]); });
  expect(fixture.api.canContinue()).toBe(true);
});

it('a new plan request cannot inherit a late result from the previous plan', async () => {
  const fixture = mount(), old = deferred();
  mockSend.mockReturnValueOnce(old.promise);
  let first!: ReturnType<typeof fixture.api.prepare>;
  act(() => { first = fixture.api.prepare(['bob']); });
  let oldSend!: Promise<void>;
  act(() => { oldSend = fixture.api.send(first, 'old-plan', 'alice'); });
  act(() => { fixture.api.prepare(['carol']); });
  await act(async () => { old.resolve(1); await oldSend; });
  expect(fixture.api.status).toBe('waiting');
  expect(fixture.api.canRetry).toBe(false);
});

it('rejects mismatched creator identity without sending', async () => {
  const fixture = mount();
  let request!: ReturnType<typeof fixture.api.prepare>;
  act(() => { request = fixture.api.prepare(['bob']); });
  await act(async () => { await fixture.api.send(request, 'saved-plan', 'another-account'); });
  expect(mockSend).not.toHaveBeenCalled();
  expect(fixture.api.status).toBe('unconfirmed');
  expect(fixture.api.canRetry).toBe(false);
});

it('cannot retry a request after A to B to A even when an old response arrives', async () => {
  const fixture = mount(), pending = deferred();
  mockSend.mockReturnValue(pending.promise);
  let request!: ReturnType<typeof fixture.api.prepare>;
  act(() => { request = fixture.api.prepare(['bob']); });
  let send!: Promise<void>;
  act(() => { send = fixture.api.send(request, 'saved-plan', 'alice'); });
  revision++;
  fixture.update('other');
  revision++;
  fixture.update('alice');
  await act(async () => { pending.resolve(1); await send; });
  expect(fixture.api.status).toBe('unconfirmed');
  expect(fixture.api.canRetry).toBe(false);
  await act(async () => { await fixture.api.retry(); });
  expect(mockSend).toHaveBeenCalledTimes(1);
});

it('resets invitation state independently of an old request outcome and ignores unmounted work', async () => {
  const fixture = mount(), pending = deferred();
  mockSend.mockReturnValue(pending.promise);
  let request!: ReturnType<typeof fixture.api.prepare>;
  act(() => { request = fixture.api.prepare(['bob']); });
  let send!: Promise<void>;
  act(() => { send = fixture.api.send(request, 'saved-plan', 'alice'); });
  act(() => fixture.api.reset());
  expect(fixture.api.status).toBe('none');
  fixture.unmount();
  await act(async () => { pending.resolve(1); await send; });
  expect(mockSend).toHaveBeenCalledTimes(1);
});

it('does not send an empty recipient list', async () => {
  const fixture = mount();
  let request!: ReturnType<typeof fixture.api.prepare>;
  act(() => { request = fixture.api.prepare([]); });
  await act(async () => { await fixture.api.send(request, 'saved-plan', 'alice'); });
  expect(fixture.api.status).toBe('none');
  expect(mockSend).not.toHaveBeenCalled();
});
