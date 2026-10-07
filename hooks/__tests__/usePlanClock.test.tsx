import React from 'react';
import { AppState } from 'react-native';
import { act, create } from 'react-test-renderer';
import { usePlanClock } from '../usePlanClock';
let tree: ReturnType<typeof create>;
const remove = jest.fn();
let listener: (state: any) => void;
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(Date.parse('2030-01-01T00:00:00Z')); jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => { listener = handler; return { remove }; }); remove.mockClear(); });
afterEach(() => { if (tree) act(() => tree.unmount()); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });
it('refreshes after background time elapses and removes its listener/timer on unmount', () => {
  let now = 0;
  function Harness() { now = usePlanClock([{ start_time: '2030-01-01T01:00:00Z' }]); return null; }
  act(() => { tree = create(<Harness />); });
  const before = now;
  jest.setSystemTime(Date.parse('2030-01-01T05:00:00Z'));
  act(() => listener('active'));
  expect(now - before).toBe(5 * 3600000);
  expect(jest.getTimerCount()).toBe(0);
  act(() => tree.unmount());
  expect(remove).toHaveBeenCalled();
});
it('replaces the old cutoff when the end time changes', () => {
  let renders = 0;
  function Harness({ end }: { end: string }) { usePlanClock([{ start_time: '2029-12-31T23:00:00Z', end_time: end }]); renders++; return null; }
  act(() => { tree = create(<Harness end="2030-01-01T00:00:01Z" />); });
  act(() => tree.update(<Harness end="2030-01-01T00:00:03Z" />));
  const previous = renders;
  act(() => jest.advanceTimersByTime(1000)); expect(renders).toBe(previous);
  act(() => jest.advanceTimersByTime(2000)); expect(renders).toBe(previous + 1);
});
it('does not spin on malformed dates or overflow a distant timer', () => {
  function Harness() { usePlanClock([{ start_time: 'bad' }, { start_time: '2040-01-01T00:00:00Z' }]); return null; }
  act(() => { tree = create(<Harness />); });
  expect(jest.getTimerCount()).toBe(1);
  act(() => jest.advanceTimersByTime(2147483647));
  expect(jest.getTimerCount()).toBe(1);
});
