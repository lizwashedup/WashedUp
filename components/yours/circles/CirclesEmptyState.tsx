/**
 * CirclesEmptyState - warm, never-a-void empty state for Yours > Circles.
 *
 * Two variants, chosen by whether the user has any people yet (spec section 2,
 * "empty states route to the right next action"):
 *   - hasPeople: a warm invitation to make the first circle.
 *   - no people: point at the prerequisite first ("add people, then gather").
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Users, UserPlus } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../../constants/Typography';
import { CIRCLE } from '../../../constants/YoursDesign';
import { COPY } from '../state/constants';
import { hapticSelection } from '../../../lib/haptics';

export default function CirclesEmptyState({
  hasPeople,
  onCreate,
  onAddPeople,
}: {
  hasPeople: boolean;
  onCreate: () => void;
  onAddPeople: () => void;
}) {
  const title = hasPeople ? COPY.circlesEmptyTitle : COPY.circlesNeedPeopleTitle;
  const sub = hasPeople ? COPY.circlesEmptySub : COPY.circlesNeedPeopleSub;
  const ctaLabel = hasPeople ? COPY.circleMakeCta : COPY.circlesNeedPeopleCta;
  const onPress = hasPeople ? onCreate : onAddPeople;

  return (
    <View style={styles.wrap}>
      <View style={styles.iconBubble}>
        {hasPeople ? (
          <Users size={CIRCLE.emptyIcon} color={Colors.terracotta} strokeWidth={1.5} />
        ) : (
          <UserPlus size={CIRCLE.emptyIcon} color={Colors.terracotta} strokeWidth={1.5} />
        )}
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.sub}>{sub}</Text>
      <Pressable
        onPress={() => {
          hapticSelection();
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
      >
        {/* Pill styling lives on an inner View: a Pressable with a
            function-form style collapsed to text size in this centered
            column (no fill), while a View with explicit dimensions paints
            (same as iconBubble). The pressed feedback rides the inner View. */}
        {({ pressed }) => (
          <View style={[styles.cta, pressed && styles.ctaPressed]}>
            <Text style={styles.ctaLabel}>{ctaLabel}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: CIRCLE.emptyPadH,
    paddingBottom: CIRCLE.emptyPadBottom,
  },
  iconBubble: {
    width: CIRCLE.emptyBubble,
    height: CIRCLE.emptyBubble,
    borderRadius: CIRCLE.emptyBubbleRadius,
    backgroundColor: Colors.emptyIconBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: CIRCLE.emptyBubbleGap,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displaySM,
    color: Colors.darkWarm,
    textAlign: 'center',
  },
  sub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  cta: {
    // Explicit width + height (no alignSelf, no padding-sizing). In this
    // centered column, padding/minHeight collapse to text size and the fill
    // never paints; the sibling iconBubble paints only because it has explicit
    // dimensions. Parent `wrap` (alignItems:center) centers this.
    width: CIRCLE.emptyCtaW,
    height: CIRCLE.emptyCtaH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    shadowColor: Colors.terracotta,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4, // Android: shadow* alone is invisible without elevation
  },
  ctaPressed: { opacity: 0.85 },
  ctaLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
});
