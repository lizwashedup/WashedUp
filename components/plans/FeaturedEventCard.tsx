import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
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
import { Fonts, FontSizes } from '../../constants/Typography';

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
    is_featured?: boolean;
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
      Alert.alert('', '', [
        { text: 'Report this plan', onPress: () => onReport?.(plan.id) },
        { text: `Block ${creatorName}`, style: 'destructive', onPress: () => onBlock?.(plan.id) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [plan.id, plan.creator?.first_name_display, onReport, onBlock]);

  const handleWishlist = useCallback((e: any) => {
    e?.stopPropagation?.();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onWishlist?.(plan.id, isWishlisted);
  }, [plan.id, isWishlisted, onWishlist]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/plan/${plan.id}`);
  }, [plan.id, router]);

  const locationDisplay = plan.location_text && !plan.location_text.startsWith('http')
    ? plan.location_text
    : null;

  const creatorNote = plan.host_message ? `\u201C${plan.host_message}\u201D` : null;
  const attendees = plan.attendees ?? [];

  return (
    <TouchableOpacity
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={500}
      activeOpacity={0.92}
      style={[styles.card, solo && styles.cardSolo]}
      accessibilityLabel={`${plan.title} WashedUp Event`}
      accessibilityRole="button"
    >
      {/* WashedUp Event pill */}
      <View style={styles.featuredPill}>
        <Text style={styles.featuredPillText}>washedup event</Text>
      </View>

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
        <View style={styles.headerIcons}>
          <TouchableOpacity onPress={handleWishlist} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Heart
              size={18}
              color={isWishlisted ? Colors.errorRed : Colors.warmGray}
              fill={isWishlisted ? Colors.errorRed : 'transparent'}
              strokeWidth={2}
            />
          </TouchableOpacity>
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
  featuredPill: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.goldenAmberTint15,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 10,
  },
  featuredPillText: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: Colors.goldenAmber,
    letterSpacing: 0.2,
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
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
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
