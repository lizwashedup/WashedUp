import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Colors, { CreatorSurfaceColors, SunsetActionColors } from '../../constants/Colors';

/** Shared decorative lighting; contains no interactive or status content. */
export function CreatorActionFill() {
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.fill}>
    <LinearGradient colors={[Colors.terracotta, SunsetActionColors.lower]} start={{x:0,y:0}} end={{x:1,y:1}} style={StyleSheet.absoluteFill} />
    <LinearGradient colors={[CreatorSurfaceColors.goldLight, CreatorSurfaceColors.goldClear]} style={styles.light} />
  </View>;
}
const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, borderRadius: 24, overflow: 'hidden' },
  light: { ...StyleSheet.absoluteFillObject, height: 3 },
});
