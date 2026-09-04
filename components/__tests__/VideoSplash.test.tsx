import React from 'react';
import { act, create } from 'react-test-renderer';
import VideoSplash from '../VideoSplash';

// withTiming's completion callback is what crashed Hermes in production
// (EXC_BAD_ACCESS) when it fired after the component had already unmounted.
// Everything the test needs lives inside the factory itself and is read
// back via jest.requireMock below -- referencing an externally-declared
// const from inside a jest.mock() factory is unsafe here: VideoSplash's
// top-level import resolves this mock before any of this file's own
// top-level consts have run.
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  let fadeCallback: ((finished: boolean) => void) | null = null;
  return {
    // Animated's default import resolves to this whole mock object under
    // this project's CJS interop, so View must sit at the top level (it
    // becomes Animated.View) rather than nested under a "default" key.
    View,
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    withTiming: (
      toValue: unknown,
      _config: unknown,
      callback?: (finished: boolean) => void,
    ) => {
      fadeCallback = callback ?? null;
      return toValue;
    },
    runOnJS:
      <T extends (...args: never[]) => unknown>(fn: T) =>
      (...args: Parameters<T>) =>
        fn(...args),
    cancelAnimation: jest.fn(),
    __fireFadeCallback: (finished: boolean) => fadeCallback?.(finished),
    __hasFadeCallback: () => fadeCallback !== null,
  };
});

// The JSX wrapper injected app-wide for style interop reads from this
// package; without its official mock, rendering ANY component crashes here,
// unrelated to the crash under test.
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock'),
);

jest.mock('expo-video', () => {
  let lastPlayer: any = null;
  return {
    useVideoPlayer: (_source: unknown, configure: (p: Record<string, unknown>) => void) => {
      const player = {
        play: jest.fn(),
        pause: jest.fn(),
        addListener: jest.fn(() => ({ remove: jest.fn() })),
      };
      configure(player);
      lastPlayer = player;
      return player;
    },
    VideoView: () => null,
    __getLastPlayer: () => lastPlayer,
  };
});

const reanimatedMock = jest.requireMock('react-native-reanimated') as {
  cancelAnimation: jest.Mock;
  __fireFadeCallback: (finished: boolean) => void;
  __hasFadeCallback: () => boolean;
};
const expoVideoMock = jest.requireMock('expo-video') as {
  __getLastPlayer: () => { addListener: jest.Mock } | null;
};

describe('VideoSplash: fade-completes-after-unmount crash guard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    reanimatedMock.cancelAnimation.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not call onFinish if the fade finishes after the component unmounted', () => {
    const onFinish = jest.fn();
    let instance: ReturnType<typeof create>;
    act(() => {
      instance = create(<VideoSplash onFinish={onFinish} />);
    });

    // The 6s safety timeout starts the fade, same as it would on a real device.
    act(() => {
      jest.advanceTimersByTime(6000);
    });
    expect(reanimatedMock.__hasFadeCallback()).toBe(true);

    act(() => {
      instance.unmount();
    });
    expect(reanimatedMock.cancelAnimation).toHaveBeenCalled();

    // The fade's completion callback fires late, after unmount -- the exact
    // race from the crash report.
    act(() => {
      reanimatedMock.__fireFadeCallback(true);
    });

    expect(onFinish).not.toHaveBeenCalled();
  });

  it('still calls onFinish normally when the fade completes while mounted', () => {
    const onFinish = jest.fn();
    act(() => {
      create(<VideoSplash onFinish={onFinish} />);
    });

    act(() => {
      jest.advanceTimersByTime(6000);
    });
    act(() => {
      reanimatedMock.__fireFadeCallback(true);
    });

    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  // Sentry issue 7578055204 (FunctionCallException: Calling the 'get'
  // function has failed -> NativeSharedObjectNotFoundException), first seen
  // 2026-06-26/28 and hit again 2026-09-03 navigating into Community. Root
  // cause: useVideoPlayer's internal release effect (expo-modules-core's
  // useReleasingSharedObject) is registered before this component's own
  // playToEnd/statusChange listener effect, so on unmount React released the
  // native player BEFORE the listener effect's cleanup called
  // endSub/statusSub.remove() on subscriptions tied to it. The fix detaches
  // the listeners proactively in fadeAndFinish, before the player can be
  // released -- this guards that they are gone well before unmount, not
  // merely that unmount itself is safe.
  it('detaches the player event listeners before unmount, not only in the unmount cleanup', () => {
    const onFinish = jest.fn();
    let instance: ReturnType<typeof create>;
    act(() => {
      instance = create(<VideoSplash onFinish={onFinish} />);
    });

    const player = expoVideoMock.__getLastPlayer();
    expect(player).not.toBeNull();
    // One addListener call each for 'playToEnd' and 'statusChange'.
    const subs = player!.addListener.mock.results.map((r) => r.value as { remove: jest.Mock });
    expect(subs).toHaveLength(2);
    subs.forEach((s) => expect(s.remove).not.toHaveBeenCalled());

    // The 6s safety timeout drives fadeAndFinish, same trigger as the fade
    // race test above. This is the moment the listeners must already be
    // gone -- well before the later unmount that used to release the player.
    act(() => {
      jest.advanceTimersByTime(6000);
    });
    subs.forEach((s) => expect(s.remove).toHaveBeenCalledTimes(1));

    // Unmounting afterward must not double-remove or throw: the listener
    // effect's own cleanup is now a no-op fallback (subsRef already empty).
    expect(() => act(() => { instance.unmount(); })).not.toThrow();
    subs.forEach((s) => expect(s.remove).toHaveBeenCalledTimes(1));
  });
});
