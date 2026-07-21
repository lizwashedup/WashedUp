/**
 * The tier editor (doc 61 §4b/§5): name, description, price with the
 * four-number fee preview (§3 — face, buyer pays, our cut, organizer
 * gets, honest incl. cheap-ticket physics), caps, visibility. Windows
 * and chaining are 65 columns the sheet does not edit yet — they ride
 * the next slice with the house date pickers.
 */

import React, { useEffect, useMemo, useState } from 'react';
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
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { hapticLight } from '../../lib/haptics';
import {
  computeFeePreview,
  formatCents,
  TIER_DESCRIPTION_MAX,
  TIER_MIN_PAID_CENTS,
  TIER_MAX_CENTS,
  TIER_NAME_MAX,
  type TicketTier,
  type TierDraft,
  type TierVisibility,
} from '../../lib/ticketing';

interface TierEditorSheetProps {
  visible: boolean;
  /** null = creating a new tier */
  tier: TicketTier | null;
  commissionBps: number;
  busy: boolean;
  onSave: (draft: TierDraft) => void;
  onClose: () => void;
}

function parsePriceCents(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const value = Number(cleaned);
  if (isNaN(value)) return null;
  return Math.round(value * 100);
}

export function TierEditorSheet({ visible, tier, commissionBps, busy, onSave, onClose }: TierEditorSheetProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceText, setPriceText] = useState('');
  const [capText, setCapText] = useState('');
  const [perOrderMaxText, setPerOrderMaxText] = useState('');
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(tier?.name ?? '');
    setDescription(tier?.description ?? '');
    setPriceText(tier ? (tier.price_cents === 0 ? '' : (tier.price_cents / 100).toFixed(2)) : '');
    setCapText(tier?.quantity_cap ? String(tier.quantity_cap) : '');
    setPerOrderMaxText(tier?.per_order_max ? String(tier.per_order_max) : '');
    setHidden(tier?.visibility === 'hidden');
  }, [visible, tier]);

  const priceCents = parsePriceCents(priceText);
  const preview = useMemo(
    () => computeFeePreview(priceCents ?? 0, commissionBps),
    [priceCents, commissionBps],
  );

  const priceProblem =
    priceCents === null
      ? /* copy to the taste gate */ 'that price does not read as a number.'
      : priceCents !== 0 && priceCents < TIER_MIN_PAID_CENTS
        ? /* copy to the taste gate: the cheap-ticket physics floor */ 'paid tickets start at $5 — under that, fees eat the ticket.'
        : priceCents !== null && priceCents > TIER_MAX_CENTS
          ? 'that is past the $10,000 ceiling.'
          : null;

  const canSave = name.trim().length > 0 && priceProblem === null && !busy;

  const handleSave = () => {
    if (!canSave || priceCents === null) return;
    hapticLight();
    const visibility: TierVisibility = hidden ? 'hidden' : 'visible';
    const cap = capText.trim() ? parseInt(capText, 10) : null;
    const perOrderMax = perOrderMaxText.trim() ? parseInt(perOrderMaxText, 10) : null;
    onSave({
      name: name.trim().slice(0, TIER_NAME_MAX),
      description: description.trim() ? description.trim().slice(0, TIER_DESCRIPTION_MAX) : null,
      price_cents: priceCents,
      quantity_cap: cap && cap > 0 ? cap : null,
      per_order_max: perOrderMax && perOrderMax >= 1 ? perOrderMax : null,
      visibility,
      status: tier?.status ?? 'draft',
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
                <Text style={styles.title}>{tier ? 'edit this ticket' : 'a new ticket'}</Text>
                <TouchableOpacity onPress={onClose} hitSlop={12}>
                  <Text style={styles.closeX}>✕</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="general admission"
                placeholderTextColor={Colors.textLight}
                maxLength={TIER_NAME_MAX}
              />

              <Text style={styles.label}>description</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={description}
                onChangeText={setDescription}
                placeholder="what this ticket gets them"
                placeholderTextColor={Colors.textLight}
                multiline
                maxLength={TIER_DESCRIPTION_MAX}
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
              {!!priceProblem && <Text style={styles.problem}>{priceProblem}</Text>}

              {priceCents !== null && priceCents > 0 && priceProblem === null && (
                <View style={styles.previewBox}>
                  {/* the §3 four numbers, honest (copy to the taste gate) */}
                  <View style={styles.previewRow}>
                    <Text style={styles.previewLabel}>ticket price</Text>
                    <Text style={styles.previewValue}>{formatCents(preview.faceCents)}</Text>
                  </View>
                  <View style={styles.previewRow}>
                    <Text style={styles.previewLabel}>what they pay at checkout</Text>
                    <Text style={styles.previewValue}>{formatCents(preview.buyerTotalCents)}</Text>
                  </View>
                  <View style={styles.previewRow}>
                    <Text style={styles.previewLabel}>washedup's {(commissionBps / 100).toFixed(commissionBps % 100 === 0 ? 0 : 2)}%</Text>
                    <Text style={styles.previewValue}>{formatCents(preview.commissionCents)}</Text>
                  </View>
                  <View style={styles.previewRow}>
                    <Text style={styles.previewLabelStrong}>what you receive</Text>
                    <Text style={styles.previewValueStrong}>{formatCents(preview.organizerCents)}</Text>
                  </View>
                </View>
              )}
              {priceCents === 0 && (
                /* copy to the taste gate: free is free at the code level */
                <Text style={styles.freeNote}>free means free — no fees, no card, rsvp as usual.</Text>
              )}

              <Text style={styles.label}>how many exist (blank = no cap)</Text>
              <TextInput
                style={styles.input}
                value={capText}
                onChangeText={setCapText}
                placeholder="no cap"
                placeholderTextColor={Colors.textLight}
                keyboardType="number-pad"
              />

              <Text style={styles.label}>most per order (blank = no limit)</Text>
              <TextInput
                style={styles.input}
                value={perOrderMaxText}
                onChangeText={setPerOrderMaxText}
                placeholder="no limit"
                placeholderTextColor={Colors.textLight}
                keyboardType="number-pad"
              />

              <TouchableOpacity style={styles.checkRow} onPress={() => setHidden(!hidden)} activeOpacity={0.7}>
                <View style={[styles.checkbox, hidden && styles.checkboxChecked]}>
                  {hidden && <Text style={styles.checkmark}>✓</Text>}
                </View>
                {/* copy to the taste gate */}
                <Text style={styles.checkLabel}>hidden — only people with the direct link see it</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={!canSave}
                activeOpacity={0.85}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.saveBtnText}>{tier ? 'save it' : 'add it'}</Text>
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
  closeX: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.textMedium },
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
  previewBox: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginTop: 12,
    gap: 8,
  },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between' },
  previewLabel: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  previewValue: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  previewLabelStrong: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  previewValueStrong: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  freeNote: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, marginTop: 8 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  checkmark: { color: Colors.white, fontSize: FontSizes.bodySM, fontFamily: Fonts.sansBold },
  checkLabel: { flex: 1, fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.asphalt },
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
