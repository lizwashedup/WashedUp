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
import { GeneratedPoster } from './GeneratedPoster';
import type { SceneEvent } from '../../lib/sceneDiscovery';

const POSTER_RATIO = 0.56;
const COMPACT_THUMB = 84;

interface EventPosterProps {
  event: SceneEvent;
  width: number;
  onPress: () => void;
  /** slice 1 (doc 37): mixed density — one featured card, then compact */
  variant?: 'featured' | 'compact';
}

export function EventPoster({ event: e, width, onPress, variant = 'featured' }: EventPosterProps) {
  const [imageBroken, setImageBroken] = useState(false);
  const posterHeight = (width - 40) * POSTER_RATIO;
  // one corner slot, one grammar (the people-first pack): a community event
  // wears the leader's FACE, a standalone brand listing wears the organizer
  // LOGO, never both; nothing when neither resolves
  const chipUrl = e.community_id ? e.leader_avatar_url : e.organizer_logo;
  const chipIsFace = !!e.community_id;

  if (variant === 'compact') {
    return (
      <TouchableOpacity style={styles.compactCard} onPress={onPress} activeOpacity={0.85}>
        <View style={styles.compactThumbWrap}>
          {e.image_url && !imageBroken ? (
            <Image
              source={{ uri: e.image_url }}
              style={styles.compactThumb}
              contentFit="cover"
              onError={() => setImageBroken(true)}
            />
          ) : (
            <GeneratedPoster title={e.title} category={e.category} venue={e.venue} height={COMPACT_THUMB} compact />
          )}
          {!!chipUrl && (
            <Image
              source={{ uri: chipUrl }}
              style={[styles.compactChip, chipIsFace ? styles.cornerChipFace : styles.cornerChipLogo]}
              contentFit="cover"
            />
          )}
        </View>
        <View style={styles.compactBody}>
          {!!e.category && <Text style={styles.posterCategory}>{e.category.toLowerCase()}</Text>}
          <Text style={styles.compactTitle} numberOfLines={2}>{e.title}</Text>
          <Text style={styles.posterMetaCompact} numberOfLines={1}>
            {[
              e.event_date ? formatEventDateLA(e.event_date) : null,
              e.venue,
            ].filter(Boolean).join(' · ')}
          </Text>
          {!!(e.public_name || e.organizer_name) && (
            <Text style={styles.posterBy} numberOfLines={1}>
              put on by {e.public_name ?? e.organizer_name}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  }

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
        // the generated branded fallback (doc 37): title, category, and
        // venue compose the poster — never the empty monogram slab
        <GeneratedPoster title={e.title} category={e.category} venue={e.venue} height={posterHeight} />
      )}
      {!!chipUrl && (
        <Image
          source={{ uri: chipUrl }}
          style={[styles.cornerChip, chipIsFace ? styles.cornerChipFace : styles.cornerChipLogo]}
          contentFit="cover"
        />
      )}
      <View style={styles.posterBody}>
        {!!e.category && <Text style={styles.posterCategory}>{e.category.toLowerCase()}</Text>}
        <Text style={styles.posterTitle} numberOfLines={2}>{e.title}</Text>
        <Text style={styles.posterMeta}>
          {[
            e.event_date ? formatEventDateLA(e.event_date) : null,
            e.venue,
          ].filter(Boolean).join(' · ')}
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
  posterBody: { padding: 14 },
  compactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    marginBottom: 12,
  },
  compactThumbWrap: { width: COMPACT_THUMB, height: COMPACT_THUMB },
  compactThumb: { width: COMPACT_THUMB, height: COMPACT_THUMB, borderRadius: 12 },
  compactChip: {
    position: 'absolute',
    right: -5,
    bottom: -5,
    width: 24,
    height: 24,
    borderWidth: 1.5,
    borderColor: Colors.white,
    backgroundColor: Colors.cardBg,
  },
  compactBody: { flex: 1 },
  compactTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displaySM,
    color: Colors.darkWarm,
    marginTop: 2,
  },
  posterMetaCompact: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 3 },
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
  cornerChip: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderWidth: 1.5,
    borderColor: Colors.white,
    backgroundColor: Colors.cardBg,
  },
  cornerChipFace: { borderRadius: 16 },
  cornerChipLogo: { borderRadius: 8 },
});
