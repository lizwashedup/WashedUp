/**
 * The mood-board body editor (proposal 70, section 4c anatomy): ordered
 * text, image, and one-faq-marker blocks on a saved event. Draft-safe:
 * a Draft row already has the id the image folder pin needs, and saving
 * blocks never touches status or the rest of the form. The 70 trigger
 * is the validator of record; this editor mirrors its limits in copy.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ImagePlus, MessageCircleQuestion, Plus, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { hapticLight, hapticSuccess, hapticError } from '../../lib/haptics';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../keyboard/KeyboardDoneBar';
import {
  BLOCKS_MAX,
  TEXT_BLOCK_MAX,
  eventContentPublicUrl,
  getDescriptionBlocks,
  pickAndUploadEventContentImage,
  saveDescriptionBlocks,
  type DescriptionBlock,
} from '../../lib/eventContent';

const IMAGE_PREVIEW_HEIGHT = 140;

interface DescriptionBlocksEditorProps {
  eventId: string;
}

export function DescriptionBlocksEditor({ eventId }: DescriptionBlocksEditorProps) {
  const queryClient = useQueryClient();
  const [blocks, setBlocks] = useState<DescriptionBlock[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data: loaded, isLoading } = useQuery({
    queryKey: ['description-blocks', eventId],
    queryFn: () => getDescriptionBlocks(eventId),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (loaded && blocks === null) setBlocks(loaded);
  }, [loaded, blocks]);

  const mutate = useCallback((next: DescriptionBlock[]) => {
    setBlocks(next);
    setDirty(true);
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const result = await saveDescriptionBlocks(eventId, blocks ?? []);
      if (!result.ok) throw new Error(result.message ?? 'save failed');
    },
    onSuccess: () => {
      hapticSuccess();
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['description-blocks', eventId] });
    },
    onError: () => hapticError(),
  });

  const handleAddImage = useCallback(async () => {
    if (!blocks || blocks.length >= BLOCKS_MAX || uploading) return;
    hapticLight();
    setUploading(true);
    try {
      const path = await pickAndUploadEventContentImage(eventId);
      if (path) mutate([...blocks, { type: 'image', path }]);
    } catch {
      hapticError();
    } finally {
      setUploading(false);
    }
  }, [blocks, uploading, eventId, mutate]);

  if (isLoading || blocks === null) {
    return <ActivityIndicator size="small" color={Colors.terracotta} />;
  }

  const faqMarkerPlaced = blocks.some((b) => b.type === 'faq');
  const full = blocks.length >= BLOCKS_MAX;

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    hapticLight();
    const next = [...blocks];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
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
              <Image
                source={{ uri: eventContentPublicUrl(block.path) }}
                style={styles.imagePreview}
                contentFit="cover"
              />
            )}
            {block.type === 'faq' && (
              /* copy to the taste gate */
              <Text style={styles.faqMarkerText}>your faq cards show here</Text>
            )}
          </View>
          <View style={styles.blockControls}>
            <TouchableOpacity onPress={() => move(index, -1)} hitSlop={8} disabled={index === 0}>
              <ArrowUp size={16} color={index === 0 ? Colors.border : Colors.textMedium} strokeWidth={2} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => move(index, 1)} hitSlop={8} disabled={index === blocks.length - 1}>
              <ArrowDown size={16} color={index === blocks.length - 1 ? Colors.border : Colors.textMedium} strokeWidth={2} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => remove(index)} hitSlop={8}>
              <X size={16} color={Colors.errorRed} strokeWidth={2} />
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
          onPress={handleAddImage}
          disabled={full || uploading}
          activeOpacity={0.85}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={Colors.terracotta} />
          ) : (
            <ImagePlus size={14} color={Colors.terracotta} strokeWidth={2.5} />
          )}
          <Text style={styles.addPillText}>photo</Text>
        </TouchableOpacity>
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

      {full && (
        /* copy to the taste gate: 70's 30-block ceiling */
        <Text style={styles.limitText}>that is the whole page. thirty blocks is the ceiling.</Text>
      )}

      {dirty && (
        <TouchableOpacity
          style={styles.saveBtn}
          onPress={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          activeOpacity={0.85}
        >
          {saveMutation.isPending ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            /* copy to the taste gate */
            <Text style={styles.saveBtnText}>save the page body</Text>
          )}
        </TouchableOpacity>
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
  limitText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.warmGray },
  saveBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.white },
});
