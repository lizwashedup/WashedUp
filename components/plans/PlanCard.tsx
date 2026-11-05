import { getPlanLifecycle } from '../../lib/planLifecycle';
import { usePlanClock } from '../../hooks/usePlanClock';
import { circlePlanCardState } from '../../lib/circlePlanCard';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  ActivityIndicator,
  Text,
  TouchableOpacity,
  Pressable,
  ActionSheetIOS,
  Platform,
  Share,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Users } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { type AfterglowFontFamilies } from '../../constants/Typography';
import { planCardAppearance } from './planCardStyles';
import { hapticLight, hapticMedium, hapticSelection } from '../../lib/haptics';
import { buildPlanShareContent } from '../../lib/sharePlan';
import { planAgeLabel, type PlanAgeParameters } from '../../lib/planAgeLabel';
import { usePlanCardDuplicate } from '../../hooks/usePlanCardDuplicate';
import { isOptimisticPlanId } from '../../lib/optimisticPlans';
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
import { getActivityFirstCompanionPhotos } from '../../lib/planCardLayout';


// km -> miles for the card meta line. Under 10 mi shows one decimal ("1.2 mi"),
// 10+ rounds to a whole number ("12 mi").
function formatDistanceMi(km: number): string {
  const mi = km * 0.621371;
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}

interface PlanCardProps {
  plan: PlanAgeParameters & {
    id: string;
    title: string;
    host_message: string | null;
    start_time: string;
    end_time?: string | null;
    status?: string;
    location_text: string | null;
    neighborhood?: string | null;
    distance_km?: number | null;
    slug?: string | null;
    category: string | null;
    gender_rule?: string | null;
    max_invites: number;
    member_count: number;
    is_featured?: boolean;
    featured_type?: 'washedup_event' | 'birthday_party' | 'special_event' | 'plan_in_making' | null;
    allow_duplicate?: boolean;
    // Circle-aware plans (optional; absent on normal plans). When circle_id is
    // set the card carries the "from a circle" badge / "private to circle" tag,
    // the low-pressure join line, and stranger-cap-based spots.
    circle_id?: string | null;
    circle_metadata_known?: boolean;
    spots_remaining?: number | null;
    circle_visibility?: 'circle_only' | 'open' | null;
    stranger_cap?: number | null;
    // Capacity for the Badge B "{filled} of {size} in" line on opened-up circle
    // plans (from get_filtered_feed, batch 2). circle_size = joined members,
    // circle_in_count = members already on the plan.
    circle_size?: number | null;
    circle_in_count?: number | null;
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
  wishlistPending?: boolean;
  wishlistDisabled?: boolean;
  onWishlist?: (planId: string, current: boolean) => void;
  onReport?: (planId: string) => void;
  onBlock?: (planId: string) => void;
  onCreatorPress?: (creatorId: string) => void;
  isPast?: boolean;
  // September 13 approved hierarchy; prior variants remain for comparison.
  layout?: 'creator-first' | 'activity-first' | 'title-first';
  // Opt-in comparison; the approved title-first placement stays the default.
  creatorPlacement?: 'before-join' | 'after-join';
  appearance?: { fonts: AfterglowFontFamilies };
}

function formatDateTimeForCard(dateString: string): string {
  const d = new Date(dateString);
  // Plans live on an LA clock: render the stored instant in LA regardless of the
  // device timezone (mirrors laWallTimeToUTC on the write side).
  const dateStr = d.toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const timeStr = d.toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${dateStr} · ${timeStr}`;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Leading "circle of people" glyph on the "from a circle" provenance badge
// (badge spec: terracotta line icon, ~12pt).
const CIRCLE_BADGE_GLYPH = 12;

export const PlanCard = React.memo<PlanCardProps>(({ plan, isMember = false, isWishlisted = false, wishlistPending = false, wishlistDisabled = false, onWishlist, onReport, onBlock, onCreatorPress, isPast = false, layout = 'title-first', creatorPlacement = 'before-join', appearance }) => {
  const styles = useMemo(() => planCardAppearance(appearance?.fonts), [appearance?.fonts]);
  const router = useRouter();
  const [cardAlert, setCardAlert] = useState<{ title: string; message: string; buttons?: BrandedAlertButton[] } | null>(null);

  const now = usePlanClock([plan]);
  const lifecycle = getPlanLifecycle({ status: plan.status, startTime: plan.start_time, endTime: plan.end_time }, now);
  const isClosed = isPast || lifecycle.isClosed;
  const closedLabel = lifecycle.terminalStatus === 'cancelled' ? 'Cancelled' : lifecycle.terminalStatus === 'completed' ? 'Completed' : 'Ended';
  const isHappeningNow = !isClosed && new Date(plan.start_time).getTime() <= now;

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
      if (wishlistPending || wishlistDisabled) return;
      hapticSelection(); // toggle save
      bookmarkScale.value = withSpring(1.3, {}, () => {
        bookmarkScale.value = withSpring(1);
      });
      onWishlist?.(plan.id, isWishlisted);
    },
    [plan.id, isWishlisted, onWishlist, wishlistPending, wishlistDisabled],
  );

  const handlePress = useCallback(() => {
    // Optimistic posting: a just-prepended card carries a temporary id until the
    // insert commits (sub-second). Don't navigate to /plan/optimistic-..., the
    // detail screen has no such event yet. The id swaps to the real one on commit.
    if (isOptimisticPlanId(plan.id)) return;
    hapticLight();
    if (plan.creator?.profile_photo_url) {
      Image.prefetch(plan.creator.profile_photo_url).catch(() => {});
    }
    router.push(`/plan/${plan.id}`);
  }, [plan.id, plan.creator?.profile_photo_url, router]);

  const duplicate = usePlanCardDuplicate({
    eventId: plan.id,
    enabled: !isMember && !isClosed && plan.allow_duplicate === true && !plan.circle_id && plan.circle_metadata_known !== false,
    startTime: plan.start_time, endTime: plan.end_time, status: plan.status,
    onError: () => setCardAlert({
      title: 'Couldn’t open a draft',
      message: 'This plan may have changed, or the connection is unavailable. Try “Post your own” again from the card.',
    }),
  });
  const duplicating = duplicate.busy;
  const handlePostYourOwn = (event?: { stopPropagation?: () => void }) => {
    event?.stopPropagation?.();
    return duplicate.open();
  };

  // Creator always counts as 1 — member_count should never display as 0
  const isFeatured = plan.is_featured ?? false;
  const isBirthdayParty = isFeatured && plan.featured_type === 'birthday_party';
  const isSpecialEvent = isFeatured && plan.featured_type === 'special_event';
  const isPlanInMaking = isFeatured && plan.featured_type === 'plan_in_making';
  const circleCard = circlePlanCardState(plan);
  const usesOrdinaryCapacity = circleCard.kind === 'ordinary';
  const going = Math.max(1, usesOrdinaryCapacity ? capDisplayCount(plan.member_count, isFeatured) : plan.member_count);
  const totalCapacity = isFeatured
    ? (plan.max_invites ?? 99) + 1
    : Math.min((plan.max_invites ?? 7) + 1, MAX_GROUP);
  const spotsLeft = Math.max(0, totalCapacity - going);
  const isFull = usesOrdinaryCapacity && going >= totalCapacity;
  // Circle plans use stranger_cap, not max_invites, so the normal spots/full
  // math does not apply: never show the "N left" urgency badge on them.
  const isCirclePlan = !!plan.circle_id;
  const isOpenCircle = circleCard.kind === 'open';
  const isJustUsCircle = circleCard.kind === 'private';
  const showSpotsLeftBadge = !isMember && !isClosed && !isFeatured && usesOrdinaryCapacity && spotsLeft >= 1 && spotsLeft <= 2 && !isFull;

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
  // Distance only when the feed passed location (Near-me on); null otherwise, so
  // the meta line is byte-identical to before off Near-me. Shown in miles (LA).
  const distanceLabel = plan.distance_km != null ? formatDistanceMi(plan.distance_km) : null;
  const placePart = locationRaw
    ? (plan.neighborhood ? `${locationRaw} · ${plan.neighborhood}` : locationRaw)
    : null;
  const locationDisplay = [distanceLabel, placePart].filter(Boolean).join(' · ') || null;

  const ageLabel = planAgeLabel(plan);
  const creatorNote = plan.host_message
    ? `"${plan.host_message}"`
    : null;
  const isActivityFirst = layout === 'activity-first';
  const isTitleFirst = layout === 'title-first';
  const isCreatorLast = isTitleFirst && creatorPlacement === 'after-join';
  const hasWideDecision = isCreatorLast && !isMember && !isClosed && isFull && plan.allow_duplicate === true;
  const companionPhotos = getActivityFirstCompanionPhotos(
    plan.attendees,
    going,
    plan.creator?.profile_photo_url ?? null,
  );

  const renderSpotsLeftBadge = () => showSpotsLeftBadge && (
        <Animated.View style={pulseAnimatedStyle}>
          <View style={styles.spotsLeftBadge}>
            <Text style={styles.spotsLeftBadgeText}>{spotsLeft} left</Text>
          </View>
        </Animated.View>
      );

  const renderHeaderActions = () => (
    <View style={[styles.headerRight, isTitleFirst && styles.titleActions]}>
      {!isActivityFirst && !isTitleFirst && renderSpotsLeftBadge()}
      <TouchableOpacity
        onPress={(e) => {
          e.stopPropagation();
          hapticLight();
          const share = buildPlanShareContent(plan);
          Share.share({ message: `${share.message}\n${share.url}` });
        }}
        style={[styles.iconBtn, isTitleFirst && styles.titleActionButton]}
        hitSlop={appearance || isTitleFirst ? undefined : { top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Share plan"
        accessibilityRole="button"
      >
        <Ionicons name="share-outline" size={18} color={appearance ? AfterglowColors.ink : Colors.asphalt} />
      </TouchableOpacity>
      {onWishlist && (
        <TouchableOpacity
          onPress={handleWishlist}
          disabled={wishlistPending || wishlistDisabled}
          style={[styles.iconBtn, isTitleFirst && styles.titleActionButton]}
          hitSlop={appearance || isTitleFirst ? undefined : { top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={wishlistPending ? 'Updating saved plan' : isWishlisted ? 'Remove from saved' : 'Save plan'}
          accessibilityRole="button"
          accessibilityState={{ selected: isWishlisted, disabled: wishlistPending || wishlistDisabled, busy: wishlistPending }}
        >
          <Animated.View style={bookmarkAnimatedStyle}>
            {wishlistPending ? <ActivityIndicator size="small" color={appearance ? AfterglowColors.clay : Colors.terracotta} /> : (
            <Ionicons
              name={isWishlisted ? 'bookmark' : 'bookmark-outline'}
              size={18}
              color={appearance ? (isWishlisted ? AfterglowColors.clay : AfterglowColors.ink) : (isWishlisted ? Colors.terracotta : Colors.asphalt)}
            />
            )}
          </Animated.View>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderCreatorAvatar = () => (
    <TouchableOpacity
      style={styles.activityCreatorPressable}
      disabled={!onCreatorPress || !plan.creator?.id}
      activeOpacity={onCreatorPress && plan.creator?.id ? 0.7 : 1}
      onPress={(e) => {
        if (onCreatorPress && plan.creator?.id) {
          e.stopPropagation();
          hapticLight();
          onCreatorPress(plan.creator.id);
        }
      }}
      accessibilityRole={onCreatorPress && plan.creator?.id ? 'button' : undefined}
      accessibilityLabel="Open creator profile"
    >
      {plan.creator?.profile_photo_url ? (
        <Image
          source={{ uri: plan.creator.profile_photo_url }}
          style={styles.activityCreatorAvatar}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={styles.activityCreatorPlaceholder}>
          <Ionicons name="person-outline" size={16} color={Colors.tertiary} />
        </View>
      )}
    </TouchableOpacity>
  );

  const renderCreatorRow = () => (
      <View style={[styles.creatorRow, isCreatorLast && styles.creatorLastRow]}>
        <TouchableOpacity
          style={styles.creatorLeft}
          disabled={!onCreatorPress || !plan.creator?.id}
          accessibilityRole={appearance && onCreatorPress && plan.creator?.id ? 'button' : undefined}
          accessibilityLabel={appearance && onCreatorPress && plan.creator?.id ? `Open ${plan.creator.first_name_display || 'creator'} profile` : undefined}
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
        {isTitleFirst ? !isCreatorLast && renderSpotsLeftBadge() : renderHeaderActions()}
      </View>
  );

  const renderJoinActions = () => (
    <>
        {!isMember && !isClosed && isFull && plan.allow_duplicate === true && (
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
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel={isClosed ? `${closedLabel}, view plan` : isMember ? 'Going, view plan' : undefined}
            style={[
              !isClosed && isFull && !isMember
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
              numberOfLines={1}
              style={
                !isClosed && isFull && !isMember
                  ? (plan.allow_duplicate === true ? styles.waitlistQuietText : styles.ctaButtonOutlineText)
                  : styles.ctaButtonText
              }
            >
              {isClosed ? 'View plan →' : isMember ? 'Going ✓' : !usesOrdinaryCapacity ? (circleCard.remaining === null || circleCard.remaining === 0 ? 'View plan →' : "Let's Go →") : isFull && !isMember ? 'Waitlist →' : "Let's Go →"}
            </Text>
          </AnimatedPressable>
    </>
  );

  const renderLogistics = () => (
      (plan.start_time || locationDisplay) && (
        <View style={styles.logisticsBlock}>
          {plan.start_time && (
            <View style={styles.logisticsLine}>
              <Ionicons name="calendar-outline" size={13} color={appearance ? AfterglowColors.clay : Colors.terracotta} />
              <Text style={styles.logisticsText}>
                {formatDateTimeForCard(plan.start_time)}
              </Text>
            </View>
          )}
          {locationDisplay && (
            <View style={[styles.logisticsLine, plan.start_time && { marginTop: 4 }]}>
              <Ionicons name="location-outline" size={13} color={appearance ? AfterglowColors.clay : Colors.terracotta} />
              <Text style={styles.logisticsText} numberOfLines={1}>
                {locationDisplay}
              </Text>
            </View>
          )}
        </View>
      )
  );

  const renderDecisionFooter = () => (
      <View style={[styles.footer, isCreatorLast && styles.creatorLastDecision, hasWideDecision && styles.creatorLastWideDecision]}>
        {isActivityFirst && (
          <View
            style={[styles.activityAvatarStack, { width: 34 + companionPhotos.length * 12 }]}
            accessibilityLabel={`${going} ${isClosed ? 'participants' : 'going'}`}
            accessible
          >
            {companionPhotos.map((photoUrl, index) => (
              photoUrl ? (
                <Image
                  key={`${photoUrl}-${index}`}
                  source={{ uri: photoUrl }}
                  style={[styles.activityCompanionAvatar, { left: (index + 1) * 12 }]}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View
                  key={`companion-${index}`}
                  style={[styles.activityCompanionPlaceholder, { left: (index + 1) * 12 }]}
                />
              )
            ))}
            <View style={styles.activityCreatorLayer}>
              {renderCreatorAvatar()}
            </View>
          </View>
        )}
        {isClosed ? (
          <Text style={styles.joinLine}>{closedLabel}</Text>
        ) : isMember ? (
          <Text style={styles.spotsLabel}><Text style={styles.spotsNumber}>{going}</Text>{' going'}</Text>
        ) : !usesOrdinaryCapacity ? (
          <Text style={[styles.joinLine, { flexShrink: 1 }]}>{circleCard.footer}</Text>
        ) : !isBirthdayParty && (
          isFeatured ? (
            <Text style={styles.spotsLabel}>
              <Text style={styles.spotsNumber}>{going}</Text>
              {' going'}
            </Text>
          ) : (isActivityFirst || isCreatorLast) && showSpotsLeftBadge ? (
            <Animated.View style={pulseAnimatedStyle}>
              <View style={styles.spotsLeftBadge}>
                <Text style={styles.spotsLeftBadgeText}>{spotsLeft} left</Text>
              </View>
            </Animated.View>
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
        {(!isCreatorLast || hasWideDecision) && <View style={styles.ctaSpacer} />}
        {isCreatorLast && !hasWideDecision ? (
          <View style={styles.creatorLastActions}>{renderJoinActions()}</View>
        ) : renderJoinActions()}
      </View>
  );

  return (
    <Animated.View
      entering={isOptimisticPlanId(plan.id)
        ? FadeInUp.duration(300).easing(Easing.out(Easing.ease))
        : undefined}
    >
    <TouchableOpacity
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={500}
      activeOpacity={0.92}
      style={[styles.card, isClosed && styles.cardPast]}
      accessible={false}
      accessibilityLabel={`${plan.title} plan${isClosed ? `, ${closedLabel.toLowerCase()}` : isMember ? ', going' : ''}`}
      // Web titles are real buttons. Their clicks use this press responder,
      // retaining keyboard activation and its post-long-press cancellation.
      accessibilityRole={Platform.OS === 'web' ? undefined : 'button'}
      focusable={Platform.OS === 'web' ? false : undefined}
    >
      {/* The approved title-first layout retains the complete creator row below. */}
      {isActivityFirst ? (
        <View style={styles.activityHeader}>
          <Text style={[styles.title, styles.activityTitle]} numberOfLines={2}
            accessible accessibilityRole="button"
            accessibilityLabel={`${plan.title} plan${isClosed ? `, ${closedLabel.toLowerCase()}` : isMember ? ', going' : ''}`}
            onAccessibilityTap={handlePress}>
            {plan.title}
          </Text>
          {renderHeaderActions()}
        </View>
      ) : (
        !isTitleFirst && renderCreatorRow()
      )}

      {/* B. Plan Title */}
      {isTitleFirst ? (
        <View style={styles.titleHeader}>
          <Text style={[styles.title, styles.titleWithActions]}
            accessible accessibilityRole="button"
            accessibilityLabel={`${plan.title} plan${isClosed ? `, ${closedLabel.toLowerCase()}` : isMember ? ', going' : ''}`}
            onAccessibilityTap={handlePress}>
            {plan.title}
          </Text>
          {renderHeaderActions()}
        </View>
      ) : !isActivityFirst && (
        <Text style={styles.title} numberOfLines={2}
          accessible accessibilityRole="button"
          accessibilityLabel={`${plan.title} plan${isClosed ? `, ${closedLabel.toLowerCase()}` : isMember ? ', going' : ''}`}
          onAccessibilityTap={handlePress}>
          {plan.title}
        </Text>
      )}

      {/* B2. Pills row — happening-now status (when live), then featured pill
          (gold "washedup event" or pink "birthday party") OR regular category
          + women-only pills. Happening-now leads visually so users scanning
          the feed spot live plans first. */}
      {(isHappeningNow || isFeatured || plan.category || plan.gender_rule === 'women_only' || isCirclePlan || ageLabel) ? (
        <View style={styles.categoryRow}>
          {isHappeningNow && (
            <View style={styles.happeningNowPill}>
              <Text style={styles.happeningNowPillText}>happening now</Text>
            </View>
          )}
          {isOpenCircle && (
            <View style={styles.fromCircleBadge}>
              <Users size={CIRCLE_BADGE_GLYPH} color={appearance ? AfterglowColors.clay : Colors.terracotta} strokeWidth={1.75} />
              <Text style={styles.fromCircleBadgeText}>Friends group</Text>
            </View>
          )}
          {isJustUsCircle && <View style={styles.privateCircleTag}><Text style={styles.privateCircleTagText}>Circle only</Text></View>}
          {isCirclePlan && circleCard.kind === 'unknown' && <View style={styles.privateCircleTag}><Text style={styles.privateCircleTagText}>Circle plan</Text></View>}
          {isFeatured ? (
            <View
              style={[
                styles.featuredPill,
                isBirthdayParty && { backgroundColor: Colors.birthdayPinkTint15 },
                isSpecialEvent && { backgroundColor: Colors.specialEventMaroon },
                isPlanInMaking && { backgroundColor: Colors.planInMakingPurple },
              ]}
            >
              <Text
                style={[
                  styles.featuredPillText,
                  isBirthdayParty && { color: Colors.birthdayPink },
                  isSpecialEvent && { color: Colors.specialEventCream },
                  isPlanInMaking && { color: Colors.white },
                ]}
              >
                {isPlanInMaking ? 'Plan in the making' : isBirthdayParty ? 'birthday party' : isSpecialEvent ? 'special event' : 'washedup event'}
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
            </>
          )}
          {plan.gender_rule === 'women_only' && (
            <View style={styles.womenOnlyPill}>
              <Text style={styles.womenOnlyPillText}>Women Only</Text>
            </View>
          )}
          {ageLabel && (
            <View style={styles.agePill}>
              <Text style={styles.agePillText} accessibilityLabel={`Age range: ${ageLabel}`}>
                {ageLabel}
              </Text>
            </View>
          )}
        </View>
      ) : null}

      {/* B3. Birthday party subtitle — small italic context line. */}
      {isBirthdayParty && (
        <Text style={styles.birthdaySubtitle}>celebrating our OG washedup users</Text>
      )}

      {isOpenCircle && <Text style={styles.circleExplanation}>A plan with an existing group of friends.</Text>}

      {/* C. Creator's Note */}
      {creatorNote && (
        <View style={styles.quoteBlock}>
          <Text style={styles.quoteText} numberOfLines={2}>
            {creatorNote}
          </Text>
        </View>
      )}

      {/* D. Date/Time & Location */}
      {!isCreatorLast && renderLogistics()}

      {isTitleFirst && !isCreatorLast && renderCreatorRow()}

      {/* E. Footer: spots + CTA. Circle plans lead with the low-pressure join
          line ("Join if you're around.") instead of stranger-cap-incorrect
          spots math. */}
      {isCreatorLast ? (
        <View style={[styles.creatorLastDecisionArea, hasWideDecision && styles.creatorLastWideArea]}>
          <View style={[styles.creatorLastLogistics, hasWideDecision && styles.creatorLastWideLogistics]}>{renderLogistics()}</View>
          {renderDecisionFooter()}
        </View>
      ) : renderDecisionFooter()}
      {isCreatorLast && <View style={styles.creatorLastFooter}>{renderCreatorRow()}</View>}
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
