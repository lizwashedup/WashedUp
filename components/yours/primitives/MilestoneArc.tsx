import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';

const THRESHOLDS = [1, 3, 5, 10, 25];

function progressToNext(count: number): number {
  if (count >= 25) return 1;
  let lower = 0;
  let upper = 1;
  for (const t of THRESHOLDS) {
    if (count >= t) lower = t;
    else {
      upper = t;
      break;
    }
  }
  if (count < 1) return Math.min(count / 1, 1);
  return Math.min((count - lower) / (upper - lower), 1);
}

/** Polar point on the gauge (240° sweep, opening at the bottom). */
function pt(cx: number, cy: number, r: number, frac: number) {
  const start = 150; // degrees
  const sweep = 240;
  const a = ((start + sweep * frac) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(cx: number, cy: number, r: number, frac: number) {
  const a = pt(cx, cy, r, 0);
  const b = pt(cx, cy, r, frac);
  const large = 240 * frac > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

/**
 * Milestone progress: a thin warm arc + the current milestone name. No
 * numbers, just the arc and the name (spec: emotional centerpiece).
 */
export default function MilestoneArc({
  sharedCount,
  milestone,
}: {
  sharedCount: number;
  milestone: string | null;
}) {
  const size = 140;
  const r = size / 2 - 8;
  const cx = size / 2;
  const cy = size / 2;
  const frac = progressToNext(sharedCount);

  return (
    <View style={styles.wrap}>
      <Svg width={size} height={size}>
        <Path
          d={arcPath(cx, cy, r, 1)}
          stroke={Colors.dividerWarm}
          strokeWidth={3}
          strokeLinecap="round"
          fill="none"
        />
        {frac > 0 && (
          <Path
            d={arcPath(cx, cy, r, frac)}
            stroke={Colors.terracotta}
            strokeWidth={3}
            strokeLinecap="round"
            fill="none"
          />
        )}
      </Svg>
      {milestone ? (
        <Text style={styles.name}>{milestone}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  name: {
    position: 'absolute',
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displaySM,
    color: Colors.terracotta,
    textAlign: 'center',
  },
});
