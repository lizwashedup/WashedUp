import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { COPY } from '../state/constants';

/**
 * Conditional amber banner. Renders null when there are no requests (spec:
 * no placeholder). goldenAmber tint bg + asphalt text for WCAG AA.
 */
export default function RequestBanner({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}) {
  if (count <= 0) return null;
  const label =
    count === 1 ? COPY.requestBannerOne : COPY.requestBannerMany(count);
  return (
    <Pressable
      onPress={onPress}
      style={styles.banner}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.accent} />
      <Text style={styles.text}>{label}</Text>
      <ChevronRight size={20} color={Colors.asphalt} strokeWidth={2} />
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
