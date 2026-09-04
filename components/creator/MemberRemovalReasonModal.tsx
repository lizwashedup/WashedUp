import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

// Liz decision #10 (2026-09-03): removing a member requires a recorded
// reason. Rendered only when constants/FeatureFlags.ts's
// MEMBER_REMOVAL_REASON_ENABLED is on; see app/(creator)/members.tsx.

interface Props {
  visible: boolean;
  memberName: string | null;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}

export function MemberRemovalReasonModal({ visible, memberName, submitting, onCancel, onSubmit }: Props) {
  const [reason, setReason] = useState('');

  const handleCancel = () => {
    setReason('');
    onCancel();
  };

  const handleSubmit = () => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setReason('');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <Pressable style={styles.backdrop} onPress={handleCancel}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Remove {memberName ?? 'this member'}?</Text>
          <Text style={styles.body}>
            They lose access to the community and its chat. A reason is required, and you can undo this later.
          </Text>
          <TextInput
            style={styles.input}
            value={reason}
            onChangeText={setReason}
            placeholder="Why are you removing them?"
            placeholderTextColor={Colors.textLight}
            multiline
            maxLength={500}
            autoFocus
          />
          <View style={styles.row}>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} activeOpacity={0.7} disabled={submitting}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.removeBtn, (!reason.trim() || submitting) && styles.removeBtnDisabled]}
              onPress={handleSubmit}
              activeOpacity={0.85}
              disabled={!reason.trim() || submitting}
            >
              <Text style={styles.removeBtnText}>Remove</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: Colors.overlayDark,
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  card: {
    width: '100%', maxWidth: 360,
    backgroundColor: Colors.parchment, borderRadius: 12,
    padding: 22, gap: 12,
  },
  title: {
    fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
  },
  body: {
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, lineHeight: 22,
    color: Colors.textMedium,
  },
  input: {
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.asphalt,
    backgroundColor: Colors.inputBg, borderRadius: 10, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 12, minHeight: 80, textAlignVertical: 'top',
  },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.border,
  },
  cancelBtnText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  removeBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.errorRed,
  },
  removeBtnDisabled: { opacity: 0.4 },
  removeBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
});
