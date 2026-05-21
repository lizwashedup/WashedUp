import React from 'react';
import Svg, { Path, Line, G } from 'react-native-svg';

/**
 * Sunrise / horizon tab glyph for the Yours tab. Reads as "your day starts
 * here" — optimistic, forward-looking, personal.
 *
 * Composition: horizon line, half-circle sun (outline only, no fill) rising
 * above it, and a dense fan of 11 short rays radiating from the sun. All
 * stroke-based with round caps so it sits at the same visual weight as the
 * other outline tab icons (Scene compass, Chats speech bubble). 24x24
 * viewBox; default 24pt to match siblings exactly.
 */

// Bigger half-sun (radius 10) sitting low on the horizon at y=19, so the
// half-circle matches the chat bubble width. 11 rays alternate long/short
// around the half-circle (25° to 155° at 13° steps) for an organic sunburst:
// odd indices = long, even = short. Each ray's outer radius is still
// auto-capped to the 24x24 viewBox so the rays near the horizon naturally
// clip a touch shorter without leaving the canvas.
// ViewBox is 28x24 (wider than tall) on purpose: a radius-10 sun in a 24
// canvas leaves no horizontal room for rays beside the sun. Widening to 28
// gives 4 extra units across so rays can radiate truly "around" the half-
// circle from horizon to horizon. Render scales preserving aspect ratio.
const VIEWBOX_W = 28;
const VIEWBOX_H = 24;
const SUN_CX = 14; // centered in the wider viewBox
const SUN_CY = 19;
const SUN_R = 10;
const RAY_INNER_R = 10.5;
const LONG_RAY_LEN = 7;
const SHORT_RAY_LEN = 4;
const EDGE_PAD = 0.5; // keep stroke fully inside viewBox
// 13 rays from 5° to 175° (every 14°) — wraps almost flat-to-flat across
// the horizon. The extreme side rays still taper short (canvas just barely
// has room for them) which mirrors a real sunburst.
const RAY_ANGLES_DEG = [5, 19, 33, 47, 61, 75, 90, 105, 119, 133, 147, 161, 175];

function rayCoords(deg: number, isLong: boolean) {
  const rad = (deg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const target = isLong ? LONG_RAY_LEN : SHORT_RAY_LEN;
  // Cap so the ray's tip never leaves the viewBox (left/right/top edges).
  const maxByX = Math.abs(cosA) > 1e-3
    ? (VIEWBOX_W - SUN_CX - EDGE_PAD) / Math.abs(cosA)
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

export default function SunriseIcon({
  size = 26,
  color,
  strokeWidth = 2,
}: {
  size?: number;
  color: string;
  strokeWidth?: number;
}) {
  const strokeProps = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
  };
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`} fill="none">
      {/* Horizon (spans the full widened viewBox) */}
      <Line x1={0} y1={SUN_CY} x2={VIEWBOX_W} y2={SUN_CY} {...strokeProps} />
      {/* Half sun rising above the horizon (sweep=1 = arc above the chord). */}
      <Path
        d={`M ${SUN_CX - SUN_R} ${SUN_CY} A ${SUN_R} ${SUN_R} 0 0 1 ${SUN_CX + SUN_R} ${SUN_CY}`}
        {...strokeProps}
        fill="none"
      />
      {/* Fan of rays (alternating long/short, odd index = long) */}
      <G>
        {RAY_ANGLES_DEG.map((deg, idx) => {
          const c = rayCoords(deg, idx % 2 === 1);
          return <Line key={deg} {...c} {...strokeProps} />;
        })}
      </G>
    </Svg>
  );
}
