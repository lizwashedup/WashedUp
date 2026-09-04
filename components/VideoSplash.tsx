import React, { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  cancelAnimation,
} from 'react-native-reanimated';

// expo-video is the supported replacement for expo-av. It works on both
// platforms under React Native's new architecture; expo-av's Video component
// silently fails to render on new-arch Android. Guard against missing native
// module so the app still boots if the dependency isn't available.
let useVideoPlayer: any = null;
let VideoView: any = null;
try {
  const ev = require('expo-video');
  useVideoPlayer = ev.useVideoPlayer;
  VideoView = ev.VideoView;
} catch {}

interface Props {
  onFinish: () => void;
}

const FADE_MS = 300;
const TIMEOUT_MS = 6000; // Safety net: auto-dismiss if video never finishes
const VIDEO_SOURCE = require('../assets/splash-video.mp4');

export default function VideoSplash({ onFinish }: Props) {
  // If expo-video native module isn't available, skip splash entirely.
  // Render the inner implementation only if we can; otherwise call onFinish.
  if (!useVideoPlayer || !VideoView) {
    return <VideoSplashUnavailable onFinish={onFinish} />;
  }
  return <VideoSplashImpl onFinish={onFinish} />;
}

function VideoSplashUnavailable({ onFinish }: Props) {
  useEffect(() => {
    onFinish();
  }, [onFinish]);
  return null;
}

function VideoSplashImpl({ onFinish }: Props) {
  const calledRef = useRef(false);
  const mountedRef = useRef(true);
  const opacity = useSharedValue(1);
  // Live player-event subscriptions. Held in a ref (not effect-local consts)
  // so fadeAndFinish can detach them proactively -- see its comment below.
  const subsRef = useRef<Array<{ remove?: () => void } | null | undefined>>([]);

  useEffect(() => {
    // Prevents a known Hermes crash: the fade's runOnJS callback firing
    // after unmount (component closed mid-animation).
    return () => {
      mountedRef.current = false;
      cancelAnimation(opacity);
    };
  }, [opacity]);

  const finishIfMounted = useCallback(() => {
    if (mountedRef.current) onFinish();
  }, [onFinish]);

  const player = useVideoPlayer(VIDEO_SOURCE, (p: any) => {
    p.loop = false;
    p.muted = true;
    // Mix with other audio: an expo-video player defaults to audioMixingMode
    // 'auto', which seizes the iOS AVAudioSession and STOPS the user's music
    // on cold open even while muted (muted only silences output). 'mixWithOthers'
    // leaves any music / podcast / call audio playing. Opening the app must not
    // interrupt background audio.
    p.audioMixingMode = 'mixWithOthers';
    p.play();
  });

  // try/catch-wrapped removal of whatever's currently in subsRef, then
  // clears it. Shared by fadeAndFinish (the normal path) and the listener
  // effect's own cleanup (the fallback path) below.
  const detachPlayerListeners = useCallback(() => {
    subsRef.current.forEach((s) => { try { s?.remove?.(); } catch {} });
    subsRef.current = [];
  }, []);

  const fadeAndFinish = useCallback(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    // Detach the player's event listeners HERE -- synchronously, before the
    // fade/unmount sequence starts -- rather than leaving it to the listener
    // effect's own unmount cleanup. useVideoPlayer() above is
    // expo-modules-core's useReleasingSharedObject, which registers ITS OWN
    // unmount effect at the useVideoPlayer(...) call site -- earlier in this
    // component's hook order than the listener effect below. React runs a
    // component's effect cleanups in declaration order (not reversed) on
    // unmount, so that internal effect releases the native player BEFORE the
    // listener effect's cleanup runs, meaning endSub/statusSub.remove() used
    // to be called on subscriptions tied to an already-released native
    // SharedObject. That is the exact shape of Sentry issue 7578055204
    // (FunctionCallException: Calling the 'get' function has failed ->
    // NativeSharedObjectNotFoundException), first seen 2026-06-26/28 and hit
    // again 2026-09-03 navigating into Community. Detaching the listeners
    // here, while the player is still guaranteed alive (fadeAndFinish always
    // runs before onFinish()/the state update that unmounts this component),
    // closes the race instead of trying to out-order it.
    detachPlayerListeners();

    try { player?.pause?.(); } catch {}

    opacity.value = withTiming(0, { duration: FADE_MS }, (done) => {
      if (done) runOnJS(finishIfMounted)();
    });
  }, [detachPlayerListeners, finishIfMounted, opacity, player]);

  // Listen for the "playToEnd" event from the player — fires when the
  // video finishes naturally. Also listen for status errors. The cleanup
  // here is a fallback only, for an unmount that happens without
  // fadeAndFinish ever having run: the normal path above already detaches
  // these via detachPlayerListeners, so subsRef is already empty by the
  // time this fires and the fallback is a no-op.
  useEffect(() => {
    if (!player) return;

    const endSub = player.addListener?.('playToEnd', () => {
      fadeAndFinish();
    });
    const statusSub = player.addListener?.('statusChange', (evt: any) => {
      if (evt?.status === 'error') {
        fadeAndFinish();
      }
    });
    subsRef.current = [endSub, statusSub];

    return detachPlayerListeners;
  }, [player, fadeAndFinish, detachPlayerListeners]);

  // Safety timeout — never leave the user stuck
  useEffect(() => {
    const timer = setTimeout(fadeAndFinish, TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [fadeAndFinish]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    // pointerEvents="none" prevents the outer overlay from absorbing touches
    // if the unmount chain (Reanimated done callback -> runOnJS(onFinish) ->
    // parent setShowVideoSplash(false)) stalls. With opacity at 0 and pointer
    // events disabled, the underlying Stack remains tappable instead of being
    // silently blocked by the still-mounted splash. Tap-to-skip is sacrificed:
    // playToEnd + statusChange listeners and the 6s safety timeout are
    // sufficient exits and removing user-driven dismiss eliminates the
    // touch-sink failure mode seen on iPhone SE 3rd gen (2026-05-20).
    <Animated.View style={[styles.container, animatedStyle]} pointerEvents="none">
      <Pressable style={styles.pressable} onPress={fadeAndFinish}>
        <VideoView
          player={player}
          style={styles.video}
          contentFit="cover"
          nativeControls={false}
          allowsFullscreen={false}
          allowsPictureInPicture={false}
        />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    // Cream to match the native splash + app background. If the video fails
    // to render for any reason, the user stays on a consistent on-brand
    // color instead of seeing the old teal flash.
    backgroundColor: '#FAF5EC',
  },
  pressable: {
    flex: 1,
  },
  video: {
    flex: 1,
  },
});
