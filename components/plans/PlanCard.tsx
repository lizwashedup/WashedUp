import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
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
    host: {
      id: string;
      first_name: string | null;
      avatar_url: string | null;
    } | null;
  };
  isWishlisted?: boolean;
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

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.92}
      style={[styles.card, { width: cardWidth as any }]}
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
          <View style={[styles.imagePlaceholder, { backgroundColor: categoryColor + '26' }]}>
            <Text style={[styles.placeholderLabel, { color: categoryColor }]}>
              {formatCategoryLabel(plan.category)}
            </Text>
          </View>
        )}

        {/* Top-left: status badge — Full (orange) or 1 spot left (amber), nothing otherwise */}
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

        {/* Host avatar + name — bottom left, horizontal row */}
        <View style={styles.hostOverlay}>
          {plan.host?.avatar_url ? (
            <Image
              source={{ uri: plan.host.avatar_url }}
              style={styles.hostAvatar}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.hostAvatar, styles.hostAvatarPlaceholder]}>
              <Text style={styles.hostAvatarInitial}>
                {plan.host?.first_name?.[0]?.toUpperCase() ?? '?'}
              </Text>
            </View>
          )}
          {plan.host?.first_name && (
            <Text style={styles.hostName} numberOfLines={1}>
              {plan.host.first_name}
            </Text>
          )}
        </View>

        {/* Category badge — bottom right */}
        {plan.category && (
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryBadgeText}>{formatCategoryLabel(plan.category)}</Text>
          </View>
        )}
      </View>

      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={2}>
          {plan.title}
        </Text>

        {plan.location_text && (
          <Text style={styles.neighborhood} numberOfLines={1}>
            {plan.location_text}
          </Text>
        )}

        <View style={styles.dateRow}>
          <Calendar size={12} color="#999999" strokeWidth={2} />
          <Text style={styles.dateText} numberOfLines={1}>
            {formatDate(plan.start_time)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
});

PlanCard.displayName = 'PlanCard';

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
  placeholderLabel: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.3,
    opacity: 0.7,
  },

  // Status badges — top left
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

  // Heart — top right
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

  // Host overlay — bottom left, horizontal
  hostOverlay: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hostAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  hostAvatarPlaceholder: {
    backgroundColor: '#C4652A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostAvatarInitial: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  hostName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    maxWidth: 100,
  },

  // Category badge — bottom right
  categoryBadge: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  categoryBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#C4652A',
  },

  // Content below image
  content: {
    padding: 12,
    gap: 5,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A1A',
    lineHeight: 22,
  },
  neighborhood: {
    fontSize: 13,
    color: '#666666',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 1,
  },
  dateText: {
    fontSize: 13,
    color: '#999999',
  },
});
