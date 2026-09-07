import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

/**
 * Refund-authority delegate reason capture (Liz's item 14, 2026-09-04):
 * ticket-refund/index.ts and record_refund_issuance both require a
 * non-empty reason whenever the person issuing a refund is a granted
 * delegate rather than the event's real owner -- the owner is never asked
 * to justify refunding their own event, so this step only ever appears for
 * a delegate issuer. Same shape as MemberRemovalReasonModal (confirm +
 * required reason in one step), a separate component because the two
 * features' copy and destructive color don't overlap.
 */
interface Props {
  visible: boolean;
  /** e.g. "$25.00" -- the server-previewed amount, never client math. */
  amountLabel: string;
  /** e.g. "this seat" / "the whole purchase" */
  scopeLabel: string;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}

export function RefundReasonModal({ visible, amountLabel, scopeLabel, submitting, onCancel, onSubmit }: Props) {
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
          {/* copy to the taste gate */}
          <Text style={styles.title}>refund {amountLabel}?</Text>
          <Text style={styles.body}>
            {scopeLabel}. you&apos;re issuing this as a granted delegate, not the owner, so a short reason is required for their records.
          </Text>
          <TextInput
            style={styles.input}
            value={reason}
            onChangeText={setReason}
            placeholder="why is this being refunded?"
            placeholderTextColor={Colors.textLight}
            multiline
            maxLength={500}
            autoFocus
          />
          <View style={styles.row}>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} activeOpacity={0.7} disabled={submitting}>
              <Text style={styles.cancelBtnText}>never mind</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitBtn, (!reason.trim() || submitting) && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              activeOpacity={0.85}
              disabled={!reason.trim() || submitting}
            >
              <Text style={styles.submitBtnText}>refund it</Text>
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
  submitBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.errorBrand,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
});
