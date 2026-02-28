import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Heart, Calendar } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 48;

interface PlanCardProps {
  plan: {
    id: string;
    title: string;
    start_time: string;
    location_text: string | null;
    image_url: string | null;
    category: string | null;
    gender_rule: string | null;
    max_invites: number | null;
    min_invites: number | null;
    member_count: number;
    status: string;
    host_message: string | null;
    host: {
      id: string;
      first_name: string | null;
      avatar_url: string | null;
    } | null;
  };
  isWishlisted?: boolean;
  isMember?: boolean;
  onWishlist?: (planId: string, currentState: boolean) => void;
  variant?: 'carousel' | 'full';
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

function formatCategoryLabel(category: string | null): string {
  if (!category) return 'Plan';
  return category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();
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

  if (dateStart.getTime() === todayStart.getTime()) return `Tonight · ${timeStr}`;
  if (dateStart.getTime() === tomorrowStart.getTime()) return `Tomorrow · ${timeStr}`;

  const dayStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${dayStr} · ${timeStr}`;
}

export const PlanCard = React.memo<PlanCardProps>(({
  plan,
  isWishlisted = false,
  isMember = false,
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
  const isFull = plan.status === 'full' || (spotsLeft !== null && spotsLeft <= 0);
  const oneSpotLeft = !isFull && spotsLeft === 1;

  const categoryColor = getCategoryColor(plan.category);
  const cardWidth = variant === 'carousel' ? CARD_WIDTH : '100%';

  const metaText = plan.location_text
    ? `${formatDate(plan.start_time)} · ${plan.location_text}`
    : formatDate(plan.start_time);

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.92}
      style={[
        styles.card,
        { width: cardWidth as any },
        variant === 'carousel' && styles.cardCarousel,
      ]}
      accessibilityLabel={`${plan.title} plan`}
      accessibilityRole="button"
    >
      <View style={styles.imageContainer}>
        {plan.image_url ? (
          <Image
            source={{ uri: plan.image_url }}
            style={styles.image}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View style={[styles.imagePlaceholder, { backgroundColor: '#F0E6D3' }]}>
            <Ionicons name="calendar-outline" size={32} color="#C4652A" />
            <Text style={styles.placeholderLabel}>
              {plan.category ?? 'Plan'}
            </Text>
          </View>
        )}

        {/* Top-left: status badge — Full or 1 spot left */}
        {isFull ? (
          <View style={[styles.statusBadge, styles.statusBadgeFull]}>
            <Text style={styles.statusBadgeText}>
              {plan.member_count > 0 ? `${plan.member_count} going · Full` : 'Full'}
            </Text>
          </View>
        ) : oneSpotLeft ? (
          <View style={[styles.statusBadge, styles.statusBadgeOneLeft]}>
            <Text style={styles.statusBadgeText}>1 spot left</Text>
          </View>
        ) : null}

        {/* Heart — top right */}
        <TouchableOpacity
          onPress={handleWishlist}
          style={styles.heartButton}
          accessibilityLabel={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Heart
            size={18}
            color={isWishlisted ? '#E53935' : '#1A1A1A'}
            fill={isWishlisted ? '#E53935' : 'transparent'}
            strokeWidth={2}
          />
        </TouchableOpacity>
      </View>

      {/* Content below image — directly on page background */}
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={2}>
          {plan.title}
        </Text>

        <View style={styles.hostRow}>
          {plan.host && (plan.host.avatar_url ? (
            <Image
              source={{ uri: plan.host.avatar_url }}
              style={styles.hostAvatar}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.hostAvatar, styles.hostAvatarPlaceholder]}>
              <Text style={styles.hostAvatarInitial}>
                {plan.host.first_name?.[0]?.toUpperCase() ?? '?'}
              </Text>
            </View>
          ))}
          {plan.host?.first_name && (
            <Text style={styles.hostName} numberOfLines={1}>
              {plan.host.first_name}
            </Text>
          )}
          {plan.host?.first_name && plan.category && (
            <Text style={styles.separator}> · </Text>
          )}
          {plan.category && (
            <Text style={[styles.categoryText, { color: categoryColor }]}>
              {formatCategoryLabel(plan.category)}
            </Text>
          )}
          {isMember && (
            <View style={styles.goingBadge}>
              <View style={styles.goingDot} />
              <Text style={styles.goingText}>You're going</Text>
            </View>
          )}
        </View>

        <View style={styles.metaRow}>
          <Calendar size={12} color="#888888" strokeWidth={2} />
          <Text style={styles.metaText} numberOfLines={1}>
            {metaText}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
});

PlanCard.displayName = 'PlanCard';

const styles = StyleSheet.create({
  card: {
    marginBottom: 24,
  },
  cardCarousel: {
    marginRight: 12,
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: 14,
    overflow: 'hidden',
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
  placeholderLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#C4652A',
    marginTop: 8,
  },

  statusBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  statusBadgeFull: {
    backgroundColor: '#C4652A',
  },
  statusBadgeOneLeft: {
    backgroundColor: '#F59E0B',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  heartButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 3,
  },

  content: {
    paddingTop: 8,
    gap: 4,
  },
  title: {
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 18,
    color: '#1C1917',
    lineHeight: 23,
  },
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hostAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  hostAvatarPlaceholder: {
    backgroundColor: '#C4652A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostAvatarInitial: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  hostName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#44403C',
    maxWidth: 100,
  },
  separator: {
    fontSize: 13,
    color: '#CCCCCC',
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '600',
  },
  goingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  goingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4CAF50',
  },
  goingText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2E7D32',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    fontSize: 13,
    color: '#888888',
    flex: 1,
  },
});
