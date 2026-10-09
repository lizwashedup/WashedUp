import React from 'react';
import { act, create } from 'react-test-renderer';
import { useChatReplyScroll } from '../useChatReplyScroll';
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
it.each(['drag', 'latest', 'room', 'unmount', 'deleted'] as const)('retires pending reply retries on %s', reason => {
  const list = { current: { scrollToIndex: jest.fn(), scrollToOffset: jest.fn() } };
  let index = 40;
  let value!: ReturnType<typeof useChatReplyScroll>;
  function Harness({ scope = 'a' }) { value = useChatReplyScroll(list as any, scope, () => index); return null; }
  let tree!: ReturnType<typeof create>; act(() => { tree = create(<Harness />); });
  act(() => { value.scrollToMessage('target'); value.onScrollToIndexFailed({ index: 40, averageItemLength: 60 }); });
  if (reason === 'drag' || reason === 'latest') act(() => value.cancel());
  if (reason === 'room') act(() => tree.update(<Harness scope="b" />));
  if (reason === 'unmount') act(() => tree.unmount());
  if (reason === 'deleted') index = -1;
  act(() => jest.advanceTimersByTime(1000));
  expect(list.current.scrollToIndex).toHaveBeenCalledTimes(1);
  const previousOffsets = list.current.scrollToOffset.mock.calls.length;
  act(() => value.onScrollToIndexFailed({ index: 40, averageItemLength: 60 }));
  expect(list.current.scrollToOffset).toHaveBeenCalledTimes(previousOffsets);
  if (reason !== 'unmount') act(() => tree.unmount());
  expect(jest.getTimerCount()).toBe(0);
});
it('bounds repeated measurement failures and resolves the identity again after arrivals', () => {
  const list = { current: { scrollToIndex: jest.fn(), scrollToOffset: jest.fn() } };
  let index = 40;
  let value!: ReturnType<typeof useChatReplyScroll>;
  function Harness() { value = useChatReplyScroll(list as any, 'a', () => index); return null; }
  let tree!: ReturnType<typeof create>; act(() => { tree = create(<Harness />); });
  act(() => { value.scrollToMessage('target'); value.onScrollToIndexFailed({ index: 40, averageItemLength: 60 }); });
  index = 42;
  act(() => jest.advanceTimersByTime(300));
  expect(list.current.scrollToIndex).toHaveBeenLastCalledWith({ index: 42, animated: false, viewPosition: 0.5 });
  for (let i=0; i<10; i++) act(() => { value.onScrollToIndexFailed({ index: 42, averageItemLength: 60 }); jest.advanceTimersByTime(300); });
  expect(list.current.scrollToIndex).toHaveBeenCalledTimes(4);
  expect(list.current.scrollToOffset).toHaveBeenCalledTimes(3);
  expect(jest.getTimerCount()).toBe(0);
  act(() => tree.unmount());
});
it('replaces an old target and coalesces duplicate native failures', () => {
  const list = { current: { scrollToIndex: jest.fn(), scrollToOffset: jest.fn() } };
  let value!: ReturnType<typeof useChatReplyScroll>;
  function Harness() { value = useChatReplyScroll(list as any, 'a', id => id === 'old' ? 40 : 70); return null; }
  let tree!: ReturnType<typeof create>; act(() => { tree = create(<Harness />); });
  act(() => {
    value.scrollToMessage('old'); value.onScrollToIndexFailed({ index: 40, averageItemLength: 60 });
    value.scrollToMessage('new'); value.onScrollToIndexFailed({ index: 70, averageItemLength: 60 });
    value.onScrollToIndexFailed({ index: 70, averageItemLength: 60 });
    jest.advanceTimersByTime(300);
  });
  expect(list.current.scrollToIndex.mock.calls.map(([arg]) => arg.index)).toEqual([40, 70, 70]);
  act(() => tree.unmount());
});
