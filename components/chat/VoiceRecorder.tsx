import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import VoicePlayer from './VoicePlayer';

// Recording UI that replaces the input bar while a voice message is being
// captured. Three modes:
//  - holding: finger held on the mic; shows timer, live waveform, and the
//    slide-to-cancel / slide-up-to-lock hints (the gesture itself lives on the
//    mic button in [id].tsx).
//  - locked: hands-free; trash / pause-resume / stop-to-preview / send.
//  - draft: recording stopped, previewed via VoicePlayer before sending.

const DOT_SIZE = 10;
const CONTROL_ICON_SIZE = 24;
const SEND_ICON_SIZE = 18;
const SEND_CIRCLE_SIZE = 36;
const WAVE_BAR_WIDTH = 3;
const WAVE_BAR_GAP = 2;
const WAVE_MAX_HEIGHT = 26;
const WAVE_MIN_HEIGHT = 3;
const DOT_PULSE_MS = 700;
const DOT_MIN_OPACITY = 0.3;

export type RecorderUiMode = 'holding' | 'locked' | 'draft';

interface VoiceRecorderProps {
  mode: RecorderUiMode;
  durationMillis: number;
  meterings: number[];
  isPaused: boolean;
  draftUri: string | null;
  draftDuration: number;
  onTrash: () => void;
  onPauseResume: () => void;
  onStop: () => void;
  onSend: () => void;
}

function formatTime(totalMillis: number): string {
  const s = Math.max(0, Math.floor(totalMillis / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

function LiveWaveform({ meterings }: { meterings: number[] }) {
  return (
    <View style={styles.waveform}>
      {meterings.map((ratio, i) => (
        <View
          key={i}
          style={[styles.waveBar, { height: Math.max(WAVE_MIN_HEIGHT, ratio * WAVE_MAX_HEIGHT) }]}
        />
      ))}
    </View>
  );
}

function RecordingDot() {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(DOT_MIN_OPACITY, { duration: DOT_PULSE_MS }), -1, true);
  }, [opacity]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.dot, animatedStyle]} />;
}

export default function VoiceRecorder({
  mode,
  durationMillis,
  meterings,
  isPaused,
  draftUri,
  draftDuration,
  onTrash,
  onPauseResume,
  onStop,
  onSend,
}: VoiceRecorderProps) {
  if (mode === 'draft' && draftUri) {
    return (
      <View style={styles.bar}>
        <Pressable onPress={onTrash} hitSlop={8} accessibilityRole="button" accessibilityLabel="Discard voice message">
          <Ionicons name="trash-outline" size={CONTROL_ICON_SIZE} color={Colors.warmGray} />
        </Pressable>
        <View style={styles.draftPlayer}>
          <VoicePlayer uri={draftUri} durationSeconds={draftDuration} isOwn={false} />
        </View>
        <Pressable
          onPress={onSend}
          style={styles.sendCircle}
          accessibilityRole="button"
          accessibilityLabel="Send voice message"
        >
          <Ionicons name="arrow-up" size={SEND_ICON_SIZE} color={Colors.white} />
        </Pressable>
      </View>
    );
  }

  if (mode === 'locked') {
    return (
      <View style={styles.bar}>
        <Pressable onPress={onTrash} hitSlop={8} accessibilityRole="button" accessibilityLabel="Discard recording">
          <Ionicons name="trash-outline" size={CONTROL_ICON_SIZE} color={Colors.warmGray} />
        </Pressable>
        <RecordingDot />
        <Text style={styles.timer}>{formatTime(durationMillis)}</Text>
        <View style={styles.waveformWrap}>
          <LiveWaveform meterings={meterings} />
        </View>
        <Pressable onPress={onPauseResume} hitSlop={8} accessibilityRole="button" accessibilityLabel={isPaused ? 'Resume recording' : 'Pause recording'}>
          <Ionicons name={isPaused ? 'play' : 'pause'} size={CONTROL_ICON_SIZE} color={Colors.terracotta} />
        </Pressable>
        <Pressable onPress={onStop} hitSlop={8} accessibilityRole="button" accessibilityLabel="Stop and preview">
          <Ionicons name="stop-circle-outline" size={CONTROL_ICON_SIZE} color={Colors.terracotta} />
        </Pressable>
        <Pressable onPress={onSend} style={styles.sendCircle} accessibilityRole="button" accessibilityLabel="Send voice message">
          <Ionicons name="arrow-up" size={SEND_ICON_SIZE} color={Colors.white} />
        </Pressable>
      </View>
    );
  }

  // holding
  return (
    <View style={styles.bar}>
      <RecordingDot />
      <Text style={styles.timer}>{formatTime(durationMillis)}</Text>
      <View style={styles.waveformWrap}>
        <LiveWaveform meterings={meterings} />
      </View>
      <View style={styles.hints}>
        <Ionicons name="chevron-back" size={14} color={Colors.warmGray} />
        <Text style={styles.hintText}>slide to cancel</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: Colors.terracotta,
  },
  timer: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
    minWidth: 40,
  },
  waveformWrap: {
    flex: 1,
    overflow: 'hidden',
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    height: WAVE_MAX_HEIGHT,
    gap: WAVE_BAR_GAP,
  },
  waveBar: {
    width: WAVE_BAR_WIDTH,
    borderRadius: WAVE_BAR_WIDTH / 2,
    backgroundColor: Colors.terracotta,
  },
  hints: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  hintText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
  },
  draftPlayer: {
    flex: 1,
  },
  sendCircle: {
    width: SEND_CIRCLE_SIZE,
    height: SEND_CIRCLE_SIZE,
    borderRadius: SEND_CIRCLE_SIZE / 2,
    backgroundColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
