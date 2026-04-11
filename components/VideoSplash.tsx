import React, { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
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
  const opacity = useSharedValue(1);

  const player = useVideoPlayer(VIDEO_SOURCE, (p: any) => {
    p.loop = false;
    p.muted = true;
    p.play();
  });

  const fadeAndFinish = useCallback(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    try { player?.pause?.(); } catch {}

    opacity.value = withTiming(0, { duration: FADE_MS }, (done) => {
      if (done) runOnJS(onFinish)();
    });
  }, [onFinish, opacity, player]);

  // Listen for the "playToEnd" event from the player — fires when the
  // video finishes naturally. Also listen for status errors.
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

    return () => {
      try { endSub?.remove?.(); } catch {}
      try { statusSub?.remove?.(); } catch {}
    };
  }, [player, fadeAndFinish]);

  // Safety timeout — never leave the user stuck
  useEffect(() => {
    const timer = setTimeout(fadeAndFinish, TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [fadeAndFinish]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.container, animatedStyle]}>
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
