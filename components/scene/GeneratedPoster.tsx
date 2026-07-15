/**
 * The generated branded fallback poster (doc 37, slice 1): composed from
 * title, category, and venue when an event has no photo — nobody gets
 * punished in discovery for not having a photographer. Replaces the C7
 * monogram slab.
 *
 * Not a photo, so the no-text-over-photos rule does not apply: this is a
 * designed card where the words ARE the poster. Every ground comes from
 * the house pin palette with a deterministic ink that stays legible on it
 * (light grounds take the dark ink, everything else takes cream) — no
 * computed colors, no new hexes.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';

const CATEGORY_GROUNDS: Record<string, { bg: string; ink: string }> = {
  music: { bg: Colors.pinMusic, ink: Colors.cream },
  comedy: { bg: Colors.pinComedy, ink: Colors.darkWarm },
  nightlife: { bg: Colors.pinNightlife, ink: Colors.cream },
  'food and drink': { bg: Colors.pinFood, ink: Colors.cream },
  art: { bg: Colors.pinArt, ink: Colors.cream },
  'fitness and outdoors': { bg: Colors.pinFitness, ink: Colors.cream },
  community: { bg: Colors.pinOutdoors, ink: Colors.cream },
  film: { bg: Colors.pinFilm, ink: Colors.cream },
  markets: { bg: Colors.pinBooks, ink: Colors.cream },
};
const DEFAULT_GROUND = { bg: Colors.terracotta, ink: Colors.cream };
const POSTER_PADDING = 18;

interface GeneratedPosterProps {
  title: string;
  category: string | null;
  venue: string | null;
  height: number;
  /** compact = the small square thumb: ground + initial, no words */
  compact?: boolean;
  /** hero usage: extra top padding so the words clear the status bar */
  topPadding?: number;
  /** hero usage: the page shows its own category pill, skip the label */
  hideCategory?: boolean;
}

export function GeneratedPoster({ title, category, venue, height, compact, topPadding = 0, hideCategory }: GeneratedPosterProps) {
  const ground = CATEGORY_GROUNDS[category?.toLowerCase() ?? ''] ?? DEFAULT_GROUND;
  if (compact) {
    return (
      <View style={[styles.compact, { backgroundColor: ground.bg, height, width: height }]}>
        <Text style={[styles.compactLetter, { color: ground.ink }]}>
          {title.slice(0, 1).toLowerCase()}
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.poster, { backgroundColor: ground.bg, height, paddingTop: POSTER_PADDING + topPadding }]}>
      {!!category && !hideCategory && (
        <Text style={[styles.category, { color: ground.ink }]}>{category.toLowerCase()}</Text>
      )}
      <View style={styles.spacer} />
      <Text style={[styles.title, { color: ground.ink }]} numberOfLines={3}>
        {title}
      </Text>
      {!!venue && (
        <Text style={[styles.venue, { color: ground.ink }]} numberOfLines={1}>
          {venue}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  poster: { width: '100%', padding: POSTER_PADDING },
  category: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    letterSpacing: 1.5,
    opacity: 0.85,
  },
  spacer: { flex: 1 },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayMD,
    lineHeight: LineHeights.displayMD,
  },
  venue: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    opacity: 0.85,
    marginTop: 4,
  },
  compact: { alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  compactLetter: { fontFamily: Fonts.display, fontSize: FontSizes.displaySM },
});
