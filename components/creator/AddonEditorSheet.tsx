/**
 * The add-on editor (doc 114): name, price, description, image, quantity,
 * per-order max. Mirrors TierEditorSheet's shape and tokens; reachable only
 * from the probe-gated add-ons section, so it cannot exist before the
 * schema does. The image goes to the event-images bucket via the existing
 * uploader (event-pinned path law).
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { hapticLight } from '../../lib/haptics';
import { pickAndUploadEventImage } from '../../lib/creatorEvents';
import { TIER_DESCRIPTION_MAX, TIER_NAME_MAX } from '../../lib/ticketing';
import { type AddonDraft, type EventAddon } from '../../lib/ticketPromosAddons';

interface AddonEditorSheetProps {
  visible: boolean;
  /** null = creating a new add-on */
  addon: EventAddon | null;
  busy: boolean;
  onSave: (draft: AddonDraft) => void;
  onClose: () => void;
}

function parsePriceCents(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const value = Number(cleaned);
  if (isNaN(value)) return null;
  return Math.round(value * 100);
}

export function AddonEditorSheet({ visible, addon, busy, onSave, onClose }: AddonEditorSheetProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceText, setPriceText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [capText, setCapText] = useState('');
  const [perOrderMaxText, setPerOrderMaxText] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(addon?.name ?? '');
    setDescription(addon?.description ?? '');
    setPriceText(addon ? (addon.price_cents === 0 ? '' : (addon.price_cents / 100).toFixed(2)) : '');
    setImageUrl(addon?.image_url ?? '');
    setCapText(addon?.quantity_cap ? String(addon.quantity_cap) : '');
    setPerOrderMaxText(addon?.per_order_max ? String(addon.per_order_max) : '');
  }, [visible, addon]);

  const priceCents = parsePriceCents(priceText);
  const problem =
    priceCents === null
      ? /* copy to the taste gate */ 'that price does not read as a number.'
      : null;
  const canSave = name.trim().length > 0 && problem === null && !busy && !uploading;

  const handlePickImage = async () => {
    hapticLight();
    setUploading(true);
    try {
      const url = await pickAndUploadEventImage();
      if (url) setImageUrl(url);
    } catch { /* leaving the old image is never worth an error */ }
    setUploading(false);
  };

  const handleSave = () => {
    if (!canSave || priceCents === null) return;
    hapticLight();
    const cap = capText.trim() ? parseInt(capText, 10) : null;
    const perOrderMax = perOrderMaxText.trim() ? parseInt(perOrderMaxText, 10) : null;
    onSave({
      name: name.trim().slice(0, TIER_NAME_MAX),
      description: description.trim() ? description.trim().slice(0, TIER_DESCRIPTION_MAX) : null,
      price_cents: priceCents,
      image_url: imageUrl || null,
      quantity_cap: cap && cap > 0 ? cap : null,
      per_order_max: perOrderMax && perOrderMax >= 1 ? perOrderMax : null,
      // a new extra starts as a draft; the list's own flip puts it on sale
      // (the tier pattern), so nothing goes buyable by the act of existing
      status: addon?.status ?? 'draft',
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.overlay} onPress={() => Keyboard.dismiss()}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.avoider}>
          <Pressable style={styles.sheet} onPress={() => Keyboard.dismiss()}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.headerRow}>
                {/* copy to the taste gate */}
                <Text style={styles.title}>{addon ? 'edit this extra' : 'a new extra'}</Text>
                <TouchableOpacity onPress={onClose} hitSlop={12}>
                  <X size={22} color={Colors.textMedium} strokeWidth={2} />
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="market food pass"
                placeholderTextColor={Colors.textLight}
                maxLength={TIER_NAME_MAX}
              />

              <Text style={styles.label}>price (blank or 0 = free)</Text>
              <TextInput
                style={styles.input}
                value={priceText}
                onChangeText={setPriceText}
                placeholder="0.00"
                placeholderTextColor={Colors.textLight}
                keyboardType="decimal-pad"
              />
              {!!problem && <Text style={styles.problem}>{problem}</Text>}

              <Text style={styles.label}>description</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={description}
                onChangeText={setDescription}
                placeholder="what this extra gets them"
                placeholderTextColor={Colors.textLight}
                multiline
                maxLength={TIER_DESCRIPTION_MAX}
              />

              {/* the image: optional, event-bucket upload, quiet preview */}
              <TouchableOpacity style={styles.imageBtn} onPress={handlePickImage} disabled={uploading} activeOpacity={0.85}>
                {uploading ? (
                  <ActivityIndicator size="small" color={Colors.darkWarm} />
                ) : imageUrl ? (
                  <Image source={{ uri: imageUrl }} style={styles.imagePreview} contentFit="cover" />
                ) : (
                  /* copy to the taste gate */
                  <Text style={styles.imageBtnText}>add a photo</Text>
                )}
              </TouchableOpacity>

              <View style={styles.pairRow}>
                <View style={styles.pairCol}>
                  <Text style={styles.label}>how many exist (blank = no cap)</Text>
                  <TextInput
                    style={styles.input}
                    value={capText}
                    onChangeText={setCapText}
                    placeholder="no cap"
                    placeholderTextColor={Colors.textLight}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={styles.pairCol}>
                  <Text style={styles.label}>most per purchase (blank = no limit)</Text>
                  <TextInput
                    style={styles.input}
                    value={perOrderMaxText}
                    onChangeText={setPerOrderMaxText}
                    placeholder="no limit"
                    placeholderTextColor={Colors.textLight}
                    keyboardType="number-pad"
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={!canSave}
                activeOpacity={0.85}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.saveBtnText}>{addon ? 'save it' : 'add it'}</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: Colors.overlayDark, justifyContent: 'flex-end' },
  avoider: { justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.parchment,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 34,
    maxHeight: '88%',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  label: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textMedium, marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  problem: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.errorRed, marginTop: 6 },
  imageBtn: {
    marginTop: 12, minHeight: 64, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  imageBtnText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  imagePreview: { width: '100%', height: 120 },
  pairRow: { flexDirection: 'row', gap: 12 },
  pairCol: { flex: 1 },
  saveBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
});
