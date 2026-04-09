import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

const SHIMMER_DURATION = 1200;

function ShimmerBlock({ width, height, borderRadius = 8, style }: {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: any;
}) {
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: SHIMMER_DURATION, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: '#E8DDD0',
        },
        style,
        animStyle,
      ]}
    />
  );
}

function SkeletonCard() {
  return (
    <View style={styles.card}>
      {/* Creator row */}
      <View style={styles.creatorRow}>
        <ShimmerBlock width={36} height={36} borderRadius={18} />
        <View style={{ flex: 1, marginLeft: 10, gap: 6 }}>
          <ShimmerBlock width={120} height={12} borderRadius={6} />
          <ShimmerBlock width={60} height={10} borderRadius={5} />
        </View>
      </View>
      {/* Title */}
      <ShimmerBlock width="85%" height={16} borderRadius={8} style={{ marginBottom: 8 }} />
      {/* Category pill */}
      <ShimmerBlock width={70} height={20} borderRadius={999} style={{ marginBottom: 10 }} />
      {/* Description lines */}
      <ShimmerBlock width="100%" height={10} borderRadius={5} style={{ marginBottom: 6 }} />
      <ShimmerBlock width="70%" height={10} borderRadius={5} style={{ marginBottom: 12 }} />
      {/* Date/location */}
      <ShimmerBlock width="60%" height={10} borderRadius={5} style={{ marginBottom: 6 }} />
      <ShimmerBlock width="50%" height={10} borderRadius={5} style={{ marginBottom: 14 }} />
      {/* Footer */}
      <View style={styles.footer}>
        <ShimmerBlock width={80} height={10} borderRadius={5} />
        <ShimmerBlock width={100} height={34} borderRadius={12} />
      </View>
    </View>
  );
}

export function SkeletonFeed() {
  return (
    <View style={styles.feed}>
      {/* Section header skeleton */}
      <ShimmerBlock width={90} height={10} borderRadius={5} style={{ marginBottom: 12, marginTop: 24 }} />
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </View>
  );
}

export function SkeletonChatList() {
  return (
    <View style={styles.feed}>
      <ShimmerBlock width={60} height={10} borderRadius={5} style={{ marginBottom: 12, marginTop: 20 }} />
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={styles.chatRow}>
          <ShimmerBlock width={52} height={52} borderRadius={12} />
          <View style={{ flex: 1, marginLeft: 12, gap: 6 }}>
            <ShimmerBlock width="70%" height={13} borderRadius={6} />
            <ShimmerBlock width="90%" height={10} borderRadius={5} />
            <ShimmerBlock width="40%" height={8} borderRadius={4} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function SkeletonPlanDetail() {
  return (
    <View style={styles.detailFeed}>
      {/* Hero image placeholder */}
      <ShimmerBlock width="100%" height={200} borderRadius={0} style={{ marginBottom: 16 }} />
      {/* Creator */}
      <View style={[styles.creatorRow, { paddingHorizontal: 20 }]}>
        <ShimmerBlock width={48} height={48} borderRadius={24} />
        <View style={{ flex: 1, marginLeft: 12, gap: 6 }}>
          <ShimmerBlock width={80} height={10} borderRadius={5} />
          <ShimmerBlock width={140} height={14} borderRadius={7} />
        </View>
      </View>
      {/* Title */}
      <ShimmerBlock width="75%" height={22} borderRadius={8} style={{ marginTop: 16, marginHorizontal: 20 }} />
      {/* Tags */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, paddingHorizontal: 20 }}>
        <ShimmerBlock width={60} height={24} borderRadius={999} />
        <ShimmerBlock width={80} height={24} borderRadius={999} />
      </View>
      {/* Description */}
      <View style={{ paddingHorizontal: 20, marginTop: 16, gap: 6 }}>
        <ShimmerBlock width="100%" height={12} borderRadius={6} />
        <ShimmerBlock width="90%" height={12} borderRadius={6} />
        <ShimmerBlock width="60%" height={12} borderRadius={6} />
      </View>
      {/* Logistics card */}
      <ShimmerBlock width="100%" height={140} borderRadius={16} style={{ marginTop: 20, marginHorizontal: 20 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  feed: { paddingHorizontal: 20 },
  detailFeed: {},
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#F5EDE0',
    paddingTop: 12,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
});
