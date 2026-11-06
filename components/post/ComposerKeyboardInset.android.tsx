import React, { useContext } from 'react';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useIsFocused } from '@react-navigation/native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';

function FocusedInset() {
  const keyboard = useAnimatedKeyboard();
  const tabHeight = useContext(BottomTabBarHeightContext) ?? 0;
  // The tab bar already occupies part of the space below the form.
  const style = useAnimatedStyle(() => ({
    height: Math.max(0, keyboard.height.value - tabHeight),
  }));
  return <Animated.View pointerEvents="none" accessible={false} style={style} />;
}

export default function ComposerKeyboardInset() {
  const focused = useIsFocused();
  // Android's native inset observer changes the window's resize handling.
  // Retire it when the creator navigates to another tab.
  return focused ? <FocusedInset /> : null;
}
