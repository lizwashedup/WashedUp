/**
 * Mark Icons — Minimal SVG line drawings for the Marks system.
 * Terracotta (#D97746) and asphalt (#1E1E1E) strokes on parchment backgrounds.
 * Identity marks: rounded square containers (12px radius).
 * Milestone marks: circular containers.
 */
import React from 'react';
import Svg, { Path, Circle, Line, Polyline, Rect } from 'react-native-svg';

const TERRACOTTA = '#D97746';
const ASPHALT = '#1E1E1E';

interface IconProps {
  size?: number;
  strokeColor?: string;
}

function Spark({ size = 24, strokeColor = TERRACOTTA }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
        stroke={strokeColor}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

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

function Mainstay({ size = 24, strokeColor = TERRACOTTA }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2L9 9H3l5 4.5-2 7L12 16l6 4.5-2-7 5-4.5h-6L12 2z"
        stroke={strokeColor}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

function Owl({ size = 24, strokeColor = TERRACOTTA }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={9} cy={10} r={2.5} stroke={strokeColor} strokeWidth={1.8} />
      <Circle cx={15} cy={10} r={2.5} stroke={strokeColor} strokeWidth={1.8} />
      <Circle cx={9} cy={10} r={0.8} fill={strokeColor} />
      <Circle cx={15} cy={10} r={0.8} fill={strokeColor} />
      <Path d="M6 7c-1-3 2-5 6-5s7 2 6 5" stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round" fill="none" />
      <Path d="M12 12.5v1.5" stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M10.5 15c.5.5 2.5.5 3 0" stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round" fill="none" />
      <Path d="M7 17c1 3 4 4.5 5 4.5s4-1.5 5-4.5" stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

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

function Mountain({ size = 24, strokeColor = TERRACOTTA }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 4l-9 16h18L12 4z"
        stroke={strokeColor}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="M17 12l4 8"
        stroke={strokeColor}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 4l3.5 6"
        stroke={strokeColor}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeDasharray="2 2"
      />
    </Svg>
  );
}

function Frame({ size = 24, strokeColor = TERRACOTTA }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={3} width={18} height={18} rx={2} stroke={strokeColor} strokeWidth={1.8} />
      <Rect x={6} y={6} width={12} height={12} rx={1} stroke={strokeColor} strokeWidth={1.4} />
      <Circle cx={12} cy={12} r={2} stroke={strokeColor} strokeWidth={1.4} />
    </Svg>
  );
}

function Cups({ size = 24, strokeColor = TERRACOTTA }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 6h6v8a3 3 0 01-6 0V6z" stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M11 9h2a2 2 0 010 4h-2" stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round" fill="none" />
      <Path d="M13 6h6v8a3 3 0 01-6 0V6z" stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Line x1={4} y1={20} x2={20} y2={20} stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1={8} y1={17} x2={8} y2={20} stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1={16} y1={17} x2={16} y2={20} stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

function Compass({ size = 24, strokeColor = TERRACOTTA }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9.5} stroke={strokeColor} strokeWidth={1.8} />
      <Path
        d="M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z"
        stroke={strokeColor}
        strokeWidth={1.6}
        strokeLinejoin="round"
        fill="none"
      />
      <Circle cx={12} cy={12} r={1} fill={strokeColor} />
    </Svg>
  );
}

function Triangle({ size = 24, strokeColor = TERRACOTTA }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3L2 21h20L12 3z"
        stroke={strokeColor}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Path d="M12 9v5" stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round" />
      <Circle cx={12} cy={17} r={0.8} fill={strokeColor} />
    </Svg>
  );
}

const ICON_MAP: Record<string, React.FC<IconProps>> = {
  spark: Spark,
  anchor: Anchor,
  mainstay: Mainstay,
  owl: Owl,
  sunrise: Sunrise,
  mountain: Mountain,
  frame: Frame,
  cups: Cups,
  compass: Compass,
  triangle: Triangle,
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
