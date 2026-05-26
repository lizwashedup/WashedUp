import { useCallback, useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import { logError } from '../lib/logger';

// Voice recording engine built on expo-av (SDK 54 ships expo-av deprecated but
// functional; expo-audio migration is tracked tech debt, out of Phase 1 scope).
// Records m4a/AAC via the HIGH_QUALITY preset and samples metering so the UI can
// draw a live amplitude waveform.

export type RecorderStatus = 'idle' | 'recording' | 'paused';

const METERING_INTERVAL_MS = 100;
const METERING_SAMPLE_CAP = 48; // most recent bars kept for the live waveform
const METERING_MIN_DB = -60; // map [-60dB, 0dB] -> [0, 1]

export interface StoppedRecording {
  uri: string;
  durationSeconds: number;
}

export function useVoiceRecorder() {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [durationMillis, setDurationMillis] = useState(0);
  const [meterings, setMeterings] = useState<number[]>([]);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const durationRef = useRef(0);

  const reset = useCallback(() => {
    setStatus('idle');
    setDurationMillis(0);
    setMeterings([]);
    durationRef.current = 0;
  }, []);

  const releaseAudioMode = useCallback(async () => {
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch {
      // best-effort; not fatal
    }
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    // Hoisted so the catch can unload a partially-prepared instance. expo-av
    // allows only ONE prepared Recording at the native layer, so a leaked one
    // makes every subsequent prepareToRecordAsync throw "Only one Recording
    // object can be prepared at a given time".
    let recording: Audio.Recording | null = null;
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) return false;

      // Tear down any survivor before preparing a new one (rapid re-tap, or a
      // prior teardown still settling) so the native recorder slot is free.
      if (recordingRef.current) {
        const stale = recordingRef.current;
        recordingRef.current = null;
        try { await stale.stopAndUnloadAsync(); } catch { /* already gone */ }
      }

      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

      recording = new Audio.Recording();
      await recording.prepareToRecordAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      recording.setProgressUpdateInterval(METERING_INTERVAL_MS);
      recording.setOnRecordingStatusUpdate((s) => {
        if (typeof s.durationMillis === 'number') {
          durationRef.current = s.durationMillis;
          setDurationMillis(s.durationMillis);
        }
        if (s.isRecording && typeof s.metering === 'number') {
          const norm = Math.max(0, Math.min(1, (s.metering - METERING_MIN_DB) / (0 - METERING_MIN_DB)));
          setMeterings((prev) => {
            const next = prev.length >= METERING_SAMPLE_CAP ? prev.slice(1) : prev.slice();
            next.push(norm);
            return next;
          });
        }
      });

      recordingRef.current = recording;
      reset();
      await recording.startAsync();
      setStatus('recording');
      return true;
    } catch (e) {
      logError(e, 'useVoiceRecorder.start');
      // Unload the instance we just created so it doesn't stay prepared at the
      // native layer and block the next start(). This is the leak that turned a
      // one-off failure into a permanent "Only one Recording object" error.
      if (recording) {
        try { await recording.stopAndUnloadAsync(); } catch { /* already gone */ }
      }
      recordingRef.current = null;
      reset();
      return false;
    }
  }, [reset]);

  const pause = useCallback(async () => {
    try {
      await recordingRef.current?.pauseAsync();
      setStatus('paused');
    } catch (e) {
      logError(e, 'useVoiceRecorder.pause');
    }
  }, []);

  const resume = useCallback(async () => {
    try {
      await recordingRef.current?.startAsync();
      setStatus('recording');
    } catch (e) {
      logError(e, 'useVoiceRecorder.resume');
    }
  }, []);

  const cancel = useCallback(async () => {
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (recording) {
      try { await recording.stopAndUnloadAsync(); } catch { /* already stopped */ }
    }
    reset();
    await releaseAudioMode();
  }, [reset, releaseAudioMode]);

  const stop = useCallback(async (): Promise<StoppedRecording | null> => {
    const recording = recordingRef.current;
    if (!recording) return null;
    recordingRef.current = null;
    try {
      const finalStatus = await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      const ms = finalStatus.durationMillis ?? durationRef.current;
      reset();
      await releaseAudioMode();
      if (!uri) return null;
      return { uri, durationSeconds: Math.max(1, Math.round(ms / 1000)) };
    } catch (e) {
      logError(e, 'useVoiceRecorder.stop');
      reset();
      await releaseAudioMode();
      return null;
    }
  }, [reset, releaseAudioMode]);

  // Safety net: if the screen unmounts mid-recording, tear the recorder down.
  useEffect(() => {
    return () => {
      const recording = recordingRef.current;
      recordingRef.current = null;
      if (recording) {
        recording.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  return { status, durationMillis, meterings, start, pause, resume, cancel, stop };
}
