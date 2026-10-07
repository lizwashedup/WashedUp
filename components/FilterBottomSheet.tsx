import React, { useRef, useEffect, useLayoutEffect } from 'react';
import {
  View, Text, Modal, Pressable, TouchableOpacity, ScrollView,
  StyleSheet, Animated, PanResponder, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hapticSelection } from '../lib/haptics';
import { Check } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../constants/Typography';

const DISMISS_THRESHOLD = 80;
export interface FilterSheetOption { key: string; label: string }
interface FilterBottomSheetProps {
  visible: boolean;
  title: string;
  options: FilterSheetOption[];
  selected: string[];
  onToggle: (key: string) => void;
  onClose: () => void;
  onClear: () => void;
  appearance?: { fonts: AfterglowFontFamilies };
}

/** Existing live filters; each visible visit owns its selection and dismissal callbacks. */
export function FilterBottomSheet(props: FilterBottomSheetProps) {
  return props.visible ? <VisibleFilterBottomSheet {...props} /> : null;
}

function VisibleFilterBottomSheet({ title, options, selected, onToggle, onClose, onClear, appearance }: FilterBottomSheetProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(height)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const mounted = useRef(false);
  const entered = useRef(false);
  const closed = useRef(false);
  const dismissal = useRef<object | null>(null);
  const motion = useRef<Animated.CompositeAnimation | null>(null);
  const latest = useRef({ onClose, onClear, onToggle });
  latest.current = { onClose, onClear, onToggle };
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
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityRole="button" accessibilityLabel={`Close ${title.toLowerCase()} filters`} />
      </Animated.View>
      <Animated.View accessibilityViewIsModal onAccessibilityEscape={dismiss} style={[
        styles.sheet, fonts && afterglow.sheet,
        { maxHeight: Math.max(0, height - insets.top - 12), transform: [{ translateY }],
          paddingBottom: fonts ? Math.max(16, insets.bottom + 12) : Math.max(44, insets.bottom + 16) },
      ]}>
        <View {...panResponder.panHandlers} style={layout.grabber} testID="category-filter-grabber">
          <View style={[styles.sheetHandle, fonts && afterglow.handle]} />
        </View>
        <View style={styles.sheetHeader}>
          <Text accessibilityRole="header" style={[styles.sheetTitle, layout.title, fonts && afterglow.title, fonts && { fontFamily: fonts.display }]}>{title}</Text>
          <TouchableOpacity style={layout.clear} onPress={clear} accessibilityRole="button" accessibilityLabel="Clear all">
            <Text numberOfLines={1} style={[styles.sheetClear, fonts && afterglow.clear, fonts && { fontFamily: fonts.semibold }]}>Clear all</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={layout.scroll} contentContainerStyle={layout.content} keyboardShouldPersistTaps="handled">
          {options.map(opt => {
            const checked = selected.includes(opt.key);
            return (
              <TouchableOpacity key={opt.key} style={[styles.sheetRow, fonts && afterglow.row]} activeOpacity={0.7}
                accessibilityRole="checkbox" accessibilityLabel={opt.label} accessibilityState={{ checked }}
                onPress={() => { if (active()) { hapticSelection(); latest.current.onToggle(opt.key); } }}>
                <Text style={[styles.sheetRowText, layout.optionText, checked && styles.sheetRowTextActive,
                  fonts && afterglow.optionText, fonts && { fontFamily: checked ? fonts.semibold : fonts.regular }, checked && fonts && afterglow.optionSelected]}>{opt.label}</Text>
                <View style={[styles.sheetCheck, fonts && afterglow.check, checked && styles.sheetCheckActive, checked && fonts && afterglow.checkSelected]}>
                  {checked && <Check size={13} color={fonts ? AfterglowColors.white : Colors.white} strokeWidth={3} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <TouchableOpacity style={[styles.sheetDone, fonts && afterglow.done]} onPress={dismiss} accessibilityRole="button" accessibilityLabel="Done">
          <Text numberOfLines={1} style={[styles.sheetDoneText, fonts && afterglow.doneText, fonts && { fontFamily: fonts.semibold }]}>Done</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlayMedium,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 44,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 20,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sheetTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Colors.asphalt },
  sheetClear: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.textLight },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sheetRowText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  sheetRowTextActive: { fontFamily: Fonts.sansBold, color: Colors.terracotta },
  sheetCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCheckActive: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  sheetDone: {
    marginTop: 20,
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetDoneText: { color: Colors.white, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG },
});

const layout = StyleSheet.create({
  grabber: { flexShrink: 0, minHeight: 32, justifyContent: 'center' },
  title: { flex: 1, minWidth: 0, marginRight: 12 },
  clear: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  scroll: { flexShrink: 1, minHeight: 0 },
  content: { paddingBottom: 4 },
  optionText: { flex: 1, minWidth: 0, marginRight: 16 },
});
const afterglow = StyleSheet.create({
  sheet: { backgroundColor: AfterglowColors.paper, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  handle: { backgroundColor: AfterglowColors.line, marginTop: 0, marginBottom: 0 },
  title: { ...AfterglowType.identity, color: AfterglowColors.ink },
  clear: { ...AfterglowType.body, color: AfterglowColors.clay },
  row: { minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AfterglowColors.subtleLine, paddingVertical: 14 },
  optionText: { ...AfterglowType.message, color: AfterglowColors.ink },
  optionSelected: { color: AfterglowColors.clay },
  check: { borderColor: AfterglowColors.line, borderRadius: 4 },
  checkSelected: { backgroundColor: AfterglowColors.clay, borderColor: AfterglowColors.clay },
  done: { minHeight: 48, borderRadius: 4, marginTop: 12, paddingVertical: 12, backgroundColor: AfterglowColors.clay },
  doneText: { ...AfterglowType.title, color: AfterglowColors.white },
});
