import {useAfterglowFonts} from '../../hooks/useAfterglowFonts';
import {useMemo} from 'react';
import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Colors from '../../constants/Colors';
import { type AfterglowFontFamilies, FontSizes } from '../../constants/Typography';

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
  onSubmit: (reason: string) => Promise<boolean>;
  problem?: string;
}

export function RefundReasonModal({ visible, amountLabel, scopeLabel, submitting, onCancel, onSubmit, problem }: Props) {
  const {fonts}=useAfterglowFonts(true, 'creator');
  const styles=useMemo(()=>createStyles(fonts),[fonts]);
  const [reason, setReason] = useState('');
  const submitLock = useRef(false);

  const handleCancel = () => {
    if (submitting || submitLock.current) return;
    setReason('');
    onCancel();
  };

  const handleSubmit = async () => {
    const trimmed = reason.trim();
    if (!trimmed || submitting || submitLock.current) return;
    submitLock.current = true;
    try { if (await onSubmit(trimmed)) setReason(''); }
    finally { submitLock.current = false; }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><Pressable style={styles.backdrop} onPress={handleCancel}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {/* copy to the taste gate */}
          <Text accessibilityRole="header" style={styles.title}>Refund {amountLabel}?</Text>
          <Text style={styles.body}>
            {scopeLabel}{/[.!?…]\s*$/.test(scopeLabel) ? '' : '.'} Add a short reason for the creator’s records.
          </Text>
          <TextInput
            style={styles.input}
            accessibilityLabel="Refund reason"
            editable={!submitting}
            value={reason}
            onChangeText={setReason}
            placeholder="why is this being refunded?"
            placeholderTextColor={Colors.textLight}
            multiline
            maxLength={500}
            autoFocus
          />
          {problem && <Text accessibilityRole="alert" style={styles.problem}>{problem}</Text>}
          <View style={styles.row}>
            <TouchableOpacity style={styles.cancelBtn} accessibilityRole="button" accessibilityLabel="Cancel refund" onPress={handleCancel} activeOpacity={0.7} disabled={submitting}>
              <Text style={styles.cancelBtnText}>never mind</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitBtn, (!reason.trim() || submitting) && styles.submitBtnDisabled]}
              accessibilityRole="button" accessibilityLabel="Confirm refund" onPress={() => { void handleSubmit(); }}
              activeOpacity={0.85}
              disabled={!reason.trim() || submitting}
            >
              <Text style={styles.submitBtnText}>{submitting ? 'Sending…' : 'Refund it'}</Text>
            </TouchableOpacity>
          </View></ScrollView>
        </Pressable>
      </Pressable></KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  keyboard: {flex:1},
  content: {padding:20,gap:12},
  problem: {fontFamily:fonts.regular,fontSize:FontSizes.bodySM,color:Colors.errorBrand},
  backdrop: {
    flex: 1, backgroundColor: Colors.overlayDark,
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  card: {
    width: '100%', maxWidth: 360,
    backgroundColor: Colors.parchment, borderRadius: 20, maxHeight:'90%',
  },
  title: {
    fontFamily: fonts.display, fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
  },
  body: {
    fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, lineHeight: 22,
    color: Colors.textMedium,
  },
  input: {
    fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, color: Colors.asphalt,
    backgroundColor: Colors.inputBg, borderRadius: 10, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 12, minHeight: 80, textAlignVertical: 'top',
  },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.border,
  },
  cancelBtnText: { fontFamily: fonts.medium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  submitBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.errorBrand,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: Colors.white },
}); }
