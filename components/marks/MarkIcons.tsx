/**
 * Mark Icons — Minimal SVG line drawings for the Marks system.
 * Terracotta (#D97746) and asphalt (#1E1E1E) strokes on parchment backgrounds.
 * Milestone marks (anchor, mainstay): circular containers.
 * Identity marks (all others): rounded square containers (12px radius).
 */
import React from 'react';
import Svg, { Path, Circle, Line, Rect, Text as SvgText } from 'react-native-svg';

const TERRACOTTA = '#D97746';
const ASPHALT = '#1E1E1E';

interface IconProps {
  size?: number;
  strokeColor?: string;
}

/* ── Milestone marks ─────────────────────────────────────────────── */

/** Anchor — KEPT AS IS. Circular container. */
function Anchor({ size = 24, strokeColor = TERRACOTTA }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={5} r={2.5} stroke={strokeColor} strokeWidth={1.8} />
      <Line x1={12} y1={7.5} x2={12} y2={21} stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round" />
      <Path
        d="M5 13a7 7 0 0014 0"
        stroke={strokeColor}
        strokeWidth={1.8}
        strokeLinecap="round"
        fill="none"
      />
      <Line x1={8} y1={12} x2={16} y2={12} stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

/** Mainstay — Mast and sail (pennant). Circular container. */
function Mainstay({ size = 24, strokeColor = TERRACOTTA }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Mast — vertical line */}
      <Line x1={9} y1={3} x2={9} y2={19} stroke={strokeColor} strokeWidth={1.5} strokeLinecap="round" />
      {/* Sail — triangular pennant hanging right */}
      <Path
        d="M9 4l9 4.5-9 4.5"
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Base line */}
      <Line x1={5} y1={21} x2={19} y2={21} stroke={strokeColor} strokeWidth={1.5} strokeLinecap="round" />
      {/* Stem connecting mast to base */}
      <Line x1={9} y1={19} x2={9} y2={21} stroke={strokeColor} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

/* ── Identity marks ──────────────────────────────────────────────── */

/** Night Owl — Cute owl face. Rounded square container. */
function Owl({ size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Head circle */}
      <Circle cx={12} cy={11} r={7} stroke={ASPHALT} strokeWidth={1.5} fill="none" />
      {/* Ear tufts */}
      <Path d="M7.5 5.5L6 3" stroke={ASPHALT} strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M16.5 5.5L18 3" stroke={ASPHALT} strokeWidth={1.5} strokeLinecap="round" />
      {/* Large round eyes (filled dots) */}
      <Circle cx={9.5} cy={10.5} r={1.8} fill={ASPHALT} />
      <Circle cx={14.5} cy={10.5} r={1.8} fill={ASPHALT} />
      {/* Small beak */}
      <Path d="M11 13.5l1 1 1-1" stroke={ASPHALT} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Perch line below */}
      <Path d="M7 20q5 2 10 0" stroke={ASPHALT} strokeWidth={1.5} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/** Early Bird — Sunrise. KEPT AS IS. Rounded square container. */
function Sunrise({ size = 24, strokeColor = TERRACOTTA }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 2v3" stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M4.22 7.22l2.12 2.12" stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M19.78 7.22l-2.12 2.12" stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M1 16h22" stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M5 16a7 7 0 0114 0" stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round" fill="none" />
      <Path d="M3 20h18" stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

/** Trailblazer — Mountain peak with trail and summit flag. Rounded square container. */
function Mountain({ size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Mountain triangle */}
      <Path
        d="M12 3L2 21h20L12 3z"
        stroke={ASPHALT}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Trail line across middle */}
      <Path d="M6.5 13h11" stroke={ASPHALT} strokeWidth={1.2} strokeLinecap="round" strokeDasharray="2 2.5" />
      {/* Summit flag marker — small diamond in terracotta */}
      <Path
        d="M12 5l1.5 2-1.5 2-1.5-2z"
        stroke={TERRACOTTA}
        strokeWidth={1.3}
        strokeLinejoin="round"
        fill={TERRACOTTA}
        opacity={0.8}
      />
    </Svg>
  );
}

/** Culture Club — Paintbrush with paint dots. Rounded square container. */
function Paintbrush({ size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Handle — diagonal line */}
      <Line x1={6} y1={20} x2={16} y2={6} stroke={TERRACOTTA} strokeWidth={1.5} strokeLinecap="round" />
      {/* Brush tip — rounded at top-right */}
      <Path
        d="M16 6q2-1 3.5 0.5t0.5 3.5l-2.5-1.5z"
        stroke={TERRACOTTA}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={TERRACOTTA}
        opacity={0.6}
      />
      {/* Paint dots */}
      <Circle cx={5} cy={15} r={2} fill={ASPHALT} opacity={0.5} />
      <Circle cx={8.5} cy={17.5} r={1.5} fill={ASPHALT} opacity={0.35} />
      <Circle cx={3.5} cy={19} r={1.2} fill={ASPHALT} opacity={0.6} />
    </Svg>
  );
}

/** The Regular — Two people whose paths merge. Rounded square container. */
function TwoPaths({ size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Left person head */}
      <Circle cx={8} cy={4} r={2} fill={ASPHALT} />
      {/* Right person head */}
      <Circle cx={16} cy={4} r={2} fill={TERRACOTTA} />
      {/* Left path curving down */}
      <Path
        d="M8 6c0 4-2 6 0 10"
        stroke={ASPHALT}
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
      />
      {/* Right path curving down */}
      <Path
        d="M16 6c0 4 2 6 0 10"
        stroke={TERRACOTTA}
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
      />
      {/* Shared arc at bottom where paths merge */}
      <Path
        d="M8 16q4 5 8 0"
        stroke={ASPHALT}
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

/** Explorer — Compass with N/S/E/W ticks and diamond needle. Rounded square container. */
function Compass({ size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Outer circle */}
      <Circle cx={12} cy={12} r={9.5} stroke={ASPHALT} strokeWidth={1.5} />
      {/* Inner circle for depth */}
      <Circle cx={12} cy={12} r={7} stroke={ASPHALT} strokeWidth={1} opacity={0.4} />
      {/* N/S/E/W tick marks */}
      <Line x1={12} y1={1.5} x2={12} y2={3.5} stroke={ASPHALT} strokeWidth={1.5} strokeLinecap="round" />
      <Line x1={12} y1={20.5} x2={12} y2={22.5} stroke={ASPHALT} strokeWidth={1.5} strokeLinecap="round" />
      <Line x1={1.5} y1={12} x2={3.5} y2={12} stroke={ASPHALT} strokeWidth={1.5} strokeLinecap="round" />
      <Line x1={20.5} y1={12} x2={22.5} y2={12} stroke={ASPHALT} strokeWidth={1.5} strokeLinecap="round" />
      {/* Compass needle diamond — north-pointing, terracotta filled */}
      <Path
        d="M12 7l2 5-2 5-2-5z"
        stroke={TERRACOTTA}
        strokeWidth={1.2}
        strokeLinejoin="round"
        fill={TERRACOTTA}
        opacity={0.5}
      />
      {/* Tiny N */}
      <SvgText x={12} y={6} textAnchor="middle" fontSize={4} fontWeight="bold" fill={ASPHALT}>N</SvgText>
    </Svg>
  );
}

/** Day One — Trophy. Rounded square container. */
function Trophy({ size = 24, strokeColor = TERRACOTTA }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Cup — V shape */}
      <Path
        d="M7 4h10l-2 9h-6L7 4z"
        stroke={strokeColor}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Rim */}
      <Line x1={6.5} y1={4} x2={17.5} y2={4} stroke={strokeColor} strokeWidth={1.3} strokeLinecap="round" />
      {/* Left handle */}
      <Path d="M7 5.5c-2.5 0-3 3-1.5 5" stroke={strokeColor} strokeWidth={1.3} strokeLinecap="round" fill="none" />
      {/* Right handle */}
      <Path d="M17 5.5c2.5 0 3 3 1.5 5" stroke={strokeColor} strokeWidth={1.3} strokeLinecap="round" fill="none" />
      {/* Stem */}
      <Line x1={12} y1={13} x2={12} y2={18} stroke={strokeColor} strokeWidth={1.3} strokeLinecap="round" />
      {/* Base */}
      <Line x1={8} y1={18} x2={16} y2={18} stroke={strokeColor} strokeWidth={1.3} strokeLinecap="round" />
    </Svg>
  );
}

/* ── Icon map ────────────────────────────────────────────────────── */

const ICON_MAP: Record<string, React.FC<IconProps>> = {
  anchor: Anchor,
  mainstay: Mainstay,
  owl: Owl,
  sunrise: Sunrise,
  mountain: Mountain,
  paintbrush: Paintbrush,
  frame: Paintbrush,       // legacy alias
  twopaths: TwoPaths,
  cups: TwoPaths,          // legacy alias
  compass: Compass,
  trophy: Trophy,
  triangle: Trophy,        // legacy alias
};

interface MarkIconProps {
  iconName: string;
  size?: number;
  strokeColor?: string;
}

export default function MarkIcon({ iconName, size = 24, strokeColor = TERRACOTTA }: MarkIconProps) {
  const Icon = ICON_MAP[iconName];
  if (!Icon) return null;
  return <Icon size={size} strokeColor={strokeColor} />;
}
