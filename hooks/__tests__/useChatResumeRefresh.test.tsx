import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, create } from 'react-test-renderer';
import { useChatResumeRefresh } from '../useChatResumeRefresh';

let tree: ReturnType<typeof create> | undefined;
let listener: (state: AppStateStatus) => void;
let focused: { current: boolean }, current: boolean;
const refresh = jest.fn(), remove = jest.fn();
const isCurrent = () => current;
function Harness({ read = refresh }: { read?: typeof refresh }) { useChatResumeRefresh(read, isCurrent, focused); return null; }
function state(value: AppStateStatus) {
  Object.defineProperty(AppState, 'currentState', { configurable: true, value });
  listener(value);
}
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
beforeEach(() => {
  focused = { current: true }; current = true; refresh.mockReset().mockResolvedValue(undefined); remove.mockReset();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { listener = callback; return { remove }; });
  act(() => { tree = create(<Harness />); });
});
afterEach(() => { act(() => tree?.unmount()); tree = undefined; jest.restoreAllMocks(); });
it('refreshes once per actual return without duplicating mount or active signals', async () => {
  await flush(); expect(refresh).not.toHaveBeenCalled();
  for (let cycle = 0; cycle < 100; cycle++) {
    state('inactive'); state('background'); state('active'); state('active'); await flush();
    expect(refresh).toHaveBeenCalledTimes(cycle + 1);
    expect(refresh).toHaveBeenLastCalledWith(true);
  }
});
it.each(['blur', 'account'] as const)('does not refresh after %s retirement', async retirement => {
  state('background');
  if (retirement === 'blur') focused.current = false; else current = false;
  state('active'); await flush(); expect(refresh).not.toHaveBeenCalled();
});
it.each(['blur', 'account', 'background', 'unmount'] as const)('rechecks %s before the queued refresh dispatches', async retirement => {
  state('background'); state('active');
  if (retirement === 'blur') focused.current = false;
  if (retirement === 'account') current = false;
  if (retirement === 'background') state('background');
  if (retirement === 'unmount') act(() => { tree?.unmount(); tree = undefined; });
  await flush(); expect(refresh).not.toHaveBeenCalled();
});
it('handles a failed refresh and remains usable on the next return', async () => {
  refresh.mockRejectedValueOnce(Error('offline'));
  state('background'); state('active'); await flush();
  state('background'); state('active'); await flush();
  expect(refresh).toHaveBeenCalledTimes(2);
});
it('retires old listeners when the refresh owner changes', async () => {
  const old = listener, next = jest.fn().mockResolvedValue(undefined);
  act(() => tree!.update(<Harness read={next} />));
  old('background'); old('active'); await flush(); expect(refresh).not.toHaveBeenCalled();
  state('background'); state('active'); await flush(); expect(next).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
});
