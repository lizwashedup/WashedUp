/**
 * FirstJoinPlanCard: one of the three "your first week" cards (spec a2/b3,
 * founder design pass 2026-07-16). Reads in two seconds: photo, title, who,
 * when and where, n going, button.
 *
 * The whole card is tappable (Fitts's law: the target is the card, not just
 * the button) and both paths NAVIGATE to the plan detail page. Nothing here
 * joins; joining happens only through the plan page's own commitment flow.
 * Facts shown (going count, spots left) are true at render time; the
 * scarcity pill disappears rather than stretch the truth.
 */
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '../../constants/Colors';
import { FirstJoinDesign as D } from '../../constants/FirstJoinDesign';
import { Fonts } from '../../constants/Typography';
import { FIRST_JOIN_COPY as COPY } from '../../lib/firstJoin/copy';
import { formatFirstJoinMeta } from '../../lib/firstJoin/format';
import { hapticLight } from '../../lib/haptics';

export interface FirstJoinCardPlan {
  id: string;
  title: string;
  start_time: string;
  neighborhood: string | null;
  image_url: string | null;
  primary_vibe: string | null;
  /** Real joined count (already floored at 1 by the ranking service). */
  memberCount: number;
  max_invites: number | null;
  min_invites: number | null;
  creatorName: string | null;
  creatorPhotoUrl: string | null;
}

interface FirstJoinPlanCardProps {
  plan: FirstJoinCardPlan;
  /** Fires after navigation is triggered; the screen uses it for impression logs. */
  onLetsGo?: (planId: string) => void;
}

// Imageless plans show the brand's three-wave element (no per-vibe icon art).
// Pixel-exact crop from the official branding export; provenance in
// assets/images/brand/README.md.
const BRAND_WAVES = require('../../assets/images/brand/washedup-waves.png');

export function FirstJoinPlanCard({ plan, onLetsGo }: FirstJoinPlanCardProps) {
  const router = useRouter();

  const handleLetsGo = useCallback(() => {
    hapticLight(); // open detail; the join ritual lives on the plan page
    router.push(`/plan/${plan.id}`);
    onLetsGo?.(plan.id);
  }, [plan.id, router, onLetsGo]);

  const pastMinimum = plan.min_invites !== null && plan.memberCount >= plan.min_invites;
  const spotsLeft = plan.max_invites !== null ? plan.max_invites - plan.memberCount : null;
  // Honest scarcity only: nearly full AND already past its bar (spec a3/b2).
  const showSpotsPill = spotsLeft !== null && spotsLeft > 0 && spotsLeft <= SPOTS_PILL_MAX && pastMinimum;

  const creatorName = plan.creatorName?.toLowerCase() ?? null;

  return (
    // The whole card navigates; the button inside is the explicit affordance.
    <Pressable onPress={handleLetsGo} testID={`first-join-card-${plan.id}`}>
      {({ pressed: cardPressed }) => (
        <View style={[styles.card, cardPressed && styles.cardPressed]}>
          {/* Image left, text right; text never wraps around the image. */}
          <View style={styles.topRow}>
            {plan.image_url ? (
              <Image source={{ uri: plan.image_url }} style={styles.planImage} contentFit="cover" cachePolicy="memory-disk" />
            ) : (
              <View style={styles.vibeFallback}>
                <Image source={BRAND_WAVES} style={styles.brandWaves} contentFit="contain" />
              </View>
            )}

            <View style={styles.content}>
              <Text style={styles.title} numberOfLines={1}>
                {plan.title}
              </Text>
              {creatorName && (
                <View style={styles.creatorRow}>
                  {plan.creatorPhotoUrl ? (
                    <Image source={{ uri: plan.creatorPhotoUrl }} style={styles.creatorAvatar} contentFit="cover" cachePolicy="memory-disk" />
                  ) : (
                    <View style={[styles.creatorAvatar, styles.avatarPlaceholder]}>
                      <Ionicons name="person" size={D.pillIconSize} color={Colors.tertiary} />
                    </View>
                  )}
                  <Text style={styles.creatorText} numberOfLines={1}>
                    {COPY.creatorPlan(creatorName)}
                  </Text>
                </View>
              )}
              <Text style={styles.metaText} numberOfLines={1}>
                {formatFirstJoinMeta(plan.start_time, plan.neighborhood)}
              </Text>
              <View style={styles.factsRow}>
                <Text style={styles.goingText}>{COPY.going(plan.memberCount)}</Text>
                {showSpotsPill && spotsLeft !== null && (
                  <View style={styles.spotsPill}>
                    <Text style={styles.spotsPillText}>{COPY.spotsLeft(spotsLeft)}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Bare Pressable, fill on the inner View (Pressable pills don't paint reliably). */}
          <Pressable onPress={handleLetsGo} testID={`first-join-lets-go-${plan.id}`}>
            {({ pressed }) => (
              <View style={[styles.letsGoButton, pressed && styles.letsGoButtonPressed]}>
                <Text style={styles.letsGoText}>{COPY.letsGo}</Text>
              </View>
            )}
          </Pressable>
        </View>
      )}
    </Pressable>
  );
}

const SPOTS_PILL_MAX = 3; // gold scarcity pill threshold (spec a2)
const CARD_PRESSED_OPACITY = 0.96; // whole-card press feedback, subtle

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: D.cardRadius,
    padding: D.cardPadding,
    shadowColor: Colors.warmShadow,
    shadowOpacity: D.cardShadowOpacity,
    shadowRadius: D.cardShadowRadius,
    shadowOffset: { width: 0, height: D.cardShadowOffsetY },
    elevation: D.cardElevationAndroid,
  },
  cardPressed: {
    opacity: CARD_PRESSED_OPACITY,
  },
  topRow: {
    flexDirection: 'row',
    gap: D.imageTextGap,
  },
  planImage: {
    width: D.imageSize,
    height: D.imageSize,
    borderRadius: D.imageRadius,
  },
  vibeFallback: {
    width: D.imageSize,
    height: D.imageSize,
    borderRadius: D.imageRadius,
    backgroundColor: Colors.emptyIconBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandWaves: {
    width: D.imageSize * D.brandWavesWidthRatio,
    height: (D.imageSize * D.brandWavesWidthRatio) / D.brandWavesAspect,
  },
  content: {
    flex: 1,
    gap: D.contentRowGap,
  },
  title: {
    fontFamily: Fonts.sansSemibold,
    fontSize: D.titleSize,
    lineHeight: D.titleLineHeight,
    color: Colors.text1,
  },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: D.creatorRowGap,
  },
  creatorAvatar: {
    width: D.creatorAvatarSize,
    height: D.creatorAvatarSize,
    borderRadius: D.creatorAvatarSize / 2,
  },
  avatarPlaceholder: {
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorText: {
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: D.creatorTextSize,
    lineHeight: D.creatorTextLineHeight,
    color: Colors.secondary,
  },
  metaText: {
    fontFamily: Fonts.sans,
    fontSize: D.metaTextSize,
    lineHeight: D.metaTextLineHeight,
    color: Colors.secondary,
  },
  factsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: D.proofRowGap,
  },
  goingText: {
    fontFamily: Fonts.sansMedium,
    fontSize: D.factsTextSize,
    lineHeight: D.factsTextLineHeight,
    color: Colors.text1,
  },
  spotsPill: {
    backgroundColor: Colors.spotsLeftGoldFill,
    borderRadius: D.pillRadius,
    paddingHorizontal: D.pillPaddingH,
    paddingVertical: D.pillPaddingV,
  },
  spotsPillText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: D.metaTextSize,
    color: Colors.brandDeep,
  },
  letsGoButton: {
    backgroundColor: Colors.terracotta,
    borderRadius: D.buttonRadius,
    height: D.buttonHeight,
    marginTop: D.buttonTopGap,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.terracotta,
    shadowOpacity: D.ctaShadowOpacity,
    shadowRadius: D.ctaShadowRadius,
    shadowOffset: { width: 0, height: D.ctaShadowOffsetY },
    elevation: D.cardElevationAndroid,
  },
  letsGoButtonPressed: {
    backgroundColor: Colors.brandPressed,
  },
  letsGoText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: D.buttonFontSize,
    color: Colors.cream,
  },
});
