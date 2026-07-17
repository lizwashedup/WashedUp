/**
 * YourFirstWeek: the final onboarding surface (spec a2/b3). Shows exactly
 * three plans from the ranking service; the primary action navigates to the
 * plan detail page (never auto-joins). Skippable via the header back arrow,
 * never blocking.
 *
 * Step 2 scope: the screen itself, mounted behind /dev/first-join only.
 * Onboarding wiring, the wishlist write, and real impression logging are
 * step 2b; the ghost/later handlers arrive as props so this component stays
 * flow-agnostic.
 */
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import Colors from '../../constants/Colors';
import { FirstJoinDesign as D } from '../../constants/FirstJoinDesign';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { FIRST_JOIN_COPY as COPY } from '../../lib/firstJoin/copy';
import { logFirstJoinPrompt } from '../../lib/firstJoin/logImpressions';
import { useFirstJoinCandidates } from '../../hooks/useFirstJoinCandidates';
import ProgressHead from '../onboarding/ProgressHead';
import { FirstJoinPlanCard, FirstJoinCardPlan } from './FirstJoinPlanCard';

// Full W-over-waves mark, pixel-exact from the official branding export
// (provenance: assets/images/brand/README.md).
const BRAND_MARK = require('../../assets/images/brand/washedup-mark.png');

interface YourFirstWeekScreenProps {
  userId: string | null;
  /** Wishlist capture (ghost button + empty-state CTA). Stub until step 2b. */
  onWishlist?: () => void;
  /** Skip link. Stub until step 2b. */
  onLater?: () => void;
  /** Header back arrow; same non-blocking exit as "later". */
  onBack?: () => void;
  /** Dev-harness override: render these plans instead of live data. */
  overridePlans?: FirstJoinCardPlan[];
  /** Dev-harness override: force the empty/fallback state. */
  overrideEmpty?: boolean;
}

export function YourFirstWeekScreen({
  userId,
  onWishlist,
  onLater,
  onBack,
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
    logFirstJoinPrompt({
      userId,
      shownEventIds: plans.map((p) => p.id),
      action: 'shown',
      tier: query.data?.tier,
      scoreBreakdowns: query.data?.scoreSnapshots,
    });
  }, [userId, loading, plans, query.data]);

  const handleCardTap = (planId: string) => {
    if (!userId) return;
    logFirstJoinPrompt({ userId, shownEventIds: plans.map((p) => p.id), action: 'card_tap', eventId: planId });
  };

  const handleWishlist = () => {
    if (userId) logFirstJoinPrompt({ userId, shownEventIds: plans.map((p) => p.id), action: 'wishlist' });
    onWishlist?.();
  };

  // The header back arrow is the skip affordance (founder design pass 7-16
  // dropped the "later" text link); it logs the same 'later' action.
  const handleBack = () => {
    if (userId) logFirstJoinPrompt({ userId, shownEventIds: plans.map((p) => p.id), action: 'later' });
    (onBack ?? onLater)?.();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Final onboarding step: a nearly-done progress bar pulls the last
            action along (goal-gradient); back is the same non-blocking exit. */}
        <ProgressHead step={5} totalSteps={5} onBack={handleBack} />
        <Text style={styles.headline}>{COPY.headline}</Text>
        <Text style={styles.subline}>{COPY.subline}</Text>

        {loading && (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={Colors.terracotta} />
          </View>
        )}

        {!loading && empty && (
          <View style={styles.emptyCenterer} testID="first-join-empty">
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconCircle}>
                <Image source={BRAND_MARK} style={styles.emptyMark} contentFit="contain" />
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
    flexGrow: 1, // lets the empty state center vertically in the viewport
    paddingHorizontal: D.screenPaddingH,
    paddingBottom: D.laterBottomGap,
  },
  headline: {
    fontFamily: Fonts.displayItalic,
    fontSize: D.headlineSize,
    lineHeight: D.headlineLineHeight,
    color: Colors.terracotta,
    marginTop: D.headlineTopGap,
  },
  subline: {
    fontFamily: Fonts.sans,
    fontSize: D.sublineSize,
    lineHeight: D.sublineLineHeight,
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
  emptyCenterer: {
    flex: 1,
    justifyContent: 'center',
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    borderRadius: D.cardRadius,
    padding: D.emptyCardPadding,
    shadowColor: Colors.warmShadow,
    shadowOpacity: D.cardShadowOpacity,
    shadowRadius: D.cardShadowRadius,
    shadowOffset: { width: 0, height: D.cardShadowOffsetY },
    elevation: D.cardElevationAndroid,
  },
  emptyIconCircle: {
    width: D.emptyIconCircle,
    height: D.emptyIconCircle,
    borderRadius: D.emptyIconCircle / 2,
    backgroundColor: Colors.emptyIconBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyMark: {
    height: D.emptyMarkHeight,
    width: D.emptyMarkHeight * D.emptyMarkAspect,
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
    height: D.buttonHeight,
    paddingHorizontal: D.cardPadding,
    alignItems: 'center',
    justifyContent: 'center',
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
    fontFamily: Fonts.sansSemibold,
    fontSize: D.buttonFontSize,
    color: Colors.cream,
  },
  emptyCtaSpacing: {
    marginTop: D.emptyCtaTopGap,
  },
});
