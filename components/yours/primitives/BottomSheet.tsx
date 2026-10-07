import React, { useRef, useEffect, useLayoutEffect } from 'react';
import { View, Text, Modal, Pressable, StyleSheet, Animated, PanResponder, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { ANIM } from '../state/constants';
import { useReduceMotion } from '../a11y/useReduceMotion';

const DISMISS_THRESHOLD = 80;
export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Fraction of current screen height (0..1). Omit for content-sized. */
  heightPct?: number;
  /** Opt-in composer spring motion; other callers retain timing. */
  springMotion?: boolean;
  appearance?: { fonts: AfterglowFontFamilies };
}

/** Each visible visit owns its animations; an old dismissal cannot close a new visit. */
export default function BottomSheet(props: BottomSheetProps) {
  return props.visible ? <VisibleBottomSheet {...props} /> : null;
}

function VisibleBottomSheet({ onClose, children, heightPct, springMotion = false, appearance }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const translateY = useRef(new Animated.Value(height)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const mounted = useRef(false);
  const entered = useRef(false);
  const closed = useRef(false);
  const motion = useRef<Animated.CompositeAnimation | null>(null);
  const dismissal = useRef<object | null>(null);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; dismissal.current = null; motion.current?.stop(); };
  }, []);

  useEffect(() => {
    // Rotation and Reduce Motion changes settle the current presentation
    // instead of playing a new entrance or completing an obsolete dismissal.
    dismissal.current = null;
    motion.current?.stop();
    if (entered.current || reduceMotion) {
      entered.current = true;
      translateY.setValue(0); overlayOpacity.setValue(1);
      return;
    }
    entered.current = true;
    translateY.setValue(height); overlayOpacity.setValue(0);
    motion.current = Animated.parallel([
      springMotion
        ? Animated.spring(translateY, { toValue: 0, mass: 1, stiffness: 280, damping: 26, useNativeDriver: true })
        : Animated.timing(translateY, { toValue: 0, duration: ANIM.sheetInMs, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: 1, duration: ANIM.sheetInMs, useNativeDriver: true }),
    ]);
    motion.current.start();
    return () => { motion.current?.stop(); };
  }, [height, reduceMotion, springMotion, translateY, overlayOpacity]);

  const dismiss = () => {
    if (!mounted.current || closed.current || dismissal.current) return;
    const attempt = {}; dismissal.current = attempt;
    motion.current?.stop();
    const finish = () => {
      if (!mounted.current || closed.current || dismissal.current !== attempt) return;
      closed.current = true;
      latestClose.current();
    };
    if (reduceMotion) { finish(); return; }
    motion.current = Animated.parallel([
      springMotion
        ? Animated.spring(translateY, { toValue: height, mass: 1, stiffness: 320, damping: 30, useNativeDriver: true })
        : Animated.timing(translateY, { toValue: height, duration: ANIM.sheetOutMs, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: 0, duration: ANIM.sheetOutMs, useNativeDriver: true }),
    ]);
    motion.current.start(({ finished }) => {
      if (finished) finish();
      else if (dismissal.current === attempt) dismissal.current = null;
    });
  };
  const restore = () => {
    if (!mounted.current || closed.current || dismissal.current) return;
    motion.current?.stop();
    if (reduceMotion) { translateY.setValue(0); return; }
    motion.current = Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 8 });
    motion.current.start();
  };
  const latestHandlers = useRef({ dismiss, restore });
  latestHandlers.current = { dismiss, restore };
  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gs) => !dismissal.current && gs.dy > 8 && Math.abs(gs.dy) > Math.abs(gs.dx),
    onPanResponderGrant: () => { if (!dismissal.current) motion.current?.stop(); },
    onPanResponderMove: (_, gs) => { if (mounted.current && !dismissal.current && gs.dy > 0) translateY.setValue(gs.dy); },
    onPanResponderRelease: (_, gs) => {
      if (gs.dy > DISMISS_THRESHOLD || gs.vy > 0.5) latestHandlers.current.dismiss();
      else latestHandlers.current.restore();
    },
    onPanResponderTerminate: () => latestHandlers.current.restore(),
  })).current;
  const fonts = appearance?.fonts;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={dismiss} onAccessibilityEscape={dismiss}>
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityRole="button" accessibilityLabel="Close sheet" />
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        onAccessibilityEscape={dismiss}
        style={[
          styles.sheet, fonts && afterglow.sheet,
          heightPct ? { height: height * Math.max(0, Math.min(1, heightPct)) } : null,
          { maxHeight: Math.max(0, height - insets.top - 12), transform: [{ translateY }], paddingBottom: Math.max(44, insets.bottom + 16) },
        ]}
      >
        {/* Only the grabber owns vertical drag. Child scrolling stays separate. */}
        <View {...panResponder.panHandlers} style={styles.grabber} testID="bottom-sheet-grabber">
          <View style={[styles.handle, fonts && afterglow.handle]} />
        </View>
        {fonts && (
          <View style={afterglow.closeRow}>
            <Pressable style={afterglow.closeButton} onPress={dismiss} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={[afterglow.closeText, { fontFamily: fonts.semibold }]} numberOfLines={1}>Close</Text>
            </Pressable>
          </View>
        )}
        <View style={heightPct ? styles.fillContent : fonts ? afterglow.autoContent : undefined}>{children}</View>
      </Animated.View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.overlayMedium },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 8 },
  grabber: { alignItems: 'center', paddingTop: 2, paddingBottom: 2 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.iconMuted, marginBottom: 12 },
  fillContent: { flex: 1, minHeight: 0 },
});
const afterglow = StyleSheet.create({
  sheet: { backgroundColor: AfterglowColors.paper, borderTopLeftRadius: 10, borderTopRightRadius: 10, paddingHorizontal: 20 },
  handle: { backgroundColor: AfterglowColors.line, marginBottom: 2 },
  autoContent: { flexShrink: 1, minHeight: 0 },
  closeRow: { flexDirection: 'row', justifyContent: 'flex-end', flexShrink: 0 },
  closeButton: { minWidth: 44, minHeight: 44, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  closeText: { ...AfterglowType.body, color: AfterglowColors.clay },
});
