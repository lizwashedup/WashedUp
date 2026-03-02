import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Share,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Colors from '../../constants/Colors';
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
    host: {
      first_name_display: string;
      profile_photo_url: string | null;
      member_since?: string;
      plans_hosted?: number;
    };
    attendees: { profile_photo_url: string | null }[];
  };
  isMember?: boolean;
}

export const PlanCard = React.memo<PlanCardProps>(({ plan, isMember = false }) => {
  const router = useRouter();

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/plan/${plan.id}`);
  }, [plan.id, router]);

  const handleShare = useCallback((e: any) => {
    e.stopPropagation();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Share.share({
      message: `Check out "${plan.title}" on WashedUp!\nhttps://washedup.app/e/${plan.id}`,
      title: 'Share plan',
    }).catch(() => {});
  }, [plan.id, plan.title]);

  const spotsLeft = plan.max_invites - plan.member_count;
  const oneSpotLeft = spotsLeft === 1;
  const spotsText = spotsLeft > 0 ? `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left` : null;

  const hostLine2 = [
    plan.host.member_since && `Member since ${plan.host.member_since}`,
    plan.host.plans_hosted != null && `${plan.host.plans_hosted} plans hosted`,
  ]
    .filter(Boolean)
    .join(' • ') || 'Member since Jan 2025 • 4 plans hosted';

  const hostLine1 = plan.location_text
    ? `${plan.host.first_name_display} hosting in ${plan.location_text}`
    : `${plan.host.first_name_display} hosting`;

  const hostNote = plan.host_message
    ? `"${plan.host_message}"`
    : null;

  const goingText = `${plan.member_count} going`;
  const spotsTextFull = spotsText ? `${goingText} • ${spotsText}` : goingText;

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.92}
      style={styles.card}
      accessibilityLabel={`${plan.title} plan`}
      accessibilityRole="button"
    >
      {/* A. Host Info Block */}
      <View style={styles.hostRow}>
        <View style={styles.hostLeft}>
          {plan.host.profile_photo_url ? (
            <Image
              source={{ uri: plan.host.profile_photo_url }}
              style={styles.hostAvatar}
              contentFit="cover"
            />
          ) : (
            <View style={styles.hostAvatarPlaceholder}>
              <Ionicons name="person-outline" size={24} color={Colors.textLight} />
            </View>
          )}
          <View style={styles.hostDetails}>
            <Text style={styles.hostLine1} numberOfLines={1}>
              {hostLine1}
            </Text>
            <Text style={styles.hostLine2} numberOfLines={1}>
              {hostLine2}
            </Text>
          </View>
        </View>
        <View style={styles.badgesRow}>
          {oneSpotLeft && (
            <View style={styles.spotsBadge}>
              <Text style={styles.spotsBadgeText}>1 spot left</Text>
            </View>
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

      {/* C. Host's Note */}
      {hostNote && (
        <Text style={styles.hostNote} numberOfLines={2}>
          {hostNote}
        </Text>
      )}

      {/* D. Logistics & CTA */}
      <View style={styles.bottomRow}>
        <View style={styles.avatarPile}>
          {plan.attendees.slice(0, 4).map((a, i) =>
            a.profile_photo_url ? (
              <Image
                key={i}
                source={{ uri: a.profile_photo_url }}
                style={[styles.attendeeAvatar, { marginLeft: i > 0 ? -8 : 0 }]}
                contentFit="cover"
              />
            ) : (
              <View
                key={i}
                style={[styles.attendeeAvatar, styles.attendeeAvatarPlaceholder, { marginLeft: i > 0 ? -8 : 0 }]}
              >
                <Ionicons name="person-outline" size={12} color={Colors.textLight} />
              </View>
            ),
          )}
        </View>
        <Text style={styles.spotsText}>{spotsTextFull}</Text>
        <View style={styles.ctaSpacer} />
        <TouchableOpacity
          style={[styles.ctaButton, isMember && styles.ctaButtonJoined]}
          onPress={handlePress}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaButtonText}>
            {isMember ? "Going ✓" : "Let's Go →"}
          </Text>
        </TouchableOpacity>
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
  hostRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  hostLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  hostAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  hostAvatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostDetails: {
    marginLeft: 12,
    flex: 1,
    minWidth: 0,
  },
  hostLine1: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    marginBottom: 2,
  },
  hostLine2: {
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
  hostNote: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    lineHeight: 20,
    marginBottom: 16,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatarPile: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  attendeeAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.cardBg,
  },
  attendeeAvatarPlaceholder: {
    backgroundColor: Colors.white,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
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
    backgroundColor: Colors.asphalt,
  },
  ctaButtonText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
});
