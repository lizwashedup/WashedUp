/**
 * A Scene discovery poster listing (locked decision 12: marquee, not the
 * warm Plans card). Owns the graceful no-image treatment: a dead image URL
 * falls back to the same monogram block a missing one gets, so a poster is
 * never a blank slab (the March pilots' hotlinked images rotted).
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { formatEventDateLA } from '../../lib/laDate';
import type { SceneEvent } from '../../lib/sceneDiscovery';

const POSTER_RATIO = 0.56;

interface EventPosterProps {
  event: SceneEvent;
  width: number;
  onPress: () => void;
}

export function EventPoster({ event: e, width, onPress }: EventPosterProps) {
  const [imageBroken, setImageBroken] = useState(false);
  const posterHeight = (width - 40) * POSTER_RATIO;
  return (
    <TouchableOpacity style={styles.poster} onPress={onPress} activeOpacity={0.85}>
      {e.image_url && !imageBroken ? (
        <Image
          source={{ uri: e.image_url }}
          style={[styles.posterImage, { height: posterHeight }]}
          contentFit="cover"
          onError={() => setImageBroken(true)}
        />
      ) : (
        <View style={[styles.posterImage, styles.posterFallback, { height: posterHeight }]}>
          <Text style={styles.posterFallbackText}>{e.title.slice(0, 1).toLowerCase()}</Text>
        </View>
      )}
      <View style={styles.posterBody}>
        {!!e.category && <Text style={styles.posterCategory}>{e.category.toLowerCase()}</Text>}
        <Text style={styles.posterTitle} numberOfLines={2}>{e.title}</Text>
        <Text style={styles.posterMeta}>
          {[
            e.event_date ? formatEventDateLA(e.event_date) : null,
            e.venue,
          ].filter(Boolean).join('  ')}
        </Text>
        {/* public_name override wins; standalone listings fall back to the
            organizer profile name (proposal 36) */}
        {!!(e.public_name || e.organizer_name) && (
          <Text style={styles.posterBy}>put on by {e.public_name ?? e.organizer_name}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  poster: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    marginBottom: 16,
  },
  posterImage: { width: '100%' },
  posterFallback: { backgroundColor: Colors.accentSubtle, alignItems: 'center', justifyContent: 'center' },
  posterFallbackText: { fontFamily: Fonts.display, fontSize: FontSizes.displayLG, color: Colors.terracotta },
  posterBody: { padding: 14 },
  posterCategory: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  posterTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayMD,
    lineHeight: LineHeights.displayMD,
    color: Colors.darkWarm,
  },
  posterMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 6 },
  posterBy: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary, marginTop: 4 },
});
