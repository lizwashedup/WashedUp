import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

// Tilt rotation cycles through these values by index so the grid feels analog.
const TILTS = [-2, 1.5, 1, -1.5];

export type PolaroidStatus = 'collecting' | 'developing' | 'ready';

export type PolaroidCardProps = {
  index: number;                  // grid position; drives tilt
  title: string;
  dateText: string;               // "Sat, May 3"
  attendeeSummary?: string;       // "with Haley, Ash +2"
  coverUri?: string | null;       // signed display URL or null
  status: PolaroidStatus;
  readyInLabel?: string;          // "Ready in 6h" — used when developing
  onPress: () => void;
};

function pickTilt(index: number): number {
  return TILTS[index % TILTS.length];
}

export const PolaroidCard = React.memo<PolaroidCardProps>(({
  index, title, dateText, attendeeSummary, coverUri, status, readyInLabel, onPress,
}) => {
  const rotateDeg = useMemo(() => `${pickTilt(index)}deg`, [index]);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.outer,
        { transform: [{ rotate: rotateDeg }] },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.frame}>
        <View style={styles.photo}>
          {coverUri && status === 'ready' ? (
            <Image source={{ uri: coverUri }} style={styles.photoImage} contentFit="cover" />
          ) : (
            <View style={styles.developingOverlay}>
              <Ionicons name="hourglass-outline" size={28} color={Colors.terracotta} />
              {readyInLabel ? (
                <Text style={styles.readyLabel}>{readyInLabel}</Text>
              ) : (
                <Text style={styles.readyLabel}>Collecting photos</Text>
              )}
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
  );
});

PolaroidCard.displayName = 'PolaroidCard';

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    margin: 8,
  },
  pressed: {
    opacity: 0.9,
  },
  frame: {
    backgroundColor: Colors.white,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 12,
    shadowColor: Colors.shadowBlack,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  photo: {
    aspectRatio: 1,
    backgroundColor: Colors.inputBg,
    borderRadius: 4,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  developingOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  readyLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
    textAlign: 'center',
  },
  caption: {
    paddingTop: 8,
    paddingHorizontal: 4,
    gap: 2,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  meta: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.warmGray,
  },
});
