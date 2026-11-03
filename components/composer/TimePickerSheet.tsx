import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, type AfterglowFontFamilies } from '../../constants/Typography';
import { hapticLight } from '../../lib/haptics';

export type PickerTime = { hour: number; minute: string; period: 'AM' | 'PM' };
export function displayTime(hour: number, minute: string, period: 'AM' | 'PM') {
  return `${hour}:${minute} ${period}`;
}
const totalMinutes = ({ hour, minute, period }: PickerTime) => (hour % 12 + (period === 'PM' ? 12 : 0)) * 60 + Number(minute);
const fromMinutes = (value: number): PickerTime => ({ hour: Math.floor(value / 60) % 12 || 12, minute: String(value % 60).padStart(2, '0'), period: value >= 720 ? 'PM' : 'AM' });

/** Include an existing arbitrary minute without rounding the stored schedule. */
export function timeChoices(initial: PickerTime): PickerTime[] {
  const values = Array.from({ length: 96 }, (_, index) => index * 15);
  const exact = totalMinutes(initial);
  if (Number.isInteger(exact) && exact >= 0 && exact < 1440 && !values.includes(exact)) values.push(exact);
  return values.sort((a, b) => a - b).map(fromMinutes);
}

type Props = {
  initial: PickerTime;
  appearance?: { fonts: AfterglowFontFamilies; sunset?: boolean };
  onCancel: () => void;
  onConfirm: (time: PickerTime) => void;
  /** Render within an existing Modal, avoiding a second native presentation. */
  embedded?: boolean;
};

export default function TimePickerSheet({ initial, appearance, onCancel, onConfirm, embedded = false }: Props) {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const styles = useMemo(() => sheetStyles(appearance), [appearance]);
  const [hour, setHour] = useState(String(initial.hour));
  const [minute, setMinute] = useState(initial.minute);
  const [period, setPeriod] = useState(initial.period);
  const [exactEntry, setExactEntry] = useState(false);
  const active = useRef(true);
  const minuteInput = useRef<TextInput>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const valid = /^\d{1,2}$/.test(hour) && Number(hour) >= 1 && Number(hour) <= 12 && /^\d{1,2}$/.test(minute) && Number(minute) <= 59;
  const chosen: PickerTime = { hour: Number(hour), minute: String(Number(minute)).padStart(2, '0'), period };
  const choices = useMemo(() => {
    const values = timeChoices(initial);
    if (valid && !values.some(value => totalMinutes(value) === totalMinutes(chosen))) {
      values.push(chosen);
      values.sort((a, b) => totalMinutes(a) - totalMinutes(b));
    }
    return values;
  }, [initial.hour, initial.minute, initial.period, hour, minute, period]);
  const rowHeight = Math.max(52, Math.ceil(FontSizes.bodyLG * fontScale * 1.5) + 24);
  const initialIndex = Math.max(0, choices.findIndex(time => totalMinutes(time) === totalMinutes(valid ? chosen : initial)));
  const cancel = () => {
    if (!active.current) return;
    active.current = false;
    Keyboard.dismiss();
    onCancel();
  };
  const confirm = () => {
    if (!active.current || !valid) return;
    active.current = false;
    Keyboard.dismiss();
    hapticLight();
    onConfirm(chosen);
  };
  return (
    <KeyboardAvoidingView style={embedded ? styles.embedded : styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={[styles.overlay, { paddingTop: insets.top + 8 }]} onPress={cancel} accessible={false}>
        <Pressable style={[styles.sheet, exactEntry && styles.exactSheet, { paddingBottom: Math.max(insets.bottom, 12) }]} onPress={event => event.stopPropagation()} accessible={false} accessibilityViewIsModal={embedded} onAccessibilityEscape={cancel}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit accessibilityRole="header">Choose time</Text>
            <TouchableOpacity style={styles.cancel} accessibilityRole="button" accessibilityLabel="Cancel time changes" onPress={cancel}>
              <Text style={styles.actionText} numberOfLines={1} adjustsFontSizeToFit>Cancel</Text>
            </TouchableOpacity>
          </View>
          {exactEntry ? (
            <ScrollView style={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
              <Text style={styles.note} numberOfLines={1} adjustsFontSizeToFit>Los Angeles time</Text>
              <View style={styles.inputs}>
                <TextInput style={styles.input} value={hour} keyboardType="number-pad" maxLength={2} selectTextOnFocus accessibilityLabel="Hour, 1 through 12" onChangeText={value => {
                  if (!active.current) return;
                  const digits = value.replace(/\D/g, '').slice(0, 2);
                  setHour(digits);
                  if (digits.length === 2) minuteInput.current?.focus();
                }} />
                <Text style={styles.digits}>:</Text>
                <TextInput ref={minuteInput} style={styles.input} value={minute} keyboardType="number-pad" maxLength={2} selectTextOnFocus accessibilityLabel="Minute, 0 through 59" onChangeText={value => { if (active.current) setMinute(value.replace(/\D/g, '').slice(0, 2)); }} />
              </View>
              <View style={styles.periods}>
                {(['AM', 'PM'] as const).map(value => <TouchableOpacity key={value} style={[styles.period, period === value && styles.selected]} accessibilityRole="button" accessibilityLabel={value} accessibilityState={{ selected: period === value }} onPress={() => { if (active.current) { Keyboard.dismiss(); setPeriod(value); } }}>
                  <Text style={[styles.optionText, period === value && styles.selectedText]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
                </TouchableOpacity>)}
              </View>
              {!valid && <Text style={styles.error} accessibilityRole="alert">Enter an hour from 1–12 and minutes from 00–59.</Text>}
              <TouchableOpacity style={styles.modeButton} accessibilityRole="button" onPress={() => { if (active.current) { Keyboard.dismiss(); setExactEntry(false); } }}>
                <Text style={styles.actionText}>Choose from list</Text>
              </TouchableOpacity>
            </ScrollView>
          ) : (
            <FlatList
              style={styles.body}
              data={choices}
              initialScrollIndex={initialIndex}
              initialNumToRender={12}
              getItemLayout={(_, index) => ({ length: rowHeight, offset: rowHeight * index, index })}
              keyExtractor={item => String(totalMinutes(item))}
              keyboardShouldPersistTaps="handled"
              extraData={`${hour}:${minute}:${period}`}
              renderItem={({ item }) => {
                const selected = valid && totalMinutes(item) === totalMinutes(chosen);
                const label = displayTime(item.hour, item.minute, item.period);
                return <TouchableOpacity style={[styles.timeOption, { height: rowHeight }, selected && styles.selected]} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={() => {
                  if (!active.current) return;
                  setHour(String(item.hour)); setMinute(item.minute); setPeriod(item.period);
                }}>
                  <Text style={[styles.optionText, selected && styles.selectedText]} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
                  <Text style={[styles.optionText, selected && styles.selectedText]} accessible={false}>{selected ? '✓' : ''}</Text>
                </TouchableOpacity>;
              }}
            />
          )}
          <View style={styles.footer}>
            {!exactEntry && <TouchableOpacity style={styles.modeButton} accessibilityRole="button" accessibilityLabel="Enter exact time" onPress={() => { if (active.current) setExactEntry(true); }}>
              <Text style={styles.actionText} numberOfLines={1} adjustsFontSizeToFit>Enter exact time</Text>
            </TouchableOpacity>}
            {!exactEntry && <Text style={styles.note} numberOfLines={1} adjustsFontSizeToFit>Los Angeles time</Text>}
            <TouchableOpacity style={[styles.done, !valid && styles.disabled]} accessibilityRole="button" accessibilityLabel="Done, confirm time" accessibilityState={{ disabled: !valid }} disabled={!valid} onPress={confirm}>
              <Text style={styles.doneText} numberOfLines={1} adjustsFontSizeToFit>Done</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

function sheetStyles(appearance?: Props['appearance']) {
  const fonts = appearance?.fonts ?? { regular: Fonts.sans, medium: Fonts.sansMedium, semibold: Fonts.sansSemibold, display: Fonts.display };
  const paper = appearance ? AfterglowColors.paper : Colors.cream;
  const ink = appearance ? AfterglowColors.ink : Colors.darkWarm;
  const line = appearance ? AfterglowColors.line : Colors.border;
  const accent = appearance ? AfterglowColors.clay : Colors.terracotta;
  return StyleSheet.create({
    fill: { flex: 1 },
    embedded: { ...StyleSheet.absoluteFillObject, zIndex: 1000, elevation: 24 },
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: Colors.overlayDark40 },
    sheet: { height: '85%', flexShrink: 1, backgroundColor: paper, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20 },
    exactSheet: { height: '100%' },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
    title: { flex: 1, fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: ink },
    cancel: { minWidth: 44, minHeight: 44, justifyContent: 'center', maxWidth: '45%' },
    actionText: { fontFamily: fonts.medium, fontSize: FontSizes.bodyMD, color: accent },
    body: { flex: 1, minHeight: 0 },
    timeOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderRadius: 12 },
    optionText: { fontFamily: fonts.medium, fontSize: FontSizes.bodyLG, color: ink },
    selected: { backgroundColor: accent },
    selectedText: { color: Colors.white, fontFamily: fonts.semibold },
    inputs: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 12 },
    input: { flex: 1, minWidth: 0, minHeight: 52, paddingVertical: 8, textAlign: 'center', borderRadius: 12, borderColor: line, borderWidth: 1, backgroundColor: Colors.white, fontFamily: fonts.semibold, fontSize: FontSizes.displayMD, color: ink },
    digits: { fontFamily: fonts.semibold, fontSize: FontSizes.displayMD, color: ink },
    periods: { flexDirection: 'row', gap: 12 },
    period: { flex: 1, minHeight: 48, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: line },
    modeButton: { minHeight: 44, paddingVertical: 8, justifyContent: 'center', alignItems: 'center' },
    footer: { paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: line },
    note: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: appearance ? AfterglowColors.muted : Colors.secondary, textAlign: 'center' },
    done: { minHeight: 48, marginTop: 8, paddingVertical: 12, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: accent },
    doneText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: Colors.white },
    disabled: { opacity: 0.45 },
    error: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, color: Colors.errorRed, marginTop: 12 },
  });
}
