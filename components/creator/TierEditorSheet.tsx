/**
 * The tier editor (doc 61 §4b/§5): name, description, price with the
 * four-number fee preview (§3 - face, buyer pays, our cut, organizer
 * gets, honest incl. cheap-ticket physics), caps, visibility, and the
 * sales-open/close window (Build 35 Screen 23, 2026-09-01) using the
 * house date pickers. `opens_after_tier_id` chaining is still not
 * edited here - that's a separate slice.
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
import { getLAWallParts, laWallTimeToUTC } from '../../lib/laDate';
import CollapsibleCalendar from '../composer/CollapsibleCalendar';
import TimePicker from '../composer/TimePicker';
import { type CalendarDay } from '../calendar/WashedUpCalendar';
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

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' <-> the calendar's CalendarDay (month 0-based). Mirrors event-form.tsx. */
function parseDateString(s: string): CalendarDay | null {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) } : null;
}

interface TierEditorSheetProps {
  visible: boolean;
  /** null = creating a new tier */
  tier: TicketTier | null;
  commissionBps: number;
  busy: boolean;
  onSave: (draft: TierDraft) => void;
  onClose: () => void;
  /** Pre-fills the name field when creating a new tier (tier === null). Ignored while editing an existing tier. */
  initialName?: string;
}

function parsePriceCents(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const value = Number(cleaned);
  if (isNaN(value)) return null;
  return Math.round(value * 100);
}

export function TierEditorSheet({ visible, tier, commissionBps, busy, onSave, onClose, initialName }: TierEditorSheetProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceText, setPriceText] = useState('');
  const [capText, setCapText] = useState('');
  const [perOrderMinText, setPerOrderMinText] = useState('');
  const [perOrderMaxText, setPerOrderMaxText] = useState('');
  const [hidden, setHidden] = useState(false);
  const [openDate, setOpenDate] = useState('');
  const [openTime, setOpenTime] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [closeTime, setCloseTime] = useState('');

  useEffect(() => {
    if (!visible) return;
    setName(tier?.name ?? initialName ?? '');
    setDescription(tier?.description ?? '');
    setPriceText(tier ? (tier.price_cents === 0 ? '' : (tier.price_cents / 100).toFixed(2)) : '');
    setCapText(tier?.quantity_cap ? String(tier.quantity_cap) : '');
    // 1 is the column's no-minimum default; only a real minimum shows
    setPerOrderMinText(tier && tier.per_order_min > 1 ? String(tier.per_order_min) : '');
    setPerOrderMaxText(tier?.per_order_max ? String(tier.per_order_max) : '');
    setHidden(tier?.visibility === 'hidden');
    const openWall = tier?.sales_open_at ? getLAWallParts(tier.sales_open_at) : null;
    setOpenDate(openWall ? `${openWall.y}-${pad2(openWall.m + 1)}-${pad2(openWall.d)}` : '');
    setOpenTime(openWall ? `${pad2(openWall.hour24)}:${pad2(openWall.minute)}` : '');
    const closeWall = tier?.sales_close_at ? getLAWallParts(tier.sales_close_at) : null;
    setCloseDate(closeWall ? `${closeWall.y}-${pad2(closeWall.m + 1)}-${pad2(closeWall.d)}` : '');
    setCloseTime(closeWall ? `${pad2(closeWall.hour24)}:${pad2(closeWall.minute)}` : '');
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
        ? /* copy to the taste gate: the cheap-ticket physics floor */ 'paid tickets start at $5. under that, fees eat the ticket.'
        : priceCents !== null && priceCents > TIER_MAX_CENTS
          ? 'that is past the $10,000 ceiling.'
          : null;

  // doc 109 (group tickets): min >= 1, never above the per-order max or the
  // tier's own cap; a blank input means 1 (the column's no-minimum default)
  const perOrderMinDraft = perOrderMinText.trim() ? parseInt(perOrderMinText, 10) : null;
  const perOrderMaxDraft = perOrderMaxText.trim() ? parseInt(perOrderMaxText, 10) : null;
  const capDraft = capText.trim() ? parseInt(capText, 10) : null;
  const minProblem =
    perOrderMinDraft === null
      ? null
      : isNaN(perOrderMinDraft) || perOrderMinDraft < 1
        ? /* copy to the taste gate */ 'the minimum has to be at least 1.'
        : perOrderMaxDraft !== null && !isNaN(perOrderMaxDraft) && perOrderMinDraft > perOrderMaxDraft
          ? /* copy to the taste gate */ 'the minimum cannot be more than the most per order.'
          : capDraft !== null && !isNaN(capDraft) && perOrderMinDraft > capDraft
            ? /* copy to the taste gate */ 'the minimum cannot be more than how many exist.'
            : null;

  // sales-open/close window (Screen 23): same LA-wall-clock composition as
  // event-form.tsx's start/end, and the same named bug family applies, so
  // it reuses that file's exact helper (laWallTimeToUTC) rather than
  // rolling a second date-math path.
  const openParsedDay = parseDateString(openDate);
  const openTimeMatch = openTime.trim().match(/^(\d{2}):(\d{2})$/);
  const closeParsedDay = parseDateString(closeDate);
  const closeTimeMatch = closeTime.trim().match(/^(\d{2}):(\d{2})$/);
  const windowProblem = (() => {
    if (closeParsedDay && !closeTimeMatch) return 'the closing time did not parse.';
    if (openParsedDay && !openTimeMatch) return 'the opening time did not parse.';
    if (!closeParsedDay || !closeTimeMatch) return null;
    const closeInstant = laWallTimeToUTC(
      closeParsedDay.year, closeParsedDay.month, closeParsedDay.day,
      Number(closeTimeMatch[1]), Number(closeTimeMatch[2]),
    );
    if (openParsedDay && openTimeMatch) {
      const openInstant = laWallTimeToUTC(
        openParsedDay.year, openParsedDay.month, openParsedDay.day,
        Number(openTimeMatch[1]), Number(openTimeMatch[2]),
      );
      if (closeInstant.getTime() <= openInstant.getTime()) {
        return /* copy to the taste gate */ 'it closes before it opens. pick a later time.';
      }
    }
    return null;
  })();

  const canSave = name.trim().length > 0 && priceProblem === null && minProblem === null && windowProblem === null && !busy;

  const handleSave = () => {
    if (!canSave || priceCents === null) return;
    hapticLight();
    const visibility: TierVisibility = hidden ? 'hidden' : 'visible';
    const cap = capText.trim() ? parseInt(capText, 10) : null;
    const perOrderMax = perOrderMaxText.trim() ? parseInt(perOrderMaxText, 10) : null;
    const salesOpenAt =
      openParsedDay && openTimeMatch
        ? laWallTimeToUTC(openParsedDay.year, openParsedDay.month, openParsedDay.day, Number(openTimeMatch[1]), Number(openTimeMatch[2])).toISOString()
        : null;
    const salesCloseAt =
      closeParsedDay && closeTimeMatch
        ? laWallTimeToUTC(closeParsedDay.year, closeParsedDay.month, closeParsedDay.day, Number(closeTimeMatch[1]), Number(closeTimeMatch[2])).toISOString()
        : null;
    onSave({
      name: name.trim().slice(0, TIER_NAME_MAX),
      description: description.trim() ? description.trim().slice(0, TIER_DESCRIPTION_MAX) : null,
      price_cents: priceCents,
      quantity_cap: cap && cap > 0 ? cap : null,
      per_order_min: perOrderMinDraft && perOrderMinDraft > 1 ? perOrderMinDraft : 1,
      per_order_max: perOrderMax && perOrderMax >= 1 ? perOrderMax : null,
      visibility,
      status: tier?.status ?? 'draft',
      sales_open_at: salesOpenAt,
      sales_close_at: salesCloseAt,
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
                <Text style={styles.freeNote}>free means free. no fees, no card, rsvp as usual.</Text>
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

              {/* doc 109: the per-order pair, minimum beside most, one design */}
              <View style={styles.pairRow}>
                <View style={styles.pairCol}>
                  {/* copy to the taste gate */}
                  <Text style={styles.label}>minimum per purchase (blank = 1)</Text>
                  <TextInput
                    style={styles.input}
                    value={perOrderMinText}
                    onChangeText={setPerOrderMinText}
                    placeholder="1"
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
              {!!minProblem && <Text style={styles.problem}>{minProblem}</Text>}

              <TouchableOpacity style={styles.checkRow} onPress={() => setHidden(!hidden)} activeOpacity={0.7}>
                <View style={[styles.checkbox, hidden && styles.checkboxChecked]}>
                  {hidden && <Text style={styles.checkmark}>✓</Text>}
                </View>
                {/* copy to the taste gate */}
                <Text style={styles.checkLabel}>hidden. only people with the direct link see it</Text>
              </TouchableOpacity>

              {/* copy to the taste gate */}
              <Text style={styles.label}>on sale window (optional)</Text>
              <Text style={styles.windowHint}>blank opens right away and never closes on its own.</Text>

              <Text style={styles.label}>opens</Text>
              <View style={styles.pickerBlock}>
                <CollapsibleCalendar
                  selected={openParsedDay}
                  onSelect={(d) => setOpenDate(`${d.year}-${pad2(d.month + 1)}-${pad2(d.day)}`)}
                  placeholder="opens right away"
                />
              </View>
              <View style={styles.pickerBlock}>
                <TimePicker
                  hour={openTimeMatch ? (Number(openTimeMatch[1]) % 12 === 0 ? 12 : Number(openTimeMatch[1]) % 12) : 12}
                  minute={openTimeMatch ? openTimeMatch[2] : '00'}
                  period={openTimeMatch && Number(openTimeMatch[1]) >= 12 ? 'PM' : 'AM'}
                  selected={!!openTimeMatch}
                  onChange={(hour, minute, period) => {
                    const h = period === 'PM' ? (hour % 12) + 12 : hour % 12;
                    setOpenTime(`${pad2(h)}:${minute}`);
                  }}
                />
                {!openParsedDay && !!openTime && (
                  <Text style={styles.problem}>pick an opening day too.</Text>
                )}
                {!!openTimeMatch && (
                  <TouchableOpacity onPress={() => { hapticLight(); setOpenDate(''); setOpenTime(''); }} hitSlop={8}>
                    <Text style={styles.clearLink}>opens right away instead</Text>
                  </TouchableOpacity>
                )}
              </View>

              <Text style={styles.label}>closes</Text>
              <View style={styles.pickerBlock}>
                <CollapsibleCalendar
                  selected={closeParsedDay}
                  onSelect={(d) => setCloseDate(`${d.year}-${pad2(d.month + 1)}-${pad2(d.day)}`)}
                  placeholder="never closes"
                />
              </View>
              <View style={styles.pickerBlock}>
                <TimePicker
                  hour={closeTimeMatch ? (Number(closeTimeMatch[1]) % 12 === 0 ? 12 : Number(closeTimeMatch[1]) % 12) : 12}
                  minute={closeTimeMatch ? closeTimeMatch[2] : '00'}
                  period={closeTimeMatch && Number(closeTimeMatch[1]) >= 12 ? 'PM' : 'AM'}
                  selected={!!closeTimeMatch}
                  onChange={(hour, minute, period) => {
                    const h = period === 'PM' ? (hour % 12) + 12 : hour % 12;
                    setCloseTime(`${pad2(h)}:${minute}`);
                  }}
                />
                {!closeParsedDay && !!closeTime && (
                  <Text style={styles.problem}>pick a closing day too.</Text>
                )}
                {!!closeTimeMatch && (
                  <TouchableOpacity onPress={() => { hapticLight(); setCloseDate(''); setCloseTime(''); }} hitSlop={8}>
                    <Text style={styles.clearLink}>never closes instead</Text>
                  </TouchableOpacity>
                )}
              </View>
              {!!windowProblem && <Text style={styles.problem}>{windowProblem}</Text>}

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
  pairRow: { flexDirection: 'row', gap: 12 },
  pairCol: { flex: 1 },
  windowHint: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.textLight, marginBottom: 6 },
  pickerBlock: { marginBottom: 10 },
  clearLink: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.textLight,
    marginTop: 6,
  },
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
