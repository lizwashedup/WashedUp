import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';

// expo-av requires a native rebuild — guard against missing native module
let Video: any = null;
let ResizeMode: any = {};
try {
  const av = require('expo-av');
  Video = av.Video;
  ResizeMode = av.ResizeMode;
} catch {}

type AVPlaybackStatus = any;

interface Props {
  onFinish: () => void;
}

const FADE_MS = 300;
const TIMEOUT_MS = 6000; // Safety net: auto-dismiss if video never finishes

export default function VideoSplash({ onFinish }: Props) {
  // If expo-av native module isn't available, skip splash entirely
  useEffect(() => {
    if (!Video) onFinish();
  }, [onFinish]);

  const videoRef = useRef<any>(null);
  const calledRef = useRef(false);
  const opacity = useSharedValue(1);

  const fadeAndFinish = useCallback(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    // Stop video playback immediately
    videoRef.current?.stopAsync().catch(() => {});

    // Fade out, then tell parent to unmount us
    opacity.value = withTiming(0, { duration: FADE_MS }, (done) => {
      if (done) runOnJS(onFinish)();
    });
  }, [onFinish, opacity]);

  const handleStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    if (status.didJustFinish) fadeAndFinish();
  }, [fadeAndFinish]);

  const handleError = useCallback(() => {
    // Video failed to load — skip splash immediately
    fadeAndFinish();
  }, [fadeAndFinish]);

  // Safety timeout — never leave the user stuck
  useEffect(() => {
    const timer = setTimeout(fadeAndFinish, TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [fadeAndFinish]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  if (!Video) return null;

  return (
    <Animated.View style={[styles.container, animatedStyle]}>
      <Pressable style={styles.pressable} onPress={fadeAndFinish}>
        <Video
          ref={videoRef}
          source={require('../assets/splash-video.mp4')}
          style={styles.video}
          resizeMode={ResizeMode.COVER}
          shouldPlay
          isMuted
          isLooping={false}
          onPlaybackStatusUpdate={handleStatus}
          onError={handleError}
        />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    backgroundColor: '#1a8a8a',
  },
  pressable: {
    flex: 1,
  },
  video: {
    flex: 1,
  },
});
