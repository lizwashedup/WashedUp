/**
 * CirclesEmptyState — warm, never-a-void empty state for Yours > Circles.
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
        style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
      >
        <Text style={styles.ctaLabel}>{ctaLabel}</Text>
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
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 28,
    paddingVertical: 13,
    shadowColor: Colors.terracotta,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  ctaPressed: { opacity: 0.85 },
  ctaLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
});
