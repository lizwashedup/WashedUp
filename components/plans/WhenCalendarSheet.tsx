/**
 * WhenCalendarSheet - the When filter for the Plans feed.
 *
 * Bottom sheet with the coarse quick chips (Tonight / This Weekend / ...) above
 * a WashedUpCalendar in filter mode: gold dots on days that have plans, tap a
 * future day to filter the feed to that exact day. Quick chips and the day are
 * mutually exclusive time filters (the parent clears one when the other is set).
 * Same sheet chrome as FilterBottomSheet.
 */
import React, { useRef, useEffect } from 'react';
import {
  View, Text, Modal, Pressable, TouchableOpacity, ScrollView,
  StyleSheet, Animated, PanResponder, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hapticSelection } from '../../lib/haptics';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { WHEN_OPTIONS } from '../../constants/WhenFilter';
import WashedUpCalendar, { type CalendarDay } from '../calendar/WashedUpCalendar';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const DISMISS_THRESHOLD = 80;

export function WhenCalendarSheet({
  visible,
  whenSelected,
  onToggleWhen,
  daySelected,
  onSelectDay,
  markedDays,
  onClear,
  onClose,
}: {
  visible: boolean;
  whenSelected: string[];
  onToggleWhen: (key: string) => void;
  daySelected: CalendarDay | null;
  onSelectDay: (day: CalendarDay) => void;
  markedDays: Set<string>;
  onClear: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(SCREEN_HEIGHT);
      overlayOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(translateY, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(overlayOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) => gs.dy > 8 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onPanResponderMove: (_, gs) => { if (gs.dy > 0) translateY.setValue(gs.dy); },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > DISMISS_THRESHOLD || gs.vy > 0.5) dismissSheet();
        else Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 8 }).start();
      },
    }),
  ).current;

  const dismissSheet = () => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => onClose());
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={dismissSheet}>
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismissSheet} />
      </Animated.View>
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY }], paddingBottom: Math.max(44, insets.bottom + 16) }]}
        {...panResponder.panHandlers}
      >
        <Pressable onStartShouldSetResponder={() => true}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>When</Text>
            <TouchableOpacity onPress={onClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.sheetClear}>Clear all</Text>
            </TouchableOpacity>
          </View>

          {/* Quick coarse buckets (a single calendar day can't say "this weekend"). */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {WHEN_OPTIONS.map((opt) => {
              const on = whenSelected.includes(opt.key);
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => { hapticSelection(); onToggleWhen(opt.key); }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <WashedUpCalendar
            mode="filter"
            selected={daySelected}
            onSelect={onSelectDay}
            markedDays={markedDays}
          />

          <TouchableOpacity style={styles.sheetDone} onPress={dismissSheet}>
            <Text style={styles.sheetDoneText}>Done</Text>
          </TouchableOpacity>
        </Pressable>
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
