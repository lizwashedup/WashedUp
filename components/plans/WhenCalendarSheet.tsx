/**
 * The existing coarse date buckets and exact LA calendar day are live filters.
 * Their mutual exclusion remains in the parent; this sheet only presents them.
 */
import React, { useRef, useEffect, useLayoutEffect } from 'react';
import {
  View, Text, Modal, Pressable, TouchableOpacity, ScrollView,
  StyleSheet, Animated, PanResponder, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hapticSelection } from '../../lib/haptics';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import { WHEN_OPTIONS } from '../../constants/WhenFilter';
import WashedUpCalendar, { type CalendarDay } from '../calendar/WashedUpCalendar';

const DISMISS_THRESHOLD = 80;
interface WhenCalendarSheetProps {
  visible: boolean;
  whenSelected: string[];
  onToggleWhen: (key: string) => void;
  daySelected: CalendarDay | null;
  onSelectDay: (day: CalendarDay) => void;
  markedDays: Set<string>;
  onClear: () => void;
  onClose: () => void;
  appearance?: { fonts: AfterglowFontFamilies };
}

export function WhenCalendarSheet(props: WhenCalendarSheetProps) {
  return props.visible ? <VisibleWhenCalendarSheet {...props} /> : null;
}

function VisibleWhenCalendarSheet({ whenSelected, onToggleWhen, daySelected, onSelectDay, markedDays, onClear, onClose, appearance }: WhenCalendarSheetProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(height)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const mounted = useRef(false);
  const entered = useRef(false);
  const closed = useRef(false);
  const dismissal = useRef<object | null>(null);
  const motion = useRef<Animated.CompositeAnimation | null>(null);
  const latest = useRef({ onClose, onClear, onToggleWhen, onSelectDay });
  latest.current = { onClose, onClear, onToggleWhen, onSelectDay };
  const active = () => mounted.current && !closed.current && !dismissal.current;

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; dismissal.current = null; motion.current?.stop(); };
  }, []);
  useEffect(() => {
    // A resize settles this visit instead of replaying entry or completing an old close.
    dismissal.current = null;
    motion.current?.stop();
    if (entered.current) {
      translateY.setValue(0); overlayOpacity.setValue(1);
      return;
    }
    entered.current = true;
    translateY.setValue(height); overlayOpacity.setValue(0);
    motion.current = Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 300, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]);
    motion.current.start();
    return () => { dismissal.current = null; motion.current?.stop(); };
  }, [height, translateY, overlayOpacity]);

  const dismiss = () => {
    if (!active()) return;
    const attempt = {}; dismissal.current = attempt;
    motion.current?.stop();
    motion.current = Animated.parallel([
      Animated.timing(translateY, { toValue: height, duration: 250, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]);
    motion.current.start(({ finished }) => {
      if (!mounted.current || closed.current || dismissal.current !== attempt) return;
      if (!finished) {
        dismissal.current = null;
        translateY.setValue(0); overlayOpacity.setValue(1);
        return;
      }
      closed.current = true;
      latest.current.onClose();
    });
  };
  const restore = () => {
    if (!active()) return;
    motion.current?.stop();
    motion.current = Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 8 });
    motion.current.start();
  };
  const latestDrag = useRef({ dismiss, restore });
  latestDrag.current = { dismiss, restore };
  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gs) => active() && gs.dy > 8 && Math.abs(gs.dy) > Math.abs(gs.dx),
    onPanResponderGrant: () => { if (active()) motion.current?.stop(); },
    onPanResponderMove: (_, gs) => { if (active() && gs.dy > 0) translateY.setValue(gs.dy); },
    onPanResponderRelease: (_, gs) => {
      if (gs.dy > DISMISS_THRESHOLD || gs.vy > 0.5) latestDrag.current.dismiss();
      else latestDrag.current.restore();
    },
    onPanResponderTerminate: () => latestDrag.current.restore(),
  })).current;
  const fonts = appearance?.fonts;
  const clear = () => { if (active()) latest.current.onClear(); };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={dismiss} onAccessibilityEscape={dismiss}>
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityRole="button" accessibilityLabel="Close when filters" />
      </Animated.View>
      <Animated.View accessibilityViewIsModal onAccessibilityEscape={dismiss} style={[
        styles.sheet, fonts && afterglow.sheet,
        { maxHeight: Math.max(0, height - insets.top - 12), transform: [{ translateY }],
          paddingBottom: fonts ? Math.max(16, insets.bottom + 12) : Math.max(44, insets.bottom + 16) },
      ]}>
        <View {...panResponder.panHandlers} style={layout.grabber} testID="when-filter-grabber">
          <View style={[styles.sheetHandle, fonts && afterglow.handle]} />
        </View>
        <View style={styles.sheetHeader}>
          <Text accessibilityRole="header" style={[styles.sheetTitle, layout.title, fonts && afterglow.title, fonts && { fontFamily: fonts.display }]}>When</Text>
          <TouchableOpacity style={layout.clear} onPress={clear} accessibilityRole="button" accessibilityLabel="Clear all">
            <Text numberOfLines={1} style={[styles.sheetClear, fonts && afterglow.clear, fonts && { fontFamily: fonts.semibold }]}>Clear all</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={layout.scroll} contentContainerStyle={layout.content} keyboardShouldPersistTaps="handled">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {WHEN_OPTIONS.map(opt => {
              const checked = whenSelected.includes(opt.key);
              return (
                <TouchableOpacity key={opt.key} style={[styles.chip, checked && styles.chipOn, fonts && afterglow.chip, checked && fonts && afterglow.chipSelected]}
                  accessibilityRole="checkbox" accessibilityLabel={opt.label} accessibilityState={{ checked }}
                  onPress={() => { if (active()) { hapticSelection(); latest.current.onToggleWhen(opt.key); } }} activeOpacity={0.8}>
                  <Text numberOfLines={1} style={[styles.chipText, checked && styles.chipTextOn, fonts && afterglow.chipText,
                    fonts && { fontFamily: checked ? fonts.semibold : fonts.medium }, checked && fonts && afterglow.chipTextSelected]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <WashedUpCalendar mode="filter" selected={daySelected}
            onSelect={day => { if (active()) latest.current.onSelectDay(day); }}
            markedDays={markedDays} appearance={appearance} />
        </ScrollView>
        <TouchableOpacity style={[styles.sheetDone, fonts && afterglow.done]} onPress={dismiss} accessibilityRole="button" accessibilityLabel="Done">
          <Text numberOfLines={1} style={[styles.sheetDoneText, fonts && afterglow.doneText, fonts && { fontFamily: fonts.semibold }]}>Done</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.overlayMedium },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: Colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 44,
  },
  sheetHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border,
    alignSelf: 'center', marginTop: 12, marginBottom: 20,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16,
  },
  sheetTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Colors.asphalt },
  sheetClear: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.textLight },
  chipRow: { gap: 8, paddingBottom: 16 },
  chip: {
    paddingHorizontal: 14, height: 34, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.inputBg,
  },
  chipOn: { backgroundColor: Colors.terracotta },
  chipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  chipTextOn: { color: Colors.white },
  sheetDone: {
    marginTop: 20, backgroundColor: Colors.terracotta, borderRadius: 14,
    paddingVertical: 15, alignItems: 'center', justifyContent: 'center',
  },
  sheetDoneText: { color: Colors.white, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG },
});

const layout = StyleSheet.create({
  grabber: { flexShrink: 0, minHeight: 32, justifyContent: 'center' },
  title: { flex: 1, minWidth: 0, marginRight: 12 },
  clear: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  scroll: { flexShrink: 1, minHeight: 0 },
  content: { paddingBottom: 4 },
});
const afterglow = StyleSheet.create({
  sheet: { backgroundColor: AfterglowColors.paper, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  handle: { backgroundColor: AfterglowColors.line, marginTop: 0, marginBottom: 0 },
  title: { ...AfterglowType.identity, color: AfterglowColors.ink },
  clear: { ...AfterglowType.body, color: AfterglowColors.clay },
  chip: { height: undefined, minHeight: 44, borderRadius: 4, paddingVertical: 8, backgroundColor: AfterglowColors.white,
    borderWidth: 1, borderColor: AfterglowColors.line },
  chipSelected: { backgroundColor: AfterglowColors.clay, borderColor: AfterglowColors.clay },
  chipText: { ...AfterglowType.body, color: AfterglowColors.ink },
  chipTextSelected: { color: AfterglowColors.white },
  done: { minHeight: 48, borderRadius: 4, marginTop: 12, paddingVertical: 12, backgroundColor: AfterglowColors.clay },
  doneText: { ...AfterglowType.title, color: AfterglowColors.white },
});
