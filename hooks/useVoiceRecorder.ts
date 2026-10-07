import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  useAudioRecorder,
  useAudioRecorderState,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  RecordingPresets,
} from 'expo-audio';
import { logError } from '../lib/logger';

// Voice recording engine on expo-audio (expo-av was deprecated and is removed in
// SDK 55). Records m4a/AAC via the HIGH_QUALITY preset (same container as before,
// so existing chat-audio clips stay playable) and samples metering so the UI can
// draw a live amplitude waveform. Each hook owns one recorder and serializes
// its native preparation and cleanup, so a newer attempt waits for the previous
// attempt to release that recorder.

export type RecorderStatus = 'idle' | 'recording' | 'paused';

const METERING_SAMPLE_CAP = 48; // most recent bars kept for the live waveform
const METERING_MIN_DB = -60; // map [-60dB, 0dB] -> [0, 1]
// Throttle React state emission of the rolling metering buffer. expo-audio
// pushes metering updates well above 30 Hz, and re-rendering the waveform
// on every tick floods the JS thread on Android (visible lag behind speech).
// 12 Hz is visually smooth and slashes React work ~5x; the ref still
// accumulates every sample so the stored envelope keeps its full resolution.
const METERING_EMIT_INTERVAL_MS = 80;

export interface StoppedRecording {
  uri: string;
  durationSeconds: number;
  // Normalized amplitude envelope captured during recording. Persisting this is
  // what lets the sent message render a real waveform instead of a seeded one.
  meterings: number[];
}

export interface VoiceRecorderScope {
  /** The initiating writable room/account visit; keep stable within a visit. */
  readonly isCurrent: () => boolean;
}

interface RecordingAttempt {
  visit: object;
  phase: 'starting' | 'recording' | 'paused' | 'stopping';
  cancelled: boolean;
  stopped: boolean;
}

function normalizeMetering(db: number): number {
  return Math.max(0, Math.min(1, (db - METERING_MIN_DB) / (0 - METERING_MIN_DB)));
}

export function useVoiceRecorder(scope?: VoiceRecorderScope) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recState = useAudioRecorderState(recorder);

  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [meterings, setMeterings] = useState<number[]>([]);
  const meteringsRef = useRef<number[]>([]);
  const lastEmitRef = useRef(0);
  const durationRef = useRef(0);
  const visit = useMemo(() => ({}), [scope, recorder]);
  const activeVisit = useRef<object | null>(null);
  const activeAttempt = useRef<RecordingAttempt | null>(null);
  const nativeOwner = useRef<RecordingAttempt | null>(null);
  const nativeQueue = useRef<Promise<void>>(Promise.resolve());
  const isCurrent = useCallback(() => activeVisit.current === visit && (!scope || scope.isCurrent()), [scope, visit]);
  const owns = useCallback((attempt: RecordingAttempt) => isCurrent() && activeAttempt.current === attempt &&
    attempt.visit === visit && !attempt.cancelled, [isCurrent, visit]);
  // Permission requests do not own the native recorder. All preparation,
  // stopping and audio-mode changes do, and therefore share this queue. A new
  // intent can wait here but cannot prepare until the old native work retires.
  const serialize = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const pending = nativeQueue.current.then(work, work);
    nativeQueue.current = pending.then(() => {}, () => {});
    return pending;
  }, []);

  // Accumulate metering into a rolling buffer while actively recording (paused
  // state still reports isRecording=false, so this naturally stops sampling).
  // The ref captures every sample (used by stop() for the persisted envelope);
  // setMeterings only fires at most every METERING_EMIT_INTERVAL_MS to keep
  // Android renders bounded — see the constant above.
  useEffect(() => {
    const attempt = activeAttempt.current;
    if (!attempt || !owns(attempt) || attempt.phase !== 'recording' || !recState.isRecording || typeof recState.metering !== 'number') return;
    const norm = normalizeMetering(recState.metering);
    const next = [...meteringsRef.current.slice(-(METERING_SAMPLE_CAP - 1)), norm];
    meteringsRef.current = next;
    const now = Date.now();
    if (now - lastEmitRef.current >= METERING_EMIT_INTERVAL_MS) {
      lastEmitRef.current = now;
      setMeterings(next);
    }
  }, [recState.metering, recState.isRecording, owns]);

  // Keep the latest duration in a ref so stop() reads a fresh value without
  // depending on the reactive state (avoids a stale closure).
  useEffect(() => {
    const attempt = activeAttempt.current;
    if (attempt && owns(attempt) && (attempt.phase === 'recording' || attempt.phase === 'paused')) {
      durationRef.current = recState.durationMillis ?? 0;
    }
  }, [recState.durationMillis, owns]);

  const reset = useCallback(() => {
    setStatus('idle');
    setMeterings([]);
    meteringsRef.current = [];
    lastEmitRef.current = 0;
    durationRef.current = 0;
  }, []);

  const releaseAudioMode = useCallback(async () => {
    try {
      await setAudioModeAsync({ allowsRecording: false });
    } catch {
      // best-effort; not fatal
    }
  }, []);

  const cleanup = useCallback(async (attempt: RecordingAttempt) => {
    if (nativeOwner.current !== attempt) return;
    if (!attempt.stopped) {
      // expo-audio may already have released its native object on unmount.
      // A failed/duplicate stop must not escape cleanup or target a later owner.
      attempt.stopped = true;
      try { await recorder.stop(); } catch { /* already stopped or released */ }
    }
    await releaseAudioMode();
    if (nativeOwner.current === attempt) nativeOwner.current = null;
  }, [recorder, releaseAudioMode]);

  const finishLocalAttempt = useCallback((attempt: RecordingAttempt) => {
    if (activeAttempt.current !== attempt) return;
    activeAttempt.current = null;
    if (activeVisit.current === attempt.visit && isCurrent()) reset();
  }, [isCurrent, reset]);

  useLayoutEffect(() => {
    activeVisit.current = visit;
    reset();
    return () => {
      if (activeVisit.current === visit) activeVisit.current = null;
      const attempt = activeAttempt.current;
      if (attempt?.visit === visit) {
        attempt.cancelled = true;
        activeAttempt.current = null;
        void serialize(() => cleanup(attempt));
      }
    };
  }, [visit, reset, serialize, cleanup]);

  const start = useCallback(async (): Promise<boolean> => {
    if (!isCurrent() || activeAttempt.current) return false;
    const attempt: RecordingAttempt = { visit, phase: 'starting', cancelled: false, stopped: false };
    activeAttempt.current = attempt;
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!owns(attempt)) return false;
      if (!perm.granted) { finishLocalAttempt(attempt); return false; }
    } catch (e) {
      if (owns(attempt)) { logError(e, 'useVoiceRecorder.start'); finishLocalAttempt(attempt); }
      return false;
    }
    return serialize(async () => {
      if (!owns(attempt)) return false;
      nativeOwner.current = attempt;
      try {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        if (!owns(attempt)) { await cleanup(attempt); return false; }
        meteringsRef.current = []; durationRef.current = 0; lastEmitRef.current = 0;
        setMeterings([]);
        await recorder.prepareToRecordAsync();
        if (!owns(attempt)) { await cleanup(attempt); return false; }
        recorder.record();
        attempt.phase = 'recording';
        setStatus('recording');
        return true;
      } catch (e) {
        if (owns(attempt)) logError(e, 'useVoiceRecorder.start');
        await cleanup(attempt);
        finishLocalAttempt(attempt);
        return false;
      }
    });
  }, [recorder, isCurrent, owns, visit, serialize, cleanup, finishLocalAttempt]);

  const pause = useCallback(() => {
    const attempt = activeAttempt.current;
    if (!attempt || !owns(attempt) || attempt.phase !== 'recording') return;
    try {
      recorder.pause();
      attempt.phase = 'paused';
      setStatus('paused');
    } catch (e) {
      logError(e, 'useVoiceRecorder.pause');
    }
  }, [recorder, owns]);

  const resume = useCallback(() => {
    const attempt = activeAttempt.current;
    if (!attempt || !owns(attempt) || attempt.phase !== 'paused') return;
    try {
      recorder.record();
      attempt.phase = 'recording';
      setStatus('recording');
    } catch (e) {
      logError(e, 'useVoiceRecorder.resume');
    }
  }, [recorder, owns]);

  const cancel = useCallback(async () => {
    const attempt = activeAttempt.current;
    if (!attempt || !owns(attempt)) return;
    // Retire before awaiting native stop/permission/preparation. A queued start
    // cannot revive this attempt, and cleanup cannot reset a newer UI intent.
    attempt.cancelled = true;
    finishLocalAttempt(attempt);
    await serialize(() => cleanup(attempt));
  }, [owns, finishLocalAttempt, serialize, cleanup]);

  const stop = useCallback(async (): Promise<StoppedRecording | null> => {
    const attempt = activeAttempt.current;
    if (!attempt || !owns(attempt) || attempt.phase === 'stopping') return null;
    if (attempt.phase === 'starting') {
      attempt.cancelled = true;
      finishLocalAttempt(attempt);
      await serialize(() => cleanup(attempt));
      return null;
    }
    attempt.phase = 'stopping';
    const capturedMeterings = meteringsRef.current.slice();
    const ms = durationRef.current;
    return serialize(async () => {
      let result: StoppedRecording | null = null;
      try {
        if (nativeOwner.current === attempt && !attempt.stopped) { attempt.stopped = true; await recorder.stop(); }
        if (nativeOwner.current === attempt && owns(attempt)) {
          const uri = recorder.uri;
          if (uri) result = { uri, durationSeconds: Math.max(1, Math.round(ms / 1000)), meterings: capturedMeterings };
        }
      } catch (e) {
        if (owns(attempt)) logError(e, 'useVoiceRecorder.stop');
      } finally {
        await cleanup(attempt);
      }
      const canDeliver = owns(attempt);
      finishLocalAttempt(attempt);
      return canDeliver ? result : null;
    });
  }, [recorder, owns, serialize, cleanup, finishLocalAttempt]);

  return {
    status,
    durationMillis: status === 'idle' ? 0 : recState.durationMillis ?? 0,
    meterings,
    start,
    pause,
    resume,
    cancel,
    stop,
  };
}
