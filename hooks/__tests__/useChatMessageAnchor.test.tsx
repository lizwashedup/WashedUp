import React from 'react';
import { act, create } from 'react-test-renderer';
import { useChatMessageAnchor, useChatAnchorScroll } from '../useChatMessageAnchor';
jest.mock('../../lib/communityChat', () => ({}));
jest.mock('../../lib/communityRoomHistory', () => ({}));
const id = '33333333-3333-4333-8333-000000000020';
const frames = new Map<number, () => void>();
let serial = 0;
const originalRequest = global.requestAnimationFrame, originalCancel = global.cancelAnimationFrame;
beforeEach(() => {
  frames.clear(); serial = 0;
  global.requestAnimationFrame = jest.fn(callback => { const n = ++serial; frames.set(n, () => callback(0)); return n; });
  global.cancelAnimationFrame = jest.fn(n => { frames.delete(n); });
});
afterEach(() => { global.requestAnimationFrame = originalRequest; global.cancelAnimationFrame = originalCancel; });
function flush() { act(() => { const queued = [...frames.values()]; frames.clear(); queued.forEach(fn => fn()); }); }
it('leaves route targets on Latest and accepts a new notification without changing the room', () => {
  let value!: ReturnType<typeof useChatMessageAnchor>;
  function Harness({ target }: { target: string }) { value = useChatMessageAnchor('room', target, 'topic'); return null; }
  let view!: ReturnType<typeof create>; act(() => { view = create(<Harness target={id} />); });
  expect(value.anchor?.id).toBe(id); act(() => value.clearAnchor()); expect(value.anchor).toBeNull();
  act(() => view.update(<Harness target={id.replace('020', '021')} />)); expect(value.anchor?.id).toBe(id.replace('020', '021'));
  act(() => view.unmount());
});
it('waits for target data, corrects the measured position once, and leaves later scrolling alone', () => {
  const list = { current: { scrollToIndex: jest.fn(), scrollToOffset: jest.fn() } };
  let value!: ReturnType<typeof useChatAnchorScroll>;
  function Harness({ index }: { index: number }) { value = useChatAnchorScroll(list as any, `topic:${id}`, index, list); return null; }
  let view!: ReturnType<typeof create>; act(() => { view = create(<Harness index={-1} />); }); flush(); expect(list.current.scrollToIndex).not.toHaveBeenCalled();
  act(() => view.update(<Harness index={20} />)); flush(); expect(list.current.scrollToIndex).toHaveBeenCalledWith({ index: 20, animated: false, viewPosition: 0.35 });
  act(() => value.onTargetLayout()); flush(); expect(list.current.scrollToIndex).toHaveBeenCalledTimes(2);
  act(() => { value.onTargetLayout(); value.schedule(); }); flush(); expect(list.current.scrollToIndex).toHaveBeenCalledTimes(2);
  act(() => view.unmount());
});
it('recovers from an unmeasured virtualized cell and cancels a retired jump', () => {
  const list = { current: { scrollToIndex: jest.fn(), scrollToOffset: jest.fn() } };
  let value!: ReturnType<typeof useChatAnchorScroll>;
  function Harness({ target }: { target: string | null }) { value = useChatAnchorScroll(list as any, target, 60, list); return null; }
  let view!: ReturnType<typeof create>; act(() => { view = create(<Harness target={`topic:${id}`} />); }); flush();
  act(() => value.onScrollToIndexFailed({ index: 60, averageItemLength: 64 })); expect(list.current.scrollToOffset).toHaveBeenCalledWith({ offset: 3840, animated: false });
  act(() => view.update(<Harness target={null} />)); flush(); expect(list.current.scrollToIndex).toHaveBeenCalledTimes(1);
  act(() => view.unmount()); expect(frames.size).toBe(0);
});
it('corrects early cell layout on the frame after the first estimated jump', () => {
  const list = { current: { scrollToIndex: jest.fn(), scrollToOffset: jest.fn() } };
  let value!: ReturnType<typeof useChatAnchorScroll>;
  function Harness() { value = useChatAnchorScroll(list as any, `topic:${id}`, 20, list); return null; }
  let view!: ReturnType<typeof create>; act(() => { view = create(<Harness />); });
  act(() => value.onTargetLayout()); flush(); expect(list.current.scrollToIndex).toHaveBeenCalledTimes(1);
  flush(); expect(list.current.scrollToIndex).toHaveBeenCalledTimes(2);
  act(() => view.unmount());
});

it('stops every correction when the reader takes over and after retry exhaustion', () => {
  const list = { current: { scrollToIndex: jest.fn(), scrollToOffset: jest.fn() } };
  let value!: ReturnType<typeof useChatAnchorScroll>;
  function Harness() { value = useChatAnchorScroll(list as any, `topic:${id}`, 60, list); return null; }
  let view!: ReturnType<typeof create>; act(() => { view = create(<Harness />); }); flush();
  for (let attempt = 0; attempt < 8; attempt++) {
    act(() => value.onScrollToIndexFailed({ index: 60, averageItemLength: 64 })); flush();
  }
  expect(list.current.scrollToIndex).toHaveBeenCalledTimes(5);
  expect(list.current.scrollToOffset.mock.calls.length).toBeLessThanOrEqual(4);
  act(() => view.unmount());
});
it('cancels pending and late measured jumps as soon as a manual drag starts', () => {
  const list = { current: { scrollToIndex: jest.fn(), scrollToOffset: jest.fn() } };
  let value!: ReturnType<typeof useChatAnchorScroll>;
  function Harness() { value = useChatAnchorScroll(list as any, `topic:${id}`, 60, list); return null; }
  let view!: ReturnType<typeof create>; act(() => { view = create(<Harness />); });
  act(() => (value as any).cancel?.()); flush();
  act(() => { value.onTargetLayout(); value.schedule(); value.onScrollToIndexFailed({ index: 60, averageItemLength: 64 }); }); flush();
  expect(list.current.scrollToIndex).not.toHaveBeenCalled();
  expect(list.current.scrollToOffset).not.toHaveBeenCalled();
  act(() => view.unmount());
});

it.each(['completed', 'cancelled'])('positions the same notification in a new chat visit after the old jump was %s', previous => {
  const list = { current: { scrollToIndex: jest.fn(), scrollToOffset: jest.fn() } };
  let value!: ReturnType<typeof useChatAnchorScroll>;
  function Harness({ visit, index }: { visit: number; index: number }) {
    value = useChatAnchorScroll(list as any, id, index, visit);
    return null;
  }
  let view!: ReturnType<typeof create>;
  act(() => { view = create(<Harness visit={1} index={22} />); });
  flush();
  act(() => value.onTargetLayout()); flush();
  if (previous === 'cancelled') act(() => value.cancel());
  const previousList = value;
  list.current.scrollToIndex.mockClear();
  act(() => view.update(<Harness visit={2} index={-1} />));
  flush();
  act(() => { previousList.onTargetLayout(); previousList.schedule(); });
  flush();
  expect(list.current.scrollToIndex).not.toHaveBeenCalled();
  act(() => view.update(<Harness visit={2} index={7} />));
  act(() => previousList.cancel()); // A retired list cannot cancel the new frame.
  flush();
  expect(list.current.scrollToIndex.mock.calls).toEqual([[{ index: 7, animated: false, viewPosition: 0.35 }]]);
  act(() => view.unmount());
});

it('schedules one retry when an already laid-out target still has unmeasured siblings', () => {
  let value!: ReturnType<typeof useChatAnchorScroll>;
  const list = { current: { scrollToIndex: jest.fn(), scrollToOffset: jest.fn() } };
  list.current.scrollToIndex.mockImplementationOnce(({ index }) => {
    // VirtualizedList reports this inline, before scrollToIndex returns.
    value.onScrollToIndexFailed({ index, averageItemLength: 44 });
  });
  function Harness() { value = useChatAnchorScroll(list as any, id, 29, list); return null; }
  let view!: ReturnType<typeof create>;
  act(() => { view = create(<Harness />); });
  act(() => value.onTargetLayout());
  flush();
  expect(frames.size).toBe(1);
  flush(); flush();
  expect(list.current.scrollToIndex).toHaveBeenCalledTimes(3);
  expect(frames.size).toBe(0);
  act(() => view.unmount());
});
