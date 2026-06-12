/**
 * NameCircleSheet - the front door to name an unnamed circle.
 *
 * An unnamed circle (a DM that grew a third person) renders as its member names
 * until someone gives it an identity. This bottom sheet is that "Name this
 * circle" action, surfaced on the View-circle page for admins only (update_circle
 * is admin-gated; the DM's original pair are both admins). Name is required; the
 * description is optional. The monogram preview updates live as you type, mirroring
 * the create-circle IdentityStep so the two naming surfaces feel the same.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, ImagePlus } from 'lucide-react-native';
import * as Crypto from 'expo-crypto';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { CIRCLE_CREATE } from '../../constants/YoursDesign';
import { COPY } from '../yours/state/constants';
import { BrandedAlert } from '../BrandedAlert';
import { useUpdateCircle } from '../../hooks/useUpdateCircle';
import { uploadBase64ToStorage } from '../../lib/uploadPhoto';
import { pickCoverPhoto } from '../../lib/circles/pickCover';
import { buildCircleCoverUrl } from '../../lib/circles/coverUrl';
import CircleCover from '../yours/circles/CircleCover';

export default function NameCircleSheet({
  visible,
  circleId,
  userId,
  currentCoverUploadId,
  onClose,
  onNamed,
}: {
  visible: boolean;
  circleId: string;
  userId: string | null | undefined;
  /** The circle's existing manual cover, if any; enables "Remove cover". */
  currentCoverUploadId?: string | null;
  onClose: () => void;
  onNamed?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const update = useUpdateCircle(circleId, userId);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [coverBase64, setCoverBase64] = useState<string | null>(null);
  const [coverPreviewUri, setCoverPreviewUri] = useState<string | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorVisible, setErrorVisible] = useState(false);

  const busy = update.isPending || saving;
  const canSave = name.trim().length > 0 && !busy;

  const currentCoverUrl = buildCircleCoverUrl(circleId, currentCoverUploadId);
  // Show the existing cover in the preview unless the user picked a new one or
  // staged its removal. A staged removal drops the preview to the monogram.
  const previewCoverUrl = coverPreviewUri ?? (removeCover ? null : currentCoverUrl);
  // "Remove cover" applies to a saved manual cover only (a not-yet-saved pick is
  // cleared by re-picking). Hidden once removal is staged or a new cover is picked.
  const showRemoveCover = !!currentCoverUrl && !coverPreviewUri && !removeCover;

  const reset = () => {
    setName('');
    setDescription('');
    setCoverBase64(null);
    setCoverPreviewUri(null);
    setRemoveCover(false);
  };
  const close = () => { reset(); onClose(); };

  const onPickCover = async () => {
    const picked = await pickCoverPhoto();
    if (picked) {
      setCoverBase64(picked.base64);
      setCoverPreviewUri(picked.uri);
      setRemoveCover(false);
    }
  };

  const save = async () => {
    if (name.trim().length === 0 || busy) return;
    let coverUploadId: string | undefined;
    if (coverBase64) {
      setSaving(true);
      try {
        coverUploadId = Crypto.randomUUID();
        await uploadBase64ToStorage('circle-covers', `${circleId}/${coverUploadId}`, coverBase64, { upsert: true });
      } catch {
        coverUploadId = undefined; // cover failed; still save name + description
      } finally {
        setSaving(false);
      }
    }
    update.mutate(
      { name: name.trim(), description: description.trim() || null, coverUploadId, clearCover: removeCover },
      {
        onSuccess: () => { reset(); onNamed?.(); onClose(); },
        onError: () => setErrorVisible(true),
      },
    );
  };

  return (
    <>
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={styles.backdropTap} onPress={close} accessibilityLabel={COPY.circlePlusCancel} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.header}>
            <Text style={styles.title}>{COPY.circleNameSheetTitle}</Text>
            <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel={COPY.circlePlusCancel}>
              <X size={22} color={Colors.secondary} />
            </Pressable>
          </View>
          <Text style={styles.sub}>{COPY.circleNameSheetSub}</Text>

          <View style={styles.coverWrap}>
            <CircleCover
              name={name}
              coverUrl={previewCoverUrl}
              size={CIRCLE_CREATE.coverPreview}
              radius={CIRCLE_CREATE.coverPreviewRadius}
              monogramSize={CIRCLE_CREATE.coverMonogram}
            />
            <Pressable
              onPress={onPickCover}
              android_ripple={{ color: Colors.border }}
              style={styles.coverBtn}
              accessibilityRole="button"
              accessibilityLabel={previewCoverUrl ? COPY.circleCoverChange : COPY.circleCoverAdd}
            >
              <ImagePlus size={16} color={Colors.terracotta} strokeWidth={1.75} />
              <Text style={styles.coverBtnText}>
                {previewCoverUrl ? COPY.circleCoverChange : COPY.circleCoverAdd}
              </Text>
            </Pressable>
            {showRemoveCover && (
              <Pressable
                onPress={() => setRemoveCover(true)}
                hitSlop={8}
                style={styles.removeCoverBtn}
                accessibilityRole="button"
                accessibilityLabel={COPY.circleCoverRemove}
              >
                <Text style={styles.removeCoverText}>{COPY.circleCoverRemove}</Text>
              </Pressable>
            )}
          </View>

          <TextInput
            style={styles.field}
            value={name}
            onChangeText={setName}
            placeholder={COPY.circleNamePlaceholder}
            placeholderTextColor={Colors.tertiary}
            maxLength={60}
            autoFocus
            returnKeyType="next"
          />
          <TextInput
            style={[styles.field, styles.desc]}
            value={description}
            onChangeText={setDescription}
            placeholder={COPY.circleDescPlaceholder}
            placeholderTextColor={Colors.tertiary}
            multiline
            maxLength={140}
          />

          <Pressable
            onPress={save}
            disabled={!canSave}
            android_ripple={{ color: Colors.border }}
            style={[styles.cta, !canSave && styles.ctaDisabled]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave }}
            accessibilityLabel={COPY.circleNameSheetSave}
          >
            {busy ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.ctaLabel}>{COPY.circleNameSheetSave}</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    <BrandedAlert
      visible={errorVisible}
      title={COPY.circleNameSheetError}
      onClose={() => setErrorVisible(false)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  backdropTap: { flex: 1 },
  sheet: {
    backgroundColor: Colors.parchment,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  title: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displaySM, color: Colors.darkWarm },
  sub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.secondary,
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 8,
  },
  coverWrap: { alignItems: 'center', marginVertical: 12 },
  coverBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
  },
  coverBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  removeCoverBtn: { marginTop: 8, paddingHorizontal: 8, paddingVertical: 4 },
  removeCoverText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary },
  field: {
    backgroundColor: Colors.inputBg,
    borderRadius: CIRCLE_CREATE.fieldRadius,
    minHeight: CIRCLE_CREATE.fieldMinHeight,
    marginHorizontal: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
    marginBottom: 12,
  },
  desc: { minHeight: CIRCLE_CREATE.descMinHeight, textAlignVertical: 'top' },
  cta: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    marginHorizontal: 20,
    marginTop: 4,
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  ctaLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
});
