import { useCallback, useEffect, useRef, useState } from 'react';
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
// draw a live amplitude waveform. The single hook-owned recorder instance makes
// the old "Only one Recording object can be prepared" class of bug structurally
// impossible — there is exactly one recorder for the component's lifetime.

export type RecorderStatus = 'idle' | 'recording' | 'paused';

const METERING_SAMPLE_CAP = 48; // most recent bars kept for the live waveform
const METERING_MIN_DB = -60; // map [-60dB, 0dB] -> [0, 1]

export interface StoppedRecording {
  uri: string;
  durationSeconds: number;
  // Normalized amplitude envelope captured during recording. Persisting this is
  // what lets the sent message render a real waveform instead of a seeded one.
  meterings: number[];
}

function normalizeMetering(db: number): number {
  return Math.max(0, Math.min(1, (db - METERING_MIN_DB) / (0 - METERING_MIN_DB)));
}

export function useVoiceRecorder() {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recState = useAudioRecorderState(recorder);

  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [meterings, setMeterings] = useState<number[]>([]);
  const meteringsRef = useRef<number[]>([]);
  const durationRef = useRef(0);

  // Accumulate metering into a rolling buffer while actively recording (paused
  // state still reports isRecording=false, so this naturally stops sampling).
  useEffect(() => {
    if (!recState.isRecording || typeof recState.metering !== 'number') return;
    const norm = normalizeMetering(recState.metering);
    const next = [...meteringsRef.current.slice(-(METERING_SAMPLE_CAP - 1)), norm];
    meteringsRef.current = next;
    setMeterings(next);
  }, [recState.metering, recState.isRecording]);

  // Keep the latest duration in a ref so stop() reads a fresh value without
  // depending on the reactive state (avoids a stale closure).
  useEffect(() => {
    durationRef.current = recState.durationMillis ?? 0;
  }, [recState.durationMillis]);

  const reset = useCallback(() => {
    setStatus('idle');
    setMeterings([]);
    meteringsRef.current = [];
    durationRef.current = 0;
  }, []);

  const releaseAudioMode = useCallback(async () => {
    try {
      await setAudioModeAsync({ allowsRecording: false });
    } catch {
      // best-effort; not fatal
    }
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) return false;

      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

      meteringsRef.current = [];
      setMeterings([]);
      await recorder.prepareToRecordAsync();
      recorder.record();
      setStatus('recording');
      return true;
    } catch (e) {
      logError(e, 'useVoiceRecorder.start');
      reset();
      await releaseAudioMode();
      return false;
    }
  }, [recorder, reset, releaseAudioMode]);

  const pause = useCallback(() => {
    try {
      recorder.pause();
      setStatus('paused');
    } catch (e) {
      logError(e, 'useVoiceRecorder.pause');
    }
  }, [recorder]);

  const resume = useCallback(() => {
    try {
      recorder.record();
      setStatus('recording');
    } catch (e) {
      logError(e, 'useVoiceRecorder.resume');
    }
  }, [recorder]);

  const cancel = useCallback(async () => {
    try {
      await recorder.stop();
    } catch {
      /* already stopped */
    }
    reset();
    await releaseAudioMode();
  }, [recorder, reset, releaseAudioMode]);

  const stop = useCallback(async (): Promise<StoppedRecording | null> => {
    const capturedMeterings = meteringsRef.current.slice();
    const ms = durationRef.current;
    try {
      await recorder.stop();
      const uri = recorder.uri;
      reset();
      await releaseAudioMode();
      if (!uri) return null;
      return {
        uri,
        durationSeconds: Math.max(1, Math.round(ms / 1000)),
        meterings: capturedMeterings,
      };
    } catch (e) {
      logError(e, 'useVoiceRecorder.stop');
      reset();
      await releaseAudioMode();
      return null;
    }
  }, [recorder, reset, releaseAudioMode]);

  // Safety net: if the screen unmounts mid-recording, tear the recorder down.
  useEffect(() => {
    return () => {
      if (recorder.isRecording) {
        recorder.stop().catch(() => {});
      }
    };
  }, [recorder]);

  return {
    status,
    durationMillis: recState.durationMillis ?? 0,
    meterings,
    start,
    pause,
    resume,
    cancel,
    stop,
  };
}
