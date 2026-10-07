import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { router } from 'expo-router';
import { AfterglowColors, CreatorSurfaceColors } from '../../constants/Colors';
import { AfterglowType } from '../../constants/Typography';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';

export function BackToYoursButton() {
  const { fonts } = useAfterglowFonts(true, 'creator');
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to Yours"
    accessibilityHint="Returns to your plans, people and circles"
    onPress={() => router.replace('/(tabs)/friends')} style={styles.button} activeOpacity={0.8}>
    <ArrowLeft size={17} color={AfterglowColors.ink} />
    <Text numberOfLines={1} style={[styles.label, { fontFamily: fonts.semibold }]}>Back to Yours</Text>
  </TouchableOpacity>;
}

const styles = StyleSheet.create({
  button: { alignSelf: 'flex-start', maxWidth: '100%', minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: CreatorSurfaceColors.sunsetGoldLight,
    borderWidth: 1, borderColor: CreatorSurfaceColors.goldEdge },
  label: { ...AfterglowType.caption, flexShrink: 1, color: AfterglowColors.ink },
});
