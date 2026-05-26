import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
} from 'react-native-reanimated';
import Colors from '../../constants/Colors';

// Three pulsing dots in a warm incoming-style bubble, shown at the visual
// bottom of the message list while another member is typing.

const DOT_COUNT = 3;
const DOT_SIZE = 7;
const DOT_SPACING = 4;
const DOT_STAGGER_MS = 160;
const DOT_PULSE_MS = 480;
const DOT_MIN_OPACITY = 0.3;

function TypingDot({ index }: { index: number }) {
  const opacity = useSharedValue(DOT_MIN_OPACITY);

  useEffect(() => {
    opacity.value = withDelay(
      index * DOT_STAGGER_MS,
      withRepeat(
        withSequence(
          withTiming(1, { duration: DOT_PULSE_MS }),
          withTiming(DOT_MIN_OPACITY, { duration: DOT_PULSE_MS }),
        ),
        -1,
        false,
      ),
    );
  }, [index, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={[styles.dot, index > 0 && styles.dotSpacing, animatedStyle]} />;
}

export default function TypingIndicator() {
  return (
    <View style={styles.row}>
      <View style={styles.bubble}>
        {Array.from({ length: DOT_COUNT }).map((_, i) => (
          <TypingDot key={i} index={i} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 6,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dividerWarm,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: Colors.warmGray,
  },
  dotSpacing: {
    marginLeft: DOT_SPACING,
  },
});
