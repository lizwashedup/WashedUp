import React from 'react';
import { AppState } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockLoad = jest.fn();
let mockScope: any, mockAccount: any;
jest.mock('../usePublicPageScope', () => ({ usePublicPageScope: () => ({ scope: mockScope, account: mockAccount }) }));
jest.mock('../../lib/eventMediaSource', () => ({ loadEventMediaSource: (...args: unknown[]) => mockLoad(...args) }));
import { useEventMediaSource } from '../useEventMediaSource';
let value: ReturnType<typeof useEventMediaSource>, tree: ReactTestRenderer, change: (state: string) => void;
function Harness({ path = 'private-path' }: { path?: string }) { value = useEventMediaSource('event', path, 'image'); return null; }
const source = { uri: 'private-one', headers: { Authorization: 'test' }, useCaching: false };
beforeEach(() => {
  jest.clearAllMocks(); AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener: any) => { change = listener; return { remove: jest.fn() }; });
  mockScope = { userId: 'a', isCurrent: () => true }; mockAccount = { error: null, retry: jest.fn() };
  mockLoad.mockResolvedValue(source);
});
afterEach(() => { act(() => tree?.unmount()); jest.restoreAllMocks(); });
it('loads only for the current foreground visit and resolves freshly after returning', async () => {
  await act(async () => { tree = create(<Harness />); }); expect(value.source).toBe(source);
  act(() => change('background')); expect(value.source).toBeUndefined();
  await act(async () => change('active')); expect(mockLoad).toHaveBeenCalledTimes(2); expect(value.source).toBe(source);
});
it('retires a background/return pair even when React batches both events', async () => {
  await act(async () => { tree = create(<Harness />); }); const oldCurrent = value.current;
  await act(async () => { change('inactive'); change('active'); });
  expect(oldCurrent()).toBe(false); expect(mockLoad).toHaveBeenCalledTimes(2);
});
it('does not display a late account response or late failure over the new source', async () => {
  let finish!: (x: any) => void; mockLoad.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { tree = create(<Harness />); });
  mockScope = { userId: 'b', isCurrent: () => true }; mockLoad.mockResolvedValue({ ...source, uri: 'private-two' });
  await act(async () => tree.update(<Harness />));
  await act(async () => finish(source)); expect(value.source?.uri).toBe('private-two');
});
it('retries failed transport with fresh authorization and retires the old decode callback', async () => {
  await act(async () => { tree = create(<Harness />); }); const oldCurrent = value.current;
  act(() => value.fail()); expect(value.error).toBe(true); expect(value.source).toBeUndefined(); expect(oldCurrent()).toBe(false);
  await act(async () => value.retry()); expect(mockLoad).toHaveBeenCalledTimes(2); expect(value.source).toBe(source);
});
it('surfaces permission/read errors without displaying previous media and supports explicit retry', async () => {
  await act(async () => { tree = create(<Harness />); }); mockLoad.mockRejectedValueOnce(Error('Access removed'));
  await act(async () => tree.update(<Harness path="other-private" />)); expect(value.error).toBe(true); expect(value.source).toBeUndefined();
  await act(async () => value.retry()); expect(value.source).toBe(source);
});
it('does not resolve while unfocused and discards responses after unmount', async () => {
  mockScope = { userId: 'a', isCurrent: () => false };
  await act(async () => { tree = create(<Harness />); }); expect(mockLoad).not.toHaveBeenCalled();
  let finish!: (x: any) => void; mockScope = { userId: 'a', isCurrent: () => true }; mockLoad.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => tree.update(<Harness />)); act(() => tree.unmount()); await act(async () => finish(source)); expect(value.source).toBeUndefined();
});
it('keeps account-check failures distinct and delegates their retry to the identity observer', async () => {
  mockAccount.error = Error('offline'); mockScope = null;
  await act(async () => { tree = create(<Harness />); }); expect(value.error).toBe(true); expect(mockLoad).not.toHaveBeenCalled();
  act(() => value.retry()); expect(mockAccount.retry).toHaveBeenCalledTimes(1);
});
