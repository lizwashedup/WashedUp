/**
 * Toast - a small transient bottom message with an optional action (e.g. Undo).
 * Generic sibling of SaveSnackbar (same slide-up + fade), kept action-agnostic so
 * any surface can use it. Auto-dismisses after 4s; tapping the action fires
 * onAction (the caller decides whether to also dismiss).
 */
import React, { useEffect } from 'react';
import { Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
  runOnJS,
} from 'react-native-reanimated';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';

interface Props {
  visible: boolean;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}

export function Toast({ visible, message, actionLabel, onAction, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(100);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      translateY.value = withSpring(0, { damping: 20, stiffness: 300 });
      opacity.value = withTiming(1, { duration: 150 });
      const timer = setTimeout(() => {
        opacity.value = withTiming(0, { duration: 300 });
        translateY.value = withDelay(200, withTiming(100, { duration: 200 }, () => {
          runOnJS(onDismiss)();
        }));
      }, 4000);
      return () => clearTimeout(timer);
    } else {
      translateY.value = 100;
      opacity.value = 0;
    }
  }, [visible]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        Platform.OS === 'android' && { bottom: 90 + insets.bottom },
        animStyle,
      ]}
    >
      <Text style={styles.message} numberOfLines={2}>{message}</Text>
      {actionLabel && onAction && (
        <TouchableOpacity style={styles.action} onPress={onAction} activeOpacity={0.8}>
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 90,
    left: 16,
    right: 16,
    backgroundColor: Colors.darkWarm,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: Colors.shadowBlack,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 999,
  },
  message: {
    flex: 1,
    marginRight: 12,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.white,
  },
  action: {
    backgroundColor: Colors.terracotta,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  actionText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.white,
  },
});
