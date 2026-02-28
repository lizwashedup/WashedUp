import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useNavigation } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LayoutList, Map, ChevronDown, ArrowRight, Heart } from 'lucide-react-native';
import ProfileButton from '../../../components/ProfileButton';
import MapView, { Marker } from 'react-native-maps';
import { supabase } from '../../../lib/supabase';
import { fetchPlans, Plan } from '../../../lib/fetchPlans';
import { PlanCard } from '../../../components/plans/PlanCard';
import { FilterBottomSheet } from '../../../components/FilterBottomSheet';
import { CATEGORY_OPTIONS, type CategoryOption } from '../../../constants/Categories';
import { WHEN_OPTIONS } from '../../../constants/WhenFilter';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────────────────────────

type TabKey = 'plans' | 'myplans';

interface SectionDef {
  key: string;
  title: string;
  from: Date;
  to: Date;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LA_REGION = {
  latitude: 34.0522,
  longitude: -118.2437,
  latitudeDelta: 0.4,
  longitudeDelta: 0.4,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Shared fetch helper for "My Plans" and "Wishlist" tabs
async function fetchEventsByIds(ids: string[]): Promise<Plan[]> {
  if (ids.length === 0) return [];

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, title, start_time, location_text, location_lat, location_lng, image_url, primary_vibe, gender_rule, max_invites, min_invites, member_count, status, creator_user_id')
    .in('id', ids)
    .order('start_time', { ascending: true });

  if (eventsError) return [];
  if (!events?.length) return [];

  // Build profile lookup using plain object (avoids Hermes Map<generic> issue)
  const profileMap: Record<string, any> = {};
  const creatorIds = events.map((e: any) => e.creator_user_id).filter(Boolean);
  const uniqueCreatorIds = creatorIds.filter((id: string, i: number) => creatorIds.indexOf(id) === i);

  if (uniqueCreatorIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles_public')
      .select('id, first_name_display, profile_photo_url')
      .in('id', uniqueCreatorIds);
    (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p; });
  }

  return events.map((e: any) => {
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
      host: hp ? {
        id: hp.id,
        first_name: hp.first_name_display ?? null,
        avatar_url: hp.profile_photo_url ?? null,
      } : null,
    } as Plan;
  });
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

// ─── Section Row ──────────────────────────────────────────────────────────────

const SectionRow = React.memo(({
  def,
  plans,
  wishlisted,
  memberIds,
  onWishlist,
  isFirst = false,
}: {
  def: SectionDef;
  plans: Plan[];
  wishlisted: Record<string, boolean>;
  memberIds: Record<string, boolean>;
  onWishlist: (id: string, current: boolean) => void;
  isFirst?: boolean;
}) => {
  const handleSeeAll = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/plans-section',
      params: {
        title: def.title,
        from: def.from.toISOString(),
        to: def.to.toISOString(),
      },
    } as any);
  }, [def]);

  return (
    <View style={styles.section}>
      {!isFirst && <View style={styles.sectionDivider} />}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{def.title}</Text>
        <TouchableOpacity
          style={styles.seeAllButton}
          onPress={handleSeeAll}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ArrowRight size={18} color="#1A1A1A" strokeWidth={2} />
        </TouchableOpacity>
      </View>

      <FlatList
        horizontal
        data={plans}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PlanCard
            plan={item}
            isWishlisted={!!wishlisted[item.id]}
            isMember={!!memberIds[item.id]}
            onWishlist={onWishlist}
            variant="carousel"
          />
        )}
        contentContainerStyle={styles.carouselContent}
        showsHorizontalScrollIndicator={false}
        snapToInterval={SCREEN_WIDTH - 36}
        decelerationRate="fast"
      />
    </View>
  );
});
SectionRow.displayName = 'SectionRow';

// ─── Vertical Plan List (My Plans / Wishlist) ─────────────────────────────────

function VerticalPlanList({
  plans,
  loading,
  wishlisted,
  memberIds,
  onWishlist,
  emptyMessage,
  emptyCta,
  onEmptyCta,
}: {
  plans: Plan[];
  loading: boolean;
  wishlisted: Record<string, boolean>;
  memberIds: Record<string, boolean>;
  onWishlist: (id: string, current: boolean) => void;
  emptyMessage: string;
  emptyCta: string;
  onEmptyCta: () => void;
}) {
  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color="#C4652A" /></View>;
  }
  if (plans.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>{emptyMessage}</Text>
        <TouchableOpacity style={styles.emptyButton} onPress={onEmptyCta}>
          <Text style={styles.emptyButtonText}>{emptyCta}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <FlatList
      data={plans}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <PlanCard
          plan={item}
          isWishlisted={!!wishlisted[item.id]}
          isMember={!!memberIds[item.id]}
          onWishlist={onWishlist}
          variant="full"
        />
      )}
      contentContainerStyle={styles.verticalListContent}
      showsVerticalScrollIndicator={false}
    />
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PlansScreen() {
  const queryClient = useQueryClient();
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
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
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

  // "My Plans" — events the user has joined OR created (single JOIN query)
  const { data: myPlans = [], isLoading: myPlansLoading } = useQuery<Plan[]>({
    queryKey: ['my-plans', userId],
    queryFn: async () => {
      if (!userId) return [];

      // Joined events via JOIN (avoids two-step fetchEventsByIds)
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

      // Events user created directly
      const { data: created, error: createdError } = await supabase
        .from('events')
        .select('id, title, start_time, location_text, location_lat, location_lng, image_url, primary_vibe, gender_rule, max_invites, min_invites, member_count, status, creator_user_id')
        .eq('creator_user_id', userId)
        .in('status', ['forming', 'active', 'full']);

      if (createdError) { /* created query failed */ }

      const joinedEvents = (memberships ?? [])
        .map((m: any) => m.events)
        .filter((e: any) => e && ['forming', 'active', 'full'].includes(e.status));

      // Merge and deduplicate
      const seen: Record<string, boolean> = {};
      const allEvents: any[] = [];
      [...joinedEvents, ...(created ?? [])].forEach((e: any) => {
        if (e && !seen[e.id]) {
          seen[e.id] = true;
          allEvents.push(e);
        }
      });

      if (!allEvents.length) return [];

      // Fetch host profiles
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
          host: hp ? { id: hp.id, first_name: hp.first_name_display ?? null, avatar_url: hp.profile_photo_url ?? null } : null,
        } as Plan;
      });
    },
    enabled: !!userId,
    staleTime: 10_000,
    refetchOnMount: 'always',
  });

  // "Wishlist" — fetched via JOIN (single query, avoids two-step)
  const { data: wishlistPlans = [], isLoading: wishlistLoading } = useQuery<Plan[]>({
    queryKey: ['wishlist-plans', userId],
    queryFn: async () => {
      if (!userId) return [];

      const { data: wl, error: wlError } = await supabase
        .from('wishlists')
        .select(`
          event_id,
          events (
            id, title, start_time, location_text, location_lat, location_lng,
            image_url, primary_vibe, gender_rule, max_invites, min_invites,
            member_count, status, creator_user_id, host_message
          )
        `)
        .eq('user_id', userId);

      if (wlError) return [];

      if (!wl?.length) return [];

      const plans = wl
        .map((w: any) => w.events)
        .filter((e: any) => e != null);

      if (!plans.length) return [];

      // Fetch host profiles
      const creatorIds = plans.map((e: any) => e.creator_user_id).filter(Boolean);
      const uniqueCreatorIds = creatorIds.filter((id: string, i: number) => creatorIds.indexOf(id) === i);
      const profileMap: Record<string, any> = {};
      if (uniqueCreatorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles_public')
          .select('id, first_name_display, profile_photo_url')
          .in('id', uniqueCreatorIds);
        (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p; });
      }

      return plans.map((e: any) => {
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
          host: hp ? { id: hp.id, first_name: hp.first_name_display ?? null, avatar_url: hp.profile_photo_url ?? null } : null,
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

  const wishlistMutation = useMutation({
    mutationFn: async ({ planId, isCurrentlyWishlisted }: { planId: string; isCurrentlyWishlisted: boolean }) => {
      if (!userId) return;
      if (isCurrentlyWishlisted) {
        await supabase.from('wishlists').delete().eq('user_id', userId).eq('event_id', planId);
      } else {
        await supabase.from('wishlists').insert({ user_id: userId, event_id: planId });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wishlists', userId] });
      queryClient.invalidateQueries({ queryKey: ['wishlist-plans', userId] });
    },
    onError: () => {},
  });

  const handleWishlist = useCallback((planId: string, isCurrentlyWishlisted: boolean) => {
    wishlistMutation.mutate({ planId, isCurrentlyWishlisted });
  }, [wishlistMutation]);

  const displayPlans = useMemo(() => {
    if (!heartFilter) return allPlans;
    return allPlans.filter(p => wishlistedSet[p.id]);
  }, [allPlans, heartFilter, wishlistedSet]);

  const sections = useMemo(
    () => filterIntoSections(displayPlans, sectionDefs, categoryFilter, whenFilter),
    [displayPlans, sectionDefs, categoryFilter, whenFilter],
  );

  const whenLabel = whenFilter.length === 0
    ? 'When'
    : whenFilter.length === 1
      ? WHEN_OPTIONS.find((o) => o.key === whenFilter[0])?.label ?? 'When'
      : `When · ${whenFilter.length}`;

  const categoryLabel = categoryFilter.length === 0
    ? 'Category'
    : categoryFilter.length === 1 ? categoryFilter[0] : `Category · ${categoryFilter.length}`;

  const whenActive = whenFilter.length > 0;
  const categoryActive = categoryFilter.length > 0;

  // Plans to show on the map depend on which tab is active
  const mapPlans = useMemo(() => {
    if (activeTab === 'myplans') return myPlans;
    return allPlans;
  }, [activeTab, allPlans, myPlans]);

  const mapLoading = activeTab === 'myplans' ? myPlansLoading : isLoading;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Plans</Text>
        <ProfileButton />
      </View>

      {/* Tab Bar: Plans / My Plans */}
      <View style={styles.tabBar}>
        {(['plans', 'myplans'] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => { setActiveTab(tab); if (tab !== 'plans') setMapView(false); }}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'plans' ? 'Plans' : 'My Plans'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Filter Dropdowns + Map Toggle — only on the Plans tab */}
      {activeTab === 'plans' && (
        <View style={styles.filterRow}>
          <View style={styles.filterPillsWrap}>
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
          </View>

          <TouchableOpacity
            style={[styles.mapTogglePill, styles.mapTogglePillPinned, mapView && styles.mapTogglePillActive]}
            onPress={() => { Haptics.selectionAsync(); setMapView((v) => !v); }}
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
      )}

      {/* Map view — shared across all tabs, shows the relevant plans for the active tab */}
      {mapView ? (
        mapLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#C4652A" />
          </View>
        ) : (
          <MapView
            style={styles.map}
            initialRegion={LA_REGION}
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
                  pinColor={wishlistedSet[plan.id] ? '#E53935' : '#C4652A'}
                  onCalloutPress={() => router.push(`/plan/${plan.id}`)}
                />
              ))}
          </MapView>
        )
      ) : activeTab === 'plans' ? (
        <>
          {!userId || isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color="#C4652A" />
            </View>
          ) : isError ? (
            <View style={styles.centered}>
              <Text style={styles.errorTitle}>Couldn't load plans</Text>
              <Text style={styles.errorMessage}>{(error as Error)?.message ?? 'Unknown error'}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#C4652A" />
              }
            >
              {sections.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>
                    {heartFilter
                      ? 'When you <3 a plan it shows up here'
                      : allPlans.length > 0
                        ? 'No plans match your filters.'
                        : 'No plans yet.'}
                  </Text>
                  <TouchableOpacity style={styles.emptyButton} onPress={() => router.push('/(tabs)/post')}>
                    <Text style={styles.emptyButtonText}>Post a Plan</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                sections.map(({ def, plans }, idx) => (
                  <SectionRow
                    key={def.key}
                    def={def}
                    plans={plans}
                    wishlisted={wishlistedSet}
                    memberIds={memberIdSet}
                    onWishlist={handleWishlist}
                    isFirst={idx === 0}
                  />
                ))
              )}
              <View style={{ height: 32 }} />
            </ScrollView>
          )}
        </>
      ) : activeTab === 'myplans' ? (
        <View style={{ flex: 1 }}>
          <VerticalPlanList
            plans={myPlans}
            loading={myPlansLoading}
            wishlisted={wishlistedSet}
            memberIds={memberIdSet}
            onWishlist={handleWishlist}
            emptyMessage="You haven't joined any plans yet."
            emptyCta="Browse Plans"
            onEmptyCta={() => setActiveTab('plans')}
          />
        </View>
      ) : null}

      {/* When Sheet */}
      <FilterBottomSheet
        visible={whenSheetOpen}
        title="When"
        options={[...WHEN_OPTIONS]}
        selected={whenFilter}
        onToggle={(key) => setWhenFilter((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])}
        onClose={() => setWhenSheetOpen(false)}
        onClear={() => setWhenFilter([])}
      />

      {/* Category Sheet */}
      <FilterBottomSheet
        visible={categorySheetOpen}
        title="Category"
        options={CATEGORY_OPTIONS.map((c) => ({ key: c, label: c }))}
        selected={categoryFilter}
        onToggle={(key) => setCategoryFilter((prev) => {
          const c = key as CategoryOption;
          return prev.includes(c) ? prev.filter((k) => k !== c) : [...prev, c];
        })}
        onClose={() => setCategorySheetOpen(false)}
        onClear={() => setCategoryFilter([])}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF8F0' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: '#FFF8F0',
  },
  headerTitle: {
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 28,
    color: '#C4652A',
    textShadowColor: 'rgba(0,0,0,0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
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
  mapTogglePillPinned: {
    flexShrink: 0,
  },
  mapTogglePillActive: { backgroundColor: '#C4652A', borderColor: '#C4652A' },
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
  mapToggleLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  mapToggleLabelActive: {
    color: '#FFFFFF',
  },

  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 20,
  },
  filterPillsWrap: {
    flex: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
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
    flexShrink: 1,
    minWidth: 0,
  },
  dropdownPillActive: { backgroundColor: '#C4652A', borderColor: '#C4652A' },
  dropdownText: { fontSize: 14, fontWeight: '600', color: '#1A1A1A' },
  dropdownTextActive: { color: '#FFFFFF' },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 12,
    gap: 0,
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: '#C4652A' },
  tabText: { fontSize: 15, fontWeight: '600', color: '#999999' },
  tabTextActive: { color: '#1A1A1A' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  map: { flex: 1 },

  section: { marginBottom: 24 },
  sectionDivider: {
    height: 1,
    backgroundColor: '#F0E6D3',
    marginHorizontal: 20,
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  sectionTitle: { fontFamily: 'DMSerifDisplay_400Regular', fontSize: 28, color: '#1A1A1A' },
  seeAllButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  carouselContent: { paddingHorizontal: 20 },

  // Vertical list (My Plans / Wishlist)
  verticalListContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 },

  emptyState: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyText: { fontSize: 16, color: '#666666', textAlign: 'center', marginBottom: 20 },
  emptyButton: { backgroundColor: '#C4652A', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  emptyButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  errorTitle: { fontSize: 16, fontWeight: '700', color: '#1A1A1A', marginBottom: 8, textAlign: 'center' },
  errorMessage: { fontSize: 13, color: '#999999', textAlign: 'center', marginBottom: 20, paddingHorizontal: 32 },
  retryButton: { backgroundColor: '#C4652A', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  retryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
