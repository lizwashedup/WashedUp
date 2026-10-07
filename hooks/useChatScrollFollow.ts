import { useCallback, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

/** Manual gestures own the viewport, including before their first scroll event. */
export function useChatScrollFollow(initial = true) {
  const atBottomRef = useRef(initial);
  const gesture = useRef(false);
  const [followingLatest, updateFollowing] = useState(initial);
  const update = useCallback((value: boolean) => {
    atBottomRef.current = value;
    updateFollowing(value);
    return value;
  }, []);
  // Explicit Latest/send/entry resets may resume following immediately.
  const setFollowingLatest = useCallback((value: boolean) => {
    gesture.current = false;
    update(value);
  }, [update]);
  const begin = useCallback(() => { gesture.current = true; update(false); }, [update]);
  // A tolerance of two points handles native rounding without pulling someone
  // back from the first portion of an older bubble (formerly up to 80 points).
  const end = useCallback((event: ScrollEvent) => {
    gesture.current = false;
    return update(event.nativeEvent.contentOffset.y <= 2);
  }, [update]);
  const onScroll = useCallback((event: ScrollEvent) => (
    update(!gesture.current && event.nativeEvent.contentOffset.y <= 2)
  ), [update]);
  return { atBottomRef, followingLatest, setFollowingLatest, onScroll,
    onScrollBeginDrag: begin, onScrollEndDrag: end,
    onMomentumScrollBegin: begin, onMomentumScrollEnd: end };
}
