import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import ShimmerGrid from '../primitives/ShimmerGrid';
import { COPY } from '../state/constants';

/**
 * Existing-user post-update state. Shimmer ghost grid behind a parchment
 * 85% overlay with the welcome copy + two action cards. Not a modal.
 */
export default function FreshStartView({
  backlogCount,
  onOpenBacklog,
  onInvite,
}: {
  backlogCount: number;
  onOpenBacklog: () => void;
  onInvite: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.shimmer}>
        <ShimmerGrid />
      </View>
      <View style={styles.overlay}>
        <Text style={styles.title}>{COPY.freshTitle}</Text>
        <Text style={styles.title}>{COPY.freshTitle2}</Text>
        <Text style={styles.sub}>{COPY.freshSub}</Text>

        <Pressable
          style={[styles.card, styles.cardPrimary]}
          onPress={onOpenBacklog}
        >
          <Text style={styles.count}>{backlogCount}</Text>
          <Text style={styles.cardLabel}>{COPY.freshCardPlansLabel}</Text>
        </Pressable>

        <Pressable style={styles.card} onPress={onInvite}>
          <Text style={styles.cardTitle}>{COPY.freshCardInviteTitle}</Text>
          <Text style={styles.cardSub}>{COPY.freshCardInviteSub}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  shimmer: { position: 'absolute', top: 24, left: 0, right: 0 },
  overlay: {
    backgroundColor: Colors.yoursOverlay85,
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 24,
    gap: 6,
  },
  title: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
  },
  sub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.secondary,
    marginTop: 8,
    marginBottom: 16,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
  },
  cardPrimary: { paddingVertical: 22 },
  count: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displayLG,
    color: Colors.terracotta,
  },
  cardLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
    marginTop: 2,
  },
  cardTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  cardSub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 2,
  },
});
