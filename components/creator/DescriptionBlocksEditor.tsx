/**
 * The mood-board body editor (proposal 70 shape, proposal 77 door):
 * ordered text, image, and one-faq-marker blocks. CONTROLLED - the form
 * owns the blocks and saves them inside its complete field set, because
 * 77's RPC nulls every other omitted column (a blocks-only write would
 * wipe the title, date, and venue). Draft-safe: a Draft row already has
 * the id the image folder pin needs. The 70/77 trigger is the validator
 * of record; this editor mirrors its limits in copy.
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { ArrowDown, ArrowUp, ImagePlus, MessageCircleQuestion, Plus, Video, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { hapticLight, hapticError } from '../../lib/haptics';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../keyboard/KeyboardDoneBar';
import { EventAction, EventSurface } from '../../constants/EventDesign';
import { VideoBlockUploader, VIDEO_LIMITS_LINE } from './VideoBlockUploader';
import {
  BLOCKS_MAX,
  GALLERY_SOFT_CAP,
  TEXT_BLOCK_MAX,
  eventContentPublicUrl,
  pickAndUploadEventContentImages,
  type DescriptionBlock,
} from '../../lib/eventContent';

const IMAGE_PREVIEW_HEIGHT = 140;

interface DescriptionBlocksEditorProps {
  eventId: string;
  blocks: DescriptionBlock[];
  onChange: (next: DescriptionBlock[]) => void;
}

export function DescriptionBlocksEditor({ eventId, blocks, onChange }: DescriptionBlocksEditorProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadProblems, setUploadProblems] = useState<string[]>([]);
  const mutate = onChange;

  const handleAddImages = useCallback(async () => {
    if (!blocks || blocks.length >= BLOCKS_MAX || uploading) return;
    hapticLight();
    setUploading(true);
    try {
      const { paths, problems } = await pickAndUploadEventContentImages(
        eventId,
        Math.min(BLOCKS_MAX, GALLERY_SOFT_CAP) - blocks.length,
      );
      setUploadProblems(problems);
      if (paths.length > 0) {
        mutate([...blocks, ...paths.map((path) => ({ type: 'image' as const, path }))]);
      }
    } catch {
      hapticError();
    } finally {
      setUploading(false);
    }
  }, [blocks, uploading, eventId, mutate]);

  const faqMarkerPlaced = blocks.some((b) => b.type === 'faq');
  const imageCount = blocks.filter((b) => b.type === 'image').length;
  // the soft cap sits UNDER 70's hard ceiling so the counters agree
  const full = blocks.length >= Math.min(BLOCKS_MAX, GALLERY_SOFT_CAP);

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
        <Text style={styles.emptyText}>nothing here yet. text and photos build the page.</Text>
      )}

      {blocks.map((block, index) => (
        <View key={`${block.type}-${index}`} style={styles.blockCard}>
          <View style={styles.blockBody}>
            {block.type === 'text' && (
              <TextInput
                style={styles.textInput}
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
                <Image
                  source={{ uri: eventContentPublicUrl(block.path) }}
                  style={styles.imagePreview}
                  contentFit="cover"
                />
                {index === firstImageIndex ? (
                  <View style={styles.coverBadge}>
                    {/* copy to the taste gate (law 15) */}
                    <Text style={styles.coverBadgeText}>cover</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.makeCoverBtn}
                    onPress={() => makeCover(index)}
                    activeOpacity={0.85}
                  >
                    {/* copy to the taste gate (law 15) */}
                    <Text style={styles.makeCoverText}>make cover</Text>
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
            <TouchableOpacity onPress={() => move(index, -1)} hitSlop={8} disabled={index === 0}>
              <ArrowUp size={16} color={index === 0 ? Colors.border : Colors.warmGray} strokeWidth={2} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => move(index, 1)} hitSlop={8} disabled={index === blocks.length - 1}>
              <ArrowDown size={16} color={index === blocks.length - 1 ? Colors.border : Colors.warmGray} strokeWidth={2} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => remove(index)} hitSlop={8}>
              <X size={16} color={EventAction.error} strokeWidth={2} />
            </TouchableOpacity>
          </View>
        </View>
      ))}

      <View style={styles.addRow}>
        <TouchableOpacity
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
        <TouchableOpacity
          style={[styles.addPill, (full || uploading) && styles.addPillDisabled]}
          onPress={handleAddImages}
          disabled={full || uploading}
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
        <VideoBlockUploader
          eventId={eventId}
          disabled={full || uploading}
          onReady={(path, poster) => mutate([...blocks, { type: 'video', path, poster }])}
        />
        {!faqMarkerPlaced && (
          <TouchableOpacity
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

      {/* law 16: the limits are stated BEFORE a file is chosen */}
      <Text style={styles.limitText}>video: {VIDEO_LIMITS_LINE}</Text>

      {imageCount > 0 && (
        /* law 15: the live count counts BLOCKS, under 70's hard ceiling */
        <Text style={styles.limitText}>{blocks.length} of {GALLERY_SOFT_CAP} blocks</Text>
      )}

      {uploadProblems.map((problem, i) => (
        <Text key={`p-${i}`} style={styles.problemText}>{problem}</Text>
      ))}

      {full && (
        /* copy to the taste gate: 70's 30-block ceiling */
        <Text style={styles.limitText}>that is the whole page. thirty blocks is the ceiling.</Text>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  emptyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  blockCard: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 10,
    flexDirection: 'row',
    gap: 8,
  },
  blockBody: { flex: 1 },
  textInput: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    minHeight: 48,
    textAlignVertical: 'top',
  },
  imagePreview: { width: '100%', height: IMAGE_PREVIEW_HEIGHT, borderRadius: 8, backgroundColor: Colors.inputBg },
  faqMarkerText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.warmGray },
  blockControls: { justifyContent: 'space-between', alignItems: 'center', paddingVertical: 2, gap: 8 },
  addRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  addPill: {
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
  addPillText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  limitText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.text2 },
  problemText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: EventAction.error },
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
  coverBadgeText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.micro, color: Colors.brandDeep },
  makeCoverBtn: {
    position: 'absolute',
    left: 8,
    top: 8,
    backgroundColor: EventSurface.mediaControl,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  makeCoverText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.micro, color: Colors.darkWarm },
  videoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: EventSurface.media,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  videoChipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: EventSurface.onMedia },
});
