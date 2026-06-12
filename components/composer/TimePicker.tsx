/**
 * TimePicker - the shared WHEN time control for both composer surfaces. A "time"
 * row (label + pill + change) opens a sheet with hour / minute / AM-PM columns
 * and a terracotta "set time" button. Kept identical across V2 and the circle
 * composer so the time mechanic is uniform.
 *
 * BUILD-PREP: this single component is where the native UIDatePicker (wheels)
 * swap lands; replacing it here updates both surfaces at once.
 */
import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { hapticLight } from '../../lib/haptics';

export const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const MINUTE_OPTIONS = ['00', '15', '30', '45'];
export const PERIODS: ('AM' | 'PM')[] = ['AM', 'PM'];

export function displayTime(hour: number, minute: string, period: 'AM' | 'PM'): string {
  return `${hour}:${minute} ${period}`;
}

interface TimePickerProps {
  hour: number;
  minute: string;
  period: 'AM' | 'PM';
  /** false shows "set a time"; true shows the chosen time. */
  selected: boolean;
  onChange: (hour: number, minute: string, period: 'AM' | 'PM') => void;
}

export default function TimePicker({ hour, minute, period, selected, onChange }: TimePickerProps) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [tempHour, setTempHour] = useState(hour);
  const [tempMinute, setTempMinute] = useState(minute);
  const [tempPeriod, setTempPeriod] = useState<'AM' | 'PM'>(period);

  const sheetBottomPad = Platform.OS === 'ios' ? 40 : Math.max(insets.bottom, 16) + 16;

  const openPicker = () => {
    setTempHour(hour);
    setTempMinute(minute);
    setTempPeriod(period);
    setOpen(true);
  };
  const confirm = () => {
    hapticLight();
    onChange(tempHour, tempMinute, tempPeriod);
    setOpen(false);
  };

  return (
    <>
      <TouchableOpacity style={styles.row} onPress={openPicker} activeOpacity={0.7}>
        <Text style={styles.label}>time</Text>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{selected ? displayTime(hour, minute, period) : 'set a time'}</Text>
        </View>
        <Text style={styles.change}>change</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: sheetBottomPad }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>what time?</Text>
            <View style={styles.columns}>
              <ScrollView showsVerticalScrollIndicator={false} style={styles.col}>
                {HOURS.map((h) => (
                  <TouchableOpacity key={h} style={[styles.opt, tempHour === h && styles.optOn]} onPress={() => setTempHour(h)}>
                    <Text style={[styles.optText, tempHour === h && styles.optTextOn]}>{h}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <ScrollView showsVerticalScrollIndicator={false} style={styles.col}>
                {MINUTE_OPTIONS.map((m) => (
                  <TouchableOpacity key={m} style={[styles.opt, tempMinute === m && styles.optOn]} onPress={() => setTempMinute(m)}>
                    <Text style={[styles.optText, tempMinute === m && styles.optTextOn]}>{m}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={styles.col}>
                {PERIODS.map((p) => (
                  <TouchableOpacity key={p} style={[styles.opt, tempPeriod === p && styles.optOn]} onPress={() => setTempPeriod(p)}>
                    <Text style={[styles.optText, tempPeriod === p && styles.optTextOn]}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <TouchableOpacity style={styles.confirm} onPress={confirm} activeOpacity={0.85}>
              <Text style={styles.confirmText}>set time</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
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
  sheetTitle: { fontFamily: Fonts.displayItalic, fontSize: 22, color: Colors.darkWarm, marginBottom: 16 },
  columns: { flexDirection: 'row', gap: 12, height: 180 },
  col: { flex: 1, backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  opt: { paddingVertical: 10, alignItems: 'center' },
  optOn: { backgroundColor: Colors.accentSubtle },
  optText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.secondary },
  optTextOn: { color: Colors.terracotta, fontFamily: Fonts.sansBold },
  confirm: { backgroundColor: Colors.terracotta, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  confirmText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
});
