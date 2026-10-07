import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType } from '../../../constants/Typography';
import { COPY } from '../state/constants';
import type { RequestAppearance } from './RequestStack';

/**
 * Conditional amber banner. Renders null when there are no requests (spec:
 * no placeholder). goldenAmber tint bg + asphalt text for WCAG AA.
 */
export default function RequestBanner({
  count,
  onPress,
  appearance,
}: {
  count: number;
  onPress: () => void;
  appearance?: RequestAppearance;
}) {
  if (count <= 0) return null;
  const label =
    count === 1 ? COPY.requestBannerOne : COPY.requestBannerMany(count);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.banner, appearance && afterglow.banner]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {!appearance && <View style={styles.accent} />}
      <Text style={[styles.text, appearance && { ...afterglow.text, fontFamily: appearance.fonts.semibold }]}>{label}</Text>
      <ChevronRight size={20} color={appearance ? AfterglowColors.ink : Colors.asphalt} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.goldenAmberTint15,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 12,
  },
  accent: {
    width: 3,
    alignSelf: 'stretch',
    backgroundColor: Colors.goldenAmber,
    borderRadius: 2,
  },
  text: {
    flex: 1,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
});

const afterglow = StyleSheet.create({
  banner: { minHeight: 48, backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line, borderWidth: 1, borderRadius: 4 },
  text: { ...AfterglowType.body, color: AfterglowColors.ink },
});
