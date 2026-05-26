import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, LayoutChangeEvent, GestureResponderEvent } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

// Playback bubble for a voice message, on expo-audio. Position/duration/playing
// come from useAudioPlayerStatus (reactive, so the progress + time update
// fluidly), and seekTo gives tap-to-scrub on the waveform. Waveform bars are
// still a stylized pattern seeded from the URL; persisting the real recorded
// amplitude envelope is a follow-up (see useVoiceRecorder's StoppedRecording).

const BAR_COUNT = 28;
const BAR_WIDTH = 3;
const BAR_GAP = 2;
const BAR_MAX_HEIGHT = 24;
const BAR_MIN_RATIO = 0.25;
const BAR_RADIUS = 1.5;
const INACTIVE_BAR_OPACITY = 0.35;
const CONTROL_ICON_SIZE = 26;
const PLAYER_UPDATE_MS = 80; // status cadence; keeps the fill + timer smooth
const SPEEDS = [1, 1.5, 2] as const;

interface VoicePlayerProps {
  uri: string;
  durationSeconds: number;
  isOwn: boolean;
}

function seededBars(seed: string, count: number): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    bars.push(BAR_MIN_RATIO + ((h % 1000) / 1000) * (1 - BAR_MIN_RATIO));
  }
  return bars;
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

export default function VoicePlayer({ uri, durationSeconds, isOwn }: VoicePlayerProps) {
  const player = useAudioPlayer(uri, { updateInterval: PLAYER_UPDATE_MS });
  const playerStatus = useAudioPlayerStatus(player);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [waveWidth, setWaveWidth] = useState(0);

  const bars = useMemo(() => seededBars(uri, BAR_COUNT), [uri]);
  const tint = isOwn ? Colors.white : Colors.terracotta;

  const isPlaying = playerStatus.playing;
  const positionSec = playerStatus.currentTime ?? 0;
  // Fall back to the stored duration until the player reports its own (the
  // status duration is 0 until the asset finishes loading).
  const totalSec = playerStatus.duration && playerStatus.duration > 0 ? playerStatus.duration : durationSeconds;

  const progress = totalSec > 0 ? Math.min(1, positionSec / totalSec) : 0;
  const filledBars = Math.round(progress * BAR_COUNT);
  const atEnd = totalSec > 0 && positionSec >= totalSec - 0.05;
  const elapsedSeconds = isPlaying || (positionSec > 0 && !atEnd) ? positionSec : durationSeconds;

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      player.pause();
      return;
    }
    // Replay from the start once a clip has finished.
    if (atEnd) player.seekTo(0);
    player.play();
  }, [isPlaying, atEnd, player]);

  const cycleSpeed = useCallback(() => {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    player.setPlaybackRate(SPEEDS[next]);
  }, [speedIndex, player]);

  const onWaveLayout = useCallback((e: LayoutChangeEvent) => {
    setWaveWidth(e.nativeEvent.layout.width);
  }, []);

  // Tap anywhere on the waveform to scrub to that position.
  const onWaveSeek = useCallback(
    (e: GestureResponderEvent) => {
      if (waveWidth <= 0 || totalSec <= 0) return;
      const frac = Math.max(0, Math.min(1, e.nativeEvent.locationX / waveWidth));
      player.seekTo(frac * totalSec);
    },
    [waveWidth, totalSec, player],
  );

  return (
    <View style={styles.container}>
      <Pressable
        onPress={togglePlay}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? 'Pause voice message' : 'Play voice message'}
      >
        <Ionicons name={isPlaying ? 'pause' : 'play'} size={CONTROL_ICON_SIZE} color={tint} />
      </Pressable>

      <Pressable style={styles.waveform} onLayout={onWaveLayout} onPress={onWaveSeek}>
        {bars.map((ratio, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              {
                height: Math.max(BAR_RADIUS * 2, ratio * BAR_MAX_HEIGHT),
                backgroundColor: tint,
                opacity: i < filledBars ? 1 : INACTIVE_BAR_OPACITY,
              },
            ]}
          />
        ))}
      </Pressable>

      <View style={styles.meta}>
        <Text style={[styles.duration, { color: tint }]}>{formatTime(elapsedSeconds)}</Text>
        <Pressable onPress={cycleSpeed} hitSlop={8} accessibilityRole="button" accessibilityLabel="Change playback speed">
          <Text style={[styles.speed, { color: tint }]}>{SPEEDS[speedIndex]}x</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 200,
  },
  waveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: BAR_MAX_HEIGHT,
    gap: BAR_GAP,
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: BAR_RADIUS,
  },
  meta: {
    alignItems: 'flex-end',
    gap: 2,
  },
  duration: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
  },
  speed: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
  },
});
