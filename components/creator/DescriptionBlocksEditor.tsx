import type {CreatorPageScope} from '../../lib/creatorPageReview';
import {useCreatorPageMediaUpload} from '../../hooks/useCreatorPageMediaUpload';
import type {EventMediaGuard} from '../../lib/eventMediaGuard';
/**
 * The mood-board body editor (proposal 70 shape, proposal 77 door):
 * ordered text, image, and one-faq-marker blocks. CONTROLLED - the form
 * owns the blocks and saves them inside its complete field set, because
 * 77's RPC nulls every other omitted column (a blocks-only write would
 * wipe the title, date, and venue). Draft-safe: a Draft row already has
 * the id the image folder pin needs. The 70/77 trigger is the validator
 * of record; this editor mirrors its limits in copy.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { EventMediaImage } from '../events/EventMediaImage';
import { ArrowDown, ArrowUp, ImagePlus, MessageCircleQuestion, Plus, Video, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, type AfterglowFontFamilies } from '../../constants/Typography';
import { hapticLight, hapticError } from '../../lib/haptics';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../keyboard/KeyboardDoneBar';
import { EventAction, EventSurface } from '../../constants/EventDesign';
import { VideoBlockUploader, VIDEO_LIMITS_LINE } from './VideoBlockUploader';
import {
  BLOCKS_MAX,
  GALLERY_SOFT_CAP,
  TEXT_BLOCK_MAX,
  pickAndUploadEventContentImages,
  type DescriptionBlock,
} from '../../lib/eventContent';

const IMAGE_PREVIEW_HEIGHT = 140;

interface DescriptionBlocksEditorProps {
  appearance?: { fonts: AfterglowFontFamilies };
  eventId: string;
  blocks: DescriptionBlock[];
  onChange: (next: DescriptionBlock[]) => void;
  /** photos and video upload into the event's OWN folder, so they need a
   *  saved event id. Text and faq blocks ride the create payload and work
   *  before a draft exists. When canAddMedia is false the media pills run
   *  onUnlockMedia instead (the form's in-place draft-create, 7-27 ship
   *  ruling item 2), so photos stay ONE obvious action on a new form too. */
  canAddMedia?: boolean;
  mediaHint?: string;
  onUnlockMedia?: (kind: 'photos' | 'video') => void;
  /** set by the unlock flow's replace (openPhotos=1): reopen the picker
   *  once so the organizer's photos tap survives the draft-create */
  autoOpenPhotos?: boolean;
  mediaGuard?: EventMediaGuard;
  pageId?: string;
  pageScope?: CreatorPageScope;
  savedBlocks?: DescriptionBlock[];
  /** Synchronous parent lease covers the whole picker batch, including gaps between files. */
  beginMediaWork?: ()=>null|(()=>void);
  mediaBusy?: boolean;
}

export function DescriptionBlocksEditor({
  eventId,
  blocks,
  onChange,
  canAddMedia = true,
  mediaHint,
  onUnlockMedia,
  autoOpenPhotos,
  mediaGuard,pageId,pageScope,savedBlocks,beginMediaWork,mediaBusy=false,appearance,
}: DescriptionBlocksEditorProps) {
  const styles = useMemo(() => descriptionStyles(appearance?.fonts), [appearance?.fonts]);
  const [uploading, setUploading] = useState(false);
  const [uploadProblems, setUploadProblems] = useState<string[]>([]);
  const latestBlocks=useRef(blocks);latestBlocks.current=blocks;
  const mutate=(next:DescriptionBlock[])=>{latestBlocks.current=next;onChange(next);};
  const visit=useMemo(()=>({}),[eventId,mediaGuard]);
  const currentVisit=useRef(visit);currentVisit.current=visit;
  const mounted=useRef(false),imageLock=useRef<object|null>(null),cancelledBatch=useRef<object|null>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{setUploading(false);setUploadProblems([]);},[visit]);
  const isCurrent=(owned:object)=>mounted.current&&currentVisit.current===owned;
  const privatePhotos=useCreatorPageMediaUpload(pageId,eventId,pageScope,mediaGuard,reference=>{
    const current=latestBlocks.current;
    if(current.some(b=>b.type==='image'&&b.path===reference))return;
    if(current.length>=Math.min(BLOCKS_MAX,GALLERY_SOFT_CAP))throw Error('Make room in the page before adding this photo.');
    mutate([...current,{type:'image',path:reference}]);
  },reference=>mutate(latestBlocks.current.filter(b=>!(b.type==='image'&&b.path===reference))),
  (savedBlocks??[]).flatMap(b=>b.type==='image'?[b.path]:[]),'image');
  const recovery=async(action:()=>Promise<unknown>)=>{
    if(imageLock.current||privatePhotos.isBusy())return;
    const release=beginMediaWork?.();if(beginMediaWork&&!release)return;
    try{await action();}catch{/* The original saved upload remains visible with recovery feedback. */}finally{release?.();}
  };


  const handleAddImages = useCallback(async () => {
    if (latestBlocks.current.length >= Math.min(BLOCKS_MAX,GALLERY_SOFT_CAP) || imageLock.current===visit || privatePhotos.isBusy() || privatePhotos.loading) return;
    const release=beginMediaWork?.();if(beginMediaWork&&!release)return;
    const owned=visit;imageLock.current=owned;cancelledBatch.current=null;
    const batchCurrent=()=>{if(!isCurrent(owned)||cancelledBatch.current===owned)throw Error('This photo batch ended.');};
    const batchGuard:EventMediaGuard={assertCurrent(){batchCurrent();mediaGuard?.assertCurrent();},async check(){batchCurrent();await mediaGuard?.check();batchCurrent();}};
    setUploading(true);setUploadProblems([]);
    try {
      await mediaGuard?.check();
      if(!isCurrent(owned))return;
      hapticLight();
      const { paths, problems } = await pickAndUploadEventContentImages(
        eventId,Math.min(BLOCKS_MAX,GALLERY_SOFT_CAP)-latestBlocks.current.length,batchGuard,pageId?privatePhotos.upload:undefined,
      );
      await batchGuard.check();
      if(!isCurrent(owned))return;
      const current=latestBlocks.current,available=Math.max(0,Math.min(BLOCKS_MAX,GALLERY_SOFT_CAP)-current.length);
      setUploadProblems(paths.length>available?[...problems,'Your newer edits filled this page. Some uploaded photos were not added.']:problems);
      if(paths.length&&available)mutate([...current,...paths.slice(0,available).map(path=>({type:'image' as const,path}))]);
    } catch {
      if(isCurrent(owned)){hapticError();setUploadProblems(['Photos were not added. Check your page access and try again.']);}
    } finally {
      if(imageLock.current===owned)imageLock.current=null;
      if(isCurrent(owned))setUploading(false);
      release?.();
    }
  }, [visit,eventId,mediaGuard,onChange,pageId,beginMediaWork,privatePhotos.upload,privatePhotos.loading]);

  const faqMarkerPlaced = blocks.some((b) => b.type === 'faq');
  // the soft cap sits UNDER 70's hard ceiling so the counters agree
  const full = blocks.length >= Math.min(BLOCKS_MAX, GALLERY_SOFT_CAP);

  // the unlock flow's landing: the organizer tapped photos, the draft was
  // created, and the screen replaced; reopen the picker exactly once
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpenPhotos || !canAddMedia || autoOpened.current) return;
    autoOpened.current = true;
    handleAddImages();
  }, [autoOpenPhotos, canAddMedia, handleAddImages]);

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    hapticLight();
    const next = [...blocks];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    mutate(next);
  };

  // law 15: order = importance, so tile #1 is the cover; "make cover"
  // moves a tile ahead of every other image without disturbing the text
  // and faq blocks around it
  const firstImageIndex = blocks.findIndex((b) => b.type === 'image');
  const makeCover = (index: number) => {
    if (firstImageIndex < 0 || index === firstImageIndex) return;
    hapticLight();
    const next = [...blocks];
    const [item] = next.splice(index, 1);
    next.splice(firstImageIndex, 0, item);
    mutate(next);
  };

  const remove = (index: number) => {
    hapticLight();
    mutate(blocks.filter((_, i) => i !== index));
  };

  return (
    <View style={styles.container}>
      {blocks.length === 0 && (
        /* copy to the taste gate (the empty-state invitation rule) */
        <Text style={styles.emptyText}>Make it yours with a story, photos, and details to look forward to.</Text>
      )}

      {blocks.map((block, index) => (
        <View key={`${block.type}-${index}`} style={styles.blockCard}>
          <View style={styles.blockBody}>
            {block.type === 'text' && (
              <TextInput
                style={styles.textInput}
                accessibilityLabel={`Text block ${index + 1}`}
                value={block.content}
                onChangeText={(t) => {
                  const next = [...blocks];
                  next[index] = { type: 'text', content: t.slice(0, TEXT_BLOCK_MAX) };
                  mutate(next);
                }}
                placeholder="say it in your voice"
                placeholderTextColor={Colors.textLight}
                multiline
                maxLength={TEXT_BLOCK_MAX}
                inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
              />
            )}
            {block.type === 'image' && (
              <View>
                <EventMediaImage
                  eventId={eventId} reference={block.path} kind="image"
                  style={styles.imagePreview}
                  contentFit="cover"
                />
                {index === firstImageIndex ? (
                  <View style={styles.coverBadge}>
                    {/* copy to the taste gate (law 15). NOT "cover": the real
                        cover is the locked 4:5 poster above (guardrail 3);
                        this badge only marks the photo that leads the body */}
                    <Text style={styles.coverBadgeText}>first</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.makeCoverBtn}
                    accessibilityRole="button" accessibilityLabel={`Show photo block ${index + 1} first`}
                    onPress={() => makeCover(index)}
                    activeOpacity={0.85}
                  >
                    {/* copy to the taste gate (law 15) */}
                    <Text style={styles.makeCoverText}>show it first</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {block.type === 'video' && (
              <View style={styles.videoChip}>
                <Video size={16} color={EventSurface.onMedia} strokeWidth={2} />
                {/* copy to the taste gate */}
                <Text style={styles.videoChipText}>video ready</Text>
              </View>
            )}
            {block.type === 'faq' && (
              /* copy to the taste gate */
              <Text style={styles.faqMarkerText}>your faq cards show here</Text>
            )}
          </View>
          <View style={styles.blockControls}>
            <TouchableOpacity style={styles.blockControl} accessibilityRole="button" accessibilityLabel={`Move ${block.type} block ${index + 1} up`} accessibilityState={{disabled: index === 0}} onPress={() => move(index, -1)} disabled={index === 0}>
              <ArrowUp size={16} color={index === 0 ? Colors.border : Colors.warmGray} strokeWidth={2} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.blockControl} accessibilityRole="button" accessibilityLabel={`Move ${block.type} block ${index + 1} down`} accessibilityState={{disabled: index === blocks.length - 1}} onPress={() => move(index, 1)} disabled={index === blocks.length - 1}>
              <ArrowDown size={16} color={index === blocks.length - 1 ? Colors.border : Colors.warmGray} strokeWidth={2} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.blockControl} accessibilityRole="button" accessibilityLabel={`Remove ${block.type} block ${index + 1}`} onPress={() => remove(index)}>
              <X size={16} color={EventAction.error} strokeWidth={2} />
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {/* 7-27 ship ruling item 2: photos lead the row, and on a NEW form the
          media pills stay live: they run the form's in-place draft-create
          (onUnlockMedia) instead of graying out, so adding a photo is ONE
          obvious action either way */}
      <View style={styles.addRow}>
        <TouchableOpacity
          accessibilityRole="button" accessibilityLabel="Add photos"
          style={[styles.addPill, (full || uploading || mediaBusy || privatePhotos.busy || privatePhotos.loading || (!canAddMedia && !onUnlockMedia)) && styles.addPillDisabled]}
          onPress={canAddMedia ? handleAddImages : () => onUnlockMedia?.('photos')}
          disabled={full || uploading || mediaBusy || privatePhotos.busy || privatePhotos.loading || (!canAddMedia && !onUnlockMedia)}
          activeOpacity={0.85}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={Colors.terracotta} />
          ) : (
            <ImagePlus size={14} color={Colors.terracotta} strokeWidth={2.5} />
          )}
          {/* copy to the taste gate (doc 76: many at once) */}
          <Text style={styles.addPillText}>photos</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button" accessibilityLabel="Add text block"
          style={[styles.addPill, full && styles.addPillDisabled]}
          onPress={() => {
            if (full) return;
            hapticLight();
            mutate([...blocks, { type: 'text', content: '' }]);
          }}
          disabled={full}
          activeOpacity={0.85}
        >
          <Plus size={14} color={Colors.terracotta} strokeWidth={2.5} />
          <Text style={styles.addPillText}>text</Text>
        </TouchableOpacity>
        {canAddMedia ? (
          <VideoBlockUploader appearance={appearance}
            key={eventId}
            eventId={eventId}
            mediaGuard={mediaGuard}
            pageId={pageId}
            pageScope={pageScope}
            savedBlocks={savedBlocks}
            beginMediaWork={beginMediaWork}
            mediaBusy={mediaBusy||uploading||privatePhotos.busy}
            disabled={full || uploading || mediaBusy || privatePhotos.busy}
            onReady={(path, poster) => {
              mediaGuard?.assertCurrent();
              const current=latestBlocks.current;
              const existing=current.find(b=>b.type==='video'&&b.path===path);
              if(existing?.type==='video')return (existing.poster??null)===(poster??null);
              if(current.length>=Math.min(BLOCKS_MAX,GALLERY_SOFT_CAP))return false;
              mutate([...current,{type:'video',path,poster}]);
              return true;
            }}
          />
        ) : (
          <TouchableOpacity
            accessibilityRole="button" accessibilityLabel="Add video"
            style={[styles.addPill, (full || !onUnlockMedia) && styles.addPillDisabled]}
            onPress={() => onUnlockMedia?.('video')}
            disabled={full || !onUnlockMedia}
            activeOpacity={0.85}
          >
            <Video size={14} color={Colors.terracotta} strokeWidth={2.5} />
            <Text style={styles.addPillText}>video</Text>
          </TouchableOpacity>
        )}
        {!faqMarkerPlaced && (
          <TouchableOpacity
            accessibilityRole="button" accessibilityLabel="Add FAQ position"
            style={[styles.addPill, full && styles.addPillDisabled]}
            onPress={() => {
              if (full) return;
              hapticLight();
              mutate([...blocks, { type: 'faq' }]);
            }}
            disabled={full}
            activeOpacity={0.85}
          >
            <MessageCircleQuestion size={14} color={Colors.terracotta} strokeWidth={2.5} />
            <Text style={styles.addPillText}>faq spot</Text>
          </TouchableOpacity>
        )}
      </View>

      {!canAddMedia && !!mediaHint && (
        /* photos/video wait for a draft id; text and faq work right now */
        <Text style={styles.limitText}>{mediaHint}</Text>
      )}

      {/* law 16: the limits are stated BEFORE a file is chosen */}
      {canAddMedia && <Text style={styles.limitText}>video: {VIDEO_LIMITS_LINE}</Text>}

      {blocks.length > 0 && (
        /* law 15: the live count counts BLOCKS, under 70's hard ceiling */
        <Text style={styles.limitText}>{blocks.length} of {GALLERY_SOFT_CAP} blocks</Text>
      )}

      {pageId && <View>
        {privatePhotos.busy && <>
          <Text accessibilityLiveRegion="polite" style={styles.limitText}>{privatePhotos.progress?.phase==='uploading'?'Uploading your photo…':'Checking your photo…'}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel photo upload" onPress={()=>{if(imageLock.current)cancelledBatch.current=imageLock.current;privatePhotos.cancel();}}><Text style={styles.addPillText} numberOfLines={1}>Cancel upload</Text></TouchableOpacity>
        </>}
        {!!privatePhotos.error&&<Text accessibilityRole="alert" style={styles.problemText}>{privatePhotos.error}</Text>}
        {!uploading&&!privatePhotos.busy&&privatePhotos.attempts.map((attempt,index)=><View key={attempt.mediaId}>
          <Text style={styles.limitText}>Saved photo upload {index+1}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Retry saved photo upload ${index+1}`} disabled={full||mediaBusy} onPress={()=>void recovery(()=>privatePhotos.retry(attempt))}><Text style={styles.addPillText} numberOfLines={1}>Retry upload</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Discard saved photo upload ${index+1}`} disabled={mediaBusy} onPress={()=>void recovery(()=>privatePhotos.discard(attempt))}><Text style={styles.addPillText} numberOfLines={1}>Discard upload</Text></TouchableOpacity>
        </View>)}
        {!!privatePhotos.error&&!privatePhotos.busy&&<TouchableOpacity accessibilityRole="button" accessibilityLabel="Check saved photo uploads" disabled={uploading||mediaBusy||privatePhotos.loading} onPress={()=>void privatePhotos.refresh()}><Text style={styles.addPillText} numberOfLines={1}>Check uploads</Text></TouchableOpacity>}
      </View>}

      {uploadProblems.map((problem, i) => (
        <Text key={`p-${i}`} style={styles.problemText}>{problem}</Text>
      ))}

      {full && (
        /* copy to the taste gate: 70's 30-block ceiling */
        <Text style={styles.limitText}>Your page has reached its {Math.min(BLOCKS_MAX, GALLERY_SOFT_CAP)}-block limit.</Text>
      )}

    </View>
  );
}

function descriptionStyles(fonts?: AfterglowFontFamilies) { return StyleSheet.create({
  container: { gap: 10 },
  emptyText: { fontFamily: fonts?.regular ?? Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  blockCard: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 10,
    gap: 8,
  },
  blockBody: { minWidth: 0 },
  textInput: {
    fontFamily: fonts?.regular ?? Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    minHeight: 48,
    textAlignVertical: 'top',
  },
  imagePreview: { width: '100%', height: IMAGE_PREVIEW_HEIGHT, borderRadius: 8, backgroundColor: Colors.inputBg },
  faqMarkerText: { fontFamily: fonts?.medium ?? Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.warmGray },
  blockControls: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4 },
  blockControl: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  addPill: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addPillDisabled: { opacity: 0.4 },
  addPillText: { fontFamily: fonts?.semibold ?? Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  limitText: { fontFamily: fonts?.regular ?? Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.text2 },
  problemText: { fontFamily: fonts?.regular ?? Fonts.sans, fontSize: FontSizes.bodySM, color: EventAction.error },
  // doc 80 section C: the cover badge is the gold success family on
  // brandDeep text, NOT a second terracotta accent
  coverBadge: {
    position: 'absolute',
    left: 8,
    top: 8,
    backgroundColor: EventAction.successFill,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  coverBadgeText: { fontFamily: fonts?.semibold ?? Fonts.sansBold, fontSize: FontSizes.micro, color: Colors.brandDeep },
  makeCoverBtn: {
    position: 'absolute',
    left: 8,
    top: 8,
    backgroundColor: EventSurface.mediaControl,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  makeCoverText: { fontFamily: fonts?.medium ?? Fonts.sansMedium, fontSize: FontSizes.micro, color: Colors.darkWarm },
  videoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: EventSurface.media,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  videoChipText: { fontFamily: fonts?.medium ?? Fonts.sansMedium, fontSize: FontSizes.bodySM, color: EventSurface.onMedia },
}); }
