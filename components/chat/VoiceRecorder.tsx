import React, { memo, useEffect, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import VoicePlayer from './VoicePlayer';
import { CreatorActionFill } from '../creator/CreatorActionFill';

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
  sending?: boolean;
  retryAvailable?: boolean;
  appearance?: { fonts: AfterglowFontFamilies };
}

function formatTime(totalMillis: number): string {
  const s = Math.max(0, Math.floor(totalMillis / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

// Memoized so a parent re-render that didn't change `meterings` doesn't remap
// the 48 bars. Combined with the metering-emit throttle in useVoiceRecorder,
// this keeps the waveform off the Android render hot path.
const LiveWaveform = memo(function LiveWaveform({ meterings, tint }: { meterings: number[]; tint?: string }) {
  return (
    <View style={styles.waveform}>
      {meterings.map((ratio, i) => (
        <View
          key={i}
          style={[styles.waveBar, { height: Math.max(WAVE_MIN_HEIGHT, ratio * WAVE_MAX_HEIGHT), ...(tint ? { backgroundColor: tint } : {}) }]}
        />
      ))}
    </View>
  );
});

function RecordingDot({ tint }: { tint?: string }) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(DOT_MIN_OPACITY, { duration: DOT_PULSE_MS }), -1, true);
  }, [opacity]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.dot, tint && {backgroundColor:tint}, animatedStyle]} />;
}

function VoiceRecorder({
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
  sending = false,
  retryAvailable = false,
  appearance,
}: VoiceRecorderProps) {
  const theme = useMemo(() => appearance ? createAppearance(appearance.fonts) : null, [appearance?.fonts]);
  const tint = appearance ? AfterglowColors.clay : Colors.terracotta;
  const muted = appearance ? AfterglowColors.muted : Colors.warmGray;
  if (mode === 'draft' && draftUri) {
    return (
      <View style={[styles.bar, theme?.bar]}>
        <Pressable onPress={onTrash} disabled={sending} accessibilityState={{ disabled: sending }} hitSlop={8} style={theme?.control} accessibilityRole="button" accessibilityLabel="Discard voice message">
          <Ionicons name="trash-outline" size={CONTROL_ICON_SIZE} color={muted} />
        </Pressable>
        <View style={[styles.draftPlayer, theme?.draftPlayer]}>
          <VoicePlayer uri={draftUri} durationSeconds={draftDuration} isOwn={false} appearance={appearance} />
        </View>
        <Pressable
          onPress={onSend}
          disabled={sending}
          accessibilityState={{ disabled: sending, busy: sending }}
          style={[styles.sendCircle, theme?.send]}
          accessibilityRole="button"
          accessibilityLabel={sending ? 'Sending voice message' : retryAvailable ? 'Retry sending voice message' : 'Send voice message'}
        >
          {appearance && <CreatorActionFill />}
          {sending ? <ActivityIndicator size="small" color={Colors.white} /> : <Ionicons name="arrow-up" size={SEND_ICON_SIZE} color={Colors.white} />}
        </Pressable>
      </View>
    );
  }

  if (mode === 'locked') {
    return (
      <View style={[styles.bar, theme?.bar]}>
        <Pressable onPress={onTrash} disabled={sending} accessibilityState={{ disabled: sending }} hitSlop={8} style={theme?.control} accessibilityRole="button" accessibilityLabel="Discard recording">
          <Ionicons name="trash-outline" size={CONTROL_ICON_SIZE} color={muted} />
        </Pressable>
        <RecordingDot tint={tint} />
        <Text style={[styles.timer, theme?.timer]}>{formatTime(durationMillis)}</Text>
        <View style={styles.waveformWrap}>
          <LiveWaveform meterings={meterings} tint={tint} />
        </View>
        <Pressable onPress={onPauseResume} hitSlop={8} style={theme?.control} accessibilityRole="button" accessibilityLabel={isPaused ? 'Resume recording' : 'Pause recording'}>
          <Ionicons name={isPaused ? 'play' : 'pause'} size={CONTROL_ICON_SIZE} color={tint} />
        </Pressable>
        <Pressable onPress={onStop} hitSlop={8} style={theme?.control} accessibilityRole="button" accessibilityLabel="Stop and preview">
          <Ionicons name="stop-circle-outline" size={CONTROL_ICON_SIZE} color={tint} />
        </Pressable>
        <Pressable onPress={onSend} style={[styles.sendCircle, theme?.send]} accessibilityRole="button" accessibilityLabel="Send voice message">
          {appearance && <CreatorActionFill />}
          <Ionicons name="arrow-up" size={SEND_ICON_SIZE} color={Colors.white} />
        </Pressable>
      </View>
    );
  }

  // holding
  return (
    <View style={[styles.bar, theme?.bar]}>
      <RecordingDot tint={tint} />
      <Text style={[styles.timer, theme?.timer]}>{formatTime(durationMillis)}</Text>
      <View style={styles.waveformWrap}>
        <LiveWaveform meterings={meterings} tint={tint} />
      </View>
      <View style={styles.hints}>
        <Ionicons name="chevron-back" size={14} color={muted} />
        <Text style={[styles.hintText, theme?.hint]}>slide to cancel</Text>
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

const createAppearance = (fonts: AfterglowFontFamilies) => StyleSheet.create({
  bar: { gap: 4, paddingHorizontal: 8, backgroundColor: AfterglowColors.paper },
  control: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  send: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden', backgroundColor: AfterglowColors.clay },
  timer: { ...AfterglowType.section, fontFamily: fonts.medium, color: AfterglowColors.ink },
  hint: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted },
  draftPlayer: { minWidth: 0 },
});

// Memoized so unrelated screen re-renders (chat messages arriving, typing
// indicators, keyboard animation) don't recursively re-render the recording UI.
export default memo(VoiceRecorder);
