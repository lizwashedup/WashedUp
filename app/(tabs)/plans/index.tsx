import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ChevronDown, ChevronRight, LayoutList, Map } from 'lucide-react-native';
import React, { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    RefreshControl,
    SectionList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FilterBottomSheet } from '../../../components/FilterBottomSheet';
import { MapErrorBoundary } from '../../../components/MapErrorBoundary';
import { SkeletonFeed } from '../../../components/SkeletonCard';
import MiniProfileCard from '../../../components/MiniProfileCard';
import { ReportModal } from '../../../components/modals/ReportModal';
import { PlanCard } from '../../../components/plans/PlanCard';
import { SaveSnackbar } from '../../../components/SaveSnackbar';
import { ShareSheet } from '../../../components/ShareSheet';
import ProfileButton from '../../../components/ProfileButton';
import WelcomeModal from '../../../components/WelcomeModal';
import { CATEGORY_OPTIONS, type CategoryOption } from '../../../constants/Categories';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { WHEN_OPTIONS } from '../../../constants/WhenFilter';
import { fetchPlans, fetchRealMemberCounts, Plan } from '../../../lib/fetchPlans';
import { supabase } from '../../../lib/supabase';
import { useBlock } from '../../../hooks/useBlock';

const TC = '#B5522E'; // terracotta primary accent

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
  neighborhood: string | null;
  slug: string | null;
  category: string | null;
  max_invites: number;
  member_count: number;
  creator: {
    id: string;
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
    neighborhood: plan.neighborhood ?? null,
    slug: plan.slug ?? null,
    category: plan.category ?? null,
    max_invites: plan.max_invites ?? 0,
    member_count: plan.member_count ?? 0,
    creator: {
      id: plan.creator?.id ?? '',
      first_name_display: plan.creator?.first_name_display ?? 'Creator',
      profile_photo_url: plan.creator?.profile_photo_url ?? null,
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
  const [now, setNow] = useState(() => new Date());
  useFocusEffect(useCallback(() => { setNow(new Date()); }, []));
  const sectionDefs = useMemo(() => getSectionDefs(now), [now]);

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
  const [reportTarget, setReportTarget] = useState<{ userId: string; userName: string; eventId: string } | null>(null);
  const [miniProfileUserId, setMiniProfileUserId] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ planId: string; planTitle: string } | null>(null);
  const [shareSheet, setShareSheet] = useState<{ planId: string; planTitle: string; slug: string | null } | null>(null);

  const [userId, setUserId] = React.useState<string | null>(null);
  const [userIdTimedOut, setUserIdTimedOut] = React.useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeName, setWelcomeName] = useState('');

  React.useEffect(() => {
    let cancelled = false;
    let initDone = false;

    async function init() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      const id = data.session?.user?.id ?? null;

      if (id) {
        // Run welcome modal check BEFORE starting data queries.
        // This gives onboarding profile writes time to fully propagate
        // in Supabase before the feed RPC reads them for gender/age filtering.
        try {
          const key = `has_seen_welcome_${id}`;
          const seen = await AsyncStorage.getItem(key);
          if (!seen && !cancelled) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('first_name_display')
              .eq('id', id)
              .single();
            if (!cancelled) {
              setWelcomeName(profile?.first_name_display ?? '');
              setShowWelcome(true);
            }
          }
        } catch {}
      }

      initDone = true;
      if (!cancelled) setUserId(id);
    }

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (!initDone) return;
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

  // Safety net: if the initial feed returns very few results (common for brand-new
  // accounts where the RPC may execute before profile data fully propagates),
  // auto-retry once after a short delay.
  const hasAutoRefetched = React.useRef(false);
  React.useEffect(() => {
    if (!isLoading && !isRefetching && !isError && userId && allPlans.length <= 1 && !hasAutoRefetched.current) {
      hasAutoRefetched.current = true;
      const t = setTimeout(() => refetch(), 1500);
      return () => clearTimeout(t);
    }
  }, [isLoading, isRefetching, isError, userId, allPlans.length, refetch]);

  const queryClient = useQueryClient();
  const { data: wishlistIds = [], isLoading: wishlistsLoading } = useQuery<string[]>({
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
    onError: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
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

      const { data: profilesData } = uniqueCreatorIds.length > 0
        ? await supabase.from('profiles_public').select('id, first_name_display, profile_photo_url').in('id', uniqueCreatorIds)
        : { data: [] as any[] };

      const profileMap: Record<string, any> = {};
      (profilesData ?? []).forEach((p: any) => { profileMap[p.id] = p; });

      const realCounts = await fetchRealMemberCounts(allEvents.map((e: any) => e.id));

      return allEvents.map((e: any) => {
        const hp = profileMap[e.creator_user_id] ?? null;
        return {
          id: e.id,
          title: e.title,
          start_time: e.start_time,
          location_text: e.location_text ?? null,
          location_lat: e.location_lat ?? null,
          location_lng: e.location_lng ?? null,
          image_url: e.image_url ?? null,
          category: e.primary_vibe ?? null,
          gender_rule: e.gender_rule ?? null,
          max_invites: e.max_invites ?? null,
          min_invites: e.min_invites ?? null,
          member_count: Math.max(1, realCounts[e.id] ?? e.member_count ?? 0),
          status: e.status ?? 'forming',
          host_message: e.host_message ?? null,
          creator: hp ? { id: hp.id, first_name_display: hp.first_name_display ?? null, profile_photo_url: hp.profile_photo_url ?? null } : null,
        } as Plan;
      });
    },
    enabled: !!userId,
    staleTime: 10_000,
    refetchOnMount: 'always',
  });

  const { data: waitlistedPlans = [] } = useQuery<Plan[]>({
    queryKey: ['waitlisted-plans', userId],
    queryFn: async () => {
      if (!userId) return [];

      // Step 1: get waitlisted event IDs (no FK on event_waitlist, so join won't work)
      const { data: waitlistRows } = await supabase
        .from('event_waitlist')
        .select('event_id')
        .eq('user_id', userId);

      const eventIds = (waitlistRows ?? []).map((w: any) => w.event_id as string);
      if (eventIds.length === 0) return [];

      // Step 2: fetch the actual events
      const { data: eventsData } = await supabase
        .from('events')
        .select('id, title, start_time, location_text, location_lat, location_lng, image_url, primary_vibe, gender_rule, max_invites, min_invites, member_count, status, creator_user_id, host_message')
        .in('id', eventIds)
        .in('status', ['forming', 'active', 'full']);

      const active = eventsData ?? [];
      if (active.length === 0) return [];

      const creatorIds = [...new Set(active.map((e: any) => e.creator_user_id).filter(Boolean))];
      const { data: profiles } = creatorIds.length > 0
        ? await supabase.from('profiles_public').select('id, first_name_display, profile_photo_url').in('id', creatorIds)
        : { data: [] as any[] };

      const profileMap: Record<string, any> = {};
      (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p; });

      const realCounts = await fetchRealMemberCounts(active.map((e: any) => e.id));

      return active.map((e: any) => {
        const hp = profileMap[e.creator_user_id] ?? null;
        return {
          id: e.id, title: e.title, start_time: e.start_time,
          location_text: e.location_text ?? null, location_lat: e.location_lat ?? null, location_lng: e.location_lng ?? null,
          image_url: e.image_url ?? null, category: e.primary_vibe ?? null, gender_rule: e.gender_rule ?? null,
          max_invites: e.max_invites ?? null, min_invites: e.min_invites ?? null,
          member_count: Math.max(1, realCounts[e.id] ?? e.member_count ?? 0), status: e.status ?? 'forming', host_message: e.host_message ?? null,
          creator: hp ? { id: hp.id, first_name_display: hp.first_name_display ?? null, profile_photo_url: hp.profile_photo_url ?? null } : null,
        } as Plan;
      });
    },
    enabled: !!userId,
    staleTime: 30_000,
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
      .filter((p) => ['forming', 'active', 'full'].includes(p.status) && new Date(p.start_time) >= now)
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()),
    [myPlans, now],
  );

  const myPlansPast = useMemo(
    () => myPlans
      .filter((p) => p.status === 'completed' || new Date(p.start_time) < now)
      .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
      .slice(0, 20),
    [myPlans, now],
  );

  const [waitlistExpanded, setWaitlistExpanded] = useState(false);

  const savedPlans = useMemo(
    () => allPlans.filter(p => wishlistedSet[p.id]),
    [allPlans, wishlistedSet],
  );

  const myPlansSections = useMemo(() => {
    const s: { title: string; data: Plan[] }[] = [];
    if (myPlansUpcoming.length > 0) s.push({ title: 'Upcoming', data: myPlansUpcoming });
    if (savedPlans.length > 0) s.push({ title: 'Saved', data: savedPlans });
    if (waitlistedPlans.length > 0) s.push({ title: 'Waitlisted', data: waitlistExpanded ? waitlistedPlans : [] });
    if (myPlansPast.length > 0) s.push({ title: 'Past', data: pastExpanded ? myPlansPast : [] });
    return s;
  }, [myPlansUpcoming, myPlansPast, pastExpanded, waitlistedPlans, waitlistExpanded, savedPlans]);

  const displayPlans = useMemo(() => {
    if (!heartFilter) return allPlans;
    return allPlans.filter((p) => wishlistedSet[p.id]);
  }, [allPlans, heartFilter, wishlistedSet]);

  const sections = useMemo(
    () => filterIntoSections(displayPlans, sectionDefs, categoryFilter, whenFilter),
    [displayPlans, sectionDefs, categoryFilter, whenFilter],
  );

  const sectionListData = useMemo(() => {
    return sections.map((s) => ({
      title: s.def.title,
      data: s.plans,
    })).filter((s) => s.data.length > 0);
  }, [sections]);

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
    if (activeTab === 'myplans') return myPlansUpcoming;
    return allPlans;
  }, [activeTab, allPlans, myPlansUpcoming]);

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
                ? <ChevronDown size={16} color={'#A09385'} />
                : <ChevronRight size={16} color={'#A09385'} />}
            </View>
          </TouchableOpacity>
        );
      }
      if (section.title === 'Waitlisted') {
        return (
          <TouchableOpacity
            style={styles.pastSectionHeader}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setWaitlistExpanded((v) => !v); }}
            activeOpacity={0.7}
          >
            <Text style={styles.sectionHeader}>{section.title}</Text>
            <View style={styles.pastChevronRow}>
              <Text style={styles.pastCount}>{waitlistedPlans.length}</Text>
              {waitlistExpanded
                ? <ChevronDown size={16} color={'#A09385'} />
                : <ChevronRight size={16} color={'#A09385'} />}
            </View>
          </TouchableOpacity>
        );
      }
      return <Text style={styles.sectionHeader}>{section.title}</Text>;
    },
    [pastExpanded, myPlansPast.length, waitlistExpanded, waitlistedPlans.length],
  );

  const { blockUser } = useBlock();

  const handleReport = useCallback((planId: string) => {
    const plan = [...allPlans, ...myPlans, ...waitlistedPlans].find((p) => p.id === planId);
    if (plan?.creator?.id) {
      setReportTarget({
        userId: plan.creator.id,
        userName: plan.creator.first_name_display ?? 'User',
        eventId: planId,
      });
    }
  }, [allPlans, myPlans, waitlistedPlans]);

  const handleBlock = useCallback((planId: string) => {
    const plan = [...allPlans, ...myPlans, ...waitlistedPlans].find((p) => p.id === planId);
    if (plan?.creator?.id) {
      blockUser(plan.creator.id, plan.creator.first_name_display ?? 'User');
    }
  }, [allPlans, myPlans, waitlistedPlans, blockUser]);

  const renderItem = useCallback(
    ({ item }: { item: Plan }) => (
      <View style={styles.cardWrap}>
        <PlanCard
          plan={toPlanCardPlan(item)}
          isMember={!!memberIdSet[item.id]}
          isWishlisted={!!wishlistedSet[item.id]}
          onWishlist={(id, current) => {
            wishlistMutation.mutate({ eventId: id, current });
            if (!current) {
              const plan = allPlans.find(p => p.id === id) ?? myPlans.find(p => p.id === id);
              setSnackbar({ planId: id, planTitle: plan?.title ?? '' });
            } else {
              setSnackbar(null);
            }
          }}
          onReport={handleReport}
          onBlock={handleBlock}
          onCreatorPress={(creatorId) => setMiniProfileUserId(creatorId)}
          isPast={item.status === 'completed'}
        />
      </View>
    ),
    [memberIdSet, wishlistedSet, wishlistMutation, handleReport, handleBlock, allPlans, myPlans],
  );

  const handleWelcomeDismiss = useCallback(async () => {
    setShowWelcome(false);
    if (userId) try { await AsyncStorage.setItem(`has_seen_welcome_${userId}`, '1'); } catch {}
  }, [userId]);

  const handleWelcomePost = useCallback(async () => {
    setShowWelcome(false);
    if (userId) try { await AsyncStorage.setItem(`has_seen_welcome_${userId}`, '1'); } catch {}
    router.push('/(tabs)/post');
  }, [userId]);

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

      {/* Row 1: All Plans | My Plans — full-width underline tabs */}
      <View style={styles.tabRow}>
        {(['plans', 'myplans'] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveTab(tab);
            }}
          >
            <Text
              style={[styles.tabText, activeTab === tab && styles.tabTextActive]}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {tab === 'plans' ? 'All Plans' : 'My Plans'}
            </Text>
          </TouchableOpacity>
        ))}
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
            <ChevronDown size={13} color={whenActive ? '#FFFFFF' : '#2C1810'} strokeWidth={2.5} />
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
            <ChevronDown size={13} color={categoryActive ? '#FFFFFF' : '#2C1810'} strokeWidth={2.5} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.savedPill, heartFilter && styles.savedPillActive]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setHeartFilter((v) => !v);
            }}
          >
            <Ionicons name={heartFilter ? 'bookmark' : 'bookmark-outline'} size={14} color={heartFilter ? '#FFFFFF' : '#2C1810'} />
            <Text style={[styles.savedPillText, heartFilter && styles.savedPillTextActive]}>Saved</Text>
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
              <LayoutList size={14} color={'#FFFFFF'} strokeWidth={2} />
            ) : (
              <Map size={14} color={'#2C1810'} strokeWidth={2} />
            )}
            <Text style={[styles.mapToggleLabel, mapView && styles.mapToggleLabelActive]}>
              {mapView ? 'List' : 'Map'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Row 2b: Map toggle for My Plans */}
      {activeTab === 'myplans' && (
        <View style={styles.myPlansFilterRow}>
          <TouchableOpacity
            style={[styles.mapTogglePill, mapView && styles.mapTogglePillActive]}
            onPress={() => {
              Haptics.selectionAsync();
              setMapView((v) => !v);
            }}
            accessibilityLabel={mapView ? 'Switch to list view' : 'Switch to map view'}
          >
            {mapView ? (
              <LayoutList size={14} color={'#FFFFFF'} strokeWidth={2} />
            ) : (
              <Map size={14} color={'#2C1810'} strokeWidth={2} />
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
            <ActivityIndicator size="large" color={TC} />
          </View>
        ) : (
          <MapErrorBoundary onClose={() => setMapView(false)}>
            <Suspense fallback={
              <View style={styles.centered}>
                <ActivityIndicator size="large" color={TC} />
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
          ) : !userId || isLoading || wishlistsLoading || myPlansLoading ? (
            <SkeletonFeed />
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
              initialNumToRender={30}
              maxToRenderPerBatch={20}
              windowSize={11}
              refreshControl={
                <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={TC} />
              }
            />
          )}
        </>
      ) : (
        <View style={{ flex: 1 }}>
          {myPlansLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={TC} />
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
              initialNumToRender={30}
              maxToRenderPerBatch={20}
              windowSize={11}
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

      <WelcomeModal
        visible={showWelcome}
        firstName={welcomeName}
        onDismiss={handleWelcomeDismiss}
        onPostPlan={handleWelcomePost}
      />

      {reportTarget && (
        <ReportModal
          visible
          onClose={() => setReportTarget(null)}
          reportedUserId={reportTarget.userId}
          reportedUserName={reportTarget.userName}
          eventId={reportTarget.eventId}
        />
      )}

      <MiniProfileCard
        visible={!!miniProfileUserId}
        userId={miniProfileUserId}
        onClose={() => setMiniProfileUserId(null)}
        onReport={(uid, uname) => {
          setMiniProfileUserId(null);
          setReportTarget({ userId: uid, userName: uname, eventId: '' });
        }}
        onBlock={(uid, uname) => {
          setMiniProfileUserId(null);
          blockUser(uid, uname);
        }}
      />

      <SaveSnackbar
        visible={!!snackbar}
        planId={snackbar?.planId ?? ''}
        planTitle={snackbar?.planTitle ?? ''}
        onShare={(id) => {
          setSnackbar(null);
          const plan = [...allPlans, ...myPlans, ...waitlistedPlans].find(p => p.id === id);
          setShareSheet({ planId: id, planTitle: plan?.title ?? '', slug: plan?.slug ?? null });
        }}
        onDismiss={() => setSnackbar(null)}
      />

      <ShareSheet
        visible={!!shareSheet}
        planId={shareSheet?.planId ?? ''}
        planTitle={shareSheet?.planTitle ?? ''}
        slug={shareSheet?.slug}
        onClose={() => setShareSheet(null)}
      />

    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAF5EC' },
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
    width: 122,
    height: 28,
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
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5DDD1',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Full-width underline tabs ──
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
    borderBottomColor: TC,
  },
  tabText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: '#A09385',
  },
  tabTextActive: {
    color: '#2C1810',
    fontFamily: Fonts.sansBold,
  },

  // ── Filters ──
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 20,
    alignItems: 'center',
  },
  filterSpacer: { flexGrow: 1, flexShrink: 0, minWidth: 4 },
  myPlansFilterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  dropdownPill: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5DDD1',
  },
  dropdownPillActive: {
    backgroundColor: TC,
    borderColor: TC,
  },
  dropdownText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: '#2C1810',
  },
  dropdownTextActive: {
    color: '#FFFFFF',
  },
  savedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5DDD1',
  },
  savedPillActive: {
    backgroundColor: '#B5522E',
    borderColor: '#B5522E',
  },
  savedPillText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#2C1810',
  },
  savedPillTextActive: {
    color: '#FFFFFF',
  },
  mapTogglePill: {
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5DDD1',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  mapTogglePillActive: {
    backgroundColor: '#2C1810',
    borderColor: '#2C1810',
  },
  mapToggleLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.micro,
    color: '#2C1810',
  },
  mapToggleLabelActive: {
    color: '#FFFFFF',
  },

  // ── List ──
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  sectionHeader: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 11,
    color: TC,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
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
    color: '#A09385',
  },
  cardWrap: {
    marginBottom: 14,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  map: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: '#78695C', textAlign: 'center', marginBottom: 20 },
  emptyButton: { backgroundColor: TC, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 999 },
  emptyButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: '#FFFFFF' },
  errorTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: '#2C1810', marginBottom: 8, textAlign: 'center' },
  errorMessage: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: '#78695C', textAlign: 'center', marginBottom: 20, paddingHorizontal: 32 },
  retryButton: { backgroundColor: TC, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 999 },
  retryButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: '#FFFFFF' },
});
