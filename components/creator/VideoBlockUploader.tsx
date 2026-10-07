import type {CreatorPageScope} from '../../lib/creatorPageReview';
import type {DescriptionBlock} from '../../lib/eventContent';
import type {PageEventVideoDraft} from '../../lib/creatorPageVideoDraft';
import type {PageEventMediaAttempt} from '../../lib/creatorPageEventMediaAttempt';
import {useCreatorPageVideo,type RecoveredPageVideo} from '../../hooks/useCreatorPageVideo';
import type {EventMediaGuard} from '../../lib/eventMediaGuard';
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

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { AppState, ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { VideoSource, useVideoPlayer } from 'expo-video';
import type { SharedRef } from 'expo-modules-core/types';
import { Video as VideoIcon } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, type AfterglowFontFamilies } from '../../constants/Typography';
import { EventAction, EventSpacing, EventSurface } from '../../constants/EventDesign';
import { hapticLight, hapticSuccess, hapticError } from '../../lib/haptics';
import {
  MEDIA_MAX_BYTES,
  POSTER_FRAME_OFFSETS_SEC,
  pickEventContentVideo,
  uploadEventContentVideo,
  uploadPosterFrame,
} from '../../lib/eventContent';

const POSTER_STRIP_HEIGHT = 64;
const PROGRESS_TRACK_HEIGHT = 6;
const PERCENT = 100;

interface VideoBlockUploaderProps {
  appearance?: { fonts: AfterglowFontFamilies };
  eventId: string;
  disabled?: boolean;
  /** the stored video path plus the pinned POSTER IMAGE path, once ready */
  onReady: (path: string, poster?: string) => void | boolean;
  mediaGuard?: EventMediaGuard;
  pageId?:string;
  pageScope?:CreatorPageScope;
  savedBlocks?:DescriptionBlock[];
  beginMediaWork?:()=>null|(()=>void);
  mediaBusy?:boolean;
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'picking' }
  | { kind: 'uploading'; fraction: number; cancel: () => void }
  | { kind: 'poster'; path: string; localUri: string };

export function VideoBlockUploader({ eventId, disabled, onReady, mediaGuard,pageId,pageScope,savedBlocks,beginMediaWork,mediaBusy=false,appearance }: VideoBlockUploaderProps) {
  const styles = useMemo(() => videoStyles(appearance?.fonts), [appearance?.fonts]);
  const privateVideo=useCreatorPageVideo(pageId,eventId,pageScope,mediaGuard,savedBlocks);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [problem, setProblem] = useState<string | null>(null);
  const [frames, setFrames] = useState<{ thumb: SharedRef<'image'>; atSec: number }[]>([]);
  const [savingPoster, setSavingPoster] = useState(false);

  // the player exists only to grab frames from the LOCAL file
  const posterSource: VideoSource = stage.kind === 'poster' ? stage.localUri : null;
  const framePlayer = useVideoPlayer(posterSource);

  type Attempt={visit:object;cancelled:boolean;cancelUpload?:()=>void;posterBusy:boolean;release?:()=>void};
  const visit=useMemo(()=>({}),[eventId,mediaGuard,pageId,pageScope]),latestVisit=useRef(visit);latestVisit.current=visit;
  const mounted=useRef(false),attempt=useRef<Attempt|null>(null),latestReady=useRef(onReady);latestReady.current=onReady;
  const [framesLoading,setFramesLoading]=useState(false);
  const current=(a:Attempt)=>mounted.current&&latestVisit.current===a.visit&&attempt.current===a&&!a.cancelled;
  const retire=(a:Attempt|null)=>{if(a){a.cancelled=true;a.cancelUpload?.();if(pageId)privateVideo.cancel();a.release?.();a.release=undefined;if(attempt.current===a)attempt.current=null;}};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;retire(attempt.current);};},[]);
  useEffect(()=>{setStage({kind:'idle'});setProblem(null);setFrames([]);setFramesLoading(false);setSavingPoster(false);return()=>retire(attempt.current);},[visit]);
  const guarded=(a:Attempt):EventMediaGuard=>({
    assertCurrent(){if(!current(a))throw Error('This video attempt ended.');mediaGuard?.assertCurrent();},
    async check(){if(!current(a))throw Error('This video attempt ended.');await mediaGuard?.check();if(!current(a))throw Error('This video attempt ended.');},
  });
  const cancel=()=>{retire(attempt.current);setStage({kind:'idle'});setFrames([]);setFramesLoading(false);setProblem(null);setSavingPoster(false);};
  useEffect(()=>{if(!pageId)return;const sub=AppState.addEventListener('change',state=>{if(state!=='active'&&attempt.current)cancel();});return()=>sub.remove();},[visit,pageId]);
  const start = async () => {
    if(disabled||attempt.current||privateVideo.isBusy()||privateVideo.loading)return;
    const release=beginMediaWork?.();if(beginMediaWork&&!release)return;
    const owned:Attempt={visit,cancelled:false,posterBusy:false,release:release??undefined};attempt.current=owned;
    const guard=guarded(owned);setStage({kind:'picking'});setProblem(null);
    try{
      await guard.check();hapticLight();
      const {pick,problem:pickProblem}=await pickEventContentVideo(guard);
      await guard.check();
      if(pickProblem||!pick){retire(owned);setStage({kind:'idle'});setProblem(pickProblem);return;}
      const upload=uploadEventContentVideo(eventId,pick,fraction=>{if(current(owned))setStage(old=>old.kind==='uploading'?{...old,fraction}:old);},guard,pageId?privateVideo.uploadVideo:undefined);
      owned.cancelUpload=upload.cancel;
      setStage({kind:'uploading',fraction:0,cancel});
      const path=await upload.done;
      owned.cancelUpload=undefined;
      if(!current(owned))return;
      if(!path){retire(owned);setStage({kind:'idle'});return;}
      await guard.check();
      const recovered=pageId?privateVideo.getResult():null;
      if(recovered?.ready){if(latestReady.current(recovered.path,recovered.poster)===false)throw Error('Check the current page before adding this video.');hapticSuccess();retire(owned);setStage({kind:'idle'});return;}
      setFramesLoading(true);setStage({kind:'poster',path,localUri:recovered?.localUri??pick.uri});
    }catch{
      if(current(owned)){retire(owned);setStage({kind:'idle'});setProblem('Video was not added. Check your page access and try again.');hapticError();}
    }
  };
  // Wait until the local poster source has rendered before asking its player for frames.
  useEffect(()=>{
    const owned=attempt.current;
    if(stage.kind!=='poster'||!owned)return;
    let active=true;
    void (async()=>{
      try{
        const thumbs=await framePlayer.generateThumbnailsAsync(POSTER_FRAME_OFFSETS_SEC);
        if(active&&current(owned))setFrames(thumbs.map((thumb,i)=>({thumb,atSec:thumb.requestedTime??POSTER_FRAME_OFFSETS_SEC[i]??0})));
      }catch{if(active&&current(owned))setFrames([]);}
      finally{if(active&&current(owned))setFramesLoading(false);}
    })();
    return()=>{active=false;};
  },[stage.kind==='poster'?stage.path:null,framePlayer,visit]);
  const finishPoster=async(frame?:SharedRef<'image'>)=>{
    const owned=attempt.current;
    if(stage.kind!=='poster'||!owned||owned.posterBusy||framesLoading)return;
    owned.posterBusy=true;setSavingPoster(true);setProblem(null);
    try{
      const guard=guarded(owned);await guard.check();
      const poster=frame?await uploadPosterFrame(eventId,frame,guard,pageId?privateVideo.uploadPoster:undefined):undefined;
      await guard.check();
      if(frame&&!poster)throw Error('Poster upload was not confirmed.');
      if(pageId&&!frame)await privateVideo.withoutPoster();
      await guard.check();
      if(latestReady.current(stage.path,poster??undefined)===false)throw Error('This page cannot accept another video yet.');
      hapticSuccess();retire(owned);setStage({kind:'idle'});setFrames([]);
    }catch{if(current(owned)){hapticError();setProblem('Video was not added. Check your page access or try this frame again.');}}
    finally{owned.posterBusy=false;if(mounted.current&&latestVisit.current===owned.visit&&(!attempt.current||attempt.current===owned))setSavingPoster(false);}
  };

  const resumeVideo=async(d:PageEventVideoDraft|PageEventMediaAttempt)=>{
    if(disabled||attempt.current||privateVideo.isBusy())return;
    const release=beginMediaWork?.();if(beginMediaWork&&!release)return;
    const owned:Attempt={visit,cancelled:false,posterBusy:false,release:release??undefined};attempt.current=owned;setProblem(null);setStage({kind:'uploading',fraction:0,cancel});
    try{
      await guarded(owned).check();
      const progress=(fraction:number)=>{if(current(owned))setStage(old=>old.kind==='uploading'?{...old,fraction}:old);};
      const task='video' in d?privateVideo.resume(d,progress):privateVideo.resumeUnassigned(d,progress);owned.cancelUpload=task.cancel;
      const recovered:RecoveredPageVideo=await task.done;owned.cancelUpload=undefined;await guarded(owned).check();
      if(recovered.ready){if(latestReady.current(recovered.path,recovered.poster)===false)throw Error('Check the current page before adding this video.');hapticSuccess();retire(owned);setStage({kind:'idle'});}
      else{setFramesLoading(true);setStage({kind:'poster',path:recovered.path,localUri:recovered.localUri});}
    }catch{if(current(owned)){retire(owned);setStage({kind:'idle'});setProblem('Video was not added. Check the saved upload or make room in this page.');}}
  };
  const discardVideo=async(d:PageEventVideoDraft|PageEventMediaAttempt)=>{
    if(attempt.current||privateVideo.isBusy())return;const release=beginMediaWork?.();if(beginMediaWork&&!release)return;
    try{await ('video' in d?privateVideo.discard(d):privateVideo.discardUnassigned(d));}catch{/* Recovery remains visible. */}finally{release?.();}
  };

  if(stage.kind==='picking')return <View style={styles.panel}><Text style={styles.panelTitle}>Choosing your video</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel video" onPress={cancel}><Text style={styles.cancelText}>cancel</Text></TouchableOpacity></View>;

  if (stage.kind === 'uploading') {
    const pct = Math.round(stage.fraction * PERCENT);
    return (
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>{pageId&&privateVideo.progress?`${privateVideo.progress.value.phase==='uploading'?'Uploading':'Checking'} your ${privateVideo.progress.purpose==='poster'?'preview':'video'}…`:'uploading your video'}</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
        <View style={styles.progressRow}>
          <Text style={styles.progressPct}>{pct}%</Text>
          <TouchableOpacity
            accessibilityRole="button" accessibilityLabel="Cancel video" onPress={cancel}
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
        {savingPoster && <ActivityIndicator size="small" color={EventAction.primary} />}
        {framesLoading ? (
          <ActivityIndicator size="small" color={EventAction.primary} />
        ) : (
          <View style={styles.strip}>
            {frames.map((frame) => (
              <TouchableOpacity
                key={frame.atSec}
                accessibilityRole="button" accessibilityLabel={`Use video frame at ${frame.atSec} seconds`}
                onPress={()=>finishPoster(frame.thumb)}
                disabled={savingPoster||framesLoading}
                activeOpacity={0.85}
              >
                {/* expo-image renders the thumbnail SharedRef directly */}
                <Image source={frame.thumb} style={styles.frame} contentFit="cover" />
              </TouchableOpacity>
            ))}
          </View>
        )}
        <TouchableOpacity
          accessibilityRole="button" accessibilityLabel={frames.length?'Use first video frame':'Add video without preview'}
          onPress={()=>finishPoster(frames[0]?.thumb)}
          disabled={savingPoster||framesLoading}
          hitSlop={8}
        >
          {/* copy to the taste gate */}
          <Text style={styles.skipText}>{frames.length?'use the first frame':'add video without a preview'}</Text>
        </TouchableOpacity>
        {!!problem&&<Text accessibilityRole="alert" style={styles.problemText}>{problem}</Text>}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel video" onPress={cancel}><Text style={styles.cancelText}>cancel</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      <TouchableOpacity
        style={[styles.addPill, disabled && styles.addPillDisabled]}
        accessibilityRole="button" accessibilityLabel="Add video" onPress={start}
        disabled={disabled||privateVideo.busy||privateVideo.loading}
        activeOpacity={0.85}
      >
        <VideoIcon size={14} color={EventAction.primary} strokeWidth={2.5} />
        <Text style={styles.addPillText}>video</Text>
      </TouchableOpacity>
      {!!problem && <Text style={styles.problemText}>{problem}</Text>}
      {pageId&&<View>
        {!!privateVideo.error&&<Text accessibilityRole="alert" style={styles.problemText}>{privateVideo.error}</Text>}
        {privateVideo.drafts.map((draft,index)=><View key={draft.video.mediaId}>
          <Text style={styles.panelTitle}>Saved video {index+1}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Resume saved video ${index+1}`} disabled={disabled||privateVideo.busy} onPress={()=>void resumeVideo(draft)}><Text style={styles.addPillText} numberOfLines={1}>Resume video</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Discard saved video ${index+1}`} disabled={mediaBusy||privateVideo.busy} onPress={()=>void discardVideo(draft)}><Text style={styles.cancelText} numberOfLines={1}>Discard upload</Text></TouchableOpacity>
        </View>)}
        {privateVideo.unassigned.map((original,index)=><View key={original.mediaId}>
          <Text style={styles.panelTitle}>{original.purpose==='video'?'Saved video upload':'Saved preview upload'} {index+1}</Text>
          {original.purpose==='video'?<TouchableOpacity accessibilityRole="button" accessibilityLabel={`Resume unassigned video ${index+1}`} disabled={disabled||privateVideo.busy} onPress={()=>void resumeVideo(original)}><Text style={styles.addPillText} numberOfLines={1}>Resume video</Text></TouchableOpacity>:<Text style={styles.problemText}>Its video choice was not saved. Choose the frame again when you resume the video, or discard this upload.</Text>}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Discard unassigned upload ${index+1}`} disabled={mediaBusy||privateVideo.busy} onPress={()=>void discardVideo(original)}><Text style={styles.cancelText} numberOfLines={1}>Discard upload</Text></TouchableOpacity>
        </View>)}
        {!!privateVideo.error&&<TouchableOpacity accessibilityRole="button" accessibilityLabel="Check saved video uploads" disabled={privateVideo.busy||privateVideo.loading||mediaBusy} onPress={()=>void privateVideo.refresh()}><Text style={styles.addPillText} numberOfLines={1}>Check uploads</Text></TouchableOpacity>}
      </View>}

    </View>
  );
}

/** law 16: the limits are named BEFORE a file is chosen. */
export const VIDEO_LIMITS_LINE = `mp4, up to ${Math.round(MEDIA_MAX_BYTES / 1048576)} mb, landscape 16:9 looks best.`;

function videoStyles(fonts?: AfterglowFontFamilies) { return StyleSheet.create({
  panel: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    padding: EventSpacing.md,
    gap: EventSpacing.sm,
  },
  panelTitle: { fontFamily: fonts?.medium ?? Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.text1 },
  progressTrack: {
    height: PROGRESS_TRACK_HEIGHT,
    borderRadius: PROGRESS_TRACK_HEIGHT / 2,
    backgroundColor: Colors.inputBg,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: EventAction.primary },
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressPct: { fontFamily: fonts?.medium ?? Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.text2 },
  cancelText: { fontFamily: fonts?.medium ?? Fonts.sansMedium, fontSize: FontSizes.bodySM, color: EventAction.error },
  strip: { flexDirection: 'row', gap: EventSpacing.sm, flexWrap: 'wrap' },
  frame: {
    width: POSTER_STRIP_HEIGHT * (16 / 9),
    height: POSTER_STRIP_HEIGHT,
    borderRadius: 8,
    backgroundColor: EventSurface.media,
  },
  skipText: { fontFamily: fonts?.medium ?? Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.text2 },
  addPill: {
    minHeight: 44,
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
  addPillText: { fontFamily: fonts?.semibold ?? Fonts.sansBold, fontSize: FontSizes.bodySM, color: EventAction.primary },
  problemText: { fontFamily: fonts?.regular ?? Fonts.sans, fontSize: FontSizes.bodySM, color: EventAction.error, marginTop: EventSpacing.xs },
}); }
