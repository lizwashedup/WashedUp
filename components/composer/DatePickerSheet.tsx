import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import WashedUpCalendar, { type CalendarDay } from '../calendar/WashedUpCalendar';

type Props = {
  selected: CalendarDay;
  onCancel: () => void;
  onSelect: (day: CalendarDay) => void;
};

/** An accessible, scrollable calendar overlay within an existing native Modal. */
export default function DatePickerSheet({ selected, onCancel, onSelect }: Props) {
  const insets = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();
  const sheetHeight = Math.max(0, Math.min(height - insets.top - 12, fontScale > 1.6 ? height * 0.9 : 480));
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const cancel = () => {
    if (!active.current) return;
    active.current = false;
    onCancel();
  };
  return <Pressable style={[styles.overlay, { paddingTop: insets.top + 8 }]} accessible={false} onPress={cancel}>
    <Pressable style={[styles.sheet, { height: sheetHeight, paddingBottom: Math.max(insets.bottom, 12) }]} accessible={false}
      accessibilityViewIsModal onAccessibilityEscape={cancel} onPress={event => event.stopPropagation()}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit>Choose date</Text>
        <TouchableOpacity style={styles.cancel} accessibilityRole="button" accessibilityLabel="Cancel date changes" onPress={cancel}>
          <Text style={styles.cancelText} numberOfLines={1} adjustsFontSizeToFit>Cancel</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.body} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
        <WashedUpCalendar mode="pick" selected={selected} onSelect={day => {
          if (!active.current) return;
          active.current = false;
          onSelect(day);
        }} />
      </ScrollView>
    </Pressable>
  </Pressable>;
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000, elevation: 24, backgroundColor: Colors.overlayDark40, justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.cream, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, paddingVertical: 8 },
  title: { flex: 1, fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm },
  cancel: { minHeight: 44, minWidth: 44, maxWidth: '45%', justifyContent: 'center' },
  cancelText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  body: { flex: 1, minHeight: 0 },
  content: { paddingBottom: 8 },
});
