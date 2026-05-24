import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

// Floating "jump to newest" button. Appears bottom-right above the input bar
// when the user scrolls up, with a terracotta badge counting messages that
// arrived below the fold. Fades + scales in/out via Reanimated.

const BUTTON_SIZE = 40;
const ICON_SIZE = 22;
const RIGHT_INSET = 16;
const BADGE_SIZE = 20;
const BADGE_TOP = -6;
const BADGE_MAX_COUNT = 99;
const ANIM_DURATION_MS = 160;
const HIDDEN_SCALE = 0.8;
const HIDDEN_TRANSLATE_Y = 8;

interface ScrollToBottomButtonProps {
  visible: boolean;
  count: number;
  bottomOffset: number;
  onPress: () => void;
}

export default function ScrollToBottomButton({
  visible,
  count,
  bottomOffset,
  onPress,
}: ScrollToBottomButtonProps) {
  const progress = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(visible ? 1 : 0, { duration: ANIM_DURATION_MS });
  }, [visible, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { scale: HIDDEN_SCALE + (1 - HIDDEN_SCALE) * progress.value },
      { translateY: HIDDEN_TRANSLATE_Y * (1 - progress.value) },
    ],
  }));

  return (
    <Animated.View
      style={[styles.wrap, { bottom: bottomOffset }, animatedStyle]}
      pointerEvents={visible ? 'box-none' : 'none'}
    >
      <Pressable
        style={styles.button}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Scroll to latest messages"
      >
        <Ionicons name="chevron-down" size={ICON_SIZE} color={Colors.asphalt} />
        {count > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText} numberOfLines={1}>
              {count > BADGE_MAX_COUNT ? `${BADGE_MAX_COUNT}+` : count}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: RIGHT_INSET,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    backgroundColor: Colors.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.shadowBlack,
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  badge: {
    position: 'absolute',
    top: BADGE_TOP,
    minWidth: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    backgroundColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    color: Colors.white,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
  },
});
