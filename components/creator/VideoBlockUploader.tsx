/**
 * F2 video (doc 78 law 16, v1 scope ruled 2026-07-22): mp4 only, limits
 * stated before the picker opens, instant client-side reject, a REAL
 * progress bar with a working cancel, then a poster-frame chooser.
 *
 * No "processing" stage and no transcode service: mp4-only under the
 * 100 MB cap plays directly, so the honest states are uploading -> ready.
 * Frames come from expo-video's generateThumbnailsAsync against the LOCAL
 * file, so the chooser costs no new native module and no server.
 */

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { VideoSource, useVideoPlayer } from 'expo-video';
import { Video as VideoIcon } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventAction, EventSpacing, EventSurface } from '../../constants/EventDesign';
import { hapticLight, hapticSuccess, hapticError } from '../../lib/haptics';
import {
  MEDIA_MAX_BYTES,
  POSTER_FRAME_OFFSETS_SEC,
  pickEventContentVideo,
  uploadEventContentVideo,
  type VideoPick,
} from '../../lib/eventContent';

const POSTER_STRIP_HEIGHT = 64;
const PROGRESS_TRACK_HEIGHT = 6;
const PERCENT = 100;

interface VideoBlockUploaderProps {
  eventId: string;
  disabled?: boolean;
  /** the stored path plus the chosen poster SECOND, once ready */
  onReady: (path: string, posterTime?: number) => void;
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'uploading'; fraction: number; cancel: () => void }
  | { kind: 'poster'; path: string; localUri: string };

export function VideoBlockUploader({ eventId, disabled, onReady }: VideoBlockUploaderProps) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [problem, setProblem] = useState<string | null>(null);
  const [frames, setFrames] = useState<{ thumb: unknown; atSec: number }[]>([]);

  // the player exists only to grab frames from the LOCAL file
  const posterSource: VideoSource = stage.kind === 'poster' ? stage.localUri : null;
  const framePlayer = useVideoPlayer(posterSource);

  const start = useCallback(async () => {
    if (disabled || stage.kind !== 'idle') return;
    hapticLight();
    setProblem(null);
    const { pick, problem: pickProblem } = await pickEventContentVideo();
    if (pickProblem) {
      hapticError();
      setProblem(pickProblem);
      return;
    }
    if (!pick) return;
    runUpload(pick);
  }, [disabled, stage.kind]);

  const runUpload = useCallback((pick: VideoPick) => {
    const upload = uploadEventContentVideo(eventId, pick, (fraction) => {
      setStage((s) => (s.kind === 'uploading' ? { ...s, fraction } : s));
    });
    setStage({ kind: 'uploading', fraction: 0, cancel: upload.cancel });

    upload.done
      .then(async (path) => {
        if (!path) {
          setStage({ kind: 'idle' });
          return;
        }
        hapticSuccess();
        setStage({ kind: 'poster', path, localUri: pick.uri });
        try {
          const thumbs = await framePlayer.generateThumbnailsAsync(POSTER_FRAME_OFFSETS_SEC);
          setFrames(thumbs.map((thumb, i) => ({
            thumb,
            atSec: thumb.requestedTime ?? POSTER_FRAME_OFFSETS_SEC[i] ?? 0,
          })));
        } catch {
          // a video shorter than the offsets, or a codec quirk: the
          // organizer just keeps the default first frame
          setFrames([]);
        }
      })
      .catch(() => {
        hapticError();
        /* copy to the taste gate */
        setProblem('that video did not upload. give it another try.');
        setStage({ kind: 'idle' });
      });
  }, [eventId, framePlayer]);

  if (stage.kind === 'uploading') {
    const pct = Math.round(stage.fraction * PERCENT);
    return (
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>uploading your video</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
        <View style={styles.progressRow}>
          <Text style={styles.progressPct}>{pct}%</Text>
          <TouchableOpacity
            onPress={() => {
              hapticLight();
              stage.cancel();
              setStage({ kind: 'idle' });
            }}
            hitSlop={10}
          >
            {/* copy to the taste gate */}
            <Text style={styles.cancelText}>cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (stage.kind === 'poster') {
    return (
      <View style={styles.panel}>
        {/* copy to the taste gate */}
        <Text style={styles.panelTitle}>pick the frame people see first</Text>
        {frames.length === 0 ? (
          <ActivityIndicator size="small" color={EventAction.primary} />
        ) : (
          <View style={styles.strip}>
            {frames.map((frame) => (
              <TouchableOpacity
                key={frame.atSec}
                onPress={() => {
                  hapticSuccess();
                  onReady(stage.path, frame.atSec);
                  setStage({ kind: 'idle' });
                  setFrames([]);
                }}
                activeOpacity={0.85}
              >
                {/* expo-image renders the thumbnail SharedRef directly */}
                <Image source={frame.thumb as never} style={styles.frame} contentFit="cover" />
              </TouchableOpacity>
            ))}
          </View>
        )}
        <TouchableOpacity
          onPress={() => {
            onReady(stage.path, undefined);
            setStage({ kind: 'idle' });
            setFrames([]);
          }}
          hitSlop={8}
        >
          {/* copy to the taste gate */}
          <Text style={styles.skipText}>use the first frame</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      <TouchableOpacity
        style={[styles.addPill, disabled && styles.addPillDisabled]}
        onPress={start}
        disabled={disabled}
        activeOpacity={0.85}
      >
        <VideoIcon size={14} color={EventAction.primary} strokeWidth={2.5} />
        <Text style={styles.addPillText}>video</Text>
      </TouchableOpacity>
      {!!problem && <Text style={styles.problemText}>{problem}</Text>}
    </View>
  );
}

/** law 16: the limits are named BEFORE a file is chosen. */
export const VIDEO_LIMITS_LINE = `mp4, up to ${Math.round(MEDIA_MAX_BYTES / 1048576)} mb, landscape 16:9 looks best.`;

const styles = StyleSheet.create({
  panel: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    padding: EventSpacing.md,
    gap: EventSpacing.sm,
  },
  panelTitle: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.text1 },
  progressTrack: {
    height: PROGRESS_TRACK_HEIGHT,
    borderRadius: PROGRESS_TRACK_HEIGHT / 2,
    backgroundColor: Colors.inputBg,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: EventAction.primary },
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressPct: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.text2 },
  cancelText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: EventAction.error },
  strip: { flexDirection: 'row', gap: EventSpacing.sm, flexWrap: 'wrap' },
  frame: {
    width: POSTER_STRIP_HEIGHT * (16 / 9),
    height: POSTER_STRIP_HEIGHT,
    borderRadius: 8,
    backgroundColor: EventSurface.media,
  },
  skipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.text2 },
  addPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1.5,
    borderColor: EventAction.primary,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addPillDisabled: { opacity: 0.4 },
  addPillText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: EventAction.primary },
  problemText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: EventAction.error, marginTop: EventSpacing.xs },
});
