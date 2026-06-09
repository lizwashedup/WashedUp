import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ActionSheetIOS,
  Platform,
  Share,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { hapticLight, hapticMedium } from '../../lib/haptics';
import { buildPlanShareContent } from '../../lib/sharePlan';
import { buildDuplicatePostParams } from '../../lib/duplicatePlan';
import { supabase } from '../../lib/supabase';
import MarkIcon from '../marks/MarkIcons';
import { BrandedAlert, BrandedAlertButton } from '../BrandedAlert';
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
import { getPlanPinColor } from '../../lib/planColors';
import { COPY } from '../yours/state/constants';


interface PlanCardProps {
  plan: {
    id: string;
    title: string;
    host_message: string | null;
    start_time: string;
    location_text: string | null;
    neighborhood?: string | null;
    slug?: string | null;
    category: string | null;
    gender_rule?: string | null;
    max_invites: number;
    member_count: number;
    is_featured?: boolean;
    featured_type?: 'washedup_event' | 'birthday_party' | null;
    allow_duplicate?: boolean;
    // Circle-aware plans (optional; absent on normal plans). When circle_id is
    // set the card carries the "from a circle" badge / "private to circle" tag,
    // the low-pressure join line, and stranger-cap-based spots.
    circle_id?: string | null;
    circle_visibility?: 'circle_only' | 'open' | null;
    stranger_cap?: number | null;
    creator: {
      id?: string;
      first_name_display: string;
      profile_photo_url: string | null;
      member_since?: string;
      plans_posted?: number;
      milestone_slug?: string | null;
      milestone_name?: string | null;
      milestone_icon?: string | null;
    };
    attendees?: { profile_photo_url: string | null }[];
  };
  isMember?: boolean;
  isWishlisted?: boolean;
  onWishlist?: (planId: string, current: boolean) => void;
  onReport?: (planId: string) => void;
  onBlock?: (planId: string) => void;
  onCreatorPress?: (creatorId: string) => void;
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

export const PlanCard = React.memo<PlanCardProps>(({ plan, isMember = false, isWishlisted = false, onWishlist, onReport, onBlock, onCreatorPress, isPast = false }) => {
  const router = useRouter();
  const [cardAlert, setCardAlert] = useState<{ title: string; message: string; buttons?: BrandedAlertButton[] } | null>(null);

  const isHappeningNow =
    new Date(plan.start_time) <= new Date() &&
    new Date(plan.start_time) > new Date(Date.now() - 3 * 60 * 60 * 1000);

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
      setCardAlert({
        title: plan.title,
        message: '',
        buttons: [
          { text: 'Report this plan', onPress: () => onReport?.(plan.id) },
          { text: `Block ${creatorName}`, style: 'destructive', onPress: () => onBlock?.(plan.id) },
          { text: 'Cancel', style: 'cancel' },
        ],
      });
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

  // "Post your own" — same destination + pre-fill as the duplicate sheet's
  // primary button in app/plan/[id].tsx. The feed Plan is slim, so fetch the
  // full event row by id first to guarantee an identical pre-fill, then push
  // to the post screen via the shared param builder.
  const [duplicating, setDuplicating] = useState(false);
  const handlePostYourOwn = useCallback(
    async (e?: any) => {
      e?.stopPropagation?.();
      if (duplicating) return;
      hapticLight();
      setDuplicating(true);
      try {
        const { data, error } = await supabase
          .from('events')
          .select(
            'id, title, description, start_time, end_time, drop_in, allow_duplicate, location_text, location_lat, location_lng, image_url, primary_vibe, gender_rule, max_invites, target_age_min, target_age_max, tickets_url, neighborhood',
          )
          .eq('id', plan.id)
          .single();
        if (error || !data) return;
        router.push({
          pathname: '/(tabs)/post',
          params: buildDuplicatePostParams(data as any, plan.id),
        });
      } finally {
        setDuplicating(false);
      }
    },
    [duplicating, plan.id, router],
  );

  // Creator always counts as 1 — member_count should never display as 0
  const isFeatured = plan.is_featured ?? false;
  const isBirthdayParty = isFeatured && plan.featured_type === 'birthday_party';
  const going = Math.max(1, capDisplayCount(plan.member_count, isFeatured));
  const totalCapacity = isFeatured
    ? (plan.max_invites ?? 99) + 1
    : Math.min((plan.max_invites ?? 7) + 1, MAX_GROUP);
  const spotsLeft = Math.max(0, totalCapacity - going);
  const isFull = going >= totalCapacity;
  // Circle plans use stranger_cap, not max_invites, so the normal spots/full
  // math does not apply: never show the "N left" urgency badge on them.
  const isCirclePlan = !!plan.circle_id;
  const isOpenCircle = isCirclePlan && plan.circle_visibility === 'open';
  const isJustUsCircle = isCirclePlan && plan.circle_visibility === 'circle_only';
  const showSpotsLeftBadge = !isFeatured && !isCirclePlan && spotsLeft >= 1 && spotsLeft <= 2 && !isFull;

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
        <TouchableOpacity
          style={styles.creatorLeft}
          disabled={!onCreatorPress || !plan.creator?.id}
          activeOpacity={onCreatorPress && plan.creator?.id ? 0.7 : 1}
          onPress={(e) => {
            if (onCreatorPress && plan.creator?.id) {
              e.stopPropagation();
              hapticLight();
              onCreatorPress(plan.creator.id);
            }
          }}
        >
          {plan.creator?.profile_photo_url ? (
            <Image
              source={{ uri: plan.creator.profile_photo_url }}
              style={styles.creatorAvatar}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={styles.creatorAvatarPlaceholder}>
              <Ionicons name="person-outline" size={18} color={Colors.tertiary} />
            </View>
          )}
          <View style={styles.creatorDetails}>
            <Text style={styles.creatorName} numberOfLines={1}>
              {plan.creator?.first_name_display ?? 'Creator'}
            </Text>
            <View style={styles.creatorSubRow}>
              <Text style={styles.creatorSubtext}>posted</Text>
              {plan.creator?.milestone_slug && plan.creator?.milestone_icon && (
                <View style={styles.creatorMark}>
                  <MarkIcon iconName={plan.creator.milestone_icon} size={16} />
                  <Text style={styles.creatorMarkText}>{plan.creator.milestone_name}</Text>
                </View>
              )}
            </View>
          </View>
        </TouchableOpacity>
        <View style={styles.headerRight}>
          {showSpotsLeftBadge && (
            <Animated.View style={pulseAnimatedStyle}>
              <View style={styles.spotsLeftBadge}>
                <Text style={styles.spotsLeftBadgeText}>{spotsLeft} left</Text>
              </View>
            </Animated.View>
          )}
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              hapticLight();
              const share = buildPlanShareContent(plan);
              Share.share({ message: share.message, url: share.url });
            }}
            style={styles.iconBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Share plan"
          >
            <Ionicons name="share-outline" size={18} color={Colors.asphalt} />
          </TouchableOpacity>
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
                  color={isWishlisted ? Colors.terracotta : Colors.asphalt}
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

      {/* B2. Pills row — happening-now status (when live), then featured pill
          (gold "washedup event" or pink "birthday party") OR regular category
          + women-only pills. Happening-now leads visually so users scanning
          the feed spot live plans first. */}
      {(isHappeningNow || isFeatured || plan.category || plan.gender_rule === 'women_only' || isCirclePlan) ? (
        <View style={styles.categoryRow}>
          {isHappeningNow && (
            <View style={styles.happeningNowPill}>
              <Text style={styles.happeningNowPillText}>happening now</Text>
            </View>
          )}
          {isOpenCircle && (
            <View style={styles.fromCircleBadge}>
              <Text style={styles.fromCircleBadgeText}>{COPY.circlePlanFromBadge}</Text>
            </View>
          )}
          {isJustUsCircle && (
            <View style={styles.privateCircleTag}>
              <Text style={styles.privateCircleTagText}>{COPY.circlePlanPrivateTag}</Text>
            </View>
          )}
          {isFeatured ? (
            <View
              style={[
                styles.featuredPill,
                isBirthdayParty && { backgroundColor: Colors.birthdayPinkTint15 },
              ]}
            >
              <Text
                style={[
                  styles.featuredPillText,
                  isBirthdayParty && { color: Colors.birthdayPink },
                ]}
              >
                {isBirthdayParty ? 'birthday party' : 'washedup event'}
              </Text>
            </View>
          ) : (
            <>
              {plan.category && (
                <View style={styles.categoryPill}>
                  <Text style={[styles.categoryPillText, { color: getPlanPinColor(plan) }]}>
                    {plan.category}
                  </Text>
                </View>
              )}
              {plan.gender_rule === 'women_only' && (
                <View style={styles.womenOnlyPill}>
                  <Text style={styles.womenOnlyPillText}>Women Only</Text>
                </View>
              )}
            </>
          )}
        </View>
      ) : null}

      {/* B3. Birthday party subtitle — small italic context line. */}
      {isBirthdayParty && (
        <Text style={styles.birthdaySubtitle}>celebrating our OG washedup users</Text>
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
              <Ionicons name="calendar-outline" size={13} color={Colors.terracotta} />
              <Text style={styles.logisticsText}>
                {formatDateTimeForCard(plan.start_time)}
              </Text>
            </View>
          )}
          {locationDisplay && (
            <View style={[styles.logisticsLine, plan.start_time && { marginTop: 4 }]}>
              <Ionicons name="location-outline" size={13} color={Colors.terracotta} />
              <Text style={styles.logisticsText} numberOfLines={1}>
                {locationDisplay}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* E. Footer: spots + CTA. Circle plans lead with the low-pressure join
          line ("Join if you're around.") instead of stranger-cap-incorrect
          spots math. */}
      <View style={styles.footer}>
        {isCirclePlan ? (
          <Text style={styles.joinLine}>{COPY.circlePlanJoinLine}</Text>
        ) : !isBirthdayParty && (
          isFeatured ? (
            <Text style={styles.spotsLabel}>
              <Text style={styles.spotsNumber}>{going}</Text>
              {' going'}
            </Text>
          ) : (
            <Text style={styles.spotsLabel}>
              {spotsLeft === 0 ? (
                'Full'
              ) : (
                <>
                  <Text style={styles.spotsNumber}>{spotsLeft}</Text>
                  {` ${spotsLeft === 1 ? 'spot left' : 'spots left'}`}
                </>
              )}
            </Text>
          )
        )}
        <View style={styles.ctaSpacer} />
        {!isPast && isFull && plan.allow_duplicate === true && (
          <Pressable
            style={styles.postYourOwnBtn}
            onPress={handlePostYourOwn}
            disabled={duplicating}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Post your own"
          >
            <Text style={styles.postYourOwnBtnText}>Post your own</Text>
          </Pressable>
        )}
        {isPast ? (
          <View style={styles.completedBadge}>
            <Ionicons name="checkmark-circle-outline" size={14} color={Colors.secondary} />
            <Text style={styles.completedText}>Completed</Text>
          </View>
        ) : (
          <AnimatedPressable
            style={[
              isFull && !isMember
                ? (plan.allow_duplicate === true ? styles.waitlistQuietBtn : styles.ctaButtonOutline)
                : styles.ctaButton,
              buttonAnimatedStyle,
            ]}
            onPress={() => {
              hapticLight();
              handlePress();
            }}
            onPressIn={handleButtonPressIn}
            onPressOut={handleButtonPressOut}
          >
            <Text
              style={
                isFull && !isMember
                  ? (plan.allow_duplicate === true ? styles.waitlistQuietText : styles.ctaButtonOutlineText)
                  : styles.ctaButtonText
              }
            >
              {isFull && !isMember ? "Waitlist \u2192" : "Let's Go \u2192"}
            </Text>
          </AnimatedPressable>
        )}
      </View>
    </TouchableOpacity>
    {cardAlert && (
      <BrandedAlert
        visible
        title={cardAlert.title}
        message={cardAlert.message}
        buttons={cardAlert.buttons}
        onClose={() => setCardAlert(null)}
      />
    )}
    </Animated.View>
  );
});

PlanCard.displayName = 'PlanCard';

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 16,
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
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
    backgroundColor: Colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorDetails: {
    marginLeft: 10,
    flex: 1,
    minWidth: 0,
  },
  creatorName: {
    fontFamily: Fonts.sansBold,
    fontSize: 14,
    color: Colors.darkWarm,
    lineHeight: 18,
  },
  creatorSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  creatorSubtext: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: Colors.tertiary,
    lineHeight: 16,
  },
  creatorMark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  creatorMarkText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 10,
    color: Colors.terracotta,
    lineHeight: 14,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  spotsLeftBadge: {
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  spotsLeftBadgeText: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: Colors.white,
    lineHeight: 14,
  },
  iconBtn: {
    padding: 4,
  },

  // ── Body ──
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: 18,
    color: Colors.darkWarm,
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
    backgroundColor: Colors.accentSubtle,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  categoryPillText: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: Colors.terracotta,
    textTransform: 'capitalize',
    letterSpacing: 0.2,
  },
  featuredPill: {
    backgroundColor: Colors.goldenAmberTint15,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  featuredPillText: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: Colors.goldenAmber,
    letterSpacing: 0.2,
  },
  happeningNowPill: {
    backgroundColor: '#C5A55A',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  happeningNowPillText: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: '#2C1810',
    letterSpacing: 0.2,
  },
  womenOnlyPill: {
    backgroundColor: Colors.birthdayPinkTint15,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  womenOnlyPillText: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: Colors.birthdayPink,
    letterSpacing: 0.2,
  },
  // "from a circle": soft gold-tinted badge (decorative bg only; text stays
  // warm-dark, never gold, per the palette rule).
  fromCircleBadge: {
    backgroundColor: Colors.goldenAmberTint15,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  fromCircleBadgeText: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: Colors.darkWarm,
    letterSpacing: 0.2,
  },
  // "private to circle": quiet neutral tag for a Just-us plan.
  privateCircleTag: {
    backgroundColor: Colors.dividerWarm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  privateCircleTagText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 10,
    color: Colors.secondary,
    letterSpacing: 0.2,
  },
  birthdaySubtitle: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    marginTop: -2,
    marginBottom: 8,
  },
  quoteBlock: {
    borderLeftWidth: 2,
    borderLeftColor: Colors.goldAccent,
    paddingLeft: 10,
    marginBottom: 10,
  },
  quoteText: {
    fontStyle: 'italic',
    fontSize: 13,
    color: Colors.quoteText,
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
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: Colors.secondary,
    flex: 1,
    lineHeight: 16,
  },

  // ── Footer ──
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.dividerWarm,
    paddingTop: 12,
    gap: 8,
  },
  spotsLabel: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    color: Colors.secondary,
  },
  // Low-pressure circle-plan join line (the emotional core of the card).
  joinLine: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    color: Colors.darkWarm,
  },
  spotsNumber: {
    fontFamily: Fonts.sansBold,
    color: Colors.darkWarm,
  },
  ctaSpacer: {
    flex: 1,
  },
  ctaButton: {
    backgroundColor: Colors.white,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  ctaButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
  ctaButtonOutline: {
    backgroundColor: 'transparent',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
  },
  ctaButtonOutlineText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
  // Primary filled action on full+duplicatable cards — "Post your own" is
  // the behavior we want to encourage, so it's the loudest element here.
  postYourOwnBtn: {
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 12,
    marginRight: 8,
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  postYourOwnBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.white,
  },
  // Quiet text link — when "Post your own" is present it's the loud action,
  // so "Waitlist" steps back to a low-emphasis link (no bg, no border).
  waitlistQuietBtn: {
    backgroundColor: 'transparent',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  waitlistQuietText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
  },
  completedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.dividerWarm,
    borderRadius: 999,
  },
  completedText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    color: Colors.secondary,
  },
});
