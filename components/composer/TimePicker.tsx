import { useEffect, useRef, useState } from 'react';
import { Keyboard, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, type AfterglowFontFamilies } from '../../constants/Typography';
import TimePickerSheet, { displayTime, type PickerTime } from './TimePickerSheet';
export { displayTime } from './TimePickerSheet';

type Props = PickerTime & {
  appearance?: { fonts: AfterglowFontFamilies; sunset?: boolean };
  selected: boolean;
  onChange: (hour: number, minute: string, period: 'AM' | 'PM') => void;
};

export default function TimePicker({ hour, minute, period, selected, appearance, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const active = useRef(false);
  const visit = useRef(0);
  const renderedVisit = visit.current;
  useEffect(() => () => { active.current = false; visit.current++; }, []);
  const current = () => active.current && visit.current === renderedVisit;
  const cancel = () => { if (current()) { active.current = false; Keyboard.dismiss(); setOpen(false); } };
  const ink = appearance ? AfterglowColors.ink : Colors.darkWarm;
  return <>
    <TouchableOpacity style={legacyStyles.row} accessibilityRole="button" accessibilityLabel={`Time, ${selected ? displayTime(hour, minute, period) : 'not set'}`} accessibilityState={{ expanded: open }} onPress={() => {
      if (active.current) return;
      Keyboard.dismiss(); active.current = true; visit.current++; setOpen(true);
    }}>
      <Text style={[legacyStyles.label, appearance && { fontFamily: appearance.fonts.medium }]}>Time</Text>
      <View style={legacyStyles.pill}>
        <Text style={[legacyStyles.pillText, { color: ink }, appearance && { fontFamily: appearance.fonts.semibold }]}>{selected ? displayTime(hour, minute, period) : 'Set a time'}</Text>
      </View>
      <Text style={[legacyStyles.change, appearance && { fontFamily: appearance.fonts.medium }]}>Change</Text>
    </TouchableOpacity>
    <Modal visible={open} transparent animationType="slide" statusBarTranslucent onRequestClose={cancel}>
      {/* Keep native modal content attached throughout its dismissal animation. */}
      <TimePickerSheet key={renderedVisit} initial={{ hour, minute, period }} appearance={appearance} onCancel={cancel} onConfirm={time => {
        if (!current()) return;
        active.current = false; setOpen(false); onChange(time.hour, time.minute, time.period);
      }} />
    </Modal>
  </>;
}

const legacyStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, minHeight: 52, flexWrap: 'wrap',
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  label: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodySM, color: Colors.secondary, letterSpacing: 0.4 },
  pill: { flexShrink: 1, backgroundColor: Colors.accentSubtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  pillText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  change: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary, marginLeft: 'auto' },

});
