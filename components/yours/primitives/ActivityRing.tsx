import React from 'react';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  useAnimatedProps,
  type SharedValue,
} from 'react-native-reanimated';
import {
  RING_COLORS,
  RING_FRACTION,
  RING_GHOST_COLOR,
  RING_A11Y_LABEL,
} from '../state/constants';
import type { RingBucket } from '../../../lib/yours/types';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface ActivityRingProps {
  /** Avatar diameter in pt. Ring sits 3pt outside it. */
  avatarSize: number;
  bucket: RingBucket;
  /** Invited-but-not-joined: dashed ghost ring, overrides bucket. */
  ghost?: boolean;
  /**
   * Optional 0..1 shared value for the light-up draw. When omitted the
   * ring is static (cheap for big grids).
   */
  animatedProgress?: SharedValue<number>;
}

const GAP = 3;

/**
 * Ambient activity ring. Starts at 12 o'clock, fills clockwise, rounded
 * cap, sits GAP pt outside the avatar. Purely visual + a VoiceOver label.
 */
export default function ActivityRing({
  avatarSize,
  bucket,
  ghost,
  animatedProgress,
}: ActivityRingProps) {
  const stroke = ghost
    ? 1
    : bucket === 'full'
      ? 2.5
      : bucket === '75'
        ? 2
        : bucket === '50'
          ? 1.5
          : 1;
  const size = avatarSize + (GAP + stroke) * 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const center = size / 2;
  const fraction = RING_FRACTION[bucket];

  // Unconditional hook (rules of hooks). Unused in ghost/none branches.
  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: animatedProgress
      ? c * (1 - animatedProgress.value)
      : c * (1 - fraction),
  }));

  const a11yLabel = ghost
    ? 'Invited, not yet joined'
    : RING_A11Y_LABEL[bucket];
  const color = ghost ? null : RING_COLORS[bucket];

  return (
    <Svg
      width={size}
      height={size}
      style={{ position: 'absolute' }}
      accessible
      accessibilityLabel={a11yLabel}
    >
      {ghost ? (
        <Circle
          cx={center}
          cy={center}
          r={r}
          stroke={RING_GHOST_COLOR}
          strokeWidth={1}
          strokeDasharray="3 4"
          fill="none"
        />
      ) : color ? (
        <AnimatedCircle
          cx={center}
          cy={center}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          fill="none"
          transform={`rotate(-90 ${center} ${center})`}
          animatedProps={animatedProps}
        />
      ) : null}
    </Svg>
  );
}
