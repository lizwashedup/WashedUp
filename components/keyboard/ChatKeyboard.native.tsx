// Requires the matching native keyboard controller in this binary.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Keyboard, KeyboardAvoidingView as RNKeyboardAvoidingView, Platform, View, type ViewProps } from 'react-native';
import { KeyboardProvider, KeyboardAvoidingView as ControllerKeyboardAvoidingView, useAnimatedKeyboard as useControllerAnimatedKeyboard, useKeyboardAnimation } from 'react-native-keyboard-controller';
import { useAnimatedKeyboard as useReanimatedKeyboard } from 'react-native-reanimated';

// Only iOS needs the native transaction adapter. Keep Android's existing
// Reanimated keyboard and window-inset behavior unchanged.
export const useAnimatedKeyboard = Platform.OS === 'ios' ? useControllerAnimatedKeyboard : useReanimatedKeyboard;

export function ChatKeyboardProvider({ children }: React.PropsWithChildren) {
  if (Platform.OS !== 'ios') return <>{children}</>;
  return (
    <KeyboardProvider
      preload={false}
      statusBarTranslucent
      navigationBarTranslucent
      preserveEdgeToEdge
    >
      {children}
    </KeyboardProvider>
  );
}

// A transform follows the native keyboard transaction without a Fabric layout
// commit for each moving frame. The attachment panel remains a minimum lift.
function useKeyboardLift(inset: number) {
  const { height } = useKeyboardAnimation();
  const floor = useRef(new Animated.Value(inset)).current;
  useLayoutEffect(() => { floor.setValue(inset); }, [floor, inset]);
  // Keep the native graph attached through keyboard/panel handoff. Replacing
  // an interpolation while its event source is moving can reset its offset.
  // min(height, -floor) = height - max(0, height + floor).
  return useMemo(() => Animated.subtract(height,
    Animated.add(height, floor).interpolate({
      inputRange: [0, 1], outputRange: [0, 1],
      extrapolateLeft: 'clamp', extrapolateRight: 'extend',
    })), [height, floor]);
}

export function IOSKeyboardDock({ inset, style, ...props }: ViewProps & { inset: number }) {
  const translateY = useKeyboardLift(inset);
  return <Animated.View {...props} style={[style, { transform: [{ translateY }] }]} />;
}

// During motion the list uses the exact same native translation as the dock.
// Reserve its settled footprint only after opening. This restores the full
// scrollable history viewport without per-frame layout commits.
export function IOSKeyboardViewport({ inset = 0, style, children, ...props }: ViewProps & { inset?: number }) {
  const translateY = useKeyboardLift(inset);
  const [settledHeight, setSettledHeight] = useState(() => Keyboard.metrics()?.height ?? 0);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', event => setSettledHeight(event.endCoordinates.height));
    const hiding = Keyboard.addListener('keyboardWillHide', () => setSettledHeight(0));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setSettledHeight(0));
    return () => { shown.remove(); hiding.remove(); hidden.remove(); };
  }, []);
  return (
    <View {...props} style={[style, { overflow: 'hidden' }]}>
      <Animated.View style={{ flex: 1, paddingTop: Math.max(settledHeight, inset), transform: [{ translateY }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

export const ChatKeyboardAvoidingView = Platform.OS === 'ios' ? ControllerKeyboardAvoidingView : RNKeyboardAvoidingView;
