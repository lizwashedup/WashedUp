import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { KEEP } from '../../../constants/YoursDesign';
import { COPY } from '../state/constants';
import type { ProfileCardAdventure } from '../../../lib/yours/types';

/** "may 11" lowercase, matching the page voice. */
function fmtDay(iso: string): string {
  try {
    return new Date(iso)
      .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      .toLowerCase();
  } catch {
    return '';
  }
}

/**
 * The "your story so far" vertical timeline. Built from the album-backed
 * shared plans the profile card returns (get_profile_card.adventures); the
 * full shared-plan history would need a backend RPC, tracked as a
 * follow-up. Newest at top, the oldest marked as the beginning in gold
 * (firsts weighted gold per the retention research; gold used decoratively
 * on the node, never as text).
 */
export default function StoryTimeline({
  adventures,
  theirName,
}: {
  adventures: ProfileCardAdventure[];
  theirName: string | null;
}) {
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
        <Text style={styles.emptyTitle}>{COPY.keepStoryEmpty}</Text>
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
        const isBeginning = isLast; // oldest shared plan
        const day = fmtDay(a.date);

        return (
          <Pressable
            key={a.album_id}
            style={styles.row}
            onPress={() => router.push(`/album/${a.event_id}` as never)}
            accessibilityRole="button"
            accessibilityLabel={`${a.title}, open album`}
          >
            <View style={styles.rail}>
              <View
                style={[styles.line, isFirst && styles.lineHidden]}
              />
              <View
                style={[styles.node, isBeginning ? styles.nodeGold : styles.nodeRoutine]}
              />
              <View
                style={[styles.line, isLast && styles.lineHidden]}
              />
            </View>

            <View style={styles.content}>
              <Text style={styles.title} numberOfLines={1}>
                {isBeginning ? `${COPY.keepFirstPlan} · ${a.title}` : a.title}
              </Text>
              <Text style={styles.meta}>
                {isBeginning ? `${day} · ${COPY.keepTheBeginning}` : day}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  timeline: { paddingHorizontal: 20 },
  row: { flexDirection: 'row', minHeight: KEEP.timelineDot + KEEP.timelineRowGap },
  rail: { width: KEEP.timelineDot, alignItems: 'center' },
  line: {
    width: KEEP.timelineLineWidth,
    flex: 1,
    backgroundColor: Colors.dividerWarm,
  },
  lineHidden: { backgroundColor: 'transparent' },
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
