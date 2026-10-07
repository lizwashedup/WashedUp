import React from 'react';
import { Text, useWindowDimensions, type TextProps } from 'react-native';

// Refresh native text measurement after an in-place system text-size change.
// The enclosing row, controls, image fallbacks and list state stay mounted.
export function ScaledText(props: TextProps) {
  const { fontScale } = useWindowDimensions();
  return <Text key={fontScale} {...props} />;
}
