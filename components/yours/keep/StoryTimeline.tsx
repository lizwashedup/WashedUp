import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { KEEP } from '../../../constants/YoursDesign';
import { COPY } from '../state/constants';
import type { ProfileCardAdventure } from '../../../lib/yours/types';

/** Locale month casing in the staged view; legacy retains its lowercase voice. */
function fmtDay(iso: string, staged = false): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return staged ? label : label.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * The "your story so far" vertical timeline. Built from the album-backed
 * shared plans the profile card returns (get_profile_card.adventures); the
 * full shared-plan history would need a backend RPC, tracked as a follow-up.
 * Newest appears first. The optional Afterglow view shows each actual album
 * without calling the oldest returned album the first shared plan. Legacy
 * appearance retains its earlier beginning marker for compatibility.
 */
export default function StoryTimeline({
  adventures,
  theirName,
  appearance,
  onOpenAlbum,
}: {
  adventures: ProfileCardAdventure[];
  theirName: string | null;
  appearance?: { fonts: AfterglowFontFamilies };
  onOpenAlbum?: (eventId: string) => void;
}) {
  const styles = useMemo(() => appearance ? { ...baseStyles, ...timelineAppearance(appearance.fonts) } : baseStyles, [appearance?.fonts]);
  const ordered = useMemo(
    () =>
      [...adventures].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      ),
    [adventures],
  );

  if (ordered.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{appearance ? 'More memories to make.' : COPY.keepStoryEmpty}</Text>
        <Text style={styles.emptySub}>
          {COPY.keepStoryEmptySub(theirName ?? 'them')}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.timeline}>
      {ordered.map((a, i) => {
        const isFirst = i === 0;
        const isLast = i === ordered.length - 1;
        const isBeginning = isLast; // Legacy-only marker: oldest returned album, not necessarily the first plan.
        const day = fmtDay(a.date, !!appearance);

        return (
          <Pressable
            key={a.album_id}
            style={styles.row}
            onPress={() => onOpenAlbum ? onOpenAlbum(a.event_id) : router.push(`/album/${a.event_id}` as never)}
            accessibilityRole="button"
            accessibilityLabel={`${a.title}, open album`}
          >
            <View style={styles.rail}>
              <View
                style={[styles.line, isFirst && styles.lineHidden]}
              />
              <View
                style={[styles.node, isBeginning && !appearance ? styles.nodeGold : styles.nodeRoutine]}
              />
              <View
                style={[styles.line, isLast && styles.lineHidden]}
              />
            </View>

            {appearance && <MemoryThumbnail key={JSON.stringify([a.album_id, a.event_id, a.thumb_url])} uri={a.thumb_url} title={a.title} fonts={appearance.fonts}/>}
            <View style={styles.content}>
              <Text style={styles.title} numberOfLines={appearance ? undefined : 1}>
                {isBeginning && !appearance ? `${COPY.keepFirstPlan} · ${a.title}` : a.title}
              </Text>
              <Text style={styles.meta}>
                {isBeginning && !appearance ? `${day} · ${COPY.keepTheBeginning}` : day}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The supplied album cover is visual context; a failed/missing cover keeps
 * the same footprint and never changes the album's identity or destination. */
function MemoryThumbnail({ uri, title, fonts }: { uri: string | null; title: string; fonts: AfterglowFontFamilies }) {
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return <View style={thumbnailStyles.frame} accessible={false}>
    {uri && !failed ? <Image source={{ uri }} style={thumbnailStyles.photo} contentFit="cover" cachePolicy="memory-disk" recyclingKey={uri}
      accessible={false} onError={() => { if (mounted.current) setFailed(true); }}/> :
      <Text style={[thumbnailStyles.initial, { fontFamily: fonts.semibold }]} accessible={false}>{title.trim().charAt(0).toUpperCase() || 'M'}</Text>}
  </View>;
}
const thumbnailStyles = StyleSheet.create({
  frame: { width: 54, height: 54, borderRadius: 5, overflow: 'hidden', backgroundColor: AfterglowColors.avatar, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginLeft: 12 },
  photo: { width: 54, height: 54, opacity: 1 },
  initial: { ...AfterglowType.contextTitle, color: AfterglowColors.muted },
});

const baseStyles = StyleSheet.create({
  timeline: { paddingHorizontal: 20 },
  row: { flexDirection: 'row', minHeight: KEEP.timelineDot + KEEP.timelineRowGap },
  rail: { width: KEEP.timelineDot, alignItems: 'center' },
  line: {
    width: KEEP.timelineLineWidth,
    flex: 1,
    backgroundColor: Colors.dividerWarm,
  },
  lineHidden: { opacity: 0 },
  node: {
    width: KEEP.timelineDotIcon,
    height: KEEP.timelineDotIcon,
    borderRadius: 999,
  },
  nodeRoutine: { backgroundColor: Colors.ringMid },
  nodeGold: {
    backgroundColor: Colors.goldAccent,
    borderWidth: 3,
    borderColor: Colors.goldenAmberTint15,
  },
  content: { flex: 1, paddingLeft: 14, justifyContent: 'center' },
  title: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
  },
  meta: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.micro,
    color: Colors.secondary,
    marginTop: 2,
  },
  empty: { paddingHorizontal: 20, paddingVertical: 8, alignItems: 'center' },
  emptyTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displaySM,
    color: Colors.asphalt,
    textAlign: 'center',
  },
  emptySub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 4,
    textAlign: 'center',
  },
});

function timelineAppearance(fonts: AfterglowFontFamilies) {
  return StyleSheet.create({
    row: { ...baseStyles.row, minHeight: 82, paddingVertical: 6 },
    content: { ...baseStyles.content, paddingVertical: 12 },
    line: { ...baseStyles.line, backgroundColor: AfterglowColors.subtleLine },
    nodeRoutine: { backgroundColor: AfterglowColors.clay },
    title: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    meta: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 4 },
    empty: { ...baseStyles.empty, alignItems: 'flex-start' },
    emptyTitle: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    emptySub: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 4 },
  });
}
