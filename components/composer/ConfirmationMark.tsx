/**
 * ConfirmationMark - the brand-drawn glyph inside the post-moment terracotta
 * ring. A sunrise/horizon mark in the same visual family as the Yours-tab glyph
 * (components/yours/icons/SunriseIcon): a horizon line, an outline half-sun
 * rising above it, and a fan of rays. Stroke-only, round caps, no fill - and
 * deliberately NOT a checkmark badge (per the composer spec).
 */
import Svg, { G, Line, Path } from 'react-native-svg';

import Colors from '../../constants/Colors';

interface ConfirmationMarkProps {
  size?: number;
  color?: string;
}

// 24x24, balanced to sit centered in the 72px ring. Half-sun low on the horizon
// with a symmetric fan of rays above it; ray tips are capped to the viewBox so
// the wide side rays taper naturally like a real sunburst.
const SUN_CX = 12;
const SUN_CY = 16;
const SUN_R = 5;
const RAY_INNER_R = 6.4;
const LONG_RAY_LEN = 3.4;
const SHORT_RAY_LEN = 2;
const EDGE_PAD = 1.5;
const RAY_ANGLES_DEG = [18, 42, 66, 90, 114, 138, 162];

function rayCoords(deg: number, isLong: boolean) {
  const rad = (deg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const target = isLong ? LONG_RAY_LEN : SHORT_RAY_LEN;
  const maxByX = Math.abs(cosA) > 1e-3
    ? (SUN_CX - EDGE_PAD) / Math.abs(cosA)
    : Infinity;
  const maxByY = sinA > 1e-3
    ? (SUN_CY - EDGE_PAD) / sinA
    : Infinity;
  const outerR = Math.min(RAY_INNER_R + target, maxByX, maxByY);
  return {
    x1: SUN_CX + RAY_INNER_R * cosA,
    y1: SUN_CY - RAY_INNER_R * sinA,
    x2: SUN_CX + outerR * cosA,
    y2: SUN_CY - outerR * sinA,
  };
}

export default function ConfirmationMark({ size = 30, color = Colors.terracotta }: ConfirmationMarkProps) {
  const strokeProps = {
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Horizon */}
      <Line x1={2.5} y1={SUN_CY} x2={21.5} y2={SUN_CY} {...strokeProps} />
      {/* Half sun rising above the horizon */}
      <Path
        d={`M ${SUN_CX - SUN_R} ${SUN_CY} A ${SUN_R} ${SUN_R} 0 0 1 ${SUN_CX + SUN_R} ${SUN_CY}`}
        {...strokeProps}
        fill="none"
      />
      {/* Fan of rays (alternating long/short) */}
      <G>
        {RAY_ANGLES_DEG.map((deg, idx) => {
          const c = rayCoords(deg, idx % 2 === 1);
          return <Line key={deg} {...c} {...strokeProps} />;
        })}
      </G>
    </Svg>
  );
}
