import {useAfterglowFonts} from '../../hooks/useAfterglowFonts';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
/**
 * The tier editor (doc 61 §4b/§5): name, description, price with the
 * four-number fee preview (§3 - face, buyer pays, our cut, organizer
 * gets, honest incl. cheap-ticket physics), caps, visibility, and the
 * sales-open/close window (Build 35 Screen 23, 2026-09-01) using the
 * house date pickers. `opens_after_tier_id` chaining is still not
 * edited here - that's a separate slice.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Colors from '../../constants/Colors';
import { type AfterglowFontFamilies, FontSizes } from '../../constants/Typography';
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
  onSave: (draft: TierDraft) => void | Promise<unknown>;
  draftKey?: string;
  scope?: CreatorPageScope;
  onClose: () => void;
  onDiscard?: () => void;
  /** Pre-fills the name field when creating a new tier (tier === null). Ignored while editing an existing tier. */
  initialName?: string;
  /** Restores an unsaved new tier after the creator fixes a required event field. */
  initialDraft?: TierDraft | null;
}

function parsePriceCents(text: string): number | null {
  const cleaned = text.trim();
  if (!cleaned) return 0;
  if (!/^\d+(?:\.\d{0,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function TierEditorSheet({ visible, tier, commissionBps, busy, onSave, onClose, initialName, initialDraft, draftKey, scope, onDiscard }: TierEditorSheetProps) {
  const {fonts}=useAfterglowFonts(true, 'creator');
  const styles=useMemo(()=>createStyles(fonts),[fonts]);
  const [saving, setSaving] = useState(false);
  const locked = busy || saving;
  const [saveProblem, setSaveProblem] = useState<string>();
  const seededKey = useRef<string | undefined>(undefined);
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
  const [saveAttempted, setSaveAttempted] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const nameRef = useRef<TextInput>(null);
  const saveLockRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    if (draftKey && seededKey.current === draftKey) return;
    seededKey.current = draftKey; setSaveProblem(undefined);
    const source = initialDraft ?? tier;
    setName(source?.name ?? initialName ?? '');
    setDescription(source?.description ?? '');
    setPriceText(source ? (source.price_cents === 0 ? '' : (source.price_cents / 100).toFixed(2)) : '');
    setCapText(source?.quantity_cap ? String(source.quantity_cap) : '');
    // 1 is the column's no-minimum default; only a real minimum shows
    setPerOrderMinText(source && source.per_order_min > 1 ? String(source.per_order_min) : '');
    setPerOrderMaxText(source?.per_order_max ? String(source.per_order_max) : '');
    setHidden(source?.visibility === 'hidden');
    const openWall = source?.sales_open_at ? getLAWallParts(source.sales_open_at) : null;
    setOpenDate(openWall ? `${openWall.y}-${pad2(openWall.m + 1)}-${pad2(openWall.d)}` : '');
    setOpenTime(openWall ? `${pad2(openWall.hour24)}:${pad2(openWall.minute)}` : '');
    const closeWall = source?.sales_close_at ? getLAWallParts(source.sales_close_at) : null;
    setCloseDate(closeWall ? `${closeWall.y}-${pad2(closeWall.m + 1)}-${pad2(closeWall.d)}` : '');
    setCloseTime(closeWall ? `${pad2(closeWall.hour24)}:${pad2(closeWall.minute)}` : '');
    setSaveAttempted(false);
  }, [visible, tier, initialName, initialDraft, draftKey]);

  useEffect(() => {
    if (!busy) saveLockRef.current = false;
  }, [busy]);

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
  const quantityProblem = [capText,perOrderMinText,perOrderMaxText].some(v => v.trim() && (!/^\d+$/.test(v.trim()) || !Number.isSafeInteger(Number(v)) || Number(v)<1)) ? 'Use positive whole numbers for ticket quantities.' : null;
  const minProblem =
    perOrderMinDraft === null
      ? null
      : isNaN(perOrderMinDraft) || perOrderMinDraft < 1
        ? /* copy to the taste gate */ 'the minimum has to be at least 1.'
        : perOrderMaxDraft !== null && !isNaN(perOrderMaxDraft) && perOrderMinDraft > perOrderMaxDraft
          ? /* copy to the taste gate */ 'the minimum cannot be more than the most per order.'
          : capDraft !== null && !isNaN(capDraft) && perOrderMinDraft > capDraft
            ? /* copy to the taste gate */ 'the minimum cannot be more than the total tickets.'
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
    if (openTime && !openParsedDay) return 'Pick an opening day too.';
    if (closeTime && !closeParsedDay) return 'Pick a closing day too.';
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

  const nameProblem = saveAttempted && name.trim().length === 0
    ? 'give this ticket a name.'
    : null;
  const hasValidationProblem = name.trim().length === 0 || priceProblem !== null || minProblem !== null || quantityProblem !== null || windowProblem !== null;

  const handleSave = async () => {
    setSaveAttempted(true);
    if ((scope && !scope.isCurrent()) || saveLockRef.current || busy || hasValidationProblem || priceCents === null) {
      if (name.trim().length === 0) {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
        nameRef.current?.focus();
      }
      return;
    }
    saveLockRef.current = true; setSaving(true); setSaveProblem(undefined);
    const owned = scope;
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
    try { await onSave({
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
    }); } catch (error) { if (!owned || owned.isCurrent()) setSaveProblem(error instanceof Error ? error.message : 'The save could not be confirmed. Your draft is kept.'); }
    finally { saveLockRef.current = false; setSaving(false); }
  };

  const handleClose = () => {
    if (saveLockRef.current || busy) return;
    Keyboard.dismiss();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={handleClose}>
      {/* Native modals render outside the screen's safe-area tree. Giving
          this modal its own provider keeps reopened editors below the
          iPhone status bar and Dynamic Island. */}
      <SafeAreaProvider>
        <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.avoider}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={handleClose} disabled={locked} style={styles.closeControl} accessibilityRole="button" accessibilityLabel="close ticket editor">
              <Text style={styles.closeText}>close</Text>
            </TouchableOpacity>
            <Text style={styles.title}>{tier ? 'Edit ticket' : 'New ticket'}</Text>
              <TouchableOpacity
                style={[styles.saveBtn, locked && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={locked}
                activeOpacity={0.85}
                accessibilityRole="button"
              >
                {locked ? (
                  <ActivityIndicator size="small" color={Colors.terracotta} />
                ) : (
                  <Text style={styles.saveBtnText}>Save</Text>
                )}
              </TouchableOpacity>
          </View>

          {saveProblem && <View style={styles.recovery}>
            <Text accessibilityRole="alert" style={styles.problem}>{saveProblem}</Text>
            {onDiscard && <TouchableOpacity accessibilityRole="button" disabled={locked} style={styles.discardControl} onPress={() => {if(!saveLockRef.current&&!busy)onDiscard();}}><Text style={styles.closeText}>Discard draft</Text></TouchableOpacity>}
          </View>}
          <ScrollView
            pointerEvents={locked ? 'none' : 'auto'}
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            showsVerticalScrollIndicator={false}
          >

              {quantityProblem && <Text accessibilityRole="alert" style={styles.problem}>{quantityProblem}</Text>}
              <Text style={styles.label}>ticket name · required</Text>
              <TextInput
                editable={!locked}
                ref={nameRef}
                style={[styles.input, !!nameProblem && styles.inputProblem]}
                value={name}
                onChangeText={setName}
                placeholder="general admission"
                placeholderTextColor={Colors.textLight}
                maxLength={TIER_NAME_MAX}
                returnKeyType="next"
                accessibilityLabel="ticket name, required"
              />
              {!!nameProblem && <Text style={styles.problem}>{nameProblem}</Text>}

              <Text style={styles.label}>description</Text>
              <TextInput
                editable={!locked}
                style={[styles.input, styles.inputMultiline]}
                accessibilityLabel="Ticket description"
                value={description}
                onChangeText={setDescription}
                placeholder="what this ticket gets them"
                placeholderTextColor={Colors.textLight}
                multiline
                maxLength={TIER_DESCRIPTION_MAX}
              />

              <Text style={styles.label}>price (blank or 0 = free)</Text>
              <TextInput
                editable={!locked}
                style={styles.input}
                accessibilityLabel="Ticket price in dollars"
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

              <Text style={styles.label}>total tickets (blank = no cap)</Text>
              <TextInput
                editable={!locked}
                style={styles.input}
                accessibilityLabel="Total ticket quantity"
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
                editable={!locked}
                    style={styles.input}
                    accessibilityLabel="Minimum tickets per purchase"
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
                editable={!locked}
                    style={styles.input}
                    accessibilityLabel="Maximum tickets per purchase"
                value={perOrderMaxText}
                    onChangeText={setPerOrderMaxText}
                    placeholder="no limit"
                    placeholderTextColor={Colors.textLight}
                    keyboardType="number-pad"
                  />
                </View>
              </View>
              {!!minProblem && <Text style={styles.problem}>{minProblem}</Text>}

              <TouchableOpacity style={styles.checkRow} accessibilityRole="checkbox" accessibilityLabel="Hidden ticket" accessibilityState={{checked:hidden,disabled:locked}} disabled={locked} onPress={() => setHidden(!hidden)} activeOpacity={0.7}>
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
                  appearance={{fonts}}
                  selected={openParsedDay}
                  onSelect={(d) => setOpenDate(`${d.year}-${pad2(d.month + 1)}-${pad2(d.day)}`)}
                  placeholder="opens right away"
                />
              </View>
              <View style={styles.pickerBlock}>
                <TimePicker
                  appearance={{fonts,sunset:true}}
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
                  appearance={{fonts}}
                  selected={closeParsedDay}
                  onSelect={(d) => setCloseDate(`${d.year}-${pad2(d.month + 1)}-${pad2(d.day)}`)}
                  placeholder="never closes"
                />
              </View>
              <View style={styles.pickerBlock}>
                <TimePicker
                  appearance={{fonts,sunset:true}}
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


          </ScrollView>
        </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.parchment },
  avoider: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  title: { flex:1,textAlign:'center', fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  recovery: { paddingHorizontal:20 },
  discardControl: { minHeight:44,justifyContent:'center',alignSelf:'flex-start' },
  closeControl: { minHeight:44,minWidth:44,justifyContent:'center',alignItems:'flex-end' },
  closeText: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  label: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.textMedium, marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.regular,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  inputProblem: { borderWidth: 1, borderColor: Colors.errorRed },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  problem: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.errorBrand, marginTop: 6 },
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
  previewLabel: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  previewValue: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  previewLabelStrong: { fontFamily: fonts.semibold, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  previewValueStrong: { fontFamily: fonts.semibold, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  freeNote: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.textMedium, marginTop: 8 },
  pairRow: { flexDirection: 'row', gap: 12 },
  pairCol: { flex: 1 },
  windowHint: { fontFamily: fonts.regular, fontSize: FontSizes.caption, color: Colors.textMedium, marginBottom: 6 },
  pickerBlock: { marginBottom: 10 },
  clearLink: {
    fontFamily: fonts.medium,
    fontSize: FontSizes.bodySM,
    color: Colors.textLight,
    marginTop: 6,
  },
  checkRow: { minHeight:44,flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
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
  checkmark: { color: Colors.white, fontSize: FontSizes.bodySM, fontFamily: fonts.semibold },
  checkLabel: { flex: 1, fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  saveBtn: { minWidth:44,minHeight:44,justifyContent:'center',alignItems:'flex-end' },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
}); }
