import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SMALL_CARD_WIDTH = 220;

interface SceneEvent {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  event_date: string | null;
  event_time: string | null;
  venue_name: string | null;
  category: string | null;
  tickets_url: string | null;
  price: string | null;
}

async function fetchSceneEvents(): Promise<SceneEvent[]> {
  const { data, error } = await supabase
    .from('explore_events')
    .select('id, title, description, image_url, event_date, event_time, venue_name, category, tickets_url, price')
    // Handle both 'Live' and 'live' casing in case the DB value differs
    .or('status.eq.Live,status.eq.live,status.eq.active')
    .order('event_date', { ascending: true });

  if (error) {
    console.log('[Scene] fetchSceneEvents error:', error.message, error.code);
    throw error;
  }
  console.log('[Scene] fetched events count:', data?.length ?? 0);
  return data ?? [];
}

// Treat event_date as local time — appending T00:00:00 prevents UTC off-by-one day in US timezones
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
  default: '#C4652A',
};

function getCatColor(category: string | null): string {
  return CATEGORY_COLORS[category?.toLowerCase() ?? ''] ?? CATEGORY_COLORS.default;
}

// ─── Featured Hero Card ───────────────────────────────────────────────────────

function FeaturedCard({ event }: { event: SceneEvent }) {
  const catColor = getCatColor(event.category);

  return (
    <TouchableOpacity
      activeOpacity={0.92}
      style={styles.featuredCard}
      onPress={() => event.tickets_url && Linking.openURL(event.tickets_url)}
    >
      {/* Photo or color placeholder */}
      {event.image_url ? (
        <Image source={{ uri: event.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallback, { backgroundColor: catColor + '30' }]}>
          <Ionicons name="calendar" size={48} color={catColor} />
        </View>
      )}

      {/* Gradient — bottom 65% of card, transparent → dark */}
      <LinearGradient
        colors={['transparent', 'rgba(28,25,23,0.92)']}
        style={styles.featuredGradient}
        pointerEvents="none"
      />

      {/* Content over gradient */}
      <View style={styles.featuredContent}>
        {event.category && (
          <View style={[styles.categoryPill, { backgroundColor: catColor }]}>
            <Text style={styles.categoryText}>{event.category.toUpperCase()}</Text>
          </View>
        )}

        <Text style={styles.featuredTitle} numberOfLines={2}>{event.title}</Text>

        <View style={styles.featuredMeta}>
          {event.venue_name && (
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={13} color="rgba(255,255,255,0.8)" />
              <Text style={styles.featuredMetaText} numberOfLines={1}>{event.venue_name}</Text>
            </View>
          )}
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={13} color="rgba(255,255,255,0.8)" />
            <Text style={styles.featuredMetaText}>
              {formatEventDate(event.event_date, event.event_time)}
            </Text>
          </View>
        </View>

        {event.tickets_url && (
          <TouchableOpacity
            style={styles.featuredCta}
            onPress={() => Linking.openURL(event.tickets_url!)}
            activeOpacity={0.85}
          >
            <Text style={styles.featuredCtaText}>
              {event.price ? `Get Tickets · ${event.price}` : 'Get Tickets'}
            </Text>
            <Ionicons name="arrow-forward" size={14} color="#C4652A" />
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Small Event Card ─────────────────────────────────────────────────────────

function EventCard({ event }: { event: SceneEvent }) {
  const catColor = getCatColor(event.category);

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      style={styles.eventCard}
      onPress={() => event.tickets_url && Linking.openURL(event.tickets_url)}
    >
      {event.image_url ? (
        <Image source={{ uri: event.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallback, { backgroundColor: catColor + '20' }]}>
          <Ionicons name="calendar-outline" size={28} color={catColor} />
        </View>
      )}

      {/* Gradient bottom overlay */}
      <LinearGradient
        colors={['transparent', 'rgba(28,25,23,0.82)']}
        style={styles.eventGradient}
        pointerEvents="none"
      />

      {event.category && (
        <View style={[styles.eventCategoryPill, { backgroundColor: catColor }]}>
          <Text style={styles.categoryText}>{event.category.toUpperCase()}</Text>
        </View>
      )}

      <View style={styles.eventContent}>
        <Text style={styles.eventTitle} numberOfLines={2}>{event.title}</Text>
        {event.venue_name && (
          <Text style={styles.eventMeta} numberOfLines={1}>{event.venue_name}</Text>
        )}
        <Text style={styles.eventDate} numberOfLines={1}>
          {formatEventDate(event.event_date, event.event_time)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

const TABS = [
  { id: 'events', label: 'Events', active: true },
  { id: 'restaurants', label: 'Restaurants', active: false },
  { id: 'ideas', label: 'Ideas', active: false },
];

export default function SceneScreen() {
  const [activeTab] = useState('events');
  const [timedOut, setTimedOut] = useState(false);

  const { data: events = [], isLoading, isError } = useQuery({
    queryKey: ['scene-events'],
    queryFn: fetchSceneEvents,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // Show empty state after 5 seconds if still loading — prevents infinite spinner
  useEffect(() => {
    if (!isLoading) { setTimedOut(false); return; }
    const timer = setTimeout(() => setTimedOut(true), 5000);
    return () => clearTimeout(timer);
  }, [isLoading]);

  const showEmpty = (!isLoading && events.length === 0) || isError || timedOut;

  const featured = events[0] ?? null;
  const rest = events.slice(1);

  // Weekend window: Friday–Sunday of the current week
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  const friday = new Date(now);
  friday.setDate(now.getDate() + daysUntilFriday);
  friday.setHours(0, 0, 0, 0);
  const sunday = new Date(friday);
  sunday.setDate(friday.getDate() + 2);
  sunday.setHours(23, 59, 59, 999);

  const thisWeekend = rest.filter(e => {
    if (!e.event_date) return false;
    const d = parseLocalDate(e.event_date);
    return d >= friday && d <= sunday;
  });

  const comingUp = rest.filter(e => {
    if (!e.event_date) return false;
    const d = parseLocalDate(e.event_date);
    return !(d >= friday && d <= sunday);
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Scene</Text>
      </View>

      {/* Tab row */}
      <View style={styles.tabRow}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.id}
            style={[styles.tab, activeTab === tab.id && styles.tabActive]}
            disabled={!tab.active}
            activeOpacity={tab.active ? 0.7 : 1}
          >
            <Text style={[
              styles.tabText,
              activeTab === tab.id && styles.tabTextActive,
              !tab.active && styles.tabTextDisabled,
            ]}>
              {tab.label}
            </Text>
            {!tab.active && (
              <View style={styles.comingSoonPill}>
                <Text style={styles.comingSoonText}>Soon</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {isLoading && !timedOut ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#C4652A" />
        </View>
      ) : showEmpty ? (
        <View style={styles.centered}>
          <Ionicons name="calendar-outline" size={40} color="#C4652A" />
          <Text style={styles.emptyTitle}>Nothing yet</Text>
          <Text style={styles.emptySubtitle}>Check back soon — we're adding events.</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Featured */}
          {featured && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Featured</Text>
              <FeaturedCard event={featured} />
            </View>
          )}

          {/* This Weekend */}
          {thisWeekend.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>This Weekend</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.hScroll}
              >
                {thisWeekend.map(event => <EventCard key={event.id} event={event} />)}
              </ScrollView>
            </View>
          )}

          {/* Coming Up */}
          {comingUp.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Coming Up</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.hScroll}
              >
                {comingUp.map(event => <EventCard key={event.id} event={event} />)}
              </ScrollView>
            </View>
          )}

          {/* Bottom CTA */}
          <View style={styles.bottomCta}>
            <Text style={styles.bottomCtaText}>Want your event here?</Text>
            <TouchableOpacity onPress={() => Linking.openURL('https://washedup.app/list-your-event')}>
              <Text style={styles.bottomCtaLink}>List your event →</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF8F0' },
  fallback: { alignItems: 'center', justifyContent: 'center' },

  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  headerTitle: {
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 32,
    color: '#1C1917',
  },

  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F0E6D3',
    marginBottom: 4,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    marginRight: 24,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: '#C4652A' },
  tabText: { fontSize: 14, fontWeight: '500', color: '#9B8B7A' },
  tabTextActive: { color: '#1C1917', fontWeight: '700' },
  tabTextDisabled: { color: '#C8BEB5' },
  comingSoonPill: {
    backgroundColor: '#F0E6D3',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  comingSoonText: { fontSize: 10, color: '#9B8B7A', fontWeight: '600' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1C1917' },
  emptySubtitle: { fontSize: 14, color: '#9B8B7A', textAlign: 'center' },

  scrollContent: { paddingBottom: 48 },
  section: { marginTop: 24 },
  sectionLabel: {
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 22,
    color: '#1C1917',
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  hScroll: { paddingHorizontal: 20, gap: 12 },

  // Featured card
  featuredCard: {
    marginHorizontal: 20,
    borderRadius: 20,
    overflow: 'hidden',
    height: 380,
  },
  featuredGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 248, // ~65% of 380
  },
  featuredContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 24,
    gap: 8,
  },
  categoryPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  categoryText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  featuredTitle: {
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 28,
    color: '#FFFFFF',
    lineHeight: 34,
  },
  featuredMeta: { gap: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  featuredMetaText: { fontSize: 13, color: 'rgba(255,255,255,0.85)', flex: 1 },
  featuredCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    marginTop: 4,
  },
  featuredCtaText: { fontSize: 13, fontWeight: '700', color: '#C4652A' },

  // Small event card
  eventCard: {
    width: SMALL_CARD_WIDTH,
    height: 260,
    borderRadius: 16,
    overflow: 'hidden',
  },
  eventGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 170,
  },
  eventCategoryPill: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  eventContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 14,
    gap: 3,
  },
  eventTitle: {
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 17,
    color: '#FFFFFF',
    lineHeight: 22,
  },
  eventMeta: { fontSize: 12, color: 'rgba(255,255,255,0.75)' },
  eventDate: { fontSize: 11, color: 'rgba(255,255,255,0.6)' },

  // Bottom CTA
  bottomCta: { alignItems: 'center', paddingVertical: 32, gap: 6 },
  bottomCtaText: { fontSize: 14, color: '#9B8B7A' },
  bottomCtaLink: { fontSize: 14, color: '#C4652A', fontWeight: '700' },
});
