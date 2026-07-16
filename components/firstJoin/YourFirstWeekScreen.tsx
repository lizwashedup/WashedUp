/**
 * YourFirstWeek: the final onboarding surface (spec a2/b3). Shows exactly
 * three plans from the ranking service; the primary action navigates to the
 * plan detail page (never auto-joins). Skippable via "later", never blocking.
 *
 * Step 2 scope: the screen itself, mounted behind /dev/first-join only.
 * Onboarding wiring, the wishlist write, and real impression logging are
 * step 2b; the ghost/later handlers arrive as props so this component stays
 * flow-agnostic.
 */
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../../constants/Colors';
import { FirstJoinDesign as D } from '../../constants/FirstJoinDesign';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { FIRST_JOIN_COPY as COPY } from '../../lib/firstJoin/copy';
import { logFirstJoinPrompt } from '../../lib/firstJoin/logImpressions';
import { useFirstJoinCandidates } from '../../hooks/useFirstJoinCandidates';
import { FirstJoinPlanCard, FirstJoinCardPlan } from './FirstJoinPlanCard';

interface YourFirstWeekScreenProps {
  userId: string | null;
  /** Wishlist capture (ghost button + empty-state CTA). Stub until step 2b. */
  onWishlist?: () => void;
  /** Skip link. Stub until step 2b. */
  onLater?: () => void;
  /** Dev-harness override: render these plans instead of live data. */
  overridePlans?: FirstJoinCardPlan[];
  /** Dev-harness override: force the empty/fallback state. */
  overrideEmpty?: boolean;
}

export function YourFirstWeekScreen({
  userId,
  onWishlist,
  onLater,
  overridePlans,
  overrideEmpty,
}: YourFirstWeekScreenProps) {
  const query = useFirstJoinCandidates(overridePlans || overrideEmpty ? null : userId);

  const plans = overrideEmpty ? [] : (overridePlans ?? query.data?.plans ?? []);
  const loading = !overridePlans && !overrideEmpty && (query.isLoading || query.isFetching) && !query.data;
  const empty = !loading && plans.length === 0;

  // One "shown" impression per rendered card set (spec a2; stub until the table ships).
  const loggedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || loading || plans.length === 0) return;
    const key = plans.map((p) => p.id).join(',');
    if (loggedKeyRef.current === key) return;
    loggedKeyRef.current = key;
    logFirstJoinPrompt({ userId, shownEventIds: plans.map((p) => p.id), action: 'shown' });
  }, [userId, loading, plans]);

  const handleCardTap = (planId: string) => {
    if (!userId) return;
    logFirstJoinPrompt({ userId, shownEventIds: plans.map((p) => p.id), action: 'card_tap', eventId: planId });
  };

  const handleWishlist = () => {
    if (userId) logFirstJoinPrompt({ userId, shownEventIds: plans.map((p) => p.id), action: 'wishlist' });
    onWishlist?.();
  };

  const handleLater = () => {
    if (userId) logFirstJoinPrompt({ userId, shownEventIds: plans.map((p) => p.id), action: 'later' });
    onLater?.();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.headline}>{COPY.headline}</Text>
        <Text style={styles.subline}>{COPY.subline}</Text>

        {loading && (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={Colors.terracotta} />
          </View>
        )}

        {!loading && empty && (
          <View style={styles.emptyWrap} testID="first-join-empty">
            <View style={styles.emptyIconCircle}>
              <Ionicons name="notifications-outline" size={D.emptyIconSize} color={Colors.terracotta} />
            </View>
            <Text style={styles.emptyBody}>{COPY.emptyBody}</Text>
            <Pressable onPress={handleWishlist} testID="first-join-empty-cta">
              {({ pressed }) => (
                <View style={[styles.primaryButton, styles.emptyCtaSpacing, pressed && styles.primaryButtonPressed]}>
                  <Text style={styles.primaryButtonText}>{COPY.emptyCta}</Text>
                </View>
              )}
            </Pressable>
          </View>
        )}

        {!loading && !empty && (
          <>
            <View style={styles.cards}>
              {plans.map((plan) => (
                <FirstJoinPlanCard key={plan.id} plan={plan} onLetsGo={handleCardTap} />
              ))}
            </View>
            <Text style={styles.psCaption}>{COPY.psCaption}</Text>
            <Pressable onPress={handleWishlist} testID="first-join-wishlist-ghost">
              {({ pressed }) => (
                <Text style={[styles.ghostButtonText, pressed && styles.ghostButtonPressed]}>
                  {COPY.wishlistPrompt}
                </Text>
              )}
            </Pressable>
          </>
        )}

        {!loading && (
          <Pressable onPress={handleLater} testID="first-join-later">
            <Text style={styles.laterText}>{COPY.later}</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.cream,
  },
  scroll: {
    paddingHorizontal: D.screenPaddingH,
    paddingBottom: D.laterBottomGap,
  },
  headline: {
    fontFamily: Fonts.displayItalic,
    fontSize: D.headlineSize,
    lineHeight: D.headlineLineHeight,
    color: Colors.terracotta,
    marginTop: D.sectionTopGap,
  },
  subline: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.secondary,
    marginTop: D.sublineTopGap,
  },
  loadingWrap: {
    marginTop: D.emptyTopGap,
    alignItems: 'center',
  },
  cards: {
    marginTop: D.sectionTopGap,
    gap: D.screenGap,
  },
  psCaption: {
    fontFamily: Fonts.sans,
    fontSize: D.psCaptionSize,
    color: Colors.secondary,
    textAlign: 'center',
    marginTop: D.captionTopGap,
  },
  ghostButtonText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
    textAlign: 'center',
    marginTop: D.ghostTopGap,
    paddingVertical: D.sublineTopGap,
  },
  ghostButtonPressed: {
    color: Colors.brandPressed,
  },
  laterText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.warmGray,
    textAlign: 'center',
    marginTop: D.laterTopGap,
    paddingVertical: D.sublineTopGap,
  },
  emptyWrap: {
    alignItems: 'center',
    marginTop: D.emptyTopGap,
  },
  emptyIconCircle: {
    width: D.emptyIconCircle,
    height: D.emptyIconCircle,
    borderRadius: D.emptyIconCircle / 2,
    backgroundColor: Colors.emptyIconBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBody: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
    maxWidth: D.emptyBodyMaxWidth,
    marginTop: D.emptyBodyTopGap,
  },
  primaryButton: {
    backgroundColor: Colors.terracotta,
    borderRadius: D.buttonRadius,
    paddingVertical: D.buttonPaddingV,
    paddingHorizontal: D.cardPadding,
    alignItems: 'center',
    shadowColor: Colors.terracotta,
    shadowOpacity: D.ctaShadowOpacity,
    shadowRadius: D.ctaShadowRadius,
    shadowOffset: { width: 0, height: D.ctaShadowOffsetY },
    elevation: D.cardElevationAndroid,
  },
  primaryButtonPressed: {
    backgroundColor: Colors.brandPressed,
  },
  primaryButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.cream,
  },
  emptyCtaSpacing: {
    marginTop: D.emptyCtaTopGap,
  },
});
