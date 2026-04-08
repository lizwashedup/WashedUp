import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Share,
  ActionSheetIOS,
  Platform,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Heart } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Colors from '../../constants/Colors';
import { capDisplayCount, MAX_GROUP } from '../../constants/GroupLimits';
import { Fonts, FontSizes } from '../../constants/Typography';

interface PlanCardProps {
  plan: {
    id: string;
    title: string;
    host_message: string | null;
    start_time: string;
    location_text: string | null;
    category: string | null;
    max_invites: number;
    member_count: number;
    is_featured?: boolean;
    creator: {
      first_name_display: string;
      profile_photo_url: string | null;
      member_since?: string;
      plans_posted?: number;
    };
    attendees?: { profile_photo_url: string | null }[];
  };
  isMember?: boolean;
  isWishlisted?: boolean;
  onWishlist?: (planId: string, current: boolean) => void;
  onReport?: (planId: string) => void;
  onBlock?: (planId: string) => void;
  isPast?: boolean;
}

function formatDateTimeForCard(dateString: string): string {
  const d = new Date(dateString);
  const dateStr = d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const timeStr = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${dateStr} · ${timeStr}`;
}

export const PlanCard = React.memo<PlanCardProps>(({ plan, isMember = false, isWishlisted = false, onWishlist, onReport, onBlock, isPast = false }) => {
  const router = useRouter();

  const handleLongPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const creatorName = plan.creator?.first_name_display ?? 'Creator';
    const options = ['Report this plan', `Block ${creatorName}`, 'Cancel'];
    const cancelIndex = 2;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: cancelIndex, destructiveButtonIndex: 1 },
        (idx) => {
          if (idx === 0) onReport?.(plan.id);
          if (idx === 1) onBlock?.(plan.id);
        },
      );
    } else {
      Alert.alert('', '', [
        { text: 'Report this plan', onPress: () => onReport?.(plan.id) },
        { text: `Block ${creatorName}`, style: 'destructive', onPress: () => onBlock?.(plan.id) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [plan.id, plan.creator?.first_name_display, onReport, onBlock]);

  const handleWishlist = useCallback(
    (e: any) => {
      e?.stopPropagation?.();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onWishlist?.(plan.id, isWishlisted);
    },
    [plan.id, isWishlisted, onWishlist],
  );

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (plan.creator?.profile_photo_url) {
      Image.prefetch(plan.creator.profile_photo_url).catch(() => {});
    }
    router.push(`/plan/${plan.id}`);
  }, [plan.id, plan.creator?.profile_photo_url, router]);

  const handleShare = useCallback((e: any) => {
    e.stopPropagation();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Share.share({
      message: `Check out "${plan.title}" on WashedUp!\nhttps://washedup.app/e/${plan.id}`,
      title: 'Share plan',
    }).catch(() => {});
  }, [plan.id, plan.title]);

  // Creator always counts as 1 — member_count should never display as 0
  const isFeatured = plan.is_featured ?? false;
  const going = Math.max(1, capDisplayCount(plan.member_count, isFeatured));
  const totalCapacity = isFeatured
    ? (plan.max_invites ?? 99) + 1
    : Math.min((plan.max_invites ?? 7) + 1, MAX_GROUP);
  const spotsLeft = Math.max(0, totalCapacity - going);
  const isFull = going >= totalCapacity;
  const oneSpotLeft = !isFeatured && spotsLeft === 1;

  const planCount = plan.creator?.plans_posted ?? 0;
  const creatorLine2 = planCount === 1 ? 'First plan' : '';

  const locationDisplay = plan.location_text && !plan.location_text.startsWith('http')
    ? plan.location_text
    : null;
  const creatorLine1 = `Posted by ${plan.creator?.first_name_display ?? 'Creator'}`;

  const creatorNote = plan.host_message
    ? `"${plan.host_message}"`
    : null;

  const countText = isFeatured
    ? `${going} going`
    : isFull
      ? `${going} of ${totalCapacity} · Full`
      : `${going} of ${totalCapacity}`;

  return (
    <TouchableOpacity
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={500}
      activeOpacity={0.92}
      style={[styles.card, isPast && styles.cardPast]}
      accessibilityLabel={`${plan.title} plan`}
      accessibilityRole="button"
    >
      {/* A. Creator Info */}
      <View style={styles.creatorRow}>
        <View style={styles.creatorLeft}>
          {plan.creator?.profile_photo_url ? (
            <Image
              source={{ uri: plan.creator.profile_photo_url }}
              style={styles.creatorAvatar}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={styles.creatorAvatarPlaceholder}>
              <Ionicons name="person-outline" size={24} color={Colors.textLight} />
            </View>
          )}
          <View style={styles.creatorDetails}>
            <Text style={styles.creatorLine1} numberOfLines={1}>
              {creatorLine1}
            </Text>
            {!!creatorLine2 && (
              <Text style={styles.creatorLine2} numberOfLines={1}>
                {creatorLine2}
              </Text>
            )}
          </View>
        </View>
        <View style={styles.badgesRow}>
          {oneSpotLeft && (
            <View style={styles.spotsBadge}>
              <Text style={styles.spotsBadgeText}>1 left</Text>
            </View>
          )}
          {onWishlist && (
            <TouchableOpacity
              onPress={handleWishlist}
              style={styles.heartButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={isWishlisted ? 'Remove from saved' : 'Save plan'}
            >
              <Heart
                size={18}
                color={isWishlisted ? Colors.errorRed : Colors.asphalt}
                fill={isWishlisted ? Colors.errorRed : 'transparent'}
                strokeWidth={2}
              />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={handleShare}
            style={styles.shareButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Share plan"
          >
            <Ionicons name="share-outline" size={18} color={Colors.asphalt} />
          </TouchableOpacity>
        </View>
      </View>

      {/* B. Plan Title */}
      <Text style={styles.title} numberOfLines={2}>
        {plan.title}
      </Text>

      {/* C. Creator's Note */}
      {creatorNote && (
        <Text style={styles.creatorNote} numberOfLines={2}>
          {creatorNote}
        </Text>
      )}

      {/* D. Date/Time & Location */}
      {(plan.start_time || locationDisplay) && (
        <View style={styles.logisticsBlock}>
          {plan.start_time && (
            <View style={styles.logisticsLine}>
              <Ionicons name="calendar-outline" size={14} color={Colors.textLight} />
              <Text style={styles.logisticsLineText}>
                {formatDateTimeForCard(plan.start_time)}
              </Text>
            </View>
          )}
          {locationDisplay && (
            <View style={[styles.logisticsLine, plan.start_time && styles.logisticsLineGap]}>
              <Ionicons name="location-outline" size={14} color={Colors.textLight} />
              <Text style={styles.logisticsLineText} numberOfLines={1}>
                {locationDisplay}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* E. Member count & CTA */}
      <View style={styles.bottomRow}>
        <Text style={styles.spotsText}>{isPast ? `${going} went` : countText}</Text>
        <View style={styles.ctaSpacer} />
        {isPast ? (
          <View style={styles.completedBadge}>
            <Ionicons name="checkmark-circle-outline" size={14} color={Colors.warmGray} />
            <Text style={styles.completedText}>Completed</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.ctaButton, isMember && styles.ctaButtonJoined, isFull && !isMember && styles.ctaButtonWaitlist]}
            onPress={handlePress}
            activeOpacity={0.85}
          >
            <Text style={[styles.ctaButtonText, isFull && !isMember && styles.ctaButtonWaitlistText]}>
              {isMember ? "Going \u2713" : isFull ? "Waitlist \u2192" : "Let's Go \u2192"}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
});

PlanCard.displayName = 'PlanCard';

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
  },
  cardPast: {
    opacity: 0.7,
  },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  creatorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  creatorAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  creatorAvatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorDetails: {
    marginLeft: 12,
    flex: 1,
    minWidth: 0,
  },
  creatorLine1: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    marginBottom: 2,
  },
  creatorLine2: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  spotsBadge: {
    backgroundColor: Colors.goldenAmber,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
  },
  spotsBadgeText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.white,
  },
  heartButton: {
    padding: 4,
  },
  shareButton: {
    padding: 4,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    lineHeight: 28,
    marginBottom: 8,
  },
  creatorNote: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    lineHeight: 20,
    marginBottom: 8,
  },
  logisticsBlock: {
    marginBottom: 12,
  },
  logisticsLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logisticsLineGap: {
    marginTop: 4,
  },
  logisticsLineText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textLight,
    flex: 1,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  spotsText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
  },
  ctaSpacer: {
    flex: 1,
  },
  ctaButton: {
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
  },
  ctaButtonJoined: {
    backgroundColor: Colors.terracotta,
  },
  ctaButtonWaitlist: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
  },
  ctaButtonText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
  ctaButtonWaitlistText: {
    color: Colors.terracotta,
  },
  completedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.inputBg,
    borderRadius: 14,
  },
  completedText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
  },
});
