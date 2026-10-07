/**
 * CirclesEmptyState - warm, never-a-void empty state for Yours > Circles.
 *
 * Two variants, chosen by whether the user has any people yet (spec section 2,
 * "empty states route to the right next action"):
 *   - hasPeople: a warm invitation to make the first circle.
 *   - no people: point at the prerequisite first ("add people, then gather").
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Users, UserPlus } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, LineHeights, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { CIRCLE } from '../../../constants/YoursDesign';
import { COPY } from '../state/constants';
import { CreatorActionFill } from '../../creator/CreatorActionFill';
import { hapticSelection } from '../../../lib/haptics';

export default function CirclesEmptyState({
  hasPeople,
  onCreate,
  onAddPeople,
  appearance,
}: {
  hasPeople: boolean;
  onCreate: () => void;
  onAddPeople: () => void;
  appearance?: { fonts: AfterglowFontFamilies };
}) {
  const title = hasPeople ? COPY.circlesEmptyTitle : COPY.circlesNeedPeopleTitle;
  const sub = hasPeople ? COPY.circlesEmptySub : COPY.circlesNeedPeopleSub;
  const ctaLabel = hasPeople ? COPY.circleMakeCta : COPY.circlesNeedPeopleCta;
  const onPress = hasPeople ? onCreate : onAddPeople;

  if (appearance) {
    const styled = afterglow(appearance.fonts);
    const Icon = hasPeople ? Users : UserPlus;
    return <ScrollView contentContainerStyle={styled.wrap}>
      <Icon size={40} color={AfterglowColors.clay} strokeWidth={1.5}/>
      <Text accessibilityRole="header" style={styled.title}>{title}</Text>
      <Text style={styled.body}>{sub}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={ctaLabel} style={styled.buttonHit} onPress={() => { hapticSelection(); onPress(); }}>
        {({ pressed }) => <View style={[styled.button, pressed && { opacity: 0.8 }]}><CreatorActionFill/><Text numberOfLines={1} style={styled.buttonText}>{ctaLabel}</Text></View>}
      </Pressable>
    </ScrollView>;
  }

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
            <Text numberOfLines={1} style={styles.ctaLabel}>{ctaLabel}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

function afterglow(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 32, gap: 14 },
  title: { ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink, textAlign: 'center' },
  body: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, textAlign: 'center', maxWidth: 320 },
  buttonHit: { alignSelf: 'stretch', marginTop: 4 },
  button: { minHeight: 48, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: AfterglowColors.clay, borderRadius: 999, justifyContent: 'center', alignItems: 'center' },
  buttonText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.white, textAlign: 'center' },
}); }

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
