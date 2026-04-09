import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  Animated,
  PanResponder,
  Dimensions,
} from 'react-native';
import { hapticSelection } from '../lib/haptics';
import { Check } from 'lucide-react-native';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const DISMISS_THRESHOLD = 80;

export interface FilterSheetOption {
  key: string;
  label: string;
}

interface FilterBottomSheetProps {
  visible: boolean;
  title: string;
  options: FilterSheetOption[];
  selected: string[];
  onToggle: (key: string) => void;
  onClose: () => void;
  onClear: () => void;
}

/**
 * Shared full-height filter bottom sheet with radio-style check circles and "Clear all".
 * Used for Category and When filters on Plans and Scene screens.
 */
export function FilterBottomSheet({
  visible,
  title,
  options,
  selected,
  onToggle,
  onClose,
  onClear,
}: FilterBottomSheetProps) {
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
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) translateY.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > DISMISS_THRESHOLD || gs.vy > 0.5) {
          dismissSheet();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 8,
          }).start();
        }
      },
    }),
  ).current;

  const dismissSheet = () => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      onClose();
    });
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={dismissSheet}>
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismissSheet} />
      </Animated.View>
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY }] }]}
        {...panResponder.panHandlers}
      >
        <Pressable onStartShouldSetResponder={() => true}>
          <View style={styles.sheetHandle} />

          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <TouchableOpacity onPress={onClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.sheetClear}>Clear all</Text>
            </TouchableOpacity>
          </View>

          {options.map((opt) => {
            const active = selected.includes(opt.key);
            return (
              <TouchableOpacity
                key={opt.key}
                style={styles.sheetRow}
                onPress={() => {
                  hapticSelection();
                  onToggle(opt.key);
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.sheetRowText, active && styles.sheetRowTextActive]}>
                  {opt.label}
                </Text>
                <View style={[styles.sheetCheck, active && styles.sheetCheckActive]}>
                  {active && <Check size={13} color={Colors.white} strokeWidth={3} />}
                </View>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity style={styles.sheetDone} onPress={dismissSheet}>
            <Text style={styles.sheetDoneText}>Done</Text>
          </TouchableOpacity>
        </Pressable>
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
