/**
 * Web placeholder for react-native-maps (native-only).
 * Use the .native.tsx version on iOS/Android.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';

export const MapView = ({ style, children }: { style?: object; children?: React.ReactNode }) => (
  <View style={[styles.placeholder, style]}>
    <Text style={styles.text}>Maps are available in the mobile app</Text>
    {children}
  </View>
);

export const Marker = () => null;
export const PROVIDER_GOOGLE = undefined;

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.inputBg,
  },
  text: {
    color: Colors.textMedium,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
  },
});
