import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  RefreshControl,
  Linking,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Heart, Calendar, MapPin, Map, LayoutList, ChevronDown } from 'lucide-react-native';
import { Ionicons } from '@expo/vector-icons';
import { MapView } from '../../../components/MapView.native';
import { supabase } from '../../../lib/supabase';
import { FilterBottomSheet } from '../../../components/FilterBottomSheet';
import { CATEGORY_OPTIONS } from '../../../constants/Categories';
import Colors from '../../../constants/Colors';
import { MAP_STYLE } from '../../../constants/MapStyle';
import { Fonts, FontSizes } from '../../../constants/Typography';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_IMAGE_HEIGHT = 220;

// ─── Types ────────────────────────────────────────────────────────────────────

interface SceneEvent {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  event_date: string | null;
  start_time: string | null;
  venue: string | null;
  venue_address: string | null;
  category: string | null;
  external_url: string | null;
  ticket_price: string | null;
  plans_count: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseLocalDate(dateStr: string): Date {
  return new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`);
}

function formatEventDate(dateStr: string | null, timeStr: string | null): string {
  if (!dateStr) return '';
  const date = parseLocalDate(dateStr);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  let dayLabel: string;
  if (date.toDateString() === today.toDateString()) dayLabel = 'Tonight';
  else if (date.toDateString() === tomorrow.toDateString()) dayLabel = 'Tomorrow';
  else dayLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  if (timeStr) {
    const [h, m] = timeStr.split(':');
    const d = new Date();
    d.setHours(parseInt(h, 10), parseInt(m, 10));
    const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${dayLabel} · ${t}`;
  }
  return dayLabel;
}

function formatVenueLocation(venueAddress: string | null): string {
  if (!venueAddress) return '';
  const parts = venueAddress.split(',').map((p) => p.trim());
  return parts[parts.length - 2] || parts[0] || venueAddress;
}

function getPriceLabel(ticketPrice: string | null): string {
  if (!ticketPrice || ticketPrice.toLowerCase() === 'free') return 'Free';
  return ticketPrice;
}

const LA_REGION = {
  latitude: 34.0522,
  longitude: -118.2437,
  latitudeDelta: 0.35,
  longitudeDelta: 0.35,
};

// ─── Data Fetching ────────────────────────────────────────────────────────────

async function fetchSceneEvents(): Promise<SceneEvent[]> {
  const { data: events, error } = await supabase
    .from('explore_events')
    .select('id, title, description, image_url, event_date, start_time, venue, venue_address, category, external_url, ticket_price')
    .eq('status', 'Live')
    .order('event_date', { ascending: true });

  if (error) throw error;
  if (!events || events.length === 0) return [];

  const eventIds = events.map((e: any) => e.id);
  const { data: planCounts } = await supabase
    .from('events')
    .select('explore_event_id')
    .in('explore_event_id', eventIds)
    .in('status', ['forming', 'active', 'full']);

  const countMap: Record<string, number> = {};
  (planCounts ?? []).forEach((p: any) => {
    if (p.explore_event_id) {
      countMap[p.explore_event_id] = (countMap[p.explore_event_id] || 0) + 1;
    }
  });

  return events.map((e: any) => ({
    ...e,
    plans_count: countMap[e.id] || 0,
  }));
}

async function fetchExploreWishlists(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('explore_wishlists')
    .select('explore_event_id')
    .eq('user_id', userId);
  if (error) return [];
  return (data ?? []).map((d: any) => d.explore_event_id);
}

// ─── SceneCard ───────────────────────────────────────────────────────────────

type SceneTab = 'events' | 'restaurants' | 'ideas';

const SceneCard = React.memo(function SceneCard({
  event,
  isWishlisted,
  onWishlist,
}: {
  event: SceneEvent;
  isWishlisted: boolean;
  onWishlist: (id: string, current: boolean) => void;
}) {
  const priceLabel = getPriceLabel(event.ticket_price);
  const dateTimeStr = formatEventDate(event.event_date, event.start_time);
  const locationStr = formatVenueLocation(event.venue_address) || event.venue || '';
  const isFree = !event.ticket_price || event.ticket_price.toLowerCase() === 'free';

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/event/${event.id}`);
  }, [event.id]);

  const handleCta = useCallback(
    (e: any) => {
      e.stopPropagation();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (event.external_url) {
        Linking.openURL(event.external_url);
      } else {
        router.push(`/event/${event.id}`);
      }
    },
    [event.external_url, event.id],
  );

  const handleWishlist = useCallback(
    (e: any) => {
      e.stopPropagation();
      onWishlist(event.id, isWishlisted);
    },
    [event.id, isWishlisted, onWishlist],
  );

  const handleShare = useCallback(
    (e: any) => {
      e.stopPropagation();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Share.share({
        message: `Check out ${event.title} in LA on WashedUp!\nhttps://washedup.app/e/${event.id}`,
      }).catch(() => {});
    },
    [event.title, event.id],
  );

  const handleSocialProof = useCallback(
    (e: any) => {
      e.stopPropagation();
      if (event.plans_count > 0) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push(`/event/${event.id}`);
      }
    },
    [event.id, event.plans_count],
  );

  return (
    <TouchableOpacity activeOpacity={0.95} style={cardStyles.card} onPress={handlePress}>
      {/* Image with overlay */}
      <View style={cardStyles.imageContainer}>
        <Image
          source={event.image_url ? { uri: event.image_url } : require('../../../assets/images/plan-placeholder.png')}
          style={cardStyles.image}
          contentFit="cover"
        />
        <View style={cardStyles.imageOverlay} />

        {/* Top right: Price badge + Share + Heart */}
        <View style={cardStyles.topRightActions}>
          <View style={cardStyles.priceBadge}>
            <Text style={cardStyles.priceBadgeText}>{priceLabel}</Text>
          </View>
          <TouchableOpacity style={cardStyles.iconButton} onPress={handleShare} hitSlop={10}>
            <Ionicons name="share-outline" size={18} color={Colors.white} />
          </TouchableOpacity>
          <TouchableOpacity style={cardStyles.iconButton} onPress={handleWishlist} hitSlop={10}>
            <Heart
              size={18}
              color={isWishlisted ? Colors.errorRed : Colors.white}
              fill={isWishlisted ? Colors.errorRed : 'transparent'}
              strokeWidth={2}
            />
          </TouchableOpacity>
        </View>

        {/* Venue badge — bottom left */}
        {event.venue && (
          <View style={cardStyles.venueBadge}>
            <Text style={cardStyles.venueBadgeText} numberOfLines={1}>
              {event.venue}
            </Text>
          </View>
        )}
      </View>

      {/* Content below image */}
      <View style={cardStyles.content}>
        <Text style={cardStyles.eventTitle} numberOfLines={2}>
          {event.title}
        </Text>

        {(dateTimeStr || locationStr) && (
          <View style={cardStyles.metaRow}>
            {dateTimeStr ? (
              <View style={cardStyles.metaItem}>
                <Calendar size={14} color={Colors.textMedium} strokeWidth={2} />
                <Text style={cardStyles.metaText}>{dateTimeStr}</Text>
              </View>
            ) : null}
            {locationStr ? (
              <View style={[cardStyles.metaItem, dateTimeStr && { marginLeft: 12 }]}>
                <MapPin size={14} color={Colors.textMedium} strokeWidth={2} />
                <Text style={cardStyles.metaText} numberOfLines={1}>
                  {locationStr}
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Social proof */}
        {event.plans_count > 0 && (
          <TouchableOpacity style={cardStyles.socialProofRow} onPress={handleSocialProof} activeOpacity={0.8}>
            <View style={cardStyles.avatarPile}>
              {[1, 2, 3].slice(0, Math.min(3, event.plans_count)).map((i) => (
                <View key={i} style={[cardStyles.avatarPlaceholder, { marginLeft: i > 1 ? -8 : 0 }]}>
                  <Ionicons name="people" size={12} color={Colors.terracotta} />
                </View>
              ))}
            </View>
            <Text style={cardStyles.socialProofText}>
              {event.plans_count} WashedUp {event.plans_count === 1 ? 'group' : 'groups'} going
            </Text>
            <Text style={cardStyles.socialProofLink}>Find others →</Text>
          </TouchableOpacity>
        )}

        {/* Category & CTA row */}
        <View style={cardStyles.ctaRow}>
          {event.category && (
            <View style={cardStyles.categoryTag}>
              <Text style={cardStyles.categoryTagText}>{event.category}</Text>
            </View>
          )}
          <TouchableOpacity
            style={[cardStyles.ctaButton, isFree && cardStyles.ctaButtonFree]}
            onPress={handleCta}
            activeOpacity={0.9}
          >
            <Text style={cardStyles.ctaButtonText}>
              {isFree ? 'RSVP Free ↗' : 'Get Tickets ↗'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
});

const cardStyles = StyleSheet.create({
  card: { marginBottom: 24 },
  imageContainer: {
    width: '100%',
    height: CARD_IMAGE_HEIGHT,
    borderRadius: 20,
    overflow: 'hidden',
    position: 'relative',
  },
  image: { width: '100%', height: '100%' },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  priceBadge: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  priceBadgeText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.white,
  },
  venueBadge: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    maxWidth: SCREEN_WIDTH * 0.5,
  },
  venueBadgeText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.white,
  },
  topRightActions: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    gap: 8,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { paddingTop: 14, paddingHorizontal: 2 },
  eventTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    lineHeight: 28,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
  },
  socialProofRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 12,
    gap: 8,
  },
  avatarPile: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarPlaceholder: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialProofText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
    flex: 1,
  },
  socialProofLink: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  categoryTag: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  categoryTagText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
  },
  ctaButton: {
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
  },
  ctaButtonFree: {
    backgroundColor: Colors.asphalt,
  },
  ctaButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

type WhenKey = 'today' | 'tomorrow' | 'this_weekend' | 'next_week';

const WHEN_OPTIONS: { key: WhenKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'this_weekend', label: 'This Weekend' },
  { key: 'next_week', label: 'Next Week' },
];

const CATEGORY_CHIPS = ['This Weekend', ...CATEGORY_OPTIONS];

function matchesWhenFilter(eventDate: string | null, filters: WhenKey[]): boolean {
  if (!eventDate) return false;
  const d = parseLocalDate(eventDate);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const tomorrowEnd = new Date(todayEnd);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

  const dayOfWeek = now.getDay();
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  const friday = new Date(todayStart);
  friday.setDate(friday.getDate() + (daysUntilFriday === 0 && dayOfWeek !== 5 ? 7 : daysUntilFriday));
  const sundayEnd = new Date(friday);
  sundayEnd.setDate(sundayEnd.getDate() + 3);

  const nextMonday = new Date(sundayEnd);
  const nextSundayEnd = new Date(nextMonday);
  nextSundayEnd.setDate(nextSundayEnd.getDate() + 7);

  for (const f of filters) {
    if (f === 'today' && d >= todayStart && d < todayEnd) return true;
    if (f === 'tomorrow' && d >= todayEnd && d < tomorrowEnd) return true;
    if (f === 'this_weekend' && d >= friday && d < sundayEnd) return true;
    if (f === 'next_week' && d >= nextMonday && d < nextSundayEnd) return true;
  }
  return false;
}

function matchesCategoryChip(event: SceneEvent, chip: string): boolean {
  if (chip === 'This Weekend') {
    return matchesWhenFilter(event.event_date, ['this_weekend']);
  }
  return event.category?.toLowerCase() === chip.toLowerCase();
}

export default function SceneScreen() {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SceneTab>('events');
  const [heartFilter, setHeartFilter] = useState(false);
  const [whenFilter, setWhenFilter] = useState<WhenKey[]>([]);
  const [whenSheetOpen, setWhenSheetOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [mapView, setMapView] = useState(false);

  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const { data: events = [], isLoading, refetch } = useQuery({
    queryKey: ['scene-events'],
    queryFn: fetchSceneEvents,
    staleTime: 5 * 60 * 1000,
  });

  const { data: wishlistedIds = [] } = useQuery({
    queryKey: ['explore-wishlists', userId],
    queryFn: () => fetchExploreWishlists(userId!),
    enabled: !!userId,
  });

  const wishlistedSet: Record<string, boolean> = {};
  wishlistedIds.forEach((id) => { wishlistedSet[id] = true; });

  const wishlistMutation = useMutation({
    mutationFn: async ({ exploreEventId, current }: { exploreEventId: string; current: boolean }) => {
      if (!userId) return;
      if (current) {
        await supabase.from('explore_wishlists').delete().eq('user_id', userId).eq('explore_event_id', exploreEventId);
      } else {
        await supabase.from('explore_wishlists').insert({ user_id: userId, explore_event_id: exploreEventId });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['explore-wishlists'] });
    },
  });

  const handleWishlist = useCallback((id: string, current: boolean) => {
    wishlistMutation.mutate({ exploreEventId: id, current });
  }, [wishlistMutation]);

  const filteredEvents = useMemo(() => {
    let result = events;
    if (heartFilter) {
      result = result.filter((e) => wishlistedSet[e.id]);
    }
    if (whenFilter.length > 0) {
      result = result.filter((e) => matchesWhenFilter(e.event_date, whenFilter));
    }
    if (categoryFilter.length > 0) {
      result = result.filter((e) =>
        e.category && categoryFilter.some((c) => c.toLowerCase() === e.category?.toLowerCase()),
      );
    }
    if (activeChip) {
      result = result.filter((e) => matchesCategoryChip(e, activeChip));
    }
    return result;
  }, [events, heartFilter, wishlistedSet, whenFilter, categoryFilter, activeChip]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const whenActive = whenFilter.length > 0;
  const whenLabel =
    whenFilter.length === 0
      ? 'When'
      : whenFilter.length === 1
        ? WHEN_OPTIONS.find((o) => o.key === whenFilter[0])?.label ?? 'When'
        : `When · ${whenFilter.length}`;

  const categoryActive = categoryFilter.length > 0;
  const categoryLabel =
    categoryFilter.length === 0
      ? 'Category'
      : categoryFilter.length === 1
        ? categoryFilter[0]
        : `Category · ${categoryFilter.length}`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          The <Text style={styles.headerTitleItalic}>Scene</Text>
        </Text>
      </View>

      {/* Filter Tabs: Events only (Restaurants & Ideas hidden until ready) */}
      <View style={styles.filterTabs}>
        {[{ key: 'events' as SceneTab, label: 'Events' }].map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.filterTab, activeTab === tab.key && styles.filterTabActive]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveTab(tab.key);
              if (tab.key !== 'events') setMapView(false);
            }}
          >
            <Text style={[styles.filterTabText, activeTab === tab.key && styles.filterTabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <>
        {/* Category Chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsScroll}
            style={styles.chipsScrollView}
          >
            {CATEGORY_CHIPS.map((chip) => (
              <TouchableOpacity
                key={chip}
                style={[styles.chip, activeChip === chip && styles.chipActive]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setActiveChip((prev) => (prev === chip ? null : chip));
                }}
              >
                <Text style={[styles.chipText, activeChip === chip && styles.chipTextActive]}>{chip}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Filter row (When, Category, Heart, Map) */}
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.dropdownPill, whenActive && styles.dropdownPillActive]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setWhenSheetOpen(true);
              }}
            >
              <Text style={[styles.dropdownText, whenActive && styles.dropdownTextActive]} numberOfLines={1}>
                {whenLabel}
              </Text>
              <ChevronDown size={13} color={whenActive ? Colors.white : Colors.asphalt} strokeWidth={2.5} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.dropdownPill, categoryActive && styles.dropdownPillActive]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setCategorySheetOpen(true);
              }}
            >
              <Text style={[styles.dropdownText, categoryActive && styles.dropdownTextActive]} numberOfLines={1}>
                {categoryLabel}
              </Text>
              <ChevronDown size={13} color={categoryActive ? Colors.white : Colors.asphalt} strokeWidth={2.5} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.heartFilterPill, heartFilter && styles.heartFilterPillActive]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setHeartFilter((v) => !v);
              }}
            >
              <Heart
                size={16}
                color={heartFilter ? Colors.white : Colors.asphalt}
                fill={heartFilter ? Colors.white : 'transparent'}
                strokeWidth={2}
              />
            </TouchableOpacity>

            <View style={{ flex: 1 }} />

            <TouchableOpacity
              style={[styles.mapTogglePill, mapView && styles.mapTogglePillActive]}
              onPress={() => {
                Haptics.selectionAsync();
                setMapView((v) => !v);
              }}
              accessibilityLabel={mapView ? 'Switch to list view' : 'Switch to map view'}
            >
              {mapView ? (
                <LayoutList size={14} color={Colors.white} strokeWidth={2} />
              ) : (
                <Map size={14} color={Colors.asphalt} strokeWidth={2} />
              )}
              <Text style={[styles.mapToggleLabel, mapView && styles.mapToggleLabelActive]}>
                {mapView ? 'List' : 'Map'}
              </Text>
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={Colors.terracotta} />
            </View>
          ) : mapView ? (
            <MapView
              style={{ flex: 1 }}
              initialRegion={LA_REGION}
              customMapStyle={MAP_STYLE}
              showsUserLocation
              showsMyLocationButton={false}
            />
          ) : filteredEvents.length === 0 ? (
            <View style={styles.centered}>
              {heartFilter ? (
                <>
                  <Heart size={40} color={Colors.terracotta} />
                  <Text style={styles.emptyTitle}>No hearted events</Text>
                  <Text style={styles.emptySubtitle}>Tap the heart on events you're interested in.</Text>
                </>
              ) : (
                <>
                  <Calendar size={40} color={Colors.terracotta} />
                  <Text style={styles.emptyTitle}>Nothing yet</Text>
                  <Text style={styles.emptySubtitle}>Check back soon — events are being added.</Text>
                </>
              )}
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.terracotta} />
              }
            >
              {filteredEvents.map((event) => (
                <SceneCard
                  key={event.id}
                  event={event}
                  isWishlisted={!!wishlistedSet[event.id]}
                  onWishlist={handleWishlist}
                />
              ))}

              <View style={styles.bottomCta}>
                <Text style={styles.bottomCtaText}>Want your event here?</Text>
                {/* Temporarily commented out until web page is live
                <TouchableOpacity onPress={() => Linking.openURL('https://washedup.app/list-your-event')}>
                  <Text style={styles.bottomCtaLink}>List your event</Text>
                </TouchableOpacity>
                */}
              </View>
            </ScrollView>
          )}
      </>

      <FilterBottomSheet
        visible={whenSheetOpen}
        title="When"
        options={WHEN_OPTIONS}
        selected={whenFilter}
        onToggle={(key) =>
          setWhenFilter((prev) =>
            prev.includes(key as WhenKey) ? prev.filter((k) => k !== key) : [...prev, key as WhenKey],
          )
        }
        onClose={() => setWhenSheetOpen(false)}
        onClear={() => setWhenFilter([])}
      />

      <FilterBottomSheet
        visible={categorySheetOpen}
        title="Category"
        options={CATEGORY_OPTIONS.map((c) => ({ key: c, label: c }))}
        selected={categoryFilter}
        onToggle={(key) =>
          setCategoryFilter((prev) =>
            prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key],
          )
        }
        onClose={() => setCategorySheetOpen(false)}
        onClear={() => setCategoryFilter([])}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
  },
  headerTitleItalic: {
    fontFamily: Fonts.displayItalic,
  },
  filterTabs: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 12,
    gap: 0,
    backgroundColor: Colors.border,
    marginHorizontal: 20,
    borderRadius: 24,
    padding: 4,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignItems: 'center',
  },
  filterTabActive: {
    backgroundColor: Colors.asphalt,
  },
  filterTabText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
  },
  filterTabTextActive: {
    color: Colors.white,
  },
  chipsScrollView: { maxHeight: 44 },
  chipsScroll: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 10,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: {
    backgroundColor: Colors.asphalt,
    borderColor: Colors.asphalt,
  },
  chipText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  chipTextActive: {
    color: Colors.white,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 20,
    alignItems: 'center',
  },
  heartFilterPill: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heartFilterPillActive: {
    backgroundColor: Colors.terracotta,
    borderColor: Colors.terracotta,
  },
  dropdownPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dropdownPillActive: {
    backgroundColor: Colors.terracotta,
    borderColor: Colors.terracotta,
  },
  dropdownText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  dropdownTextActive: {
    color: Colors.white,
  },
  mapTogglePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  mapTogglePillActive: {
    backgroundColor: Colors.asphalt,
    borderColor: Colors.asphalt,
  },
  mapToggleLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.micro,
    color: Colors.asphalt,
  },
  mapToggleLabelActive: {
    color: Colors.white,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displaySM,
    color: Colors.asphalt,
  },
  emptySubtitle: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    textAlign: 'center',
  },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48 },
  bottomCta: { alignItems: 'center', paddingVertical: 32, gap: 6 },
  bottomCtaText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
  },
  bottomCtaLink: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },
  comingSoonContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  comingSoonCard: {
    alignItems: 'center',
    gap: 12,
  },
  comingSoonTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    marginTop: 4,
  },
  comingSoonBadge: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    backgroundColor: `${Colors.terracotta}18`,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  comingSoonSubtitle: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 4,
  },
});
