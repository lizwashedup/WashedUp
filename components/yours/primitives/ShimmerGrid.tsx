import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import Colors from '../../../constants/Colors';
import { ANIM } from '../state/constants';
import { useReduceMotion } from '../a11y/useReduceMotion';

function ShimmerCircle({ size, reduce }: { size: number; reduce: boolean }) {
  const opacity = useSharedValue(0.4);
  useEffect(() => {
    if (reduce) {
      opacity.value = 0.55;
      return;
    }
    opacity.value = withRepeat(
      withTiming(0.7, {
        duration: ANIM.shimmerCycleMs,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true,
    );
  }, [reduce]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: Colors.yoursShimmer,
        },
        style,
      ]}
    />
  );
}

/**
 * Ghost placeholder grid behind the fresh-start / empty states. Breathing
 * opacity (static under Reduce Motion).
 */
export default function ShimmerGrid({
  count = 9,
  columns = 3,
  circleSize = 72,
}: {
  count?: number;
  columns?: number;
  circleSize?: number;
}) {
  const reduce = useReduceMotion();
  const itemWidth = `${Math.floor(90 / columns)}%` as const;
  return (
    <View style={styles.grid}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={{ width: itemWidth, alignItems: 'center' }}>
          <ShimmerCircle size={circleSize} reduce={reduce} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    rowGap: 28,
  },
});
