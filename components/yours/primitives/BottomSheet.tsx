import React, { useRef, useEffect } from 'react';
import {
  View,
  Modal,
  Pressable,
  StyleSheet,
  Animated,
  PanResponder,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../../../constants/Colors';
import { ANIM } from '../state/constants';
import { useReduceMotion } from '../a11y/useReduceMotion';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const DISMISS_THRESHOLD = 80;

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Fraction of screen height (0..1). Omit for content-sized. */
  heightPct?: number;
  /**
   * Opt-in: spring enter/dismiss per the composer design study (mass 1 /
   * stiffness 280 / damping 26 in, snappier 320/30 out) instead of the default
   * timing. Other consumers are untouched.
   */
  springMotion?: boolean;
}

/**
 * Generalized bottom sheet. Same DNA as components/FilterBottomSheet
 * (Modal + Animated translateY + overlay + PanResponder drag-dismiss),
 * but generic children + Reduce Motion aware.
 */
export default function BottomSheet({
  visible,
  onClose,
  children,
  heightPct,
  springMotion = false,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    if (reduceMotion) {
      translateY.setValue(0);
      overlayOpacity.setValue(1);
      return;
    }
    translateY.setValue(SCREEN_HEIGHT);
    overlayOpacity.setValue(0);
    Animated.parallel([
      springMotion
        ? Animated.spring(translateY, {
            toValue: 0,
            mass: 1,
            stiffness: 280,
            damping: 26,
            useNativeDriver: true,
          })
        : Animated.timing(translateY, {
            toValue: 0,
            duration: ANIM.sheetInMs,
            useNativeDriver: true,
          }),
      Animated.timing(overlayOpacity, {
        toValue: 1,
        duration: ANIM.sheetInMs,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, reduceMotion]);

  const dismiss = () => {
    if (reduceMotion) {
      onClose();
      return;
    }
    Animated.parallel([
      springMotion
        ? Animated.spring(translateY, {
            toValue: SCREEN_HEIGHT,
            mass: 1,
            stiffness: 320,
            damping: 30,
            useNativeDriver: true,
          })
        : Animated.timing(translateY, {
            toValue: SCREEN_HEIGHT,
            duration: ANIM.sheetOutMs,
            useNativeDriver: true,
          }),
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: ANIM.sheetOutMs,
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        gs.dy > 8 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) translateY.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > DISMISS_THRESHOLD || gs.vy > 0.5) {
          dismiss();
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

  if (!visible) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={dismiss}
    >
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          heightPct ? { height: SCREEN_HEIGHT * heightPct } : null,
          {
            transform: [{ translateY }],
            paddingBottom: Math.max(44, insets.bottom + 16),
          },
        ]}
        {...panResponder.panHandlers}
      >
        <Pressable
          onStartShouldSetResponder={() => true}
          style={heightPct ? styles.fillContent : undefined}
        >
          <View style={styles.handle} />
          {children}
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.overlayMedium },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.iconMuted,
    marginBottom: 12,
  },
  // When the sheet is fixed-height (heightPct set), let the content wrapper fill
  // it so a ScrollView child is bounded and scrolls instead of overflowing.
  fillContent: { flex: 1 },
});
