/**
 * ConfirmationMark - the brand-drawn glyph inside the post-moment terracotta
 * ring. A vector checkmark (rounded caps), NOT the raw checkmark character.
 */
import Svg, { Path } from 'react-native-svg';

import Colors from '../../constants/Colors';

interface ConfirmationMarkProps {
  size?: number;
  color?: string;
}

export default function ConfirmationMark({ size = 30, color = Colors.terracotta }: ConfirmationMarkProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4.5 12.5 L10 18 L19.5 6.5"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
