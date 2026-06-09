import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../../constants/Typography';
import { KEEP } from '../../../constants/YoursDesign';
import { COPY } from '../state/constants';

/** Small spelled-out counts keep the subline warm rather than numeric. */
const NUM_WORD: Record<number, string> = {
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
  11: 'eleven',
};

function numWord(n: number): string {
  return NUM_WORD[n] ?? String(n);
}

/** Lowercase "month year", matching the page's quiet lowercase voice. */
function fmtSince(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso)
      .toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      .toLowerCase();
  } catch {
    return '';
  }
}

/** "two months in" / "one year in" / null when too new to bother. */
function durationLabel(iso: string | null): string | null {
  if (!iso) return null;
  const since = new Date(iso).getTime();
  if (Number.isNaN(since)) return null;
  const months = Math.floor((Date.now() - since) / (1000 * 60 * 60 * 24 * 30));
  if (months < 1) return null;
  if (months < 12) {
    return `${numWord(months)} month${months === 1 ? '' : 's'}`;
  }
  const years = Math.floor(months / 12);
  return `${numWord(years)} year${years === 1 ? '' : 's'}`;
}

/** One leaning circular face. Photo when present, initial otherwise. */
function Face({
  name,
  photoUrl,
  tilt,
}: {
  name: string | null;
  photoUrl: string | null;
  tilt: number;
}) {
  return (
    <View style={[styles.face, { transform: [{ rotate: `${tilt}deg` }] }]}>
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={styles.facePhoto} contentFit="cover" />
      ) : (
        <View style={[styles.facePhoto, styles.faceBlank]}>
          <Text style={styles.faceInitial}>
            {(name ?? '?').trim().charAt(0).toUpperCase() || '?'}
          </Text>
        </View>
      )}
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function KeepHero({
  myName,
  myPhoto,
  theirName,
  theirPhoto,
  plansCount,
  albumsCount,
  comingUpCount,
  sinceDate,
  hideStats = false,
}: {
  myName: string | null;
  myPhoto: string | null;
  theirName: string | null;
  theirPhoto: string | null;
  plansCount: number;
  albumsCount: number;
  comingUpCount: number;
  sinceDate: string | null;
  /** Suppress the 0/0/0 stat row before there is any shared history. */
  hideStats?: boolean;
}) {
  const name = theirName ?? 'them';
  const since = fmtSince(sinceDate);
  const dur = durationLabel(sinceDate);

  return (
    <View style={styles.wrap}>
      <View style={styles.photos}>
        <Face name={myName} photoUrl={myPhoto} tilt={KEEP.heroLeanDeg} />
        <Text style={styles.ampersand}>&</Text>
        <Face name={theirName} photoUrl={theirPhoto} tilt={-KEEP.heroLeanDeg} />
      </View>

      <Text style={styles.headline}>
        {COPY.keepYouAnd} <Text style={styles.headlineName}>{name}</Text>
      </Text>

      {!!since && (
        <Text style={styles.subline}>
          {COPY.keepSince(since)}
          {dur ? ` · ${COPY.keepDuration(dur)}` : ''}
        </Text>
      )}

      {!hideStats && (
        <View style={styles.stats}>
          <Stat value={plansCount} label={COPY.keepStatPlans} />
          <Stat value={albumsCount} label={COPY.keepStatAlbums} />
          <Stat value={comingUpCount} label={COPY.keepStatComingUp} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: 8 },
  photos: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  face: {
    width: KEEP.heroPhoto,
    height: KEEP.heroPhoto,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: Colors.cream,
    backgroundColor: Colors.cream,
    marginHorizontal: -KEEP.heroOverlap,
    overflow: 'hidden',
  },
  facePhoto: { width: '100%', height: '100%', borderRadius: 999 },
  faceBlank: {
    backgroundColor: Colors.yoursGhostBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceInitial: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayMD,
    color: Colors.secondary,
  },
  ampersand: {
    fontFamily: Fonts.displayItalic,
    fontSize: KEEP.ampersandSize,
    color: Colors.terracotta,
    marginHorizontal: 2,
    zIndex: 2,
  },
  headline: {
    marginTop: KEEP.heroToName,
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayMD,
    lineHeight: LineHeights.displayMD,
    color: Colors.asphalt,
    textAlign: 'center',
  },
  headlineName: { fontFamily: Fonts.displayItalic, color: Colors.terracotta },
  subline: {
    marginTop: 4,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    textAlign: 'center',
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: KEEP.statGap,
    marginTop: 18,
  },
  stat: { alignItems: 'center' },
  statValue: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
  },
  statLabel: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.micro,
    color: Colors.tertiary,
    marginTop: 2,
  },
});
