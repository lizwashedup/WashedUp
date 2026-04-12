import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActionSheetIOS,
  Platform,
  Share,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Heart } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { BrandedAlert, BrandedAlertButton } from '../BrandedAlert';
import { buildPlanShareContent } from '../../lib/sharePlan';

interface FeaturedEventCardProps {
  plan: {
    id: string;
    title: string;
    host_message: string | null;
    start_time: string;
    location_text: string | null;
    category: string | null;
    max_invites: number;
    member_count: number;
    slug?: string | null;
    is_featured?: boolean;
    featured_type?: 'washedup_event' | 'birthday_party' | null;
    creator: {
      first_name_display: string;
      profile_photo_url: string | null;
      plans_posted?: number;
    };
    attendees?: { profile_photo_url: string | null }[];
  };
  isMember?: boolean;
  isWishlisted?: boolean;
  onWishlist?: (planId: string, current: boolean) => void;
  onReport?: (planId: string) => void;
  onBlock?: (planId: string) => void;
  solo?: boolean;
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

const AVATAR_SIZE = 28;
const AVATAR_OVERLAP = 8;

export const FeaturedEventCard = React.memo<FeaturedEventCardProps>(({
  plan, isMember = false, isWishlisted = false, onWishlist, onReport, onBlock, solo = false,
}) => {
  const router = useRouter();
  const [cardAlert, setCardAlert] = useState<{ title: string; message: string; buttons?: BrandedAlertButton[] } | null>(null);

  const handleLongPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onWishlist?.(plan.id, isWishlisted);
  }, [plan.id, isWishlisted, onWishlist]);

  const handleShare = useCallback((e: any) => {
    e?.stopPropagation?.();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const share = buildPlanShareContent({
      id: plan.id,
      title: plan.title,
      start_time: plan.start_time,
      location_text: plan.location_text,
      slug: plan.slug ?? null,
      member_count: plan.member_count,
      max_invites: plan.max_invites,
    });
    Share.share({ message: share.message, url: share.url });
  }, [plan.id, plan.title, plan.start_time, plan.location_text, plan.slug, plan.member_count, plan.max_invites]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/plan/${plan.id}`);
  }, [plan.id, router]);

  const locationDisplay = plan.location_text && !plan.location_text.startsWith('http')
    ? plan.location_text
    : null;

  const creatorNote = plan.host_message ? `\u201C${plan.host_message}\u201D` : null;
  const attendees = plan.attendees ?? [];
  const isBirthdayParty = plan.featured_type === 'birthday_party';

  return (
    <TouchableOpacity
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={500}
      activeOpacity={0.92}
      style={[
        styles.card,
        solo && styles.cardSolo,
        isBirthdayParty && { borderColor: Colors.birthdayPink },
      ]}
      accessibilityLabel={`${plan.title} ${isBirthdayParty ? 'Birthday Party' : 'WashedUp Event'}`}
      accessibilityRole="button"
    >
      {/* Top row: pill on left, share + heart icons in the top-right corner */}
      <View style={styles.topRow}>
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
        <View style={styles.topRowIcons}>
          <TouchableOpacity
            onPress={handleShare}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Share plan"
          >
            <Ionicons name="share-outline" size={18} color={Colors.asphalt} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleWishlist}
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
        </View>
      </View>

      {/* Birthday party subtitle — small italic line of context between
          the pink tag and the poster name. Only renders for birthday party. */}
      {isBirthdayParty && (
        <Text style={styles.birthdaySubtitle}>celebrating our OG washedup users</Text>
      )}

      {/* Creator Info */}
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
              <Ionicons name="person-outline" size={20} color={Colors.textLight} />
            </View>
          )}
          <Text style={styles.creatorName} numberOfLines={1}>
            {`Posted by ${plan.creator?.first_name_display ?? 'Creator'}`}
          </Text>
        </View>
      </View>

      {/* Title */}
      <Text style={styles.title} numberOfLines={2}>{plan.title}</Text>

      {/* Creator note */}
      {creatorNote && (
        <Text style={styles.creatorNote} numberOfLines={2}>{creatorNote}</Text>
      )}

      {/* Logistics */}
      <View style={styles.logistics}>
        {plan.start_time && (
          <View style={styles.logisticsLine}>
            <Ionicons name="calendar-outline" size={13} color={Colors.textLight} />
            <Text style={styles.logisticsText}>{formatDateTimeForCard(plan.start_time)}</Text>
          </View>
        )}
        {locationDisplay && (
          <View style={styles.logisticsLine}>
            <Ionicons name="location-outline" size={13} color={Colors.textLight} />
            <Text style={styles.logisticsText} numberOfLines={1}>{locationDisplay}</Text>
          </View>
        )}
      </View>

      {/* Bottom row: avatar stack + CTA */}
      <View style={styles.bottomRow}>
        {attendees.length > 0 ? (
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
                  <Ionicons name="person" size={12} color={Colors.textLight} />
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
          style={[styles.ctaButton, isMember && styles.ctaButtonJoined]}
          onPress={handlePress}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaButtonText}>
            {isMember ? "Going \u2713" : "Let's Go \u2192"}
          </Text>
        </TouchableOpacity>
      </View>
    {cardAlert && (
      <BrandedAlert
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

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.goldenAmber,
    padding: 16,
    width: 300,
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
    fontFamily: Fonts.displayItalic,
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
    fontStyle: 'italic',
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
  },
  ctaButtonJoined: {
    backgroundColor: Colors.successGreen,
  },
  ctaButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.white,
  },
});
