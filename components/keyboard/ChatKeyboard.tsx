// Web fallback: keep the existing browser layout and attachment-panel offsets.
import React from 'react';
import { View, type ViewProps } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

export function ChatKeyboardProvider({ children }: React.PropsWithChildren) {
  return <>{children}</>;
}

export function useAnimatedKeyboard() {
  const height = useSharedValue(0);
  const state = useSharedValue(4);
  return { height, state };
}

export function IOSKeyboardDock({ inset: _inset, ...props }: ViewProps & { inset?: number }) {
  return <View {...props} />;
}

export const IOSKeyboardViewport = IOSKeyboardDock;

export { KeyboardAvoidingView as ChatKeyboardAvoidingView } from 'react-native';
