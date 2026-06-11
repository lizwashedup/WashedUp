/**
 * CircleCover - a circle's identity thumbnail.
 *
 * A rounded square (not a round avatar) so a circle never reads as a person's
 * face. Identity ladder (circle-identity-design-spec.md): cover photo > serif
 * monogram tile > a quiet cream tile when there is no name yet. NEVER an icon:
 * the duo-people glyph is no longer the face of any circle.
 */
import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
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
  tone = 'terracotta',
}: {
  name: string;
  coverUrl?: string | null;
  size?: number;
  radius?: number;
  monogramSize?: number;
  /**
   * Coverless-square treatment. 'terracotta' (default) keeps the original
   * brand-soft square. 'gold' is the directory-card look: a gold-tinted square
   * (decorative) with the monogram letter still in terracotta (the standing
   * "no gold for text" rule keeps the letter off gold).
   */
  tone?: 'terracotta' | 'gold';
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
  // No name yet: a quiet cream tile, no glyph (identity accumulates; it is never
  // a generic icon).
  return (
    <View
      style={[
        styles.cover,
        styles.placeholder,
        monogram ? (tone === 'gold' && styles.gold) : styles.empty,
        box,
      ]}
    >
      {monogram ? (
        <Text style={[styles.monogram, { fontSize: monogramSize }]}>{monogram}</Text>
      ) : null}
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
  gold: {
    backgroundColor: Colors.goldBadgeSoft,
  },
  empty: {
    backgroundColor: Colors.cream,
  },
  monogram: {
    fontFamily: Fonts.displayItalic,
    color: Colors.terracotta,
    includeFontPadding: false,
  },
});
