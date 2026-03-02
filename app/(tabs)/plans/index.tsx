import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { router, useNavigation } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { MapView, Marker } from '../../../components/MapView.native';
import { supabase } from '../../../lib/supabase';
import { fetchPlans, Plan } from '../../../lib/fetchPlans';
import { PlanCard } from '../../../components/plans/PlanCard';
import { FilterBottomSheet } from '../../../components/FilterBottomSheet';
import { CATEGORY_OPTIONS, type CategoryOption } from '../../../constants/Categories';
import { WHEN_OPTIONS } from '../../../constants/WhenFilter';
import Colors from '../../../constants/Colors';
import { MAP_STYLE } from '../../../constants/MapStyle';
import { Fonts, FontSizes } from '../../../constants/Typography';

// ─── Types ────────────────────────────────────────────────────────────────────

type TabKey = 'plans' | 'myplans';

interface SectionDef {
  key: string;
  title: string;
  from: Date;
  to: Date;
}

// Plan shape expected by PlanCard (person-first)
interface PlanCardPlan {
  id: string;
  title: string;
  host_message: string | null;
  start_time: string;
  location_text: string | null;
  category: string | null;
  max_invites: number;
  member_count: number;
  creator: {
    first_name_display: string;
    profile_photo_url: string | null;
    member_since?: string;
    plans_posted?: number;
  };
  attendees: { profile_photo_url: string | null }[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LA_REGION = {
  latitude: 34.0522,
  longitude: -118.2437,
  latitudeDelta: 0.4,
  longitudeDelta: 0.4,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toPlanCardPlan(plan: Plan): PlanCardPlan {
  return {
    id: plan.id,
    title: plan.title,
    host_message: plan.host_message ?? null,
    start_time: plan.start_time,
    location_text: plan.location_text ?? null,
    category: plan.category ?? null,
    max_invites: plan.max_invites ?? 0,
    member_count: plan.member_count ?? 0,
    creator: {
      first_name_display: plan.creator?.first_name ?? 'Creator',
      profile_photo_url: plan.creator?.avatar_url ?? null,
    },
    attendees: [],
  };
}

// ─── Section boundary logic ───────────────────────────────────────────────────

function getSectionDefs(now: Date): SectionDef[] {
  const day = now.getDay();
  const y = now.getFullYear();
  const mo = now.getMonth();
  const d = now.getDate();
  const sections: SectionDef[] = [];

  const todayEnd = new Date(y, mo, d, 23, 59, 59, 999);
  sections.push({ key: 'tonight', title: 'Tonight', from: now, to: todayEnd });

  if (day >= 1 && day <= 4) {
    const tomorrowStart = new Date(y, mo, d + 1, 0, 0, 0);
    const fridayEnd = new Date(y, mo, d + (5 - day), 23, 59, 59, 999);
    sections.push({ key: 'this-week', title: 'This Week', from: tomorrowStart, to: fridayEnd });
  }

  if (day >= 1 && day <= 4) {
    const daysToFri = 5 - day;
    const friStart = new Date(y, mo, d + daysToFri, 0, 0, 0);
    const sunEnd = new Date(y, mo, d + daysToFri + 2, 23, 59, 59, 999);
    sections.push({ key: 'this-weekend', title: 'This Weekend', from: friStart, to: sunEnd });
  } else if (day === 5) {
    const satStart = new Date(y, mo, d + 1, 0, 0, 0);
    const sunEnd = new Date(y, mo, d + 2, 23, 59, 59, 999);
    sections.push({ key: 'this-weekend', title: 'This Weekend', from: satStart, to: sunEnd });
  } else if (day === 6) {
    const sunStart = new Date(y, mo, d + 1, 0, 0, 0);
    const sunEnd = new Date(y, mo, d + 1, 23, 59, 59, 999);
    sections.push({ key: 'this-weekend', title: 'This Weekend', from: sunStart, to: sunEnd });
  }

  const daysToNextMon = day === 0 ? 1 : (8 - day);
  const nextMonStart = new Date(y, mo, d + daysToNextMon, 0, 0, 0);
  const nextFriEnd = new Date(y, mo, d + daysToNextMon + 4, 23, 59, 59, 999);
  sections.push({ key: 'next-week', title: 'Next Week', from: nextMonStart, to: nextFriEnd });

  const comingUpStart = new Date(nextFriEnd.getTime() + 1);
  sections.push({ key: 'coming-up', title: 'Coming Up', from: comingUpStart, to: new Date(y + 2, 0, 1) });

  return sections;
}

function filterIntoSections(
  plans: Plan[],
  sectionDefs: SectionDef[],
  categoryFilter: CategoryOption[],
  whenKeys: string[],
): { def: SectionDef; plans: Plan[] }[] {
  const catFiltered = categoryFilter.length === 0
    ? plans
    : plans.filter((p) => categoryFilter.some((c) => c.toLowerCase() === p.category?.toLowerCase()));

  return sectionDefs
    .filter((def) => whenKeys.length === 0 || whenKeys.includes(def.key))
    .map((def) => ({
      def,
      plans: catFiltered.filter((p) => {
        const t = new Date(p.start_time);
        return t >= def.from && t <= def.to;
      }),
    }))
    .filter((s) => s.plans.length > 0);
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PlansScreen() {
  const sectionDefs = useMemo(() => getSectionDefs(new Date()), []);

  const [activeTab, setActiveTab] = useState<TabKey>('plans');
  const [mapView, setMapView] = useState(false);
  const [heartFilter, setHeartFilter] = useState(false);
  const navigation = useNavigation();

  React.useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress' as any, () => {
      if (mapView) setMapView(false);
      if (activeTab !== 'plans') setActiveTab('plans');
    });
    return unsubscribe;
  }, [navigation, mapView, activeTab]);

  const [whenSheetOpen, setWhenSheetOpen] = useState(false);
  const [whenFilter, setWhenFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<CategoryOption[]>([]);

  const [userId, setUserId] = React.useState<string | null>(null);
  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: allPlans = [], isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['events', 'feed', userId],
    queryFn: () => fetchPlans(userId!),
    enabled: !!userId,
    staleTime: 60_000,
    retry: 1,
  });

  const { data: wishlistIds = [] } = useQuery<string[]>({
    queryKey: ['wishlists', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data } = await supabase.from('wishlists').select('event_id').eq('user_id', userId);
      return (data ?? []).map((r: any) => r.event_id as string);
    },
    enabled: !!userId,
    staleTime: 30_000,
  });

  const { data: myPlans = [], isLoading: myPlansLoading } = useQuery<Plan[]>({
    queryKey: ['my-plans', userId],
    queryFn: async () => {
      if (!userId) return [];

      const { data: memberships, error: memError } = await supabase
        .from('event_members')
        .select(`
          event_id,
          events (
            id, title, start_time, location_text, location_lat, location_lng,
            image_url, primary_vibe, gender_rule, max_invites, min_invites,
            member_count, status, creator_user_id, host_message
          )
        `)
        .eq('user_id', userId)
        .eq('status', 'joined');

      if (memError) return [];

      const { data: created } = await supabase
        .from('events')
        .select('id, title, start_time, location_text, location_lat, location_lng, image_url, primary_vibe, gender_rule, max_invites, min_invites, member_count, status, creator_user_id, host_message')
        .eq('creator_user_id', userId)
        .in('status', ['forming', 'active', 'full']);

      const joinedEvents = (memberships ?? [])
        .map((m: any) => m.events)
        .filter((e: any) => e && ['forming', 'active', 'full'].includes(e.status));

      const seen: Record<string, boolean> = {};
      const allEvents: any[] = [];
      [...joinedEvents, ...(created ?? [])].forEach((e: any) => {
        if (e && !seen[e.id]) {
          seen[e.id] = true;
          allEvents.push(e);
        }
      });

      if (!allEvents.length) return [];

      const creatorIds = allEvents.map((e: any) => e.creator_user_id).filter(Boolean);
      const uniqueCreatorIds = creatorIds.filter((id: string, i: number) => creatorIds.indexOf(id) === i);
      const profileMap: Record<string, any> = {};
      if (uniqueCreatorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles_public')
          .select('id, first_name_display, profile_photo_url')
          .in('id', uniqueCreatorIds);
        (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p; });
      }

      return allEvents.map((e: any) => {
        const hp = profileMap[e.creator_user_id] ?? null;
        return {
          id: e.id,
          title: e.title,
          start_time: e.start_time,
          location_text: e.location_text ?? null,
          location_lat: e.location_lat ?? null,
          location_lng: e.location_lng ?? null,
          latitude: e.location_lat ?? null,
          longitude: e.location_lng ?? null,
          image_url: e.image_url ?? null,
          category: e.primary_vibe ?? null,
          gender_rule: e.gender_rule ?? null,
          max_invites: e.max_invites ?? null,
          min_invites: e.min_invites ?? null,
          member_count: e.member_count ?? 0,
          status: e.status ?? 'forming',
          host_message: e.host_message ?? null,
          creator: hp ? { id: hp.id, first_name: hp.first_name_display ?? null, avatar_url: hp.profile_photo_url ?? null } : null,
        } as Plan;
      });
    },
    enabled: !!userId,
    staleTime: 10_000,
    refetchOnMount: 'always',
  });

  const wishlistedSet = useMemo(() => {
    const lookup: Record<string, boolean> = {};
    wishlistIds.forEach((id: string) => { lookup[id] = true; });
    return lookup;
  }, [wishlistIds]);

  const memberIdSet = useMemo(() => {
    const lookup: Record<string, boolean> = {};
    myPlans.forEach((p: Plan) => { lookup[p.id] = true; });
    return lookup;
  }, [myPlans]);

  const displayPlans = useMemo(() => {
    if (!heartFilter) return allPlans;
    return allPlans.filter((p) => wishlistedSet[p.id]);
  }, [allPlans, heartFilter, wishlistedSet]);

  const sections = useMemo(
    () => filterIntoSections(displayPlans, sectionDefs, categoryFilter, whenFilter),
    [displayPlans, sectionDefs, categoryFilter, whenFilter],
  );

  const sectionListData = useMemo(
    () => sections.map((s) => ({
      title: s.def.title,
      data: s.plans,
    })),
    [sections],
  );

  const whenLabel = whenFilter.length === 0
    ? 'When'
    : whenFilter.length === 1
      ? WHEN_OPTIONS.find((o) => o.key === whenFilter[0])?.label ?? 'When'
      : `When · ${whenFilter.length}`;

  const whenActive = whenFilter.length > 0;
  const categoryActive = (key: string) => categoryFilter.some((c) => c.toLowerCase() === key.toLowerCase());

  const mapPlans = useMemo(() => {
    if (activeTab === 'myplans') return myPlans;
    return allPlans;
  }, [activeTab, allPlans, myPlans]);

  const mapLoading = activeTab === 'myplans' ? myPlansLoading : isLoading;

  const toggleCategory = useCallback((cat: CategoryOption) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCategoryFilter((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  }, []);

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string } }) => (
      <Text style={styles.sectionHeader}>{section.title}</Text>
    ),
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: Plan }) => (
      <View style={styles.cardWrap}>
        <PlanCard
          plan={toPlanCardPlan(item)}
          isMember={!!memberIdSet[item.id]}
        />
      </View>
    ),
    [memberIdSet],
  );

  const listEmpty = sections.length === 0;
  const emptyMessage = heartFilter
    ? 'When you save a plan it shows up here'
    : allPlans.length > 0
      ? 'No plans match your filters.'
      : 'No plans yet.';

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.logoRow}>
          <Image source={require('../../../assets/images/washedup-logo.png')} style={styles.logo} contentFit="contain" />
          {__DEV__ && <View style={styles.designBadge}><Text style={styles.designBadgeText}>v2</Text></View>}
        </View>
        <View style={styles.headerIcons}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => {
              Haptics.selectionAsync();
              setMapView((v) => !v);
            }}
            accessibilityLabel={mapView ? 'Switch to list view' : 'Switch to map view'}
          >
            {mapView ? (
              <Ionicons name="list" size={22} color={Colors.asphalt} />
            ) : (
              <Ionicons name="map-outline" size={22} color={Colors.asphalt} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Filter Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsScroll}
        style={styles.chipsScrollView}
      >
        {/* Primary: All Plans / My Plans */}
        <View style={styles.primaryChips}>
          {(['plans', 'myplans'] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.primaryChip, activeTab === tab && styles.primaryChipActive]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setActiveTab(tab);
                if (tab !== 'plans') setMapView(false);
              }}
            >
              <Text style={[styles.primaryChipText, activeTab === tab && styles.primaryChipTextActive]}>
                {tab === 'plans' ? 'All Plans' : 'My Plans'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Secondary: When (terracotta) + Categories */}
        {activeTab === 'plans' && (
          <>
            <TouchableOpacity
              style={[styles.whenChip, whenActive && styles.whenChipActive]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setWhenSheetOpen(true);
              }}
            >
              <Text style={[styles.whenChipText, whenActive && styles.whenChipTextActive]} numberOfLines={1}>
                {whenLabel}
              </Text>
            </TouchableOpacity>
            {CATEGORY_OPTIONS.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[styles.categoryChip, categoryActive(cat) && styles.categoryChipActive]}
                onPress={() => toggleCategory(cat)}
              >
                <Text style={[styles.categoryChipText, categoryActive(cat) && styles.categoryChipTextActive]}>
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>

      {/* Map view */}
      {mapView ? (
        mapLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.terracotta} />
          </View>
        ) : (
          <MapView
            style={styles.map}
            initialRegion={LA_REGION}
            customMapStyle={MAP_STYLE}
            showsUserLocation
            showsMyLocationButton={false}
          >
            {mapPlans
              .filter((p) => p.latitude != null && p.longitude != null)
              .map((plan) => (
                <Marker
                  key={plan.id}
                  coordinate={{ latitude: plan.latitude!, longitude: plan.longitude! }}
                  title={plan.title}
                  description={plan.location_text ?? undefined}
                  pinColor={wishlistedSet[plan.id] ? Colors.errorRed : Colors.terracotta}
                  onCalloutPress={() => router.push(`/plan/${plan.id}`)}
                />
              ))}
          </MapView>
        )
      ) : activeTab === 'plans' ? (
        <>
          {!userId || isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={Colors.terracotta} />
            </View>
          ) : isError ? (
            <View style={styles.centered}>
              <Text style={styles.errorTitle}>Couldn't load plans</Text>
              <Text style={styles.errorMessage}>{(error as Error)?.message ?? 'Unknown error'}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : listEmpty ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>{emptyMessage}</Text>
              <TouchableOpacity style={styles.emptyButton} onPress={() => router.push('/(tabs)/post')}>
                <Text style={styles.emptyButtonText}>Post a Plan</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <SectionList
              sections={sectionListData}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              renderSectionHeader={renderSectionHeader}
              stickySectionHeadersEnabled
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.terracotta} />
              }
            />
          )}
        </>
      ) : (
        <View style={{ flex: 1 }}>
          {myPlansLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={Colors.terracotta} />
            </View>
          ) : myPlans.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>You haven't joined any plans yet.</Text>
              <TouchableOpacity style={styles.emptyButton} onPress={() => setActiveTab('plans')}>
                <Text style={styles.emptyButtonText}>Browse Plans</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <SectionList
              sections={[{ title: 'My Plans', data: myPlans }]}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              renderSectionHeader={renderSectionHeader}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      )}

      <FilterBottomSheet
        visible={whenSheetOpen}
        title="When"
        options={[...WHEN_OPTIONS]}
        selected={whenFilter}
        onToggle={(key) => setWhenFilter((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))}
        onClose={() => setWhenSheetOpen(false)}
        onClear={() => setWhenFilter([])}
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
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logo: {
    width: 140,
    height: 32,
  },
  designBadge: {
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  designBadgeText: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: Colors.white,
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipsScrollView: {
    maxHeight: 52,
  },
  chipsScroll: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 10,
    alignItems: 'center',
  },
  primaryChips: {
    flexDirection: 'row',
    gap: 0,
    borderRadius: 24,
    backgroundColor: Colors.border,
    padding: 4,
  },
  primaryChip: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  primaryChipActive: {
    backgroundColor: Colors.asphalt,
  },
  primaryChipText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
  },
  primaryChipTextActive: {
    color: Colors.white,
  },
  whenChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    backgroundColor: Colors.terracotta,
  },
  whenChipActive: {
    backgroundColor: Colors.asphalt,
  },
  whenChipText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
  whenChipTextActive: {
    color: Colors.white,
  },
  categoryChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  categoryChipActive: {
    backgroundColor: Colors.asphalt,
    borderColor: Colors.asphalt,
  },
  categoryChipText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  categoryChipTextActive: {
    color: Colors.white,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  sectionHeader: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
    marginTop: 24,
    marginBottom: 12,
  },
  cardWrap: {
    marginBottom: 16,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  map: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.textMedium, textAlign: 'center', marginBottom: 20 },
  emptyButton: { backgroundColor: Colors.terracotta, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14 },
  emptyButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  errorTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt, marginBottom: 8, textAlign: 'center' },
  errorMessage: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium, textAlign: 'center', marginBottom: 20, paddingHorizontal: 32 },
  retryButton: { backgroundColor: Colors.terracotta, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14 },
  retryButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
});
