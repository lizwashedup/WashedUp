import React from 'react';
import Svg, { Path } from 'react-native-svg';

/**
 * Heart-and-hands tab glyph for the Yours tab. No equivalent exists in
 * lucide / Ionicons, so this is a hand-built SVG.
 *
 * SIM-EYEBALL #4a: confirm this reads as "two hands holding a heart" at
 * 24px on device; tweak the path or fall back to lucide HeartHandshake.
 */
export default function HeartHandsIcon({
  size = 24,
  color,
}: {
  size?: number;
  color: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Heart */}
      <Path
        d="M12 7.7c1-1.7 3.9-1.9 5.1.1.9 1.5.3 3.2-1 4.5L12 16.2 7.9 12.3c-1.3-1.3-1.9-3-1-4.5C8.1 5.8 11 6 12 7.7Z"
        fill={color}
      />
      {/* Cupping hands */}
      <Path
        d="M3.4 12.8c.5-.4 1.2-.3 1.7.2l2.6 2.6c.4.4 1 .6 1.5.6h3.9c.5 0 .9.4.9.9s-.4.9-.9.9H8.6c-.2 0-.3.2-.2.3.3.5.9.8 1.5.8h4.7c1 0 1.9-.4 2.6-1.1l2.5-2.5c.5-.5 1.3-.5 1.7 0 .4.4.4 1.1 0 1.6l-2.9 3.2c-1 1.1-2.5 1.8-4 1.8H7.8c-.7 0-1.4-.3-1.9-.8l-2.6-2.7c-.9-.9-.9-2.3.1-3.1Z"
        fill={color}
      />
    </Svg>
  );
}
