import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, ActivityIndicator, Platform, StyleSheet, LayoutChangeEvent, GestureResponderEvent } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { ChatSizedText } from './ChatSizedText';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import { Ionicons } from '@expo/vector-icons';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';

// Legacy bars are decorative, seeded from the URI, not recorded amplitude.
// The staged player uses a progress rail. Both use the actual playback clock.
const BAR_COUNT = 28;
const BAR_WIDTH = 3;
const BAR_GAP = 2;
const BAR_MAX_HEIGHT = 24;
const BAR_MIN_RATIO = 0.25;
const BAR_RADIUS = 1.5;
const INACTIVE_BAR_OPACITY = 0.35;
const CONTROL_ICON_SIZE = 26;
const PLAYER_UPDATE_MS = 80;
const LOAD_WAIT_MS = 15_000;
const OPERATION_WAIT_MS = 15_000;
const SEEK_STEP_SECONDS = 5;
const SPEEDS = [1, 1.5, 2] as const;

interface VoicePlayerProps {
  uri: string;
  durationSeconds: number;
  isOwn: boolean;
  appearance?: { fonts: AfterglowFontFamilies };
}

type PlaybackIssue = { kind: 'slow' | 'error'; message: string };

function seededBars(seed: string, count: number): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return Array.from({ length: count }, () => {
    h = (h * 1103515245 + 12345) >>> 0;
    return BAR_MIN_RATIO + ((h % 1000) / 1000) * (1 - BAR_MIN_RATIO);
  });
}

function seconds(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}
function formatTime(value: number): string {
  const total = Math.floor(seconds(value));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export default function VoicePlayer({ uri, durationSeconds, isOwn, appearance }: VoicePlayerProps) {
  const player = useAudioPlayer(uri, { updateInterval: PLAYER_UPDATE_MS });
  const playerStatus = useAudioPlayerStatus(player);
  const visit = useMemo(() => ({}), [uri, player]);
  const activeVisit = useRef<object | null>(null);
  const attemptRef = useRef<object | null>(null);
  const retryPendingRef = useRef(false);
  const retryStatusRef = useRef<typeof playerStatus | null>(null);
  const speedRef = useRef(0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [waveWidth, setWaveWidth] = useState(0);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<PlaybackIssue | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const isCurrent = useCallback(() => activeVisit.current === visit, [visit]);

  useLayoutEffect(() => {
    activeVisit.current = visit;
    attemptRef.current = null; retryPendingRef.current = false; retryStatusRef.current = null;
    speedRef.current = 0;
    setSpeedIndex(0); setWaveWidth(0); setBusy(false); setIssue(null);
    return () => { if (activeVisit.current === visit) activeVisit.current = null; };
  }, [visit]);

  // replace() is void. Wait for a fresh status event instead of treating the
  // pre-reload status object as confirmation that the new source is ready.
  const statusBelongsToPlayer = playerStatus.id === player.id;
  const awaitingReload = retryStatusRef.current === playerStatus;
  const loaded = statusBelongsToPlayer && playerStatus.isLoaded && !awaitingReload && (Platform.OS !== 'web' || player.isLoaded);
  const loading = !loaded || playerStatus.isBuffering;
  const nativeFailed = statusBelongsToPlayer && !awaitingReload && playerStatus.playbackState === 'failed';
  const failed = !!issue || nativeFailed;
  const isPlaying = statusBelongsToPlayer && playerStatus.playing && !awaitingReload;
  useEffect(() => {
    if (statusBelongsToPlayer && retryStatusRef.current && retryStatusRef.current !== playerStatus) {
      retryStatusRef.current = null; retryPendingRef.current = false;
    }
  }, [playerStatus, statusBelongsToPlayer]);
  useEffect(() => {
    if (!loading) {
      setIssue(previous => previous?.kind === 'slow' ? null : previous);
      return;
    }
    if (nativeFailed) return;
    const timer = setTimeout(() => {
      if (!isCurrent()) return;
      retryPendingRef.current = false;
      setIssue(previous => previous?.kind === 'error' ? previous : { kind: 'slow', message: 'Taking longer to load.' });
    }, LOAD_WAIT_MS);
    return () => clearTimeout(timer);
  }, [loading, nativeFailed, reloadVersion, isCurrent]);

  const totalSec = (statusBelongsToPlayer ? seconds(playerStatus.duration) : 0) || seconds(durationSeconds);
  const positionSec = statusBelongsToPlayer && totalSec > 0 ? Math.min(seconds(playerStatus.currentTime), totalSec) : 0;
  const progress = totalSec > 0 ? positionSec / totalSec : 0;
  const atEnd = playerStatus.didJustFinish || (totalSec > 0 && positionSec >= totalSec - 0.05);
  const elapsedSeconds = isPlaying || (positionSec > 0 && !atEnd) ? positionSec : totalSec;
  const bars = useMemo(() => seededBars(uri, BAR_COUNT), [uri]);
  // The legacy rail shares space with playback controls and scaled metadata.
  // Bound decorative bars to its measured width so they cannot cover either.
  const visibleBarCount = waveWidth > 0 ? Math.min(BAR_COUNT, Math.max(0, Math.floor((waveWidth + BAR_GAP) / (BAR_WIDTH + BAR_GAP)))) : BAR_COUNT;
  const filledBars = Math.round(progress * visibleBarCount);
  const tint = appearance ? (isOwn ? AfterglowColors.paper : AfterglowColors.ink) : (isOwn ? Colors.white : Colors.terracotta);
  const controlTint = appearance && !isOwn ? AfterglowColors.clay : tint;
  const durationStyle = appearance ? { ...AfterglowType.caption, fontFamily: appearance.fonts.medium } : undefined;
  const speedStyle = appearance ? { ...AfterglowType.caption, fontFamily: appearance.fonts.semibold } : undefined;

  const run = useCallback(async (operation: (canContinue: () => boolean) => void | Promise<void>, message: string) => {
    if (!isCurrent() || attemptRef.current) return false;
    const attempt = {}; attemptRef.current = attempt; setBusy(true);
    // A native seek can stall even after the asset loaded. Release the UI
    // for an explicit retry and prevent that old replay from later playing.
    const expiresAt = Date.now() + OPERATION_WAIT_MS;
    const ownsAttempt = () => isCurrent() && attemptRef.current === attempt;
    const canContinue = () => ownsAttempt() && Date.now() < expiresAt;
    try {
      await requestWithDeadline(Promise.resolve(operation(canContinue)), OPERATION_WAIT_MS);
      return canContinue();
    } catch {
      if (ownsAttempt()) setIssue({ kind: 'error', message });
      return false;
    } finally {
      if (attemptRef.current === attempt) {
        attemptRef.current = null;
        if (isCurrent()) setBusy(false);
      }
    }
  }, [isCurrent]);

  const retry = useCallback(async () => {
    if (!isCurrent() || retryPendingRef.current || attemptRef.current) return;
    retryPendingRef.current = true;
    retryStatusRef.current = playerStatus;
    setIssue(null); setReloadVersion(version => version + 1);
    const reloaded = await run(() => {
      player.pause(); // replace() can resume an already-playing source.
      player.replace(uri);
      player.setPlaybackRate(SPEEDS[speedRef.current]);
    }, 'Couldn’t reload this recording.');
    if (!reloaded && isCurrent()) {
      retryPendingRef.current = false; retryStatusRef.current = null;
      setReloadVersion(version => version + 1);
    }
  }, [isCurrent, playerStatus, run, player, uri]);

  const togglePlay = useCallback(async () => {
    if (!isCurrent() || attemptRef.current || retryPendingRef.current) return;
    if (failed) { await retry(); return; }
    if (loading && !isPlaying) return;
    await run(async canContinue => {
      if (isPlaying) { player.pause(); return; }
      if (atEnd) {
        await player.seekTo(0);
        if (!canContinue()) return;
      }
      player.play();
    }, 'Couldn’t play this recording.');
  }, [isCurrent, failed, retry, loading, isPlaying, atEnd, player, run]);

  const cycleSpeed = useCallback(async () => {
    if (!isCurrent() || loading || failed || retryPendingRef.current) return;
    await run(() => {
      const next = (speedRef.current + 1) % SPEEDS.length;
      player.setPlaybackRate(SPEEDS[next]);
      if (!isCurrent()) return;
      speedRef.current = next; setSpeedIndex(next);
    }, 'Couldn’t change playback speed.');
  }, [isCurrent, loading, failed, run, player]);

  const seek = useCallback(async (target: number) => {
    if (!isCurrent() || loading || failed || retryPendingRef.current || totalSec <= 0 || !Number.isFinite(target)) return;
    await run(() => player.seekTo(Math.max(0, Math.min(totalSec, target))), 'Couldn’t move playback.');
  }, [isCurrent, loading, failed, totalSec, run, player]);
  const onWaveLayout = useCallback((event: LayoutChangeEvent) => { if (isCurrent()) setWaveWidth(event.nativeEvent.layout.width); }, [isCurrent]);
  const onWaveSeek = useCallback((event: GestureResponderEvent) => {
    if (waveWidth > 0) void seek((event.nativeEvent.locationX / waveWidth) * totalSec);
  }, [waveWidth, seek, totalSec]);
  // RN-web does not map native adjustable actions to keyboard behavior.
  const webSeekProps = Platform.OS === 'web' ? {
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || busy || loading || failed) return;
      let target: number;
      switch (event.key) {
        case 'ArrowLeft': case 'ArrowDown': target = positionSec - SEEK_STEP_SECONDS; break;
        case 'ArrowRight': case 'ArrowUp': target = positionSec + SEEK_STEP_SECONDS; break;
        case 'Home': target = 0; break;
        case 'End': target = totalSec; break;
        default: return;
      }
      event.preventDefault();
      void seek(target);
    },
  } : {};

  const playDisabled = busy || (loading && !isPlaying && !failed);
  const playLabel = failed ? 'Retry voice message' : busy ? 'Preparing voice message' : loading && !isPlaying ? 'Loading voice message' : isPlaying ? 'Pause voice message' : 'Play voice message';
  const statusText = issue?.message ?? (nativeFailed ? 'Couldn’t load this recording.' : loading ? 'Loading voice message…' : null);
  const speedControl = (
    <Pressable onPress={cycleSpeed} disabled={busy || loading || failed} style={appearance && styles.control}
      hitSlop={appearance ? undefined : 8} accessibilityRole="button" accessibilityLabel="Change playback speed"
      accessibilityValue={{ text: `${SPEEDS[speedIndex]} times` }} accessibilityState={{ disabled: busy || loading || failed }}>
      <ChatSizedText style={[styles.speed, speedStyle, { color: tint }]}>{`${SPEEDS[speedIndex]}x`}</ChatSizedText>
    </Pressable>
  );

  return (
    <View style={[styles.container, appearance && styles.stagedContainer]}>
      <View style={[styles.row, appearance && styles.stagedRow]}>
        <Pressable onPress={togglePlay} disabled={playDisabled} style={appearance && styles.control}
          hitSlop={appearance ? undefined : 8} accessibilityRole="button" accessibilityLabel={playLabel}
          accessibilityState={{ disabled: playDisabled, busy: busy || (loading && !failed) }}>
          {!failed && (busy || (loading && !isPlaying)) ? <ActivityIndicator size="small" color={controlTint} /> : <Ionicons name={failed ? 'refresh' : isPlaying ? 'pause' : 'play'} size={CONTROL_ICON_SIZE} color={controlTint} />}
          {failed && <ChatSizedText style={[styles.speed, speedStyle, { color: tint }]}>Retry</ChatSizedText>}
        </Pressable>
        <Pressable style={[styles.waveform, appearance ? styles.seekTarget : styles.legacyWaveform]} onLayout={onWaveLayout} onPress={onWaveSeek}
          {...webSeekProps}
          disabled={busy || loading || failed} accessibilityRole="adjustable" accessibilityLabel="Voice message position"
          accessibilityHint="Swipe up or down to move five seconds."
          accessibilityValue={{ min: 0, max: Math.round(totalSec), now: Math.round(positionSec), text: `${formatTime(positionSec)} of ${formatTime(totalSec)}` }}
          aria-valuemin={0} aria-valuemax={Math.round(totalSec)} aria-valuenow={Math.round(positionSec)}
          aria-valuetext={`${formatTime(positionSec)} of ${formatTime(totalSec)}`}
          accessibilityState={{ disabled: busy || loading || failed }}
          accessibilityActions={[{ name: 'increment', label: 'Forward five seconds' }, { name: 'decrement', label: 'Back five seconds' }]}
          onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'increment') void seek(positionSec + SEEK_STEP_SECONDS); else if (event.nativeEvent.actionName === 'decrement') void seek(positionSec - SEEK_STEP_SECONDS); }}>
          {appearance ? <View style={styles.rail} accessible={false}>
            <View style={[styles.track, { backgroundColor: tint, opacity: INACTIVE_BAR_OPACITY }]} />
            <View style={[styles.track, { backgroundColor: tint, width: `${progress * 100}%` }]} />
            <View style={[styles.thumb, { backgroundColor: tint, left: `${progress * 100}%` }]} />
          </View> : bars.slice(0, visibleBarCount).map((ratio, index) => <View key={index} accessible={false} style={[styles.bar, { height: Math.max(BAR_RADIUS * 2, ratio * BAR_MAX_HEIGHT), backgroundColor: tint, opacity: index < filledBars ? 1 : INACTIVE_BAR_OPACITY }]} />)}
        </Pressable>
        {appearance ? speedControl : <View style={styles.meta}><ChatSizedText style={[styles.duration, { color: tint }]}>{formatTime(elapsedSeconds)}</ChatSizedText>{speedControl}</View>}
      </View>
      {appearance && <ChatSizedText style={[styles.stagedDuration, durationStyle, { color: tint }]}>{`${formatTime(positionSec)} / ${formatTime(totalSec)}`}</ChatSizedText>}
      {statusText && <ChatSizedText accessibilityLiveRegion="polite" style={[styles.status, durationStyle, { color: tint }]}>{statusText}</ChatSizedText>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { minWidth: 200, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stagedContainer: { minWidth: 0, width: 220, maxWidth: '100%' },
  stagedRow: { gap: 6 },
  control: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  waveform: { flex: 1, flexDirection: 'row', alignItems: 'center', height: BAR_MAX_HEIGHT, gap: BAR_GAP },
  legacyWaveform: { overflow: 'hidden', minWidth: 0 },
  seekTarget: { minWidth: 0, minHeight: 44, height: undefined, paddingHorizontal: 4 },
  bar: { width: BAR_WIDTH, borderRadius: BAR_RADIUS },
  rail: { height: 8, width: '100%', justifyContent: 'center' },
  track: { position: 'absolute', height: 3, width: '100%', borderRadius: BAR_RADIUS },
  thumb: { position: 'absolute', width: 8, height: 8, borderRadius: 4, transform: [{ translateX: -4 }] },
  meta: { alignItems: 'flex-end', gap: 2 },
  duration: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption },
  speed: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption },
  stagedDuration: { alignSelf: 'flex-end' },
  status: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, flexShrink: 1 },
});
