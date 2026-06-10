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
  Alert,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { CIRCLE_CREATE } from '../../constants/YoursDesign';
import { COPY } from '../yours/state/constants';
import { useUpdateCircle } from '../../hooks/useUpdateCircle';
import CircleCover from '../yours/circles/CircleCover';

export default function NameCircleSheet({
  visible,
  circleId,
  userId,
  onClose,
  onNamed,
}: {
  visible: boolean;
  circleId: string;
  userId: string | null | undefined;
  onClose: () => void;
  onNamed?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const update = useUpdateCircle(circleId, userId);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const canSave = name.trim().length > 0 && !update.isPending;

  const close = () => {
    setName('');
    setDescription('');
    onClose();
  };

  const save = () => {
    if (!canSave) return;
    update.mutate(
      { name: name.trim(), description: description.trim() || null },
      {
        onSuccess: () => {
          setName('');
          setDescription('');
          onNamed?.();
          onClose();
        },
        onError: () => Alert.alert(COPY.circleNameSheetError),
      },
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
              coverUrl={null}
              size={CIRCLE_CREATE.coverPreview}
              radius={CIRCLE_CREATE.coverPreviewRadius}
              monogramSize={CIRCLE_CREATE.coverMonogram}
            />
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
            style={({ pressed }) => [styles.cta, !canSave && styles.ctaDisabled, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave }}
            accessibilityLabel={COPY.circleNameSheetSave}
          >
            {update.isPending ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.ctaLabel}>{COPY.circleNameSheetSave}</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
