import React from 'react';
import { Text, useWindowDimensions, type TextProps } from 'react-native';

// Recreate only the native text measurement after an in-place system text-size
// change. Media playback, loading/retry state and the containing row stay mounted.
export function ChatSizedText(props: TextProps) {
  const { fontScale } = useWindowDimensions();
  return <Text key={fontScale} {...props} />;
}
