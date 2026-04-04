import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ActionSheetIOS,
  Platform,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { hapticLight, hapticMedium } from '../../lib/haptics';
import Animated, {
  FadeInUp,
  Easing,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { capDisplayCount, MAX_GROUP } from '../../constants/GroupLimits';

// ─── Design tokens ───────────────────────────────────────────────────────────
const C = {
  terracotta: '#B5522E',
  dark: '#2C1810',
  warmGray: '#78695C',
  lightGray: '#A09385',
  iconMuted: '#C5C0B8',
  cream: '#FAF5EC',
  surface: '#FFFFFF',
  accentSubtle: '#F5E8E2',
  goldLight: '#D4BF82',
  quoteText: '#6B5D50',
  divider: '#F5EDE0',
};

interface PlanCardProps {
  plan: {
    id: string;
    title: string;
    host_message: string | null;
    start_time: string;
    location_text: string | null;
    neighborhood?: string | null;
    category: string | null;
    max_invites: number;
    member_count: number;
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

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const PlanCard = React.memo<PlanCardProps>(({ plan, isMember = false, isWishlisted = false, onWishlist, onReport, onBlock, isPast = false }) => {
  const router = useRouter();

  // ── Bookmark scale animation (declared early so handleWishlist can reference it) ──
  const bookmarkScale = useSharedValue(1);
  const bookmarkAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: bookmarkScale.value }],
  }));

  const handleLongPress = useCallback(() => {
    hapticMedium();
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
      hapticLight();
      bookmarkScale.value = withSpring(1.3, {}, () => {
        bookmarkScale.value = withSpring(1);
      });
      onWishlist?.(plan.id, isWishlisted);
    },
    [plan.id, isWishlisted, onWishlist],
  );

  const handlePress = useCallback(() => {
    hapticLight();
    if (plan.creator?.profile_photo_url) {
      Image.prefetch(plan.creator.profile_photo_url).catch(() => {});
    }
    router.push(`/plan/${plan.id}`);
  }, [plan.id, plan.creator?.profile_photo_url, router]);

  // Creator always counts as 1 — member_count should never display as 0
  const going = Math.max(1, capDisplayCount(plan.member_count));
  const totalCapacity = Math.min((plan.max_invites ?? 7) + 1, MAX_GROUP);
  const spotsLeft = Math.max(0, totalCapacity - going);
  const isFull = going >= totalCapacity;
  const showSpotsLeftBadge = spotsLeft >= 1 && spotsLeft <= 2 && !isFull;

  // ── Spots-left pulse animation ──
  const pulseScale = useSharedValue(1);
  useEffect(() => {
    if (showSpotsLeftBadge) {
      pulseScale.value = withRepeat(
        withTiming(1.06, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else {
      pulseScale.value = 1;
    }
  }, [showSpotsLeftBadge]);
  const pulseAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  // ── Button press feedback ──
  const buttonScale = useSharedValue(1);
  const buttonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));
  const handleButtonPressIn = useCallback(() => {
    buttonScale.value = withTiming(0.96, { duration: 100 });
  }, []);
  const handleButtonPressOut = useCallback(() => {
    buttonScale.value = withTiming(1.0, { duration: 100 });
  }, []);

  const locationRaw = plan.location_text && !plan.location_text.startsWith('http')
    ? plan.location_text
    : null;
  const locationDisplay = locationRaw
    ? (plan.neighborhood ? `${locationRaw} · ${plan.neighborhood}` : locationRaw)
    : null;

  const creatorNote = plan.host_message
    ? `"${plan.host_message}"`
    : null;

  const spotsText = isFull
    ? `${going} of ${totalCapacity} spots`
    : `${going} of ${totalCapacity} spots`;

  return (
    <Animated.View entering={FadeInUp.duration(300).easing(Easing.out(Easing.ease))}>
    <TouchableOpacity
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={500}
      activeOpacity={0.92}
      style={[styles.card, isPast && styles.cardPast]}
      accessibilityLabel={`${plan.title} plan`}
      accessibilityRole="button"
    >
      {/* A. Creator row */}
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
              <Ionicons name="person-outline" size={18} color={C.lightGray} />
            </View>
          )}
          <View style={styles.creatorDetails}>
            <Text style={styles.creatorName} numberOfLines={1}>
              {plan.creator?.first_name_display ?? 'Creator'}
            </Text>
            <Text style={styles.creatorSubtext}>posted</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          {showSpotsLeftBadge && (
            <Animated.View style={pulseAnimatedStyle}>
              <View style={styles.spotsLeftBadge}>
                <Text style={styles.spotsLeftBadgeText}>{spotsLeft} left</Text>
              </View>
            </Animated.View>
          )}
          {onWishlist && (
            <TouchableOpacity
              onPress={handleWishlist}
              style={styles.iconBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={isWishlisted ? 'Remove from saved' : 'Save plan'}
            >
              <Animated.View style={bookmarkAnimatedStyle}>
                <Ionicons
                  name={isWishlisted ? 'bookmark' : 'bookmark-outline'}
                  size={18}
                  color={isWishlisted ? '#B5522E' : '#78695C'}
                />
              </Animated.View>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* B. Plan Title */}
      <Text style={styles.title} numberOfLines={2}>
        {plan.title}
      </Text>

      {/* B2. Category pill */}
      {plan.category && (
        <View style={styles.categoryRow}>
          <View style={styles.categoryPill}>
            <Text style={styles.categoryPillText}>{plan.category}</Text>
          </View>
        </View>
      )}

      {/* C. Creator's Note */}
      {creatorNote && (
        <View style={styles.quoteBlock}>
          <Text style={styles.quoteText} numberOfLines={2}>
            {creatorNote}
          </Text>
        </View>
      )}

      {/* D. Date/Time & Location */}
      {(plan.start_time || locationDisplay) && (
        <View style={styles.logisticsBlock}>
          {plan.start_time && (
            <View style={styles.logisticsLine}>
              <Ionicons name="calendar-outline" size={13} color={C.terracotta} />
              <Text style={styles.logisticsText}>
                {formatDateTimeForCard(plan.start_time)}
              </Text>
            </View>
          )}
          {locationDisplay && (
            <View style={[styles.logisticsLine, plan.start_time && { marginTop: 4 }]}>
              <Ionicons name="location-outline" size={13} color={C.terracotta} />
              <Text style={styles.logisticsText} numberOfLines={1}>
                {locationDisplay}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* E. Footer — spots + CTA */}
      <View style={styles.footer}>
        <Text style={styles.spotsLabel}>
          <Text style={styles.spotsNumber}>{going}</Text>
          {` of ${totalCapacity} spots`}
        </Text>
        <View style={styles.ctaSpacer} />
        {isPast ? (
          <View style={styles.completedBadge}>
            <Ionicons name="checkmark-circle-outline" size={14} color={C.warmGray} />
            <Text style={styles.completedText}>Completed</Text>
          </View>
        ) : (
          <AnimatedPressable
            style={[styles.ctaButton, buttonAnimatedStyle]}
            onPress={() => {
              hapticLight();
              handlePress();
            }}
            onPressIn={handleButtonPressIn}
            onPressOut={handleButtonPressOut}
          >
            <Text style={styles.ctaButtonText}>
              {"Let's Go \u2192"}
            </Text>
          </AnimatedPressable>
        )}
      </View>
    </TouchableOpacity>
    </Animated.View>
  );
});

PlanCard.displayName = 'PlanCard';

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: 'rgba(181, 82, 46, 0.08)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 3,
  },
  cardPast: {
    opacity: 0.7,
  },

  // ── Creator row ──
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  creatorAvatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorDetails: {
    marginLeft: 10,
    flex: 1,
    minWidth: 0,
  },
  creatorName: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 14,
    color: C.dark,
    lineHeight: 18,
  },
  creatorSubtext: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: C.lightGray,
    lineHeight: 16,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  spotsLeftBadge: {
    backgroundColor: C.terracotta,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  spotsLeftBadgeText: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 10,
    color: '#FFFFFF',
    lineHeight: 14,
  },
  iconBtn: {
    padding: 4,
  },

  // ── Body ──
  title: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 18,
    color: C.dark,
    lineHeight: 24,
    marginBottom: 6,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  categoryPill: {
    backgroundColor: C.accentSubtle,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  categoryPillText: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 10,
    color: C.terracotta,
    textTransform: 'capitalize',
    letterSpacing: 0.2,
  },
  quoteBlock: {
    borderLeftWidth: 2,
    borderLeftColor: C.goldLight,
    paddingLeft: 10,
    marginBottom: 10,
  },
  quoteText: {
    fontStyle: 'italic',
    fontSize: 13,
    color: C.quoteText,
    lineHeight: 19,
  },
  logisticsBlock: {
    marginBottom: 12,
  },
  logisticsLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logisticsText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: C.warmGray,
    flex: 1,
    lineHeight: 16,
  },

  // ── Footer ──
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: C.divider,
    paddingTop: 12,
    gap: 8,
  },
  spotsLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: C.warmGray,
  },
  spotsNumber: {
    fontFamily: 'DMSans_700Bold',
    color: C.dark,
  },
  ctaSpacer: {
    flex: 1,
  },
  ctaButton: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.terracotta,
    shadowColor: '#B5522E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  ctaButtonText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: C.terracotta,
  },
  completedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: C.divider,
    borderRadius: 999,
  },
  completedText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: C.warmGray,
  },
});
