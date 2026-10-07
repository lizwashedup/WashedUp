import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, LineHeights, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
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

/** Preserve the legacy lowercase voice; staged copy uses a capitalized month. */
function fmtSince(iso: string | null, capitalized = false): string {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const formatted = date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    return capitalized ? formatted.charAt(0).toLocaleUpperCase() + formatted.slice(1) : formatted.toLowerCase();
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
  appearance,
}: {
  name: string | null;
  photoUrl: string | null;
  tilt: number;
  appearance?: { fonts: AfterglowFontFamilies };
}) {
  const [failed, setFailed] = useState(false);
  const styles = useMemo(() => appearance ? { ...baseStyles, ...heroAppearance(appearance.fonts) } : baseStyles, [appearance?.fonts]);
  return (
    <View style={[styles.face, { transform: [{ rotate: `${tilt}deg` }] }]}>
      {photoUrl && !failed ? (
        <Image source={{ uri: photoUrl }} style={styles.facePhoto} contentFit="cover" cachePolicy="memory-disk" recyclingKey={photoUrl} onError={() => setFailed(true)} accessible={false} />
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

function Stat({ value, label, appearance }: { value: number; label: string; appearance?: { fonts: AfterglowFontFamilies } }) {
  const styles = useMemo(() => appearance ? { ...baseStyles, ...heroAppearance(appearance.fonts) } : baseStyles, [appearance?.fonts]);
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
  appearance,
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
  appearance?: { fonts: AfterglowFontFamilies };
}) {
  const styles = useMemo(() => appearance ? { ...baseStyles, ...heroAppearance(appearance.fonts) } : baseStyles, [appearance?.fonts]);
  const name = theirName?.trim() || 'them';
  const since = fmtSince(sinceDate, !!appearance);
  const dur = durationLabel(sinceDate);

  return (
    <View style={styles.wrap}>
      <View style={styles.photos}>
        <Face key={`me:${myName}:${myPhoto}`} name={myName} photoUrl={myPhoto} tilt={appearance ? 0 : KEEP.heroLeanDeg} appearance={appearance} />
        <Text style={styles.ampersand}>&</Text>
        <Face key={`them:${theirName}:${theirPhoto}`} name={theirName} photoUrl={theirPhoto} tilt={appearance ? 0 : -KEEP.heroLeanDeg} appearance={appearance} />
      </View>

      <Text style={styles.headline} accessibilityRole="header">
        {appearance ? 'You and' : COPY.keepYouAnd} <Text style={styles.headlineName}>{name}</Text>
      </Text>

      {!!since && (
        <Text style={styles.subline}>
          {appearance ? `Shared plans since ${since}` : COPY.keepSince(since)}
          {!appearance && dur ? ` · ${COPY.keepDuration(dur)}` : ''}
        </Text>
      )}

      {/* Anti-zero (per-stat): the whole row hides before there is any history
          (hideStats), and once there is, each individual zero stat is dropped
          rather than rendered as a "0" ("2 plans together · 1 album", never
          "0 coming up"). */}
      {!hideStats && (plansCount > 0 || albumsCount > 0 || comingUpCount > 0) && (
        <View style={styles.stats}>
          {plansCount > 0 && <Stat value={plansCount} label={appearance ? 'shared plans' : COPY.keepStatPlans} appearance={appearance} />}
          {albumsCount > 0 && <Stat value={albumsCount} label={appearance ? 'albums' : COPY.keepStatAlbums} appearance={appearance} />}
          {comingUpCount > 0 && <Stat value={comingUpCount} label={appearance ? 'upcoming plans' : COPY.keepStatComingUp} appearance={appearance} />}
        </View>
      )}
    </View>
  );
}

const baseStyles = StyleSheet.create({
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
    fontFamily: Fonts.display,
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
  headlineName: { fontFamily: Fonts.display, color: Colors.terracotta },
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

function heroAppearance(fonts: AfterglowFontFamilies) {
  return StyleSheet.create({
    wrap: { ...baseStyles.wrap, paddingHorizontal: 20, paddingTop: 12 },
    face: { ...baseStyles.face, width: 72, height: 72, borderRadius: 36, marginHorizontal: 0, borderWidth: 0, borderColor: AfterglowColors.paper, backgroundColor: AfterglowColors.avatar },
    facePhoto: { ...baseStyles.facePhoto, borderRadius: 36, opacity: 1 },
    faceBlank: { ...baseStyles.faceBlank, backgroundColor: AfterglowColors.avatar },
    faceInitial: { ...AfterglowType.identity, fontFamily: fonts.semibold, color: AfterglowColors.muted },
    ampersand: { ...baseStyles.ampersand, ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.clay, marginHorizontal: 12 },
    headline: { ...baseStyles.headline, ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink, marginTop: 16 },
    headlineName: { fontFamily: fonts.display, color: AfterglowColors.ink },
    subline: { ...baseStyles.subline, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 6 },
    stats: { ...baseStyles.stats, gap: 24, marginTop: 18, flexWrap: 'wrap' },
    statValue: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    statLabel: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 2 },
  });
}
