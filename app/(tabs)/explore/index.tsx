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
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Heart, Calendar, MapPin, Map, LayoutList, Check, ChevronDown, Utensils, Lightbulb } from 'lucide-react-native';
import ProfileButton from '../../../components/ProfileButton';
import MapView, { Marker } from 'react-native-maps';
import { supabase } from '../../../lib/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

const CATEGORY_COLORS: Record<string, string> = {
  music: '#7C5CBF',
  comedy: '#C4652A',
  film: '#5C7CBF',
  nightlife: '#BF5C7C',
  food: '#BF7C5C',
  art: '#BF5CBF',
  community: '#5CA0BF',
  tech: '#3D8B6E',
  default: '#C4652A',
};

function getCatColor(category: string | null): string {
  return CATEGORY_COLORS[category?.toLowerCase() ?? ''] ?? CATEGORY_COLORS.default;
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

  const eventIds = events.map(e => e.id);
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

  return events.map(e => ({
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

// ─── Scene Card ───────────────────────────────────────────────────────────────

function SceneCard({ event, isWishlisted, onWishlist }: {
  event: SceneEvent;
  isWishlisted: boolean;
  onWishlist: (id: string, current: boolean) => void;
}) {
  const catColor = getCatColor(event.category);

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      style={styles.card}
      onPress={() => router.push(`/event/${event.id}`)}
    >
      <View style={styles.cardImageContainer}>
        {event.image_url ? (
          <Image source={{ uri: event.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: catColor + '20', alignItems: 'center', justifyContent: 'center' }]}>
            <Calendar size={40} color={catColor} />
          </View>
        )}

        <View style={styles.cardTopLeft}>
          {event.category && (
            <View style={[styles.categoryPill, { backgroundColor: catColor }]}>
              <Text style={styles.categoryText}>{event.category}</Text>
            </View>
          )}
          {event.plans_count > 0 && (
            <View style={styles.plansCountPill}>
              <Text style={styles.plansCountText}>
                {event.plans_count} {event.plans_count === 1 ? 'plan' : 'plans'} formed
              </Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={styles.heartButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onWishlist(event.id, isWishlisted);
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Heart
            size={20}
            color={isWishlisted ? '#E53935' : '#FFFFFF'}
            fill={isWishlisted ? '#E53935' : 'transparent'}
            strokeWidth={2}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle} numberOfLines={2}>{event.title}</Text>
        {event.venue && (
          <View style={styles.cardMetaRow}>
            <MapPin size={13} color="#9B8B7A" strokeWidth={2} />
            <Text style={styles.cardMeta} numberOfLines={1}>{event.venue}</Text>
          </View>
        )}
        <View style={styles.cardMetaRow}>
          <Calendar size={13} color="#9B8B7A" strokeWidth={2} />
          <Text style={styles.cardMeta}>{formatEventDate(event.event_date, event.start_time)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

type SceneTab = 'events' | 'restaurants' | 'ideas';

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

export default function SceneScreen() {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SceneTab>('events');
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

  const wishlistedSet: Record<string, boolean> = {};
  wishlistedIds.forEach(id => { wishlistedSet[id] = true; });

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

  const allCategories = useMemo(() => {
    const cats = events.map(e => e.category).filter(Boolean) as string[];
    return [...new Set(cats)].sort();
  }, [events]);

  const filteredEvents = useMemo(() => {
    let result = events;
    if (heartFilter) {
      result = result.filter(e => wishlistedSet[e.id]);
    }
    if (whenFilter.length > 0) {
      result = result.filter(e => matchesWhenFilter(e.event_date, whenFilter));
    }
    if (categoryFilter.length > 0) {
      result = result.filter(e => e.category && categoryFilter.includes(e.category));
    }
    return result;
  }, [events, heartFilter, wishlistedSet, whenFilter, categoryFilter]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const whenActive = whenFilter.length > 0;
  const whenLabel = whenFilter.length === 0 ? 'When'
    : whenFilter.length === 1 ? WHEN_OPTIONS.find(o => o.key === whenFilter[0])?.label ?? 'When'
    : `When · ${whenFilter.length}`;

  const categoryActive = categoryFilter.length > 0;
  const categoryLabel = categoryFilter.length === 0 ? 'Category'
    : categoryFilter.length === 1 ? categoryFilter[0] : `Category · ${categoryFilter.length}`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Scene</Text>
        <ProfileButton />
      </View>

      {/* Sub-tabs: Events / Restaurants / Ideas */}
      <View style={styles.sceneTabBar}>
        {([
          { key: 'events' as SceneTab, label: 'Events' },
          { key: 'restaurants' as SceneTab, label: 'Restaurants', comingSoon: true },
          { key: 'ideas' as SceneTab, label: 'Ideas', comingSoon: true },
        ]).map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.sceneTab, activeTab === tab.key && styles.sceneTabActive]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveTab(tab.key);
              if (tab.key !== 'events') setMapView(false);
            }}
          >
            <Text style={[styles.sceneTabText, activeTab === tab.key && styles.sceneTabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'events' ? (
        <>
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.dropdownPill, whenActive && styles.dropdownPillActive]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setWhenSheetOpen(true); }}
            >
              <Text style={[styles.dropdownText, whenActive && styles.dropdownTextActive]} numberOfLines={1}>
                {whenLabel}
              </Text>
              <ChevronDown size={13} color={whenActive ? '#FFFFFF' : '#1A1A1A'} strokeWidth={2.5} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.dropdownPill, categoryActive && styles.dropdownPillActive]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCategorySheetOpen(true); }}
            >
              <Text style={[styles.dropdownText, categoryActive && styles.dropdownTextActive]} numberOfLines={1}>
                {categoryLabel}
              </Text>
              <ChevronDown size={13} color={categoryActive ? '#FFFFFF' : '#1A1A1A'} strokeWidth={2.5} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.heartFilterPill, heartFilter && styles.heartFilterPillActive]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setHeartFilter(v => !v); }}
            >
              <Heart
                size={16}
                color={heartFilter ? '#FFFFFF' : '#1A1A1A'}
                fill={heartFilter ? '#FFFFFF' : 'transparent'}
                strokeWidth={2}
              />
            </TouchableOpacity>

            <View style={{ flex: 1 }} />

            <TouchableOpacity
              style={[styles.mapTogglePill, mapView && styles.mapTogglePillActive]}
              onPress={() => { Haptics.selectionAsync(); setMapView(v => !v); }}
              accessibilityLabel={mapView ? 'Switch to list view' : 'Switch to map view'}
            >
              {mapView
                ? <LayoutList size={14} color="#FFFFFF" strokeWidth={2} />
                : <Map size={14} color="#1A1A1A" strokeWidth={2} />}
              <Text style={[styles.mapToggleLabel, mapView && styles.mapToggleLabelActive]}>
                {mapView ? 'List' : 'Map'}
              </Text>
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color="#C4652A" />
            </View>
          ) : mapView ? (
            <MapView
              style={{ flex: 1 }}
              initialRegion={LA_REGION}
              showsUserLocation
              showsMyLocationButton={false}
            />
          ) : filteredEvents.length === 0 ? (
            <View style={styles.centered}>
              {heartFilter ? (
                <>
                  <Heart size={40} color="#C4652A" />
                  <Text style={styles.emptyTitle}>No hearted events</Text>
                  <Text style={styles.emptySubtitle}>Tap the heart on events you're interested in.</Text>
                </>
              ) : (
                <>
                  <Calendar size={40} color="#C4652A" />
                  <Text style={styles.emptyTitle}>Nothing yet</Text>
                  <Text style={styles.emptySubtitle}>Check back soon — events are being added.</Text>
                </>
              )}
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#C4652A" />}
            >
              {filteredEvents.map(event => (
                <SceneCard
                  key={event.id}
                  event={event}
                  isWishlisted={!!wishlistedSet[event.id]}
                  onWishlist={handleWishlist}
                />
              ))}

              <View style={styles.bottomCta}>
                <Text style={styles.bottomCtaText}>Want your event here?</Text>
                <TouchableOpacity onPress={() => Linking.openURL('https://washedup.app/list-your-event')}>
                  <Text style={styles.bottomCtaLink}>List your event</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </>
      ) : activeTab === 'restaurants' ? (
        <View style={styles.comingSoonContainer}>
          <View style={styles.comingSoonCard}>
            <Utensils size={48} color="#C4652A" strokeWidth={1.5} />
            <Text style={styles.comingSoonTitle}>Restaurants</Text>
            <Text style={styles.comingSoonBadge}>Coming Soon</Text>
            <Text style={styles.comingSoonSubtitle}>
              Curated spots to eat with your crew.{'\n'}We're working on it.
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.comingSoonContainer}>
          <View style={styles.comingSoonCard}>
            <Lightbulb size={48} color="#C4652A" strokeWidth={1.5} />
            <Text style={styles.comingSoonTitle}>Ideas</Text>
            <Text style={styles.comingSoonBadge}>Coming Soon</Text>
            <Text style={styles.comingSoonSubtitle}>
              Activity ideas to inspire your next plan.{'\n'}Stay tuned.
            </Text>
          </View>
        </View>
      )}

      <Modal visible={whenSheetOpen} transparent animationType="slide">
        <Pressable style={styles.sheetOverlay} onPress={() => setWhenSheetOpen(false)}>
          <View />
        </Pressable>
        <View style={styles.sheetContent}>
          <Text style={styles.sheetTitle}>When</Text>
          {WHEN_OPTIONS.map(opt => {
            const selected = whenFilter.includes(opt.key);
            return (
              <TouchableOpacity
                key={opt.key}
                style={styles.sheetRow}
                onPress={() => {
                  Haptics.selectionAsync();
                  setWhenFilter(prev =>
                    selected ? prev.filter(k => k !== opt.key) : [...prev, opt.key]
                  );
                }}
              >
                <Text style={[styles.sheetRowText, selected && { color: '#C4652A', fontWeight: '700' }]}>
                  {opt.label}
                </Text>
                {selected && <Check size={18} color="#C4652A" strokeWidth={2.5} />}
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={styles.sheetDone}
            onPress={() => setWhenSheetOpen(false)}
          >
            <Text style={styles.sheetDoneText}>Done</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal visible={categorySheetOpen} transparent animationType="slide">
        <Pressable style={styles.sheetOverlay} onPress={() => setCategorySheetOpen(false)}>
          <View />
        </Pressable>
        <View style={styles.sheetContent}>
          <Text style={styles.sheetTitle}>Category</Text>
          {allCategories.map(cat => {
            const selected = categoryFilter.includes(cat);
            return (
              <TouchableOpacity
                key={cat}
                style={styles.sheetRow}
                onPress={() => {
                  Haptics.selectionAsync();
                  setCategoryFilter(prev =>
                    selected ? prev.filter(c => c !== cat) : [...prev, cat]
                  );
                }}
              >
                <Text style={[styles.sheetRowText, selected && { color: '#C4652A', fontWeight: '700' }]}>
                  {cat}
                </Text>
                {selected && <Check size={18} color="#C4652A" strokeWidth={2.5} />}
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={styles.sheetDone}
            onPress={() => setCategorySheetOpen(false)}
          >
            <Text style={styles.sheetDoneText}>Done</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1e4d4' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: {
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 28,
    color: '#1A1A1A',
  },

  sceneTabBar: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 12,
    gap: 0,
  },
  sceneTab: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  sceneTabActive: {
    borderBottomColor: '#C4652A',
  },
  sceneTabText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#999999',
  },
  sceneTabTextActive: {
    color: '#1A1A1A',
  },

  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 8,
    alignItems: 'center',
  },
  heartFilterPill: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0E6D3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heartFilterPillActive: {
    backgroundColor: '#C4652A',
    borderColor: '#C4652A',
  },
  dropdownPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0E6D3',
  },
  dropdownPillActive: { backgroundColor: '#C4652A', borderColor: '#C4652A' },
  dropdownText: { fontSize: 14, fontWeight: '600', color: '#1A1A1A' },
  dropdownTextActive: { color: '#FFFFFF' },
  mapTogglePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0E6D3',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  mapTogglePillActive: { backgroundColor: '#C4652A', borderColor: '#C4652A' },
  mapToggleLabel: { fontSize: 9, fontWeight: '700', color: '#1A1A1A' },
  mapToggleLabelActive: { color: '#FFFFFF' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1A1A1A' },
  emptySubtitle: { fontSize: 14, color: '#9B8B7A', textAlign: 'center' },

  scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48 },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  cardImageContainer: { width: '100%', height: 200, position: 'relative' },
  cardTopLeft: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    gap: 6,
  },
  categoryPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  categoryText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF', textTransform: 'capitalize' },
  plansCountPill: { backgroundColor: '#C4652A', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  plansCountText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  heartButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: { padding: 16, gap: 6 },
  cardTitle: {
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 20,
    color: '#1A1A1A',
    lineHeight: 26,
  },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardMeta: { fontSize: 13, color: '#9B8B7A', flex: 1 },

  bottomCta: { alignItems: 'center', paddingVertical: 32, gap: 6 },
  bottomCtaText: { fontSize: 14, color: '#9B8B7A' },
  bottomCtaLink: { fontSize: 14, color: '#C4652A', fontWeight: '700' },

  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheetContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: '#1A1A1A', marginBottom: 16 },
  sheetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0E6D3',
  },
  sheetRowText: { fontSize: 16, color: '#1A1A1A' },
  sheetDone: {
    backgroundColor: '#C4652A',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  sheetDoneText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },

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
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 24,
    color: '#1A1A1A',
    marginTop: 4,
  },
  comingSoonBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: '#C4652A',
    backgroundColor: '#C4652A18',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  comingSoonSubtitle: {
    fontSize: 14,
    color: '#9B8B7A',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 4,
  },
});
