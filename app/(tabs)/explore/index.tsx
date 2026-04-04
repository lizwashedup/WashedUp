import React, { useState, useCallback, useMemo, lazy, Suspense } from 'react';
import {
  View,
  Text,
  FlatList,
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
import { supabase } from '../../../lib/supabase';

// Lazy-load SceneMapView — react-native-maps can crash in Expo Go when imported at top level
const LazySceneMapView = lazy(() => import('../../../components/SceneMapView'));
import { FilterBottomSheet } from '../../../components/FilterBottomSheet';
import { MapErrorBoundary } from '../../../components/MapErrorBoundary';
import ProfileButton from '../../../components/ProfileButton';
import { CATEGORY_OPTIONS } from '../../../constants/Categories';
import Colors from '../../../constants/Colors';
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
    const d = new Date(timeStr);
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

function getPriceLabel(ticketPrice: string | null | undefined): string {
  const isFree = !ticketPrice || (typeof ticketPrice === 'string' && (ticketPrice.trim() === '' || ticketPrice.trim().toLowerCase() === 'free'));
  return isFree ? 'Free' : 'Tickets';
}

// ─── Data Fetching ────────────────────────────────────────────────────────────

function todayLocalDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function fetchSceneEvents(): Promise<SceneEvent[]> {
  const today = todayLocalDateString();
  const { data: events, error } = await supabase
    .from('explore_events')
    .select('id, title, description, image_url, event_date, start_time, venue, venue_address, category, external_url, ticket_price')
    .eq('status', 'Live')
    .gte('event_date', today)
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
  const isFree = !event.ticket_price || (typeof event.ticket_price === 'string' && (event.ticket_price.trim() === '' || event.ticket_price.trim().toLowerCase() === 'free'));

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

        {/* Top left: Category */}
        {event.category && (
          <View style={cardStyles.categoryBadge}>
            <Text style={cardStyles.categoryBadgeText} numberOfLines={1}>
              {event.category}
            </Text>
          </View>
        )}

        {/* Top right: Share + Heart */}
        <View style={cardStyles.topRightActions}>
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
        <View style={cardStyles.titleRow}>
          <Text style={cardStyles.eventTitle} numberOfLines={2}>
            {event.title}
          </Text>
          <TouchableOpacity
            style={[cardStyles.ctaButtonSmall, isFree && cardStyles.ctaButtonFree]}
            onPress={handleCta}
            activeOpacity={0.9}
          >
            <Text style={[cardStyles.ctaButtonTextSmall, isFree && cardStyles.ctaButtonTextFree]}>
              {isFree ? 'Free ↗' : 'Get Tickets ↗'}
            </Text>
          </TouchableOpacity>
        </View>

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
            <Text style={cardStyles.socialProofLink}>Let's Go →</Text>
          </TouchableOpacity>
        )}
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
    backgroundColor: Colors.overlayWarm,
  },
  priceBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  priceBadgeFree: {
    backgroundColor: Colors.white,
  },
  priceBadgeTickets: {
    backgroundColor: Colors.white,
  },
  priceBadgeText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
  },
  priceBadgeTextFree: {
    color: Colors.successGreen,
  },
  priceBadgeTextTickets: {
    color: Colors.terracotta,
  },
  categoryBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: Colors.overlayDark60,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    maxWidth: SCREEN_WIDTH * 0.5,
  },
  categoryBadgeText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.white,
  },
  venueBadge: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    backgroundColor: Colors.overlayDark60,
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
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.overlayDark40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { paddingTop: 14, paddingHorizontal: 2 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  eventTitle: {
    fontWeight: '700',
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    lineHeight: 28,
    flex: 1,
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
  ctaButtonSmall: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 14,
    flexShrink: 0,
    backgroundColor: Colors.terracotta,
  },
  ctaButtonFree: {
    backgroundColor: Colors.asphalt,
  },
  ctaButtonTextSmall: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.white,
  },
  ctaButtonTextFree: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
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
  // If today is Sat (6) or Sun (0), anchor to the Friday already behind us so
  // "This Weekend" correctly includes the ongoing weekend days.
  // For Mon–Fri, count forward to the upcoming/current Friday as before.
  const daysToFriday = dayOfWeek === 0 ? -2 : dayOfWeek === 6 ? -1 : (5 - dayOfWeek + 7) % 7;
  const friday = new Date(todayStart);
  friday.setDate(friday.getDate() + daysToFriday);
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

export default function SceneScreen() {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [heartFilter, setHeartFilter] = useState(false);
  const [whenFilter, setWhenFilter] = useState<WhenKey[]>([]);
  const [whenSheetOpen, setWhenSheetOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
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

  const wishlistedSet = useMemo(() => {
    const set: Record<string, boolean> = {};
    wishlistedIds.forEach((id) => { set[id] = true; });
    return set;
  }, [wishlistedIds]);

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
      queryClient.invalidateQueries({ queryKey: ['explore-wishlists', userId] });
    },
    onError: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
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
    return result;
  }, [events, heartFilter, wishlistedSet, whenFilter, categoryFilter]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await refetch(); } finally { setRefreshing(false); }
  }, [refetch]);

  const renderSceneCard = useCallback(({ item }: { item: SceneEvent }) => (
    <SceneCard
      event={item}
      isWishlisted={!!wishlistedSet[item.id]}
      onWishlist={handleWishlist}
    />
  ), [wishlistedSet, handleWishlist]);

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
      {/* Header — The Scene (like Plans has logo) */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          The <Text style={styles.headerTitleItalic}>Scene</Text>
        </Text>
        <ProfileButton />
      </View>

      {/* Row 1: Tab bar (matches Plans page style) */}
      <View style={styles.tabRow}>
        <View style={[styles.tab, styles.tabActive]}>
          <Text style={styles.tabTextActive}>All Events</Text>
        </View>
      </View>

      <>
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

            <View style={styles.filterSpacer} />

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
            <MapErrorBoundary onClose={() => setMapView(false)}>
              <Suspense fallback={
                <View style={styles.centered}>
                  <ActivityIndicator size="large" color={Colors.terracotta} />
                </View>
              }>
                <LazySceneMapView
                  events={filteredEvents}
                  wishlistedSet={wishlistedSet}
                  onClose={() => setMapView(false)}
                  onWishlist={handleWishlist}
                />
              </Suspense>
            </MapErrorBoundary>
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
            <FlatList
              data={filteredEvents}
              keyExtractor={(item) => item.id}
              renderItem={renderSceneCard}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              windowSize={5}
              maxToRenderPerBatch={4}
              initialNumToRender={3}
              removeClippedSubviews
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.terracotta} />
              }
              ListFooterComponent={
                <View style={styles.bottomCta}>
                  <Text style={styles.bottomCtaText}>Want your event here?</Text>
                  {/* Temporarily commented out until web page is live
                  <TouchableOpacity onPress={() => Linking.openURL('https://washedup.app/list-your-event')}>
                    <Text style={styles.bottomCtaLink}>List your event</Text>
                  </TouchableOpacity>
                  */}
                </View>
              }
            />
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
    fontSize: FontSizes.displayLG,
    fontWeight: '700',
    color: '#2C1810',
  },
  headerTitleItalic: {
    fontWeight: '700',
  },
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E5DDD1',
    marginHorizontal: 20,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 2.5,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#B5522E',
  },
  tabTextActive: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: '#2C1810',
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 20,
    alignItems: 'center',
  },
  filterSpacer: { flex: 1, minWidth: 8 },
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
  scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 120 },
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
    fontWeight: '700',
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
