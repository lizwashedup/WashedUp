/**
 * CircleCover - a circle's identity thumbnail.
 *
 * A rounded square (not a round avatar) so a circle never reads as a person's
 * face. When a cover photo exists it fills the tile; otherwise a warm
 * terracotta-tinted square shows the circle's monogram in Cormorant italic.
 *
 * Cover-photo resolution (cover_upload_id -> URL) lands with the create flow
 * (Step 8); until then coverUrl is null everywhere and the monogram shows.
 */
import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Users } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts } from '../../../constants/Typography';
import { CIRCLE } from '../../../constants/YoursDesign';

function monogramOf(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  // Grapheme-first so an emoji-led name doesn't slice a surrogate pair.
  const first = Array.from(trimmed)[0];
  return first ? first.toUpperCase() : null;
}

export default function CircleCover({
  name,
  coverUrl,
  size = CIRCLE.rowCover,
  radius = CIRCLE.rowCoverRadius,
  monogramSize = CIRCLE.monogramSize,
}: {
  name: string;
  coverUrl?: string | null;
  size?: number;
  radius?: number;
  monogramSize?: number;
}) {
  const box = { width: size, height: size, borderRadius: radius };

  if (coverUrl) {
    return (
      <Image
        source={{ uri: coverUrl }}
        style={[styles.cover, box]}
        accessibilityIgnoresInvertColors
      />
    );
  }

  const monogram = monogramOf(name);
  return (
    <View style={[styles.cover, styles.placeholder, box]}>
      {monogram ? (
        <Text style={[styles.monogram, { fontSize: monogramSize }]}>{monogram}</Text>
      ) : (
        <Users size={monogramSize} color={Colors.terracotta} strokeWidth={1.75} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    backgroundColor: Colors.brandSoft,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogram: {
    fontFamily: Fonts.displayItalic,
    color: Colors.terracotta,
    includeFontPadding: false,
  },
});
