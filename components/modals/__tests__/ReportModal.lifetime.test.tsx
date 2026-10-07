import React from 'react';
import { act, create } from 'react-test-renderer';
import { Modal, Text, TouchableOpacity } from 'react-native';
import { ReportModal, type ReportModalProps } from '../ReportModal';
import { BrandedAlert } from '../../BrandedAlert';

const mockGetUser = jest.fn();
const mockInsert = jest.fn();
const mockUnsubscribe = jest.fn();
let mockAuthListener: ((_event: string, session: { user: { id: string } } | null) => void) | undefined;
jest.mock('../../../lib/supabase', () => ({ supabase: {
  auth: {
    getUser: (...args: unknown[]) => mockGetUser(...args),
    onAuthStateChange: (callback: typeof mockAuthListener) => {
      mockAuthListener = callback;
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
    },
  },
  from: (table: string) => {
    if (table !== 'reports') throw new Error('Unexpected table');
    return { insert: (...args: unknown[]) => mockInsert(...args) };
  },
} }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../BrandedAlert', () => ({ BrandedAlert: jest.fn(() => null) }));

type Props = ReportModalProps;
const Component = ReportModal;
const cleanup: Array<() => void> = [];
function deferred<T>() {
  let resolve!: (result: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const user = (id = 'alice') => ({ data: { user: { id } }, error: null });
function mount(extra: Partial<Props> = {}) {
  const onClose = jest.fn();
  let props: Props = { visible: true, onClose, reportedUserId: 'target-a', reportedUserName: 'A', eventId: 'plan-a', scope: { userId: 'alice', isCurrent: () => true }, ...extra };
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<Component {...props} />); });
  let closed = false;
  const unmount = () => { if (!closed) act(() => tree.unmount()); closed = true; };
  cleanup.push(unmount);
  const update = (next: Partial<Props>) => { props = { ...props, ...next }; act(() => tree.update(<Component {...props} />)); };
  const button = (text: string) => tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(label => label.props.children === text))!;
  return {
    tree, onClose, unmount, update,
    choose: (reason = 'Other') => act(() => button(reason).props.onPress()),
    submit: () => button('Submit Report').props.onPress as () => Promise<void>,
    submitDisabled: () => button('Submit Report').props.disabled,
    chooseCallback: (reason = 'Other') => button(reason).props.onPress as () => void,
    alert: () => tree.root.findByType(BrandedAlert).props,
    close: () => tree.root.findByType(Modal).props.onRequestClose(),
  };
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockAuthListener = undefined;
  mockGetUser.mockResolvedValue(user());
  mockInsert.mockResolvedValue({ error: null });
});
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); jest.clearAllTimers(); jest.restoreAllMocks(); jest.useRealTimers(); });

it('submits the original report schema once and shows success after its own close', async () => {
  const f = mount();
  f.choose('No-show to plan');
  await act(async () => { await f.submit()(); });
  expect(mockInsert).toHaveBeenCalledWith({ reporter_user_id: 'alice', reported_user_id: 'target-a', reason: 'No-show to plan', reported_event_id: 'plan-a', details: 'Reported from plan' });
  expect(f.onClose).toHaveBeenCalledTimes(1);
  f.update({ visible: false });
  act(() => jest.advanceTimersByTime(350));
  expect(f.alert()).toMatchObject({ visible: true, title: 'Report submitted' });
});

it('locks duplicate retained submit and Android back callbacks before rerender', async () => {
  const auth = deferred<ReturnType<typeof user>>(); mockGetUser.mockReturnValue(auth.promise);
  const f = mount(); f.choose();
  const submit = f.submit(); const close = f.close;
  let first!: Promise<void>; let second!: Promise<void>;
  act(() => { first = submit(); second = submit(); close(); });
  expect(mockGetUser).toHaveBeenCalledTimes(1);
  expect(f.onClose).not.toHaveBeenCalled();
  await act(async () => { auth.resolve(user()); await Promise.all([first, second]); });
  expect(mockInsert).toHaveBeenCalledTimes(1);
});

it('never adopts a replacement account returned by delayed auth', async () => {
  const auth = deferred<ReturnType<typeof user>>(); mockGetUser.mockReturnValue(auth.promise);
  const f = mount(); f.choose();
  let pending!: Promise<void>; act(() => { pending = f.submit()(); });
  await act(async () => { auth.resolve(user('bob')); await pending; });
  expect(mockInsert).not.toHaveBeenCalled();
  expect(f.onClose).not.toHaveBeenCalled();
});

it('retires an old target read through target A to B to A and preserves the new reason', async () => {
  const auth = deferred<ReturnType<typeof user>>(); mockGetUser.mockReturnValue(auth.promise);
  const f = mount(); f.choose();
  let pending!: Promise<void>; act(() => { pending = f.submit()(); });
  f.update({ reportedUserId: 'target-b' }); f.update({ reportedUserId: 'target-a' }); f.choose('Fake profile or spam');
  await act(async () => { auth.resolve(user()); await pending; });
  expect(mockInsert).not.toHaveBeenCalled();
  expect(f.submitDisabled()).toBe(false);
  expect(f.alert().visible).toBe(false);
});

it('does not carry a selected reason into a different room', () => {
  const f = mount(); f.choose(); f.update({ eventId: 'plan-b' });
  expect(f.submitDisabled()).toBe(true);
});

it('ignores a late insert failure after a new target opens', async () => {
  const write = deferred<{ error: Error | null }>(); mockInsert.mockReturnValue(write.promise);
  const f = mount(); f.choose();
  let pending!: Promise<void>; await act(async () => { pending = f.submit()(); await Promise.resolve(); });
  f.update({ reportedUserId: 'target-b' }); f.choose();
  await act(async () => { write.resolve({ error: new Error('uncertain') }); await pending; });
  expect(f.alert().visible).toBe(false);
  expect(f.submitDisabled()).toBe(false);
});

it('cancels the delayed success when the same target is reopened', async () => {
  const f = mount(); f.choose();
  await act(async () => { await f.submit()(); });
  f.update({ visible: false }); f.update({ visible: true }); f.choose();
  act(() => jest.advanceTimersByTime(350));
  expect(f.alert().visible).toBe(false);
  expect(f.submitDisabled()).toBe(false);
});

it('retires an in-flight write and its feedback after an account A to B to A event', async () => {
  const write = deferred<{ error: null }>(); mockInsert.mockReturnValue(write.promise);
  const f = mount(); f.choose();
  let pending!: Promise<void>; await act(async () => { pending = f.submit()(); await Promise.resolve(); });
  act(() => { mockAuthListener?.('SIGNED_IN', { user: { id: 'bob' } }); mockAuthListener?.('SIGNED_IN', { user: { id: 'alice' } }); });
  await act(async () => { write.resolve({ error: null }); await pending; });
  act(() => jest.advanceTimersByTime(350));
  expect(f.onClose).not.toHaveBeenCalled();
  expect(f.alert().visible).toBe(false);
  expect(f.submitDisabled()).toBe(true);
});

it('keeps legacy unscoped user-search submissions and error retry behavior', async () => {
  mockInsert.mockResolvedValueOnce({ error: new Error('offline') });
  const f = mount({ scope: undefined, eventId: undefined }); f.choose();
  await act(async () => { await f.submit()(); });
  expect(f.alert()).toMatchObject({ visible: true, title: 'Could not submit report' });
  expect(f.onClose).not.toHaveBeenCalled();
  await act(async () => { await f.submit()(); });
  expect(mockInsert).toHaveBeenLastCalledWith({ reporter_user_id: 'alice', reported_user_id: 'target-a', reason: 'Other', reported_event_id: null, details: 'Reported from user search' });
  expect(f.onClose).toHaveBeenCalledTimes(1);
});

it('allows dismissal with an explicitly unknown scope but no auth read or insert', async () => {
  const f = mount({ scope: null });
  f.choose();
  expect(f.submitDisabled()).toBe(true);
  await act(async () => { await f.submit()(); });
  act(() => f.close());
  expect(f.onClose).toHaveBeenCalledTimes(1);
  expect(mockGetUser).not.toHaveBeenCalled();
  expect(mockInsert).not.toHaveBeenCalled();
});

it('does not submit or retain a reason while hidden', async () => {
  const f = mount(); f.choose(); const oldSubmit = f.submit();
  f.update({ visible: false });
  await act(async () => { await oldSubmit(); });
  expect(mockGetUser).not.toHaveBeenCalled();
  f.update({ visible: true });
  expect(f.submitDisabled()).toBe(true);
});

it('retires retained reason, submit and close callbacks when a room changes', async () => {
  const f = mount(); f.choose();
  const choose = f.chooseCallback('Harassment or bullying'); const submit = f.submit();
  const close = f.tree.root.findByType(Modal).props.onRequestClose;
  f.update({ eventId: 'plan-b' });
  await act(async () => { choose(); close(); await submit(); });
  expect(f.submitDisabled()).toBe(true);
  expect(f.onClose).not.toHaveBeenCalled();
  expect(mockGetUser).not.toHaveBeenCalled();
});

it('synchronously retires a manually closed visit before its parent rerenders', async () => {
  const f = mount(); f.choose(); const submit = f.submit();
  await act(async () => { f.close(); await submit(); });
  expect(mockGetUser).not.toHaveBeenCalled();
  expect(f.onClose).toHaveBeenCalledTimes(1);
});

it('holds an already-retired scope and ignores a scope retired during auth', async () => {
  let current = false;
  const f = mount({ scope: { userId: 'alice', isCurrent: () => current } });
  f.choose(); await act(async () => { await f.submit()(); });
  expect(mockGetUser).not.toHaveBeenCalled();
  current = true; f.update({}); f.choose();
  const auth = deferred<ReturnType<typeof user>>(); mockGetUser.mockReturnValue(auth.promise);
  let pending!: Promise<void>; act(() => { pending = f.submit()(); });
  current = false;
  await act(async () => { auth.resolve(user()); await pending; });
  expect(mockInsert).not.toHaveBeenCalled();
  expect(f.alert().visible).toBe(false);
});

it('does not expose insert success or failure after scope retirement without a render', async () => {
  let current = true;
  const write = deferred<{ error: null }>(); mockInsert.mockReturnValue(write.promise);
  const f = mount({ scope: { userId: 'alice', isCurrent: () => current } }); f.choose();
  let pending!: Promise<void>; await act(async () => { pending = f.submit()(); await Promise.resolve(); });
  current = false;
  await act(async () => { write.resolve({ error: null }); await pending; });
  act(() => jest.advanceTimersByTime(350));
  expect(f.onClose).not.toHaveBeenCalled(); expect(f.alert().visible).toBe(false);
});

it('ignores an auth continuation after unmount and removes its auth listener', async () => {
  const auth = deferred<ReturnType<typeof user>>(); mockGetUser.mockReturnValue(auth.promise);
  const f = mount(); f.choose();
  let pending!: Promise<void>; act(() => { pending = f.submit()(); });
  f.unmount();
  await act(async () => { auth.resolve(user()); await pending; });
  expect(mockInsert).not.toHaveBeenCalled();
  expect(f.onClose).not.toHaveBeenCalled();
  expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
});

it('ignores an insert continuation after unmount', async () => {
  const write = deferred<{ error: null }>(); mockInsert.mockReturnValue(write.promise);
  const f = mount(); f.choose();
  let pending!: Promise<void>; await act(async () => { pending = f.submit()(); await Promise.resolve(); });
  f.unmount();
  const schedule = jest.spyOn(global, 'setTimeout');
  await act(async () => { write.resolve({ error: null }); await pending; });
  expect(f.onClose).not.toHaveBeenCalled();
  expect(schedule.mock.calls.filter(call => call[1] === 350)).toHaveLength(0);
});

it('clears the success timer when onClose synchronously unmounts the component', async () => {
  const f = mount(); f.choose(); f.onClose.mockImplementation(f.unmount);
  const schedule = jest.spyOn(global, 'setTimeout'); const cancel = jest.spyOn(global, 'clearTimeout');
  await act(async () => { await f.submit()(); });
  const successCall = schedule.mock.calls.findIndex(call => call[1] === 350);
  expect(successCall).toBeGreaterThanOrEqual(0);
  expect(cancel).toHaveBeenCalledWith(schedule.mock.results[successCall].value);
});

it('cancels delayed success after an account change while hidden', async () => {
  const f = mount(); f.choose(); await act(async () => { await f.submit()(); });
  f.update({ visible: false });
  act(() => mockAuthListener?.('SIGNED_OUT', null));
  act(() => jest.advanceTimersByTime(350));
  expect(f.alert().visible).toBe(false);
});

it('hides an already-visible success on a new target and ignores its retained dismissal', async () => {
  const f = mount(); f.choose(); await act(async () => { await f.submit()(); });
  f.update({ visible: false }); act(() => jest.advanceTimersByTime(350));
  const oldDismiss = f.alert().onClose;
  f.update({ visible: true, reportedUserId: 'target-b' });
  expect(f.alert().visible).toBe(false);
  f.choose(); mockInsert.mockResolvedValueOnce({ error: new Error('offline') });
  await act(async () => { await f.submit()(); });
  act(() => oldDismiss());
  expect(f.alert()).toMatchObject({ visible: true, title: 'Could not submit report' });
});

it('does not let a retired insert finalizer unlock a newer pending report', async () => {
  const first = deferred<{ error: null }>(); const second = deferred<{ error: null }>();
  mockInsert.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const f = mount(); f.choose();
  let old!: Promise<void>; await act(async () => { old = f.submit()(); await Promise.resolve(); });
  f.update({ reportedUserId: 'target-b' }); f.choose(); const submit = f.submit();
  let next!: Promise<void>; await act(async () => { next = submit(); await Promise.resolve(); });
  await act(async () => {
    first.resolve({ error: null });
    await old;
    // A retained duplicate callback while the new report is pending must be
    // ignored. Do not await it here: a correct implementation may return the
    // in-flight second promise, which is deliberately resolved below.
    void submit();
    await Promise.resolve();
  });
  expect(mockInsert).toHaveBeenCalledTimes(2);
  expect(f.onClose).not.toHaveBeenCalled();
  await act(async () => { second.resolve({ error: null }); await next; });
  expect(f.onClose).toHaveBeenCalledTimes(1);
});

it('does not retire a pending report for a same-account token refresh', async () => {
  const write = deferred<{ error: null }>(); mockInsert.mockReturnValue(write.promise);
  const f = mount({ scope: undefined }); f.choose();
  let pending!: Promise<void>; await act(async () => { pending = f.submit()(); await Promise.resolve(); });
  act(() => mockAuthListener?.('TOKEN_REFRESHED', { user: { id: 'alice' } }));
  await act(async () => { write.resolve({ error: null }); await pending; });
  expect(f.onClose).toHaveBeenCalledTimes(1);
});

it('allows a fresh report after signout then sign-in without reviving the old request', async () => {
  const auth = deferred<ReturnType<typeof user>>(); mockGetUser.mockReturnValueOnce(auth.promise);
  const f = mount(); f.choose();
  let pending!: Promise<void>; act(() => { pending = f.submit()(); });
  act(() => mockAuthListener?.('SIGNED_OUT', null));
  act(() => mockAuthListener?.('SIGNED_IN', { user: { id: 'alice' } }));
  f.choose('Made me feel unsafe');
  await act(async () => { await f.submit()(); auth.resolve(user()); await pending; });
  expect(mockInsert).toHaveBeenCalledTimes(1);
  expect(mockInsert.mock.calls[0][0].reason).toBe('Made me feel unsafe');
});

it('keeps missing identity and auth errors retryable without dispatching an insert', async () => {
  mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
  mockGetUser.mockResolvedValueOnce({ ...user(), error: new Error('identity unavailable') });
  const f = mount(); f.choose();
  await act(async () => { await f.submit()(); });
  expect(f.alert().visible).toBe(true);
  await act(async () => { await f.submit()(); });
  expect(mockInsert).not.toHaveBeenCalled();
  expect(f.submitDisabled()).toBe(false);
  await act(async () => { await f.submit()(); });
  expect(mockInsert).toHaveBeenCalledTimes(1);
});
