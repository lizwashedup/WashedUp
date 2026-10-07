import { EventMediaImage } from '../events/EventMediaImage';
/**
 * A Scene discovery poster listing (locked decision 12: marquee, not the
 * warm Plans card). Owns the graceful no-image treatment: a dead image URL
 * falls back to the same monogram block a missing one gets, so a poster is
 * never a blank slab (the March pilots' hotlinked images rotted).
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Colors, { SceneDetailColors as Scene } from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { formatEventDateLA, formatTimestampLA } from '../../lib/laDate';
import { GeneratedPoster } from './GeneratedPoster';
import { eventKickerLabel, type SceneEvent } from '../../lib/sceneDiscovery';
import { eventPageByline } from '../../lib/eventPageIdentity';

const POSTER_RATIO = 0.56;
const COMPACT_THUMB = 84;

interface EventPosterProps {
  event: SceneEvent;
  width: number;
  onPress: () => void;
  /** slice 1 (doc 37): mixed density — one featured card, then compact */
  variant?: 'featured' | 'compact' | 'grid';
}

export function EventPoster({ event: e, width, onPress, variant = 'featured' }: EventPosterProps) {
  const [brokenReference, setBrokenReference] = useState<string | null>(null);
  const posterHeight = (width - 40) * POSTER_RATIO;
  // one corner slot, one grammar (the people-first pack): a community event
  // wears the leader's FACE, a standalone brand listing wears the organizer
  // LOGO, never both; nothing when neither resolves
  const chipUrl = e.community_id && (e.published_page === undefined || e.published_page?.kind === 'community')
    ? e.leader_avatar_url : e.published_page === undefined ? e.organizer_logo : null;
  const byline = eventPageByline(e);
  // Saved instants use the LA clock on every device; date-only listings stay date-only.
  const when = formatTimestampLA(e.start_time) || formatEventDateLA(e.event_date);
  const chipIsFace = !!e.community_id;

  if (variant === 'grid') {
    return <TouchableOpacity style={[styles.gridCard, { width }]} onPress={onPress} activeOpacity={0.85}
      accessibilityRole="button" accessibilityLabel={[e.title, when, e.venue, byline].filter(Boolean).join(', ')}>
      <View style={{ width: '100%', height: width, backgroundColor: Scene.surface }}>
        {e.image_url && brokenReference !== e.image_url ? <EventMediaImage eventId={e.id} reference={e.image_url}
          style={{ width: '100%', height: width }} contentFit="contain" onError={() => setBrokenReference(e.image_url)} />
          : <GeneratedPoster title={e.title} category={e.category} venue={e.venue} height={width} surface="scene" />}
      </View>
      <View style={styles.gridBody}>
        {!!eventKickerLabel(e) && <Text style={styles.gridKicker}>{eventKickerLabel(e)}</Text>}
        <Text style={styles.gridTitle} numberOfLines={3}>{e.title}</Text>
        {!!when && <Text style={styles.gridMeta}>{when}</Text>}
        {!!e.venue && <Text style={styles.gridMeta} numberOfLines={2}>{e.venue}</Text>}
        {!!byline && <Text style={styles.gridBy} numberOfLines={2}>{byline}</Text>}
      </View>
    </TouchableOpacity>;
  }

  if (variant === 'compact') {
    return (
      <TouchableOpacity style={styles.compactCard} onPress={onPress} activeOpacity={0.85}>
        <View style={styles.compactThumbWrap}>
          {e.image_url && brokenReference !== e.image_url ? (
            <EventMediaImage
              eventId={e.id} reference={e.image_url}
              style={styles.compactThumb}
              contentFit="cover"
              onError={() => setBrokenReference(e.image_url)}
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
          {!!eventKickerLabel(e) && <Text style={styles.posterCategory}>{eventKickerLabel(e)}</Text>}
          <Text style={styles.compactTitle} numberOfLines={2}>{e.title}</Text>
          <Text style={styles.posterMetaCompact} numberOfLines={1}>
            {[
              when,
              e.venue,
            ].filter(Boolean).join(' · ')}
          </Text>
          {!!byline && (
            <Text style={styles.posterBy} numberOfLines={1}>
              put on by {byline}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={styles.poster} onPress={onPress} activeOpacity={0.85}>
      {e.image_url && brokenReference !== e.image_url ? (
        <EventMediaImage
          eventId={e.id} reference={e.image_url}
          style={[styles.posterImage, { height: posterHeight }]}
          contentFit="cover"
          onError={() => setBrokenReference(e.image_url)}
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
        {!!eventKickerLabel(e) && <Text style={styles.posterCategory}>{eventKickerLabel(e)}</Text>}
        <Text style={styles.posterTitle} numberOfLines={2}>{e.title}</Text>
        <Text style={styles.posterMeta}>
          {[
            when,
            e.venue,
          ].filter(Boolean).join(' · ')}
        </Text>
        {/* public_name override wins; standalone listings fall back to the
            organizer profile name (proposal 36) */}
        {!!byline && (
          <Text style={styles.posterBy}>put on by {byline}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  gridCard: { backgroundColor: Scene.surface, borderRadius: 8, overflow: 'hidden' },
  gridBody: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 14 },
  gridTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, lineHeight: LineHeights.bodyMD, color: Scene.text },
  gridKicker: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Scene.supporting, marginBottom: 5 },
  gridMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Scene.supporting, marginTop: 6 },
  gridBy: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Scene.supporting, marginTop: 6 },
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
