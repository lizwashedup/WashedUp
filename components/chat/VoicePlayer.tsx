import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { logError } from '../../lib/logger';

// Playback bubble for a voice message. Waveform bars are a stylized, stable
// pattern seeded from the audio URL (the recorded amplitude envelope is not
// persisted in Phase 1; see the metering-fallback note in the audit). The
// progress marker and elapsed time are real, driven by expo-av playback status.

const BAR_COUNT = 28;
const BAR_WIDTH = 3;
const BAR_GAP = 2;
const BAR_MAX_HEIGHT = 24;
const BAR_MIN_RATIO = 0.25;
const BAR_RADIUS = 1.5;
const INACTIVE_BAR_OPACITY = 0.35;
const CONTROL_ICON_SIZE = 26;
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
  const soundRef = useRef<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);

  const totalMillis = durationSeconds * 1000;
  const bars = useMemo(() => seededBars(uri, BAR_COUNT), [uri]);
  const tint = isOwn ? Colors.white : Colors.terracotta;

  const progress = totalMillis > 0 ? Math.min(1, positionMillis / totalMillis) : 0;
  const elapsedSeconds = isPlaying || positionMillis > 0 ? positionMillis / 1000 : durationSeconds;

  const onStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    setPositionMillis(status.positionMillis ?? 0);
    setIsPlaying(status.isPlaying);
    if (status.didJustFinish) {
      setIsPlaying(false);
      setPositionMillis(0);
      soundRef.current?.setPositionAsync(0).catch(() => {});
    }
  }, []);

  const togglePlay = useCallback(async () => {
    try {
      if (!soundRef.current) {
        const { sound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: true, rate: SPEEDS[speedIndex], shouldCorrectPitch: true },
          onStatus,
        );
        soundRef.current = sound;
        return;
      }
      if (isPlaying) {
        await soundRef.current.pauseAsync();
      } else {
        await soundRef.current.playAsync();
      }
    } catch (e) {
      logError(e, 'VoicePlayer.togglePlay');
    }
  }, [uri, speedIndex, isPlaying, onStatus]);

  const cycleSpeed = useCallback(async () => {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    try {
      await soundRef.current?.setRateAsync(SPEEDS[next], true);
    } catch (e) {
      logError(e, 'VoicePlayer.cycleSpeed');
    }
  }, [speedIndex]);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
    };
  }, []);

  const filledBars = Math.round(progress * BAR_COUNT);

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

      <View style={styles.waveform}>
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
      </View>

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
