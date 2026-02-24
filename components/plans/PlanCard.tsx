// ─────────────────────────────────────────────────────────────────────────────
// FILE: components/plans/PlanCard.tsx
// INSTRUCTIONS: Create this folder if it doesn't exist, then create this file
// and paste everything below into it.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Heart, MapPin, Calendar, Users } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Card width for carousel (full width minus padding for peek effect)
const CARD_WIDTH = SCREEN_WIDTH - 48;

interface PlanCardProps {
  plan: {
    id: string;
    title: string;
    start_time: string;
    location_text: string | null;
    image_url: string | null;
    category: string | null;
    gender_preference: string | null;
    max_invites: number | null;
    min_invites: number | null;
    primary_vibe: string | null;
    host: {
      id: string;
      first_name: string | null;
      avatar_url: string | null;
    } | null;
    member_count: number;
  };
  isWishlisted?: boolean;
  onWishlist?: (planId: string, currentState: boolean) => void;
  variant?: 'carousel' | 'full'; // carousel = fixed width for horizontal scroll, full = full width for vertical list
}

const CATEGORY_COLORS: Record<string, string> = {
  music: '#7C5CBF',
  film: '#5C7CBF',
  nightlife: '#BF5C7C',
  food: '#BF7C5C',
  outdoors: '#5CBF7C',
  fitness: '#5CBFBF',
  art: '#BF5CBF',
  comedy: '#C4652A',
  sports: '#5C7CBF',
  wellness: '#5CBF9C',
  default: '#C4652A',
};

function getCategoryColor(category: string | null): string {
  if (!category) return CATEGORY_COLORS.default;
  return CATEGORY_COLORS[category.toLowerCase()] ?? CATEGORY_COLORS.default;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart.getTime() + 86400000);
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (dateStart.getTime() === todayStart.getTime()) {
    return `Tonight · ${timeStr}`;
  }
  if (dateStart.getTime() === tomorrowStart.getTime()) {
    return `Tomorrow · ${timeStr}`;
  }

  const dayStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${dayStr} · ${timeStr}`;
}

function formatGender(gender: string | null): string | null {
  if (!gender || gender === 'mixed') return null;
  if (gender === 'women_only') return 'Women Only';
  if (gender === 'men_only') return 'Men Only';
  return null;
}

export const PlanCard = React.memo<PlanCardProps>(({
  plan,
  isWishlisted = false,
  onWishlist,
  variant = 'carousel',
}) => {
  const router = useRouter();

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/plan/${plan.id}`);
  }, [plan.id, router]);

  const handleWishlist = useCallback((e: any) => {
    e.stopPropagation();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onWishlist?.(plan.id, isWishlisted);
  }, [plan.id, isWishlisted, onWishlist]);

  const spotsLeft = plan.max_invites ? plan.max_invites - plan.member_count : null;
  const genderLabel = formatGender(plan.gender_preference);
  const categoryColor = getCategoryColor(plan.category);
  const cardWidth = variant === 'carousel' ? CARD_WIDTH : '100%';

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.92}
      style={[styles.card, { width: cardWidth as any }]}
      accessibilityLabel={`${plan.title} plan`}
      accessibilityRole="button"
    >
      {/* Cover Image */}
      <View style={styles.imageContainer}>
        {plan.image_url ? (
          <Image
            source={{ uri: plan.image_url }}
            style={styles.image}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View style={[styles.imagePlaceholder, { backgroundColor: categoryColor + '20' }]}>
            <Text style={[styles.placeholderEmoji]}>
              {getCategoryEmoji(plan.category)}
            </Text>
          </View>
        )}

        {/* Wishlist Heart */}
        <TouchableOpacity
          onPress={handleWishlist}
          style={styles.heartButton}
          accessibilityLabel={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
          accessibilityHint="Double tap to toggle wishlist"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Heart
            size={20}
            color={isWishlisted ? '#E53935' : '#FFFFFF'}
            fill={isWishlisted ? '#E53935' : 'transparent'}
            strokeWidth={2}
          />
        </TouchableOpacity>

        {/* Category Badge */}
        {plan.category && (
          <View style={[styles.categoryBadge, { backgroundColor: categoryColor }]}>
            <Text style={styles.categoryText}>{plan.category}</Text>
          </View>
        )}
      </View>

      {/* Card Content */}
      <View style={styles.content}>
        {/* Title */}
        <Text style={styles.title} numberOfLines={2}>
          {plan.title}
        </Text>

        {/* Date & Location */}
        <View style={styles.metaRow}>
          <Calendar size={13} color="#999999" strokeWidth={2} />
          <Text style={styles.metaText} numberOfLines={1}>
            {formatDate(plan.start_time)}
          </Text>
        </View>

        {plan.location_text && (
          <View style={styles.metaRow}>
            <MapPin size={13} color="#999999" strokeWidth={2} />
            <Text style={styles.metaText} numberOfLines={1}>
              {plan.location_text}
            </Text>
          </View>
        )}

        {/* Footer Row */}
        <View style={styles.footer}>
          {/* Host info */}
          <View style={styles.hostRow}>
            {plan.host?.avatar_url ? (
              <Image
                source={{ uri: plan.host.avatar_url }}
                style={styles.avatar}
                contentFit="cover"
              />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarInitial}>
                  {plan.host?.first_name?.[0]?.toUpperCase() ?? '?'}
                </Text>
              </View>
            )}
            <Text style={styles.hostName} numberOfLines={1}>
              {plan.host?.first_name ?? 'Someone'}
            </Text>
          </View>

          {/* Right side: spots + gender */}
          <View style={styles.rightBadges}>
            {genderLabel && (
              <View style={styles.genderBadge}>
                <Text style={styles.genderText}>{genderLabel}</Text>
              </View>
            )}
            <View style={[
              styles.spotsBadge,
              spotsLeft === 0 && styles.spotsBadgeFull,
            ]}>
              <Users size={11} color={spotsLeft === 0 ? '#999999' : '#C4652A'} strokeWidth={2} />
              <Text style={[
                styles.spotsText,
                spotsLeft === 0 && styles.spotsTextFull,
              ]}>
                {plan.member_count}
                {plan.max_invites ? `/${plan.max_invites}` : ''} going
              </Text>
            </View>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
});

PlanCard.displayName = 'PlanCard';

function getCategoryEmoji(category: string | null): string {
  const map: Record<string, string> = {
    food: '🍜', music: '🎵', nightlife: '🌙', outdoors: '🌿',
    fitness: '💪', film: '🎬', art: '🎨', comedy: '😂',
    sports: '⚽', wellness: '🧘',
  };
  return category ? (map[category.toLowerCase()] ?? '✨') : '✨';
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    marginRight: 12,
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 16 / 9,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderEmoji: {
    fontSize: 40,
  },
  heartButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryBadge: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  categoryText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  content: {
    padding: 14,
    gap: 6,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A1A',
    lineHeight: 22,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    fontSize: 13,
    color: '#666666',
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  avatarPlaceholder: {
    backgroundColor: '#F0E6D3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 11,
    fontWeight: '700',
    color: '#C4652A',
  },
  hostName: {
    fontSize: 13,
    color: '#666666',
    flex: 1,
  },
  rightBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  genderBadge: {
    backgroundColor: '#FFF0E8',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  genderText: {
    fontSize: 11,
    color: '#C4652A',
    fontWeight: '600',
  },
  spotsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFF0E8',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  spotsBadgeFull: {
    backgroundColor: '#F5F5F5',
  },
  spotsText: {
    fontSize: 11,
    color: '#C4652A',
    fontWeight: '600',
  },
  spotsTextFull: {
    color: '#999999',
  },
});
