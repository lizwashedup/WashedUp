/**
 * FirstJoinPlanCard: one of the three "your first week" cards (spec a2/b3).
 *
 * "let's go" NAVIGATES to the existing plan detail page. It never calls a join
 * mutation; joining happens only through the plan page's own commitment flow.
 * Every fact on the card (going count, spots left, past the minimum) is true
 * at render time; the pills disappear rather than stretch the truth.
 */
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '../../constants/Colors';
import { FirstJoinDesign as D } from '../../constants/FirstJoinDesign';
import { Fonts, FontSizes } from '../../constants/Typography';
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
  /** Slot-1 big-room plan from the ranking service; carries the gold tag. */
  bigRoom: boolean;
  creatorName: string | null;
  creatorPhotoUrl: string | null;
  attendees: { profile_photo_url: string | null }[];
}

interface FirstJoinPlanCardProps {
  plan: FirstJoinCardPlan;
  /** Fires after navigation is triggered; the screen uses it for impression logs. */
  onLetsGo?: (planId: string) => void;
}

// Lowercase-keyed vibe → on-brand line icon for the no-image fallback (spec b1:
// vibe illustration on the warm empty-state ground, never big platform emoji).
const VIBE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  music: 'musical-notes-outline',
  food: 'restaurant-outline',
  art: 'color-palette-outline',
  outdoors: 'leaf-outline',
  comedy: 'happy-outline',
  film: 'film-outline',
  fitness: 'barbell-outline',
  nightlife: 'moon-outline',
  wellness: 'flower-outline',
  books: 'book-outline',
  sports: 'basketball-outline',
  gaming: 'game-controller-outline',
  tech: 'hardware-chip-outline',
  business: 'briefcase-outline',
};
const VIBE_ICON_FALLBACK: keyof typeof Ionicons.glyphMap = 'sparkles-outline';

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

  const vibeIcon = VIBE_ICONS[plan.primary_vibe?.toLowerCase() ?? ''] ?? VIBE_ICON_FALLBACK;
  const attendees = plan.attendees.slice(0, D.proofAvatarMax);
  const creatorName = plan.creatorName?.toLowerCase() ?? null;

  return (
    <View style={styles.card} testID={`first-join-card-${plan.id}`}>
      <View style={styles.topRow}>
        {plan.image_url ? (
          <Image source={{ uri: plan.image_url }} style={styles.planImage} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <View style={styles.vibeFallback}>
            <Ionicons name={vibeIcon} size={D.vibeIconSize} color={Colors.terracotta} />
          </View>
        )}

        <View style={styles.content}>
          {plan.bigRoom && (
            <View style={styles.bigRoomTag}>
              <Text style={styles.bigRoomTagText}>{COPY.bigRoomTag}</Text>
            </View>
          )}
          <Text style={styles.title} numberOfLines={2}>
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
        </View>
      </View>

      <View style={styles.proofRow}>
        {attendees.length > 0 && (
          <View style={styles.avatarCluster}>
            {attendees.map((a, i) =>
              a.profile_photo_url ? (
                <Image
                  key={i}
                  source={{ uri: a.profile_photo_url }}
                  style={[styles.proofAvatar, i > 0 && styles.proofAvatarOverlap, { zIndex: D.proofAvatarMax - i }]}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View
                  key={i}
                  style={[styles.proofAvatar, styles.avatarPlaceholder, i > 0 && styles.proofAvatarOverlap, { zIndex: D.proofAvatarMax - i }]}
                >
                  <Ionicons name="person" size={D.pillIconSize} color={Colors.tertiary} />
                </View>
              ),
            )}
          </View>
        )}
        <Text style={styles.goingText}>{COPY.going(plan.memberCount)}</Text>
      </View>

      {/* Pills always live on their own row below the proof row (review ruling:
          one rule, every card, every width; no conditional wrapping). */}
      {(showSpotsPill || pastMinimum) && (
        <View style={styles.pillRow}>
          {showSpotsPill && spotsLeft !== null && (
            <View style={styles.spotsPill}>
              <Text style={styles.spotsPillText}>{COPY.spotsLeft(spotsLeft)}</Text>
            </View>
          )}
          {pastMinimum && (
            <View style={styles.minimumPill}>
              <Ionicons name="checkmark" size={D.pillIconSize} color={Colors.pastMinimumGreen} />
              <Text style={styles.minimumPillText}>{COPY.pastMinimum}</Text>
            </View>
          )}
        </View>
      )}

      {/* Bare Pressable, fill on the inner View (Pressable pills don't paint reliably). */}
      <Pressable onPress={handleLetsGo} testID={`first-join-lets-go-${plan.id}`}>
        {({ pressed }) => (
          <View style={[styles.letsGoButton, pressed && styles.letsGoButtonPressed]}>
            <Text style={styles.letsGoText}>{COPY.letsGo}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const SPOTS_PILL_MAX = 3; // gold scarcity pill threshold (spec a2)

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.parchment,
    borderRadius: D.cardRadius,
    padding: D.cardPadding,
    gap: D.cardGap,
    shadowColor: Colors.warmShadow,
    shadowOpacity: D.cardShadowOpacity,
    shadowRadius: D.cardShadowRadius,
    shadowOffset: { width: 0, height: D.cardShadowOffsetY },
    elevation: D.cardElevationAndroid,
  },
  topRow: {
    flexDirection: 'row',
    gap: D.cardGap,
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
  content: {
    flex: 1,
    gap: D.contentGap,
  },
  bigRoomTag: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.spotsLeftGoldFill,
    borderRadius: D.tagRadius,
    paddingHorizontal: D.tagPaddingH,
    paddingVertical: D.tagPaddingV,
  },
  bigRoomTagText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.caption,
    color: Colors.brandDeep,
  },
  title: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodyLG,
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
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
  },
  metaText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
  },
  proofRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: D.proofRowGap,
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: D.proofRowGap,
  },
  avatarCluster: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  proofAvatar: {
    width: D.proofAvatarSize,
    height: D.proofAvatarSize,
    borderRadius: D.proofAvatarSize / 2,
    borderWidth: D.avatarRingWidth,
    borderColor: Colors.parchment,
  },
  proofAvatarOverlap: {
    marginLeft: -D.proofAvatarOverlap,
  },
  goingText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
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
    fontSize: FontSizes.caption,
    color: Colors.brandDeep,
  },
  minimumPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: D.pillIconGap,
    backgroundColor: Colors.pastMinimumGreenTint,
    borderRadius: D.pillRadius,
    paddingHorizontal: D.pillPaddingH,
    paddingVertical: D.pillPaddingV,
  },
  minimumPillText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.caption,
    color: Colors.pastMinimumGreen,
  },
  letsGoButton: {
    backgroundColor: Colors.terracotta,
    borderRadius: D.buttonRadius,
    paddingVertical: D.buttonPaddingV,
    alignItems: 'center',
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
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.cream,
  },
});
