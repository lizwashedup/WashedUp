import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { ALBUM } from '../../constants/YoursDesign';
import { COPY } from '../yours/state/constants';

// Tilt rotation cycles through these values by index so the grid reads like
// real polaroids casually placed down. Slight and alternating (cute, not loud).
const TILTS = [-2.5, 2, -2, 2.5];

// Album status still exists in the DB (collecting until the first upload, then
// ready). The card itself no longer branches on it: a cover means there are
// uploads, no cover means we are still collecting.
export type PolaroidStatus = 'collecting' | 'ready';

export type PolaroidCardProps = {
  index: number;                  // grid position; drives tilt
  cardWidth: number;              // fixed card width so a lone card isn't stretched
  title: string;
  dateText: string;               // "Sat, May 3"
  attendeeSummary?: string;       // "with Haley, Ash +2"
  coverUri?: string | null;       // signed display URL, or null when the album has no uploads yet
  onPress: () => void;
  onLongPress?: () => void;       // e.g. archive an empty album
};

function pickTilt(index: number): number {
  return TILTS[index % TILTS.length];
}

export const PolaroidCard = React.memo<PolaroidCardProps>(({
  index, cardWidth, title, dateText, attendeeSummary, coverUri, onPress, onLongPress,
}) => {
  const rotateDeg = useMemo(() => `${pickTilt(index)}deg`, [index]);

  return (
    <View style={[styles.cell, { width: cardWidth }]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={300}
        style={({ pressed }) => [
          styles.outer,
          { transform: [{ rotate: rotateDeg }] },
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.frame}>
          <View style={styles.photo}>
            {coverUri ? (
              <Image source={{ uri: coverUri }} style={styles.photoImage} contentFit="cover" />
            ) : (
              <View style={styles.placeholderOverlay}>
                <Ionicons name="images-outline" size={ALBUM.placeholderIconSize} color={Colors.terracotta} />
                <Text style={styles.placeholderLabel}>{COPY.albumCollecting}</Text>
              </View>
            )}
          </View>
          <View style={styles.caption}>
            <Text numberOfLines={1} style={styles.title}>{title}</Text>
            <Text numberOfLines={1} style={styles.meta}>
              {dateText}{attendeeSummary ? ` · ${attendeeSummary}` : ''}
            </Text>
          </View>
        </View>
      </Pressable>
    </View>
  );
});

PolaroidCard.displayName = 'PolaroidCard';

const styles = StyleSheet.create({
  cell: {
    // The width sits on a plain View wrapper, not on the Pressable. With
    // width on the Pressable, Yoga was shrinking each card to the intrinsic
    // width of its caption text (so cards with longer titles came out wider).
    // A plain View's width is honored reliably in FlatList rows.
    marginBottom: 16,
  },
  outer: {
    width: '100%',
  },
  pressed: {
    opacity: 0.9,
  },
  frame: {
    backgroundColor: Colors.white,
    borderRadius: 3,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 26,
    shadowColor: Colors.shadowBlack,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 5,
  },
  photo: {
    aspectRatio: ALBUM.photoAspectRatio,
    backgroundColor: Colors.inputBg,
    borderRadius: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoImage: {
    // Absolute-fill (not width/height:100%) so the image's intrinsic size
    // can't drive the parent box: the photo's aspectRatio:1 fully governs
    // the square, and the cover is clipped by the parent's overflow:hidden.
    ...StyleSheet.absoluteFillObject,
  },
  placeholderOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  placeholderLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
    textAlign: 'center',
  },
  caption: {
    paddingTop: 12,
    paddingHorizontal: 4,
    gap: 2,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  meta: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.warmGray,
  },
});
