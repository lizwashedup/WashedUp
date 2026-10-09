import React from 'react';
import { act, create } from 'react-test-renderer';
import { useChatScrollFollow } from '../useChatScrollFollow';
const event = (y: number) => ({ nativeEvent: { contentOffset: { y } } }) as any;
it('suspends following synchronously through drag and momentum, then resumes only at the edge', () => {
  let value!: ReturnType<typeof useChatScrollFollow>;
  function Harness() { value = useChatScrollFollow(); return null; }
  let tree!: ReturnType<typeof create>; act(() => { tree = create(<Harness />); });
  act(() => {
    value.onScrollBeginDrag(); expect(value.atBottomRef.current).toBe(false);
    value.onScroll(event(0)); expect(value.atBottomRef.current).toBe(false);
  });
  act(() => { value.onScrollEndDrag(event(12)); }); expect(value.followingLatest).toBe(false);
  act(() => { value.onMomentumScrollBegin(); value.onScroll(event(1)); }); expect(value.followingLatest).toBe(false);
  act(() => { value.onMomentumScrollEnd(event(10)); }); expect(value.followingLatest).toBe(false);
  act(() => { value.onScrollBeginDrag(); value.onScrollEndDrag(event(0)); }); expect(value.followingLatest).toBe(true);
  act(() => { value.onScrollBeginDrag(); value.setFollowingLatest(true); }); expect(value.atBottomRef.current).toBe(true);
  act(() => tree.unmount());
});
it('updates the ref before React commits and does not treat a partly visible older bubble as the live edge', () => {
  let value!: ReturnType<typeof useChatScrollFollow>;
  function Harness() { value = useChatScrollFollow(); return null; }
  let tree!: ReturnType<typeof create>; act(() => { tree = create(<Harness />); });
  act(() => { value.onScroll(event(10)); expect(value.atBottomRef.current).toBe(false); });
  act(() => { value.onScroll(event(0)); }); expect(value.followingLatest).toBe(true);
  act(() => tree.unmount());
});

it.each(['drag', 'momentum', 'wheel', 'latest', 'keyboard'] as const)('owns a delayed send position through %s events', action => {
  let value!: ReturnType<typeof useChatScrollFollow>;
  function Harness() { value = useChatScrollFollow(); return null; }
  let tree!: ReturnType<typeof create>; act(() => { tree = create(<Harness />); });
  const current = value.captureScrollIntent();
  act(() => {
    if (action === 'drag') { value.onScrollBeginDrag(); value.onScrollEndDrag(event(600)); }
    if (action === 'momentum') { value.onMomentumScrollBegin(); value.onMomentumScrollEnd(event(600)); }
    if (action === 'wheel') value.onScroll(event(600));
    if (action === 'latest') value.setFollowingLatest(true);
    if (action === 'keyboard') value.onScroll(event(0));
  });
  expect(current()).toBe(action === 'keyboard');
  const next = value.captureScrollIntent(); expect(next()).toBe(true);
  act(() => tree.unmount());
});
