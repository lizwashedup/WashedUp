// Fake request deadlines, but keep React act() scheduling live between tests.
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TextInput } from 'react-native';
const mockWorkspace = jest.fn(), mockPending = jest.fn(), mockCheck = jest.fn(), mockPrepare = jest.fn(),
  mockSend = jest.fn(), mockResolve = jest.fn(), mockEdit = jest.fn(), mockHistory = jest.fn();
let mockLive = true;
let mockAccountError: Error | null = null;
const mockAccountRetry = jest.fn();
let mockScope = { userId: 'owner', isCurrent: () => mockLive };
const mockFonts = { regular: 'System', medium: 'System', semibold: 'System', display: 'System' };
jest.mock('../../../../hooks/useCreatorPageScope', () => ({ useCreatorPageScope: () => ({ scope: mockScope, account: { isLoading: false, error: mockAccountError, retry: mockAccountRetry } }) }));
jest.mock('../../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: mockFonts }) }));
jest.mock('../../../../lib/creatorPageWorkspace', () => ({ loadCreatorPageWorkspace: (...args: unknown[]) => mockWorkspace(...args) }));
jest.mock('../../../../lib/creatorPageUpdates', () => ({
  readPendingPageUpdate: (...a: unknown[]) => mockPending(...a), checkPageUpdate: (...a: unknown[]) => mockCheck(...a),
  preparePageUpdate: (...a: unknown[]) => mockPrepare(...a), sendPageUpdate: (...a: unknown[]) => mockSend(...a),
  resolvePageUpdate: (...a: unknown[]) => mockResolve(...a), editPreparedPageUpdate: (...a: unknown[]) => mockEdit(...a),
  readRecentPageUpdates: (...a: unknown[]) => mockHistory(...a),
}));
jest.mock('../../../ProfileButton', () => () => null);
jest.mock('expo-router', () => ({ router: { canGoBack: () => true, back: () => {} }, Stack: { Screen: () => null } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
import CreatorPageUpdatesScreen from '../CreatorPageUpdatesScreen';
import { PageAction } from '../PageFrame';
let tree: ReactTestRenderer, pending: any, confirmed: any;
const attempt = { id: 'attempt', pageId: 'page', userId: 'owner', body: 'A gathering soon', stage: 'prepared' };
const receipt = { id: 'attempt', page_id: 'page', sender_user_id: 'owner', body: 'A gathering soon', created_at: '2026-09-15T04:00:00Z', queued_recipient_count: 2 };
const action = (title: string) => tree.root.findAllByType(PageAction).find(node => node.props.title === title);
const text = () => JSON.stringify(tree.toJSON());
async function mount() { await act(async () => { tree = create(<CreatorPageUpdatesScreen pageId="page" />); }); }
async function press(title: string) { await act(async () => { action(title)!.props.onPress(); }); }
beforeEach(() => {
  jest.clearAllMocks(); mockAccountError = null; mockLive = true; mockScope = { userId: 'owner', isCurrent: () => mockLive }; pending = null; confirmed = null;
  mockWorkspace.mockResolvedValue({ publication: { name: 'Sunday Table', owner_id: 'owner', page_kind: 'organization' } });
  mockPending.mockImplementation(async () => pending); mockCheck.mockImplementation(async () => confirmed);
  mockPrepare.mockImplementation(async () => { pending = { ...attempt }; return pending; });
  mockSend.mockImplementation(async () => { confirmed = { ...receipt }; return confirmed; });
  mockResolve.mockImplementation(async () => { pending = null; return { receipt, cleared: true }; });
  mockEdit.mockImplementation(async () => { pending = null; return attempt.body; });
  mockHistory.mockResolvedValue([]);
});
afterEach(() => { act(() => tree?.unmount()); });
it('reviews without dispatch, then uses one explicit send despite rapid activation', async () => {
  await mount(); act(() => tree.root.findByType(TextInput).props.onChangeText(attempt.body));
  await press('Review update'); expect(mockPrepare).toHaveBeenCalledWith('page', attempt.body, expect.objectContaining({ userId: 'owner', isCurrent: expect.any(Function) }));
  expect(mockSend).not.toHaveBeenCalled(); expect(text()).toContain('Review your update');
  const tap = action('Send update')!.props.onPress;
  await act(async () => { tap(); tap(); }); expect(mockSend).toHaveBeenCalledTimes(1);
  expect(text()).toContain('Queued for 2 followers'); expect(action('Send update')).toBeUndefined();
});
it('restores an unsent review and allows editing only that prepared text', async () => {
  pending = { ...attempt }; await mount(); expect(mockSend).not.toHaveBeenCalled();
  await press('Edit update'); expect(mockEdit).toHaveBeenCalledWith(attempt, expect.objectContaining({ userId: 'owner', isCurrent: expect.any(Function) }));
  expect(tree.root.findByType(TextInput).props.value).toBe(attempt.body);
});
it('keeps an uncertain send locked until checking, then retries the exact saved update', async () => {
  pending = { ...attempt }; mockSend.mockImplementationOnce(async () => { pending = { ...attempt, stage: 'dispatched' }; throw new Error('Offline'); });
  await mount(); await press('Send update'); expect(action('Edit update')?.props.disabled).toBe(true);
  await press('Check update'); expect(mockSend).toHaveBeenCalledTimes(1); expect(action('Edit update')).toBeUndefined();
  await press('Retry update'); expect(mockSend.mock.calls[1][0]).toEqual({ ...attempt, stage: 'dispatched' });
  expect(text()).toContain('Update saved');
});
it('on returning to a committed unknown send, reads its receipt without dispatching and can start another update', async () => {
  pending = { ...attempt, stage: 'dispatched' }; confirmed = { ...receipt }; await mount();
  expect(text()).toContain('Update saved'); expect(mockSend).not.toHaveBeenCalled();
  await press('New update'); expect(mockResolve).toHaveBeenCalledTimes(1);
  expect(tree.root.findByType(TextInput).props.value).toBe(''); expect(action('Review update')).toBeDefined();
});
it('keeps the confirmed outcome visible if local cleanup fails', async () => {
  pending = { ...attempt, stage: 'dispatched' }; confirmed = { ...receipt };
  mockResolve.mockResolvedValue({ receipt, cleared: false }); await mount(); await press('New update');
  expect(text()).toContain('Update saved'); expect(text()).toContain('local recovery record');
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0); expect(mockSend).not.toHaveBeenCalled();
});
it('shows no delivery claim for a saved update with zero recipients', async () => {
  pending = { ...attempt }; confirmed = { ...receipt, queued_recipient_count: 0 }; await mount();
  expect(text()).toContain('No eligible followers were queued');
});
it('a history outage neither invents an empty history nor blocks recovery of the pending update', async () => {
  pending = { ...attempt, stage: 'dispatched' }; mockHistory.mockRejectedValue(new Error('Offline')); await mount();
  expect(text()).toContain('could not be refreshed'); expect(text()).not.toContain('Share something');
  expect(action('Retry update')!.props.disabled).toBe(false); expect(mockSend).not.toHaveBeenCalled();
});
it.each(['community', 'other-owner', 'unpublished'])('does not offer new organization sending for %s', async kind => {
  mockWorkspace.mockResolvedValue({ publication: kind === 'unpublished' ? null : { name: 'Page', owner_id: kind === 'other-owner' ? 'other' : 'owner', page_kind: kind === 'community' ? 'community' : 'organization' } });
  await mount(); expect(action('Review update')).toBeUndefined(); expect(mockSend).not.toHaveBeenCalled();
});
it('retiring the visit prevents late send feedback; a different account cannot see the old draft', async () => {
  pending = { ...attempt }; let finish!: (value: unknown) => void;
  mockSend.mockImplementation(() => new Promise(resolve => { finish = resolve; })); await mount();
  await act(async () => { action('Send update')!.props.onPress(); });
  mockLive = false; await act(async () => { finish(receipt); }); expect(text()).not.toContain('Update saved');
  pending = null; mockScope = { userId: 'other', isCurrent: () => true };
  await act(async () => { tree.update(<CreatorPageUpdatesScreen pageId="page" />); });
  expect(text()).not.toContain(attempt.body); expect(action('Review update')).toBeUndefined();
});

it('ends a stalled review wait without creating a second update', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  try {
    mockPrepare.mockImplementation(() => new Promise(() => {}));
    await mount(); act(() => tree.root.findByType(TextInput).props.onChangeText(attempt.body));
    await press('Review update');
    await act(async () => { jest.advanceTimersByTime(25000); });
    expect(text()).toContain('Check update');
    expect(action('Review update')!.props.disabled).toBe(true);
    await press('Check update');
    expect(text()).toContain('still finishing');
    expect(mockPrepare).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function advance(ms: number) { await act(async () => { jest.advanceTimersByTime(ms); }); }

it('recovers the original late prepared identity only after an explicit check', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  try {
    const write = deferred<any>(); mockPrepare.mockReturnValue(write.promise);
    await mount(); act(() => tree.root.findByType(TextInput).props.onChangeText(attempt.body));
    const oldEdit = tree.root.findByType(TextInput).props.onChangeText;
    await press('Review update'); await advance(25000);
    expect(mockPrepare.mock.calls[0][2].isCurrent()).toBe(false);
    act(() => oldEdit('Replaced while uncertain'));
    expect(tree.root.findByType(TextInput).props.value).toBe(attempt.body);
    pending = { ...attempt };
    await act(async () => write.resolve(pending));
    expect(text()).not.toContain('Review your update');
    await press('Check update'); expect(text()).toContain('Review your update');
    await press('Send update'); expect(mockSend.mock.calls[0][0].id).toBe(attempt.id);
    expect(mockPrepare).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});
it('retires a stalled send and checks its eventual receipt without sending again', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  try {
    const send = deferred<any>(); pending = { ...attempt };
    mockSend.mockImplementation(() => { pending = { ...attempt, stage: 'dispatched' }; return send.promise; });
    await mount(); const oldSend = action('Send update')!.props.onPress;
    await press('Send update'); await advance(25000);
    expect(mockSend.mock.calls[0][1].isCurrent()).toBe(false);
    await press('Check update'); act(() => oldSend());
    expect(mockSend).toHaveBeenCalledTimes(1); expect(text()).toContain('still finishing');
    confirmed = receipt; await act(async () => send.resolve(receipt));
    expect(text()).not.toContain('Update saved');
    await press('Check update'); expect(text()).toContain('Queued for 2 followers');
    expect(mockSend).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});
it('bounds checks and rejects an older check result after a newer check succeeds', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  try {
    pending = { ...attempt, stage: 'dispatched' }; await mount();
    const check = deferred<any>(); mockPending.mockReturnValueOnce(check.promise);
    const tap = action('Check update')!.props.onPress;
    const count = mockPending.mock.calls.length;
    await act(async () => { tap(); tap(); }); expect(mockPending).toHaveBeenCalledTimes(count + 1);
    await advance(12000); confirmed = receipt;
    const retry = deferred<any>(); mockPending.mockReturnValueOnce(retry.promise);
    await press('Check update'); expect(action('Checking…')!.props.disabled).toBe(true);
    await act(async () => retry.resolve(pending)); expect(text()).toContain('Update saved');
    await act(async () => check.resolve(null)); expect(text()).toContain('Update saved');
    expect(mockSend).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});
it('preserves prepared text when an edit cleanup finishes after timeout', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  try {
    pending = { ...attempt }; const remove = deferred<string>(); mockEdit.mockReturnValue(remove.promise);
    await mount(); await press('Edit update'); await advance(25000);
    expect(text()).toContain(attempt.body); expect(action('Send update')!.props.disabled).toBe(true);
    pending = null; await act(async () => remove.resolve(attempt.body)); await press('Check update');
    expect(tree.root.findByType(TextInput).props.value).toBe(attempt.body);
    expect(mockSend).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});
it('keeps a confirmed receipt through timed-out cleanup and permits a new draft only after checking', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  try {
    pending = { ...attempt, stage: 'dispatched' }; confirmed = receipt;
    const remove = deferred<any>(); mockResolve.mockReturnValue(remove.promise);
    await mount(); await press('New update'); await advance(25000);
    expect(text()).toContain('Queued for 2 followers');
    expect(text()).toContain('Your update is saved.');
    await press('Check update'); expect(action('New update')!.props.disabled).toBe(true);
    pending = null; await act(async () => remove.resolve({ receipt, cleared: true }));
    await press('Check update'); await press('New update');
    expect(tree.root.findByType(TextInput).props.value).toBe('');
    expect(mockResolve).toHaveBeenCalledTimes(1); expect(mockSend).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});
it.each(['page', 'account', 'focus', 'unmount'])('retires retained mutation and edit callbacks after %s change', async kind => {
  pending = { ...attempt }; const send = deferred<any>(); mockSend.mockReturnValue(send.promise);
  await mount(); const oldSend = action('Send update')!.props.onPress;
  const oldEdit = action('Edit update')!.props.onPress;
  await press('Send update'); const oldOperation = mockSend.mock.calls[0][1];
  pending = null;
  if (kind === 'unmount') act(() => tree.unmount());
  else if (kind === 'focus') mockLive = false;
  else {
    if (kind === 'account') mockScope = { userId: 'other', isCurrent: () => true };
    await act(async () => tree.update(<CreatorPageUpdatesScreen pageId={kind === 'page' ? 'other-page' : 'page'} />));
  }
  expect(oldOperation.isCurrent()).toBe(false);
  await act(async () => { oldSend(); oldEdit(); send.resolve(receipt); });
  expect(mockSend).toHaveBeenCalledTimes(1); expect(mockEdit).not.toHaveBeenCalled();
  if (kind !== 'unmount') expect(text()).not.toContain('Update saved');
});
it('an explicit successful check recovers an initial read error', async () => {
  mockPending.mockRejectedValueOnce(new Error('Offline'));
  await mount(); await press('Check update');
  act(() => tree.root.findByType(TextInput).props.onChangeText(attempt.body));
  expect(action('Review update')!.props.disabled).toBe(false);
});

it('keeps account recovery available without a scope but retires its previous page callback', async () => {
  mockScope = null as any; mockAccountError = new Error('Offline'); await mount();
  const retry = action('Check account')!.props.onPress;
  act(() => retry()); expect(mockAccountRetry).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(<CreatorPageUpdatesScreen pageId="other-page" />));
  act(() => retry()); expect(mockAccountRetry).toHaveBeenCalledTimes(1);
  await press('Check account'); expect(mockAccountRetry).toHaveBeenCalledTimes(2);
});
