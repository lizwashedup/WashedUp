import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActionSheetIOS,
  Platform,
  Share,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { hapticLight, hapticMedium, hapticSelection } from '../../lib/haptics';
import Colors, { CreatorSurfaceColors, AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import { BrandedAlert, BrandedAlertButton } from '../BrandedAlert';
import { getPlanLifecycle } from '../../lib/planLifecycle';
import { usePlanClock } from '../../hooks/usePlanClock';
import { buildPlanShareContent } from '../../lib/sharePlan';
import { planAgeLabel, type PlanAgeParameters } from '../../lib/planAgeLabel';

interface FeaturedEventCardProps {
  plan: PlanAgeParameters & {
    id: string;
    title: string;
    host_message: string | null;
    start_time: string;
    end_time?: string | null;
    status?: string;
    location_text: string | null;
    category: string | null;
    max_invites: number;
    member_count: number;
    slug?: string | null;
    is_featured?: boolean;
    featured_type?: 'washedup_event' | 'birthday_party' | 'special_event' | null;
    creator: {
      first_name_display: string;
      profile_photo_url: string | null;
      plans_posted?: number;
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
  solo?: boolean;
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

const AVATAR_SIZE = 28;
const AVATAR_OVERLAP = 8;

export const FeaturedEventCard = React.memo<FeaturedEventCardProps>(({
  plan, isMember = false, isWishlisted = false, wishlistPending = false, wishlistDisabled = false, onWishlist, onReport, onBlock, solo = false, appearance,
}) => {
  const styles = useMemo(() => appearance ? { ...baseStyles, ...featuredAppearance(appearance.fonts) } : baseStyles, [appearance?.fonts]);
  const now = usePlanClock([plan]);
  const { isClosed, terminalStatus } = getPlanLifecycle({ status: plan.status, startTime: plan.start_time, endTime: plan.end_time }, now);
  const closedLabel = terminalStatus === 'cancelled' ? 'Cancelled' : terminalStatus === 'completed' ? 'Completed' : 'Ended';
  const router = useRouter();
  const [cardAlert, setCardAlert] = useState<{ title: string; message: string; buttons?: BrandedAlertButton[] } | null>(null);
  const mounted = useRef(false);
  const cardIdentity = useMemo(() => ({ sharing: false }), [plan.id]);
  const currentIdentity = useRef(cardIdentity);
  currentIdentity.current = cardIdentity;
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => { setCardAlert(null); }, [cardIdentity]);

  const handleLongPress = useCallback(() => {
    hapticMedium(); // open context menu (matches PlanCard long-press)
    const creatorName = plan.creator?.first_name_display ?? 'Creator';
    const options = ['Report this plan', `Block ${creatorName}`, 'Cancel'];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 2, destructiveButtonIndex: 1 },
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

  const handleWishlist = useCallback((e: any) => {
    e?.stopPropagation?.();
    if (wishlistPending || wishlistDisabled) return;
    hapticSelection(); // toggle save
    onWishlist?.(plan.id, isWishlisted);
  }, [plan.id, isWishlisted, wishlistPending, wishlistDisabled, onWishlist]);

  const handleShare = useCallback(async (e: any) => {
    e?.stopPropagation?.();
    const isCurrent = () => mounted.current && currentIdentity.current === cardIdentity;
    if (!isCurrent() || cardIdentity.sharing) return;
    cardIdentity.sharing = true;
    hapticLight(); // open share sheet
    const share = buildPlanShareContent({
      id: plan.id,
      title: plan.title,
      start_time: plan.start_time,
      location_text: plan.location_text,
      slug: plan.slug ?? null,
    });
    try {
      await Share.share({ message: `${share.message}\n${share.url}` });
    } catch {
      if (isCurrent()) setCardAlert({ title: 'Couldn’t open sharing', message: 'Try again.' });
    } finally {
      cardIdentity.sharing = false;
    }
  }, [plan.id, plan.title, plan.start_time, plan.location_text, plan.slug, cardIdentity]);

  const handlePress = useCallback(() => {
    hapticLight(); // open detail
    router.push(`/plan/${plan.id}`);
  }, [plan.id, router]);

  const locationDisplay = plan.location_text && !plan.location_text.startsWith('http')
    ? plan.location_text
    : null;

  const ageLabel = planAgeLabel(plan);
  const creatorNote = plan.host_message ? `\u201C${plan.host_message}\u201D` : null;
  const attendees = plan.attendees ?? [];
  const isBirthdayParty = plan.featured_type === 'birthday_party';
  const isSpecialEvent = plan.featured_type === 'special_event';
  const isPrideFlagCard = plan.slug === 'washedup-weho-pride-2026';
  const creatorRow = (
    <View style={styles.creatorRow}>
      <View style={styles.creatorLeft}>
        {plan.creator?.profile_photo_url ? (
          <Image source={{ uri: plan.creator.profile_photo_url }} style={styles.creatorAvatar} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <View style={styles.creatorAvatarPlaceholder}>
            <Ionicons name="person-outline" size={20} color={appearance ? AfterglowColors.muted : Colors.textLight} />
          </View>
        )}
        {appearance ? (
          <View style={styles.creatorIdentity}>
            <Text style={styles.creatorName}>{plan.creator?.first_name_display ?? 'Creator'}</Text>
            <Text style={styles.creatorMeta}>posted</Text>
          </View>
        ) : <Text style={styles.creatorName} numberOfLines={1}>{`${plan.creator?.first_name_display ?? 'Creator'} posted`}</Text>}
      </View>
    </View>
  );

  return (
    <TouchableOpacity
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={500}
      activeOpacity={0.92}
      style={[
        styles.card,
        solo && styles.cardSolo,
        !appearance && isBirthdayParty && { borderColor: Colors.birthdayPink },
        !appearance && isSpecialEvent && { borderColor: Colors.specialEventMaroon },
        !appearance && isPrideFlagCard && { backgroundColor: 'transparent' },
      ]}
      accessibilityLabel={`${plan.title} ${isBirthdayParty ? 'Birthday Party' : isSpecialEvent ? 'Special Event' : 'WashedUp Event'}${ageLabel ? `, age range ${ageLabel}` : ''}${isClosed ? `, ${closedLabel.toLowerCase()}` : isMember ? ', going' : ''}`}
      accessibilityRole="button"
    >
      {!appearance && isPrideFlagCard && (
        <Image
          source={require('../../assets/images/pride-flag.png')}
          style={[StyleSheet.absoluteFillObject as any, { opacity: 0.5 }]}
          contentFit="cover"
          pointerEvents="none"
        />
      )}
      {/* Top row: pill on left, share + heart icons in the top-right corner */}
      <View style={styles.topRow}>
        <View style={styles.featuredLabels}>
          <View
            style={[
              styles.featuredPill,
              isBirthdayParty && { backgroundColor: Colors.birthdayPinkTint15 },
              isSpecialEvent && { backgroundColor: Colors.specialEventMaroon },
            ]}
          >
            {appearance && isPrideFlagCard && <Image source={require('../../assets/images/pride-flag.png')} style={styles.prideAccent} contentFit="cover" pointerEvents="none" />}
            <Text
              style={[
                styles.featuredPillText,
                isBirthdayParty && { color: appearance ? AfterglowColors.ink : Colors.birthdayPink },
                isSpecialEvent && { color: Colors.specialEventCream },
              ]}
            >
              {appearance
                ? isBirthdayParty ? 'Birthday party' : isSpecialEvent ? 'Special event' : 'WashedUp event'
                : isBirthdayParty ? 'birthday party' : isSpecialEvent ? 'special event' : 'washedup event'}
            </Text>
          </View>
          {ageLabel && (
            <View style={styles.agePill}>
              <Text style={styles.agePillText} accessibilityLabel={`Age range: ${ageLabel}`}>
                {ageLabel}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.topRowIcons}>
          <TouchableOpacity
            onPress={handleShare}
            style={appearance ? styles.iconAction : undefined}
            hitSlop={appearance ? undefined : { top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Share plan"
          >
            <Ionicons name="share-outline" size={18} color={appearance ? AfterglowColors.ink : Colors.asphalt} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleWishlist}
            style={appearance ? styles.iconAction : undefined}
            hitSlop={appearance ? undefined : { top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            disabled={wishlistPending || wishlistDisabled}
            accessibilityState={{ selected: isWishlisted, disabled: wishlistPending || wishlistDisabled, busy: wishlistPending }}
            accessibilityLabel={isWishlisted ? 'Remove from saved' : 'Save plan'}
          >
            {wishlistPending ? <ActivityIndicator size="small" color={appearance ? AfterglowColors.clay : Colors.terracotta} /> : <Ionicons
              name={isWishlisted ? 'bookmark' : 'bookmark-outline'}
              size={18}
              color={appearance ? isWishlisted ? AfterglowColors.clay : AfterglowColors.ink : isWishlisted ? Colors.terracotta : Colors.asphalt}
            />}
          </TouchableOpacity>
        </View>
      </View>

      {/* Birthday party subtitle — small italic line of context between
          the pink tag and the poster name. Only renders for birthday party. */}
      {!appearance && isBirthdayParty && (
        <Text style={styles.birthdaySubtitle}>celebrating our OG washedup users</Text>
      )}

      {!appearance && creatorRow}

      {/* Title */}
      <Text style={styles.title} numberOfLines={appearance ? undefined : 2}>{plan.title}</Text>
      {appearance && isBirthdayParty && <Text style={styles.birthdaySubtitle}>Celebrating our original WashedUp users</Text>}

      {/* Creator note */}
      {creatorNote && (
        <Text style={styles.creatorNote} numberOfLines={appearance ? undefined : 2}>{creatorNote}</Text>
      )}

      {/* Logistics */}
      <View style={styles.logistics}>
        {!!plan.start_time && (
          <View style={styles.logisticsLine}>
            <Ionicons name="calendar-outline" size={appearance ? 16 : 13} color={appearance ? AfterglowColors.clay : Colors.textLight} />
            <Text style={styles.logisticsText}>{formatDateTimeForCard(plan.start_time)}</Text>
          </View>
        )}
        {locationDisplay && (
          <View style={styles.logisticsLine}>
            <Ionicons name="location-outline" size={appearance ? 16 : 13} color={appearance ? AfterglowColors.clay : Colors.textLight} />
            <Text style={styles.logisticsText} numberOfLines={appearance ? undefined : 1}>{locationDisplay}</Text>
          </View>
        )}
      </View>

      {appearance && creatorRow}

      {/* Bottom row: avatar stack + CTA */}
      <View style={styles.bottomRow}>
        {isClosed ? <Text style={styles.creatorMeta}>{closedLabel}</Text> : attendees.length > 0 ? (
          <View style={styles.avatarStack}>
            {attendees.slice(0, 5).map((a, i) => (
              a.profile_photo_url ? (
                <Image
                  key={i}
                  source={{ uri: a.profile_photo_url }}
                  style={[
                    styles.stackAvatar,
                    { marginLeft: i === 0 ? 0 : -AVATAR_OVERLAP },
                    { zIndex: 10 - i },
                  ]}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View
                  key={i}
                  style={[
                    styles.stackAvatarPlaceholder,
                    { marginLeft: i === 0 ? 0 : -AVATAR_OVERLAP },
                    { zIndex: 10 - i },
                  ]}
                >
                  <Ionicons name="person" size={12} color={appearance ? AfterglowColors.muted : Colors.textLight} />
                </View>
              )
            ))}
            {attendees.length > 5 && (
              <View style={[styles.stackAvatarPlaceholder, { marginLeft: -AVATAR_OVERLAP, zIndex: 4 }]}>
                <Text style={styles.moreCount}>+{attendees.length - 5}</Text>
              </View>
            )}
          </View>
        ) : (
          <View />
        )}
        <TouchableOpacity
          style={[styles.ctaButton, !isClosed && isMember && styles.ctaButtonJoined]}
          onPress={handlePress}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={isClosed ? `${closedLabel}, view plan` : isMember ? 'Going, view plan' : "Let's Go, view plan"}
        >
          <Text style={[styles.ctaButtonText, !isClosed && isMember && styles.ctaButtonJoinedText]} numberOfLines={1}>
            {isClosed ? "View plan \u2192" : isMember ? "Going \u2713" : "Let's Go \u2192"}
          </Text>
        </TouchableOpacity>
      </View>
    {cardAlert && (
      <BrandedAlert
        appearance={appearance}
        visible
        title={cardAlert.title}
        message={cardAlert.message}
        buttons={cardAlert.buttons}
        onClose={() => setCardAlert(null)}
      />
    )}
    </TouchableOpacity>
  );
});

FeaturedEventCard.displayName = 'FeaturedEventCard';

const baseStyles = StyleSheet.create({
  creatorIdentity: { flex: 1, minWidth: 0 },
  creatorMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.textLight },
  iconAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  prideAccent: { width: 24, height: 16, borderRadius: 2 },
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.goldenAmber,
    padding: 16,
    width: 300,
    overflow: 'hidden',
  },
  cardSolo: {
    width: '100%' as any,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  topRowIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  featuredLabels: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginRight: 8,
  },
  agePill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    backgroundColor: CreatorSurfaceColors.goldLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    minHeight: 24,
    justifyContent: 'center',
  },
  agePillText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.darkWarm,
    flexShrink: 1,
  },
  featuredPill: {
    alignSelf: 'flex-start',
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
  birthdaySubtitle: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    marginTop: -4,
    marginBottom: 8,
  },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  creatorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  creatorAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  creatorAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorName: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
    flex: 1,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 20,
    lineHeight: 26,
    color: Colors.asphalt,
    marginBottom: 4,
  },
  creatorNote: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    marginBottom: 8,
  },
  logistics: {
    gap: 4,
    marginBottom: 12,
  },
  logisticsLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logisticsText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textLight,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 12,
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stackAvatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 2,
    borderColor: Colors.cardBg,
  },
  stackAvatarPlaceholder: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 2,
    borderColor: Colors.cardBg,
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreCount: {
    fontFamily: Fonts.sansMedium,
    fontSize: 9,
    color: Colors.warmGray,
  },
  ctaButton: {
    backgroundColor: Colors.terracotta,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'transparent', // keeps geometry stable vs. the joined state's gold border
  },
  ctaButtonJoined: {
    backgroundColor: Colors.goingConfirmedFill, // gold affirmation: confirmed "Going" (warm success, NOT green)
    borderColor: Colors.gold, // crisper #C5A55A hairline; goldAccent was too pale against the 28% fill
  },
  ctaButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.white,
  },
  ctaButtonJoinedText: {
    color: Colors.brandDeep, // deep-brand label reads warm on the light gold fill (no gold text)
  },
});

function featuredAppearance(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  card: { ...baseStyles.card, borderRadius: 16, backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line },
  topRow: { ...baseStyles.topRow, gap: 8, marginTop: -6, marginRight: -6, marginBottom: 8 },
  topRowIcons: { ...baseStyles.topRowIcons, gap: 0, flexShrink: 0 },
  featuredPill: { ...baseStyles.featuredPill, flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, paddingHorizontal: 8, borderRadius: 4 },
  agePillText: { ...baseStyles.agePillText, fontFamily: fonts.medium, color: AfterglowColors.ink },
  featuredPillText: { ...AfterglowType.caption, fontFamily: fonts.medium, color: AfterglowColors.ink, flexShrink: 1 },
  title: { fontSize: FontSizes.displaySM, lineHeight: LineHeights.displaySM, fontFamily: fonts.semibold, color: AfterglowColors.ink, marginBottom: 8 },
  birthdaySubtitle: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, marginBottom: 8 },
  creatorNote: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, borderLeftWidth: 2, borderLeftColor: Colors.goldAccent, paddingLeft: 10, marginBottom: 12 },
  logistics: { ...baseStyles.logistics, gap: 4 },
  logisticsLine: { ...baseStyles.logisticsLine, alignItems: 'flex-start', gap: 8 },
  logisticsText: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, flex: 1, minWidth: 0 },
  creatorRow: { ...baseStyles.creatorRow, marginBottom: 12, minHeight: 40 },
  creatorName: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.ink },
  creatorMeta: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted },
  creatorAvatar: { width: 36, height: 36, borderRadius: 18 },
  creatorAvatarPlaceholder: { ...baseStyles.creatorAvatarPlaceholder, width: 36, height: 36, borderRadius: 18, backgroundColor: AfterglowColors.avatar },
  bottomRow: { ...baseStyles.bottomRow, flexWrap: 'wrap', gap: 12, borderTopColor: AfterglowColors.subtleLine },
  stackAvatar: { ...baseStyles.stackAvatar, borderColor: AfterglowColors.white },
  stackAvatarPlaceholder: { ...baseStyles.stackAvatarPlaceholder, borderColor: AfterglowColors.white, backgroundColor: AfterglowColors.avatar },
  moreCount: { ...AfterglowType.timestamp, fontFamily: fonts.medium, color: AfterglowColors.muted },
  ctaButton: { ...baseStyles.ctaButton, minHeight: 44, borderRadius: 4, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', marginLeft: 'auto', backgroundColor: AfterglowColors.clay },
  ctaButtonText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.white },
  ctaButtonJoined: { ...baseStyles.ctaButtonJoined },
  ctaButtonJoinedText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: Colors.brandDeep },
}); }
