import React, { useState, useCallback, useMemo, Suspense, lazy } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useNavigation } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { ChevronDown, ChevronRight, Heart, Map, LayoutList } from 'lucide-react-native';
import { supabase } from '../../../lib/supabase';
import { fetchPlans, Plan } from '../../../lib/fetchPlans';
import { PlanCard } from '../../../components/plans/PlanCard';
import { FilterBottomSheet } from '../../../components/FilterBottomSheet';
import ProfileButton from '../../../components/ProfileButton';
import { MapErrorBoundary } from '../../../components/MapErrorBoundary';
import { CATEGORY_OPTIONS, type CategoryOption } from '../../../constants/Categories';
import { WHEN_OPTIONS } from '../../../constants/WhenFilter';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';

// Lazy-load map to avoid crash on Expo Go / environments where react-native-maps fails
const LazyPlansMapView = lazy(() => import('../../../components/plans/PlansMapView'));

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
}

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
      plans_posted: plan.creator?.plans_posted ?? undefined,
    },
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
  const [pastExpanded, setPastExpanded] = useState(false);
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
  const [userIdTimedOut, setUserIdTimedOut] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    async function resolveUserId() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      const id = data.session?.user?.id ?? null;
      if (id) setUserId(id);
    }

    resolveUserId();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setUserId(session?.user?.id ?? null);
    });

    const t = setTimeout(() => {
      if (cancelled) return;
      setUserIdTimedOut(true);
    }, 5000);

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      clearTimeout(t);
    };
  }, []);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: allPlans = [], isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['events', 'feed', userId],
    queryFn: () => fetchPlans(userId!),
    enabled: !!userId,
    staleTime: 60_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    refetchOnMount: 'always',
  });

  const queryClient = useQueryClient();
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

  const wishlistMutation = useMutation({
    mutationFn: async ({ eventId, current }: { eventId: string; current: boolean }) => {
      if (!userId) return;
      if (current) {
        await supabase.from('wishlists').delete().eq('user_id', userId).eq('event_id', eventId);
      } else {
        await supabase.from('wishlists').insert({ user_id: userId, event_id: eventId });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wishlists', userId] });
    },
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
        .in('status', ['forming', 'active', 'full', 'completed']);

      const joinedEvents = (memberships ?? [])
        .map((m: any) => m.events)
        .filter((e: any) => e && ['forming', 'active', 'full', 'completed'].includes(e.status));

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

      const eventIds = allEvents.map((e: any) => e.id);
      const { data: memberRows } = await supabase
        .from('event_members')
        .select('event_id')
        .in('event_id', eventIds)
        .eq('status', 'joined');
      const countByEvent: Record<string, number> = {};
      (memberRows ?? []).forEach((r: { event_id: string }) => {
        countByEvent[r.event_id] = (countByEvent[r.event_id] ?? 0) + 1;
      });

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
          member_count: countByEvent[e.id] ?? e.member_count ?? 0,
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

  const myPlansUpcoming = useMemo(
    () => myPlans
      .filter((p) => ['forming', 'active', 'full'].includes(p.status))
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()),
    [myPlans],
  );

  const myPlansPast = useMemo(
    () => myPlans
      .filter((p) => p.status === 'completed')
      .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
      .slice(0, 20),
    [myPlans],
  );

  const myPlansSections = useMemo(() => {
    const s: { title: string; data: Plan[] }[] = [];
    if (myPlansUpcoming.length > 0) s.push({ title: 'Upcoming', data: myPlansUpcoming });
    if (myPlansPast.length > 0) s.push({ title: 'Past', data: pastExpanded ? myPlansPast : [] });
    return s;
  }, [myPlansUpcoming, myPlansPast, pastExpanded]);

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
  const categoryActive = categoryFilter.length > 0;
  const categoryLabel =
    categoryFilter.length === 0
      ? 'Category'
      : categoryFilter.length === 1
        ? categoryFilter[0]
        : `Category · ${categoryFilter.length}`;

  const mapPlans = useMemo(() => {
    if (activeTab === 'myplans') return myPlans;
    return allPlans;
  }, [activeTab, allPlans, myPlans]);

  const mapLoading = activeTab === 'myplans' ? myPlansLoading : isLoading;

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string } }) => {
      if (section.title === 'Past') {
        return (
          <TouchableOpacity
            style={styles.pastSectionHeader}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPastExpanded((v) => !v); }}
            activeOpacity={0.7}
          >
            <Text style={styles.sectionHeader}>{section.title}</Text>
            <View style={styles.pastChevronRow}>
              <Text style={styles.pastCount}>{myPlansPast.length}</Text>
              {pastExpanded
                ? <ChevronDown size={16} color={Colors.textLight} />
                : <ChevronRight size={16} color={Colors.textLight} />}
            </View>
          </TouchableOpacity>
        );
      }
      return <Text style={styles.sectionHeader}>{section.title}</Text>;
    },
    [pastExpanded, myPlansPast.length],
  );

  const renderItem = useCallback(
    ({ item }: { item: Plan }) => (
      <View style={styles.cardWrap}>
        <PlanCard
          plan={toPlanCardPlan(item)}
          isMember={!!memberIdSet[item.id]}
          isWishlisted={!!wishlistedSet[item.id]}
          onWishlist={(id, current) => wishlistMutation.mutate({ eventId: id, current })}
          isPast={item.status === 'completed'}
        />
      </View>
    ),
    [memberIdSet, wishlistedSet, wishlistMutation],
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
      {/* Header — logo + ProfileButton (Plans branding) */}
      <View style={styles.header}>
        <View style={styles.logoRow}>
          <Image source={require('../../../assets/images/washedup-logo.png')} style={styles.logo} contentFit="contain" />
        </View>
        <ProfileButton />
      </View>

      {/* Row 1: All Plans | My Plans */}
      <View style={styles.primaryChipsRow}>
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
              <Text
                style={[styles.primaryChipText, activeTab === tab && styles.primaryChipTextActive]}
                numberOfLines={1}
                allowFontScaling={false}
              >
                {tab === 'plans' ? 'All Plans' : 'My Plans'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Row 2: When, Category, Heart, Map — same layout as Scene tab */}
      {activeTab === 'plans' && (
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
      )}

      {/* Map view — lazy-loaded to avoid crash when react-native-maps fails (e.g. Expo Go) */}
      {mapView ? (
        mapLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.terracotta} />
          </View>
        ) : (
          <MapErrorBoundary onClose={() => setMapView(false)}>
            <Suspense fallback={
              <View style={styles.centered}>
                <ActivityIndicator size="large" color={Colors.terracotta} />
              </View>
            }>
              <LazyPlansMapView
                plans={mapPlans}
                wishlistedSet={wishlistedSet}
                onPlanPress={(id) => router.push(`/plan/${id}`)}
                onClose={() => setMapView(false)}
                onWishlist={(id, current) => wishlistMutation.mutate({ eventId: id, current })}
              />
            </Suspense>
          </MapErrorBoundary>
        )
      ) : activeTab === 'plans' ? (
        <>
          {userIdTimedOut && !userId ? (
            <View style={styles.centered}>
              <Text style={styles.errorTitle}>Having trouble loading</Text>
              <Text style={styles.errorMessage}>Sign in may have timed out. Try again or restart the app.</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => {
              setUserIdTimedOut(false);
              supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user?.id ?? null));
            }}>
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : !userId || isLoading ? (
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
              stickySectionHeadersEnabled={false}
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
          ) : myPlansSections.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>You haven't joined any plans yet.</Text>
              <TouchableOpacity style={styles.emptyButton} onPress={() => setActiveTab('plans')}>
                <Text style={styles.emptyButtonText}>Browse Plans</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <SectionList
              sections={myPlansSections}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              renderSectionHeader={renderSectionHeader}
              stickySectionHeadersEnabled={false}
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

      <FilterBottomSheet
        visible={categorySheetOpen}
        title="Category"
        options={CATEGORY_OPTIONS.map((c) => ({ key: c, label: c }))}
        selected={categoryFilter}
        onToggle={(key) =>
          setCategoryFilter((prev) =>
            prev.includes(key as CategoryOption) ? prev.filter((c) => c !== key) : [...prev, key as CategoryOption],
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
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logo: {
    width: 140,
    height: 32,
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
  primaryChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 20,
    alignItems: 'center',
  },
  filterSpacer: { flexGrow: 1, flexShrink: 0, minWidth: 4 },
  dropdownPill: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
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
  mapTogglePill: {
    flexShrink: 0,
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
  primaryChips: {
    flexDirection: 'row',
    gap: 0,
    borderRadius: 24,
    backgroundColor: Colors.border,
    padding: 4,
    flexShrink: 0,
  },
  primaryChip: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 110,
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
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  sectionHeader: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 12,
  },
  pastSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 12,
  },
  pastChevronRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pastCount: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textLight,
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
