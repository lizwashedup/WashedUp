import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import Colors from '../../constants/Colors';

// Minimal line-art polaroid for the Albums empty state. Same line-weight and
// stroke style as components/marks/MarkIcons.tsx. Tilted -4deg to echo the
// PolaroidCard rotation pattern. Pure SVG — no asset bundling.

type Props = { size?: number };

export function PolaroidEmptyIcon({ size = 96 }: Props) {
  return (
    <View style={{ transform: [{ rotate: '-4deg' }] }}>
      <Svg width={size} height={size} viewBox="0 0 80 80" fill="none">
        {/* Polaroid card outline */}
        <Rect
          x={12}
          y={10}
          width={56}
          height={64}
          rx={4}
          ry={4}
          stroke={Colors.terracotta}
          strokeWidth={1.6}
          fill="none"
        />
        {/* Photo aperture (square, classic polaroid proportion) */}
        <Rect
          x={18}
          y={16}
          width={44}
          height={44}
          stroke={Colors.terracotta}
          strokeWidth={1.4}
          fill="none"
        />
        {/* Tiny landscape inside the photo: horizon + sun. Reads as "a photo"
            without committing to any specific subject. */}
        <Path
          d="M22 50 L30 42 L36 47 L44 38 L52 46 L58 44"
          stroke={Colors.terracotta}
          strokeWidth={1.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <Circle
          cx={50}
          cy={26}
          r={3}
          stroke={Colors.terracotta}
          strokeWidth={1.2}
          fill="none"
        />
        {/* Caption strip — a single subtle line in the polaroid's white margin */}
        <Line
          x1={22}
          y1={68}
          x2={42}
          y2={68}
          stroke={Colors.terracotta}
          strokeWidth={1.2}
          strokeLinecap="round"
          opacity={0.55}
        />
      </Svg>
    </View>
  );
}
