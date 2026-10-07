/**
 * TimePicker - the shared WHEN time control for both composer surfaces. A "time"
 * row opens a compact sheet with direct time entry, common minute choices,
 * and a visible AM/PM choice. The same control serves Plan and event creation.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CreatorActionFill } from '../creator/CreatorActionFill';
import Colors, { AfterglowColors, CreatorSurfaceColors } from '../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import { hapticLight } from '../../lib/haptics';

export const MINUTE_OPTIONS = ['00', '15', '30', '45'];
export const PERIODS: ('AM' | 'PM')[] = ['AM', 'PM'];

export function displayTime(hour: number, minute: string, period: 'AM' | 'PM'): string {
  return `${hour}:${minute} ${period}`;
}

interface TimePickerProps {
  appearance?: { fonts: AfterglowFontFamilies; sunset?: boolean };
  hour: number;
  minute: string;
  period: 'AM' | 'PM';
  /** false shows "set a time"; true shows the chosen time. */
  selected: boolean;
  onChange: (hour: number, minute: string, period: 'AM' | 'PM') => void;
}

export default function TimePicker({ hour, minute, period, selected, onChange, appearance }: TimePickerProps) {
  const styles = useMemo(() => timeStyles(appearance), [appearance]);
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [tempHour, setTempHour] = useState(String(hour));
  const [tempMinute, setTempMinute] = useState(minute);
  const [tempPeriod, setTempPeriod] = useState<'AM' | 'PM'>(period);
  const minuteInput = useRef<TextInput>(null);
  const active = useRef(false);
  const visit = useRef(0);
  const renderedVisit = visit.current;
  useEffect(() => () => { active.current = false; visit.current++; }, []);

  const sheetBottomPad = Platform.OS === 'ios' ? 40 : Math.max(insets.bottom, 16) + 16;

  const openPicker = () => {
    if (active.current) return;
    active.current = true;
    visit.current++;
    setTempHour(String(hour));
    setTempMinute(minute);
    setTempPeriod(period);
    setOpen(true);
  };
  const isCurrentVisit = () => active.current && visit.current === renderedVisit;
  const cancel = () => {
    if (!isCurrentVisit()) return;
    active.current = false;
    Keyboard.dismiss();
    setOpen(false);
  };
  const parsedHour = Number(tempHour);
  const parsedMinute = Number(tempMinute);
  const validTime = /^\d{1,2}$/.test(tempHour) && parsedHour >= 1 && parsedHour <= 12 &&
    /^\d{1,2}$/.test(tempMinute) && parsedMinute >= 0 && parsedMinute <= 59;
  const confirm = () => {
    if (!validTime || !isCurrentVisit()) return;
    active.current = false;
    hapticLight();
    Keyboard.dismiss();
    onChange(parsedHour, String(parsedMinute).padStart(2, '0'), tempPeriod);
    setOpen(false);
  };

  return (
    <>
      <TouchableOpacity style={styles.row} onPress={openPicker} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={`Time, ${selected ? displayTime(hour, minute, period) : 'not set'}`} accessibilityState={{ expanded: open }}>
        <Text style={styles.label}>{appearance ? 'Time' : 'time'}</Text>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{selected ? displayTime(hour, minute, period) : (appearance ? 'Set a time' : 'set a time')}</Text>
        </View>
        <Text style={styles.change}>{appearance ? 'Change' : 'change'}</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={cancel} statusBarTranslucent>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.overlay} onPress={cancel} accessible={false}>
          <Pressable style={[styles.sheet, { paddingBottom: sheetBottomPad }]} onPress={(e) => e.stopPropagation()} accessible={false} accessibilityViewIsModal onAccessibilityEscape={cancel}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle} accessibilityRole="header">{appearance ? 'What time?' : 'what time?'}</Text>
              <TouchableOpacity style={styles.cancel} onPress={cancel} accessibilityRole="button" accessibilityLabel="Cancel time changes" activeOpacity={0.7}>
                <Text style={styles.cancelText} numberOfLines={1}>Cancel</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.timeRow}>
              <TextInput
                style={styles.timeInput}
                value={tempHour}
                onChangeText={(value) => {
                  const digits = value.replace(/\D/g, '').slice(0, 2);
                  setTempHour(digits);
                  if (digits.length === 2) minuteInput.current?.focus();
                }}
                keyboardType="number-pad"
                maxLength={2}
                selectTextOnFocus
                accessibilityLabel="Hour, 1 through 12"
              />
              <Text style={styles.separator}>:</Text>
              <TextInput
                ref={minuteInput}
                style={styles.timeInput}
                value={tempMinute}
                onChangeText={(value) => setTempMinute(value.replace(/\D/g, '').slice(0, 2))}
                keyboardType="number-pad"
                maxLength={2}
                selectTextOnFocus
                accessibilityLabel="Minute, 0 through 59"
              />
              <View style={styles.periodGroup}>
                {PERIODS.map((p) => (
                  <TouchableOpacity key={p} style={[styles.periodOption, tempPeriod === p && styles.selectedOption]} onPress={() => { Keyboard.dismiss(); setTempPeriod(p); }} accessibilityRole="button" accessibilityState={{ selected: tempPeriod === p }} accessibilityLabel={p}>
                    <Text style={[styles.optionText, tempPeriod === p && styles.selectedText]}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.minuteChoices}>
              {MINUTE_OPTIONS.map((m) => (
                <TouchableOpacity key={m} style={[styles.minuteChoice, tempMinute === m && styles.selectedOption]} onPress={() => { Keyboard.dismiss(); setTempMinute(m); }} accessibilityRole="button" accessibilityLabel={`${m} minutes`} accessibilityState={{ selected: tempMinute === m }}>
                  <Text style={[styles.optionText, tempMinute === m && styles.selectedText]}>:{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.timezoneNote}>Los Angeles time · adjusts for daylight saving</Text>
            {!validTime && <Text style={styles.errorText}>Enter an hour from 1–12 and minutes from 00–59.</Text>}
            <TouchableOpacity style={[styles.confirm, appearance?.sunset && creatorConfirm, !validTime && styles.confirmDisabled]} onPress={confirm} disabled={!validTime} activeOpacity={0.85} accessibilityRole="button" accessibilityState={{ disabled: !validTime }}>
              {appearance?.sunset && <CreatorActionFill />}
              <Text style={styles.confirmText}>{appearance ? 'Set time' : 'set time'}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const legacyStyles = StyleSheet.create({
  flex: { flex: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  label: { fontFamily: Fonts.sansSemibold, fontSize: 13, color: Colors.secondary, letterSpacing: 0.4 },
  pill: { backgroundColor: Colors.accentSubtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  pillText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  change: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Colors.secondary, marginLeft: 'auto' },

  overlay: { flex: 1, backgroundColor: Colors.overlayDark40, justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.cream, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 18 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  sheetTitle: { flex: 1, fontFamily: Fonts.display, fontSize: 22, color: Colors.darkWarm },
  cancel: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.secondary },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeInput: { width: 60, minHeight: 52, textAlign: 'center', backgroundColor: Colors.white, borderRadius: 6, borderWidth: 1, borderColor: Colors.border, fontFamily: Fonts.sansBold, fontSize: 22, color: Colors.darkWarm },
  separator: { fontFamily: Fonts.sansBold, fontSize: 22, color: Colors.darkWarm },
  periodGroup: { flex: 1, flexDirection: 'row', gap: 4, marginLeft: 8 },
  periodOption: { flex: 1, paddingVertical: 14, alignItems: 'center', borderRadius: 6, borderWidth: 1, borderColor: Colors.border },
  minuteChoices: { flexDirection: 'row', gap: 8, marginTop: 16 },
  minuteChoice: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 6, borderWidth: 1, borderColor: Colors.border },
  selectedOption: { backgroundColor: Colors.accentSubtle, borderColor: Colors.terracotta },
  optionText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.secondary },
  selectedText: { fontFamily: Fonts.sansBold, color: Colors.terracotta },
  timezoneNote: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 14 },
  errorText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.errorRed, marginTop: 12 },
  confirm: { backgroundColor: Colors.terracotta, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  confirmDisabled: { opacity: 0.45 },
  confirmText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
});


function timeStyles(appearance?: { fonts: AfterglowFontFamilies; sunset?: boolean }) {
  if (!appearance) return legacyStyles;
  const { fonts } = appearance;
  return { ...legacyStyles, ...StyleSheet.create({
    row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10,
      paddingHorizontal: 12, paddingVertical: 12, borderRadius: 6, borderWidth: 1,
      borderColor: AfterglowColors.line, backgroundColor: AfterglowColors.white },
    label: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.muted },
    pill: { flex: 1, minWidth: 0 },
    pillText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    change: { ...AfterglowType.caption, fontFamily: fonts.medium, color: AfterglowColors.clay },
    sheet: { backgroundColor: AfterglowColors.paper, borderTopLeftRadius: 10, borderTopRightRadius: 10, paddingHorizontal: 20, paddingTop: 18 },
    sheetTitle: { flex: 1, ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink },
    cancelText: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.ink },
    timeInput: { width: 56, minHeight: 56, textAlign: 'center', backgroundColor: AfterglowColors.white,
      borderRadius: 6, borderWidth: 1, borderColor: AfterglowColors.line,
      ...AfterglowType.identity, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    separator: { ...AfterglowType.identity, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    periodGroup: { flex: 1, flexDirection: 'row', gap: 4, marginLeft: 2 },
    periodOption: { flex: 1, minHeight: 48, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 6,
      borderWidth: 1, borderColor: AfterglowColors.line, backgroundColor: AfterglowColors.white },
    minuteChoice: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingVertical: 10,
      borderRadius: 6, borderWidth: 1, borderColor: AfterglowColors.line, backgroundColor: AfterglowColors.white },
    selectedOption: { backgroundColor: AfterglowColors.clay, borderColor: AfterglowColors.clay },
    optionText: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.ink },
    selectedText: { fontFamily: fonts.semibold, color: AfterglowColors.white },
    timezoneNote: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 14 },
    errorText: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.clay, marginTop: 12 },
    confirm: { minHeight: 48, backgroundColor: AfterglowColors.clay, borderRadius: 6, paddingVertical: 12,
      alignItems: 'center', justifyContent: 'center', marginTop: 16 },
    confirmText: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.white },
  }) };
}

const creatorConfirm = StyleSheet.create({
  surface: { borderRadius: 24, borderWidth: 1, borderColor: CreatorSurfaceColors.goldEdge,
    backgroundColor: Colors.terracotta, shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.24, shadowRadius: 8, elevation: 3 },
}).surface;
