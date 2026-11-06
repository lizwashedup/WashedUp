import React, { memo, useRef, useCallback, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../../constants/Colors';
import { hapticMedium } from '../../lib/haptics';

// ─── Swipe to reply ─────────────────────────────────────────────────────────
// Drag a message row left-to-right (finger moves rightward on screen,
// independent of the inverted list) to enter reply mode, mirroring WhatsApp.
// activeOffsetX keeps it from stealing the FlatList's vertical scroll and from
// firing on Android's left-edge back gesture; failOffsetY cancels the moment
// the drag turns vertical. At the threshold we fire hapticMedium once and, on
// release, the same reply activation the long-press menu uses.
const SWIPE_REPLY_THRESHOLD = 80;
const SWIPE_REPLY_MAX_TRANSLATE = 96;
const SWIPE_REPLY_ACTIVE_OFFSET_X = 20;
const SWIPE_REPLY_FAIL_OFFSET_Y = 12;
const SWIPE_REPLY_ICON_SIZE = 20;
const SWIPE_REPLY_ICON_LEFT = 16;
const SWIPE_REPLY_ICON_MIN_SCALE = 0.6;
const SWIPE_REPLY_ICON_SCALE_RANGE = 0.4;
const SWIPE_REPLY_SPRING = { damping: 18, stiffness: 220, mass: 0.5 };

const SwipeableRow = memo(function SwipeableRow({
  enabled,
  messageId,
  onTriggerReply,
  containerStyle,
  children,
}: {
  enabled: boolean;
  messageId: string;
  onTriggerReply: (messageId: string) => void;
  containerStyle: any;
  children: React.ReactNode;
}) {
  const translateX = useSharedValue(0);
  const triggered = useSharedValue(false);

  // Keep the latest callback in a ref so the memoized gesture never calls a
  // stale closure when the row re-renders.
  const onTriggerReplyRef = useRef(onTriggerReply);
  onTriggerReplyRef.current = onTriggerReply;
  const fireReply = useCallback(() => onTriggerReplyRef.current?.(messageId), [messageId]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        // A positive scalar waits for rightward movement. A positive lower
        // bound also activates at dx=0, stealing stationary long presses.
        .activeOffsetX(SWIPE_REPLY_ACTIVE_OFFSET_X)
        .failOffsetY([-SWIPE_REPLY_FAIL_OFFSET_Y, SWIPE_REPLY_FAIL_OFFSET_Y])
        .onBegin(() => {
          triggered.value = false;
        })
        .onUpdate((e) => {
          const x = Math.max(0, Math.min(e.translationX, SWIPE_REPLY_MAX_TRANSLATE));
          translateX.value = x;
          if (!triggered.value && x >= SWIPE_REPLY_THRESHOLD) {
            triggered.value = true;
            runOnJS(hapticMedium)();
          }
        })
        .onEnd(() => {
          if (triggered.value) runOnJS(fireReply)();
        })
        .onFinalize(() => {
          translateX.value = withSpring(0, SWIPE_REPLY_SPRING);
          triggered.value = false;
        }),
    [enabled, fireReply],
  );

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const iconStyle = useAnimatedStyle(() => {
    const progress = Math.min(translateX.value / SWIPE_REPLY_THRESHOLD, 1);
    return {
      opacity: progress,
      transform: [
        { scale: SWIPE_REPLY_ICON_MIN_SCALE + SWIPE_REPLY_ICON_SCALE_RANGE * progress },
      ],
    };
  });

  if (!enabled) {
    return <View style={containerStyle}>{children}</View>;
  }

  return (
    <View style={containerStyle}>
      <Animated.View style={[swipeStyles.replyIcon, iconStyle]} pointerEvents="none">
        <Ionicons name="arrow-undo" size={SWIPE_REPLY_ICON_SIZE} color={Colors.terracotta} />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
});

const swipeStyles = StyleSheet.create({
  replyIcon: {
    position: 'absolute',
    left: SWIPE_REPLY_ICON_LEFT,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default SwipeableRow;
