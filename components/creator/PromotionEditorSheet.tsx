/**
 * The promotion editor (doc 113): a code, percent-or-amount off, an
 * optional uses cap, an optional window. Mirrors TierEditorSheet's shape
 * and tokens; reachable only from the probe-gated promotions section, so
 * it cannot exist before the schema does.
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
import { X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { hapticLight } from '../../lib/haptics';
import { laWallTimeToUTC } from '../../lib/laDate';
import { type PromotionDraft } from '../../lib/ticketPromosAddons';

const CODE_MAX = 40;

interface PromotionEditorSheetProps {
  visible: boolean;
  busy: boolean;
  onSave: (draft: PromotionDraft) => void;
  onClose: () => void;
}

/** 'YYYY-MM-DD' on the LA calendar -> the instant that day begins/ends. */
function laDayInstant(dateStr: string, endOfDay: boolean): string | null {
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return laWallTimeToUTC(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    endOfDay ? 23 : 0, endOfDay ? 59 : 0,
  ).toISOString();
}

export function PromotionEditorSheet({ visible, busy, onSave, onClose }: PromotionEditorSheetProps) {
  const [code, setCode] = useState('');
  const [isPercent, setIsPercent] = useState(true);
  const [valueText, setValueText] = useState('');
  const [usesText, setUsesText] = useState('');
  const [startText, setStartText] = useState('');
  const [endText, setEndText] = useState('');

  useEffect(() => {
    if (!visible) return;
    setCode('');
    setIsPercent(true);
    setValueText('');
    setUsesText('');
    setStartText('');
    setEndText('');
  }, [visible]);

  const value = valueText.trim() ? Number(valueText.replace(/[^0-9.]/g, '')) : NaN;
  const uses = usesText.trim() ? parseInt(usesText, 10) : null;
  const dayShape = /^\d{4}-\d{2}-\d{2}$/;

  const problem = !code.trim()
    ? null // no complaint until they type; save just stays off
    : isNaN(value) || value <= 0
      ? /* copy to the taste gate */ 'give the code a real value.'
      : isPercent && value > 100
        ? /* copy to the taste gate */ 'a percent tops out at 100.'
        : uses !== null && (isNaN(uses) || uses < 1)
          ? /* copy to the taste gate */ 'uses start at 1.'
          : (startText.trim() && !dayShape.test(startText.trim())) || (endText.trim() && !dayShape.test(endText.trim()))
            ? /* copy to the taste gate */ 'dates use the YYYY-MM-DD shape.'
            : null;

  const canSave = code.trim().length > 0 && !isNaN(value) && value > 0 && problem === null && !busy;

  const handleSave = () => {
    if (!canSave) return;
    hapticLight();
    onSave({
      code: code.trim().toUpperCase().slice(0, CODE_MAX),
      percent_off: isPercent ? value : null,
      amount_off_cents: isPercent ? null : Math.round(value * 100),
      uses_cap: uses && uses >= 1 ? uses : null,
      // the window rides LA calendar days: starts at that day's first
      // minute, ends at that day's last (the LA-clock law)
      starts_at: startText.trim() ? laDayInstant(startText, false) : null,
      ends_at: endText.trim() ? laDayInstant(endText, true) : null,
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
                <Text style={styles.title}>a new code</Text>
                <TouchableOpacity onPress={onClose} hitSlop={12}>
                  <X size={22} color={Colors.textMedium} strokeWidth={2} />
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>the code people type</Text>
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={setCode}
                placeholder="EARLYBIRD"
                placeholderTextColor={Colors.textLight}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={CODE_MAX}
              />

              {/* percent or amount: one toggle pair, no third state */}
              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[styles.toggle, isPercent && styles.toggleOn]}
                  onPress={() => { hapticLight(); setIsPercent(true); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isPercent }}
                >
                  {/* copy to the taste gate */}
                  <Text style={[styles.toggleText, isPercent && styles.toggleTextOn]}>percent off</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggle, !isPercent && styles.toggleOn]}
                  onPress={() => { hapticLight(); setIsPercent(false); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: !isPercent }}
                >
                  {/* copy to the taste gate */}
                  <Text style={[styles.toggleText, !isPercent && styles.toggleTextOn]}>dollars off</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>{isPercent ? 'percent (like 25)' : 'dollars (like 10.00)'}</Text>
              <TextInput
                style={styles.input}
                value={valueText}
                onChangeText={setValueText}
                placeholder={isPercent ? '25' : '10.00'}
                placeholderTextColor={Colors.textLight}
                keyboardType="decimal-pad"
              />

              <Text style={styles.label}>how many times it works (blank = no cap)</Text>
              <TextInput
                style={styles.input}
                value={usesText}
                onChangeText={setUsesText}
                placeholder="no cap"
                placeholderTextColor={Colors.textLight}
                keyboardType="number-pad"
              />

              {/* the window, LA calendar days (blank = always) */}
              <View style={styles.pairRow}>
                <View style={styles.pairCol}>
                  {/* copy to the taste gate */}
                  <Text style={styles.label}>works from (blank = now)</Text>
                  <TextInput
                    style={styles.input}
                    value={startText}
                    onChangeText={setStartText}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={Colors.textLight}
                    autoCorrect={false}
                  />
                </View>
                <View style={styles.pairCol}>
                  <Text style={styles.label}>until (blank = sales end)</Text>
                  <TextInput
                    style={styles.input}
                    value={endText}
                    onChangeText={setEndText}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={Colors.textLight}
                    autoCorrect={false}
                  />
                </View>
              </View>

              {!!problem && <Text style={styles.problem}>{problem}</Text>}

              <TouchableOpacity
                style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={!canSave}
                activeOpacity={0.85}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  /* copy to the taste gate */
                  <Text style={styles.saveBtnText}>add it</Text>
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
  toggleRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  toggle: {
    flex: 1, borderRadius: 999, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
    paddingVertical: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center',
  },
  toggleOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  toggleText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  toggleTextOn: { color: Colors.white },
  pairRow: { flexDirection: 'row', gap: 12 },
  pairCol: { flex: 1 },
  problem: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.errorRed, marginTop: 6 },
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
