/**
 * Web placeholder for react-native-maps (native-only).
 * Use the .native.tsx version on iOS/Android.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export const MapView = ({ style, children }: { style?: object; children?: React.ReactNode }) => (
  <View style={[styles.placeholder, style]}>
    <Text style={styles.text}>Maps are available in the mobile app</Text>
    {children}
  </View>
);

export const Marker = () => null;

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F0E6D3',
  },
  text: {
    color: '#666666',
    fontSize: 14,
  },
});
