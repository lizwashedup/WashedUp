import { usePreviousPlansOnDisconnect } from '../../../hooks/usePreviousPlansOnDisconnect';
import { WelcomeLoading } from '../../../components/plans/PlansWelcomeLoading';
import { baseStyles, afterglowStyles } from '../../../components/plans/plansDiscoveryStyles';
import { getSectionDefs, groupIntoFeedItems, filterIntoSections, type FeedItem } from '../../../lib/plansDiscoverySections';
import { fetchFeaturedPlans, type FeaturedPlan } from '../../../lib/fetchFeaturedPlans';
import { getFeedEmptyCopy, plansOutsideFeatured } from '../../../lib/feedPresentation';
import { SunsetWordmark } from '../../../components/SunsetWordmark';
import { CreatorActionFill } from '../../../components/creator/CreatorActionFill';
import { MEMBER_REDESIGN_APPEARANCE_ENABLED } from '../../../constants/MemberAppearance';
import { readFeedMemberIds } from '../../../lib/feedMembership';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { hapticLight, hapticMedium, hapticHeavy, hapticSelection, hapticSuccess, hapticWarning, hapticError } from '../../../lib/haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { Calendar, ChevronDown, LayoutList, Map } from 'lucide-react-native';
import React, { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    FlatList,
    Modal,
    Pressable,
    RefreshControl,
    ScrollView,
    SectionList,
    Text,
    TouchableOpacity,
    View,
    useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FilterBottomSheet } from '../../../components/FilterBottomSheet';
import { CreatorSpaceBanner } from '../../../components/creator/CreatorSpaceBanner';
import { MapErrorBoundary } from '../../../components/MapErrorBoundary';
import { SkeletonFeed } from '../../../components/SkeletonCard';
import MiniProfileCard from '../../../components/MiniProfileCard';
import { ReportModal } from '../../../components/modals/ReportModal';
import { FeaturedEventCard } from '../../../components/plans/FeaturedEventCard';
import { PlanCard } from '../../../components/plans/PlanCard';
import { SaveSnackbar } from '../../../components/SaveSnackbar';
import { ShareSheet } from '../../../components/ShareSheet';
import ProfileButton from '../../../components/ProfileButton';
import { CATEGORY_OPTIONS, type CategoryOption } from '../../../constants/Categories';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { COMMUNITY_CHAT_GROUPING_ENABLED } from '../../../constants/FeatureFlags';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { usePlansEntry } from '../../../hooks/usePlansEntry';
import { useFeedWishlist } from '../../../hooks/useFeedWishlist';
import { usePlansNearMe } from '../../../hooks/usePlansNearMe';
import { WHEN_OPTIONS } from '../../../constants/WhenFilter';
import { fetchPlans, Plan } from '../../../lib/fetchPlans';
import { toPlanCardPlan } from '../../../lib/creatorMarks';
import { getLADayParts, dayKey, MONTHS } from '../../../lib/laDate';
import { WhenCalendarSheet } from '../../../components/plans/WhenCalendarSheet';
import { type CalendarDay } from '../../../components/calendar/WashedUpCalendar';
import { withTimeout, withDeadline } from '../../../lib/withTimeout';
import { friendlyError } from '../../../lib/friendlyError';
import { postAuthTransitionRef } from '../../../lib/navState';
import { usePlanFeedModeration } from '../../../hooks/usePlanFeedModeration';
import { isPlanPast } from '../../../lib/planTime';
import { usePlansProfilePrompt } from '../../../hooks/usePlansProfilePrompt';

const wLogo = require('../../../assets/images/w-logo-waves.png');

// Hard ceiling on how long the welcome overlay may capture touches. The overlay
// blocks the whole app while data loads; if a feed query never settles (a
// half-open socket on a flaky connection — supabase-js has no client-side
// timeout), `dataReady` would stay false forever and the user gets a rendered
// but unresponsive front page. Mirrors the cold-start auth watchdog in
// app/_layout.tsx: after this deadline the overlay releases regardless, so it
// can never trap the user. (Reported 2026-05-29.)
const WELCOME_OVERLAY_MAX_MS = 10000;
// Per-query upper bounds so a never-settling request can't pin the loading
// gates. Feed uses withDeadline (rejects → React Query retry/isError still
// work); the lighter queries use withTimeout (resolve empty — they already
// degrade to [] on error, so this preserves observable behavior).
const EMPTY_PLANS: Plan[] = [];
const FEED_DEADLINE_MS = 15000;
const WISHLISTS_TIMEOUT_MS = 8000;
const MEMBER_IDS_TIMEOUT_MS = 8000;

// Lazy-load map to avoid crash on Expo Go / environments where react-native-maps fails
const LazyPlansMapView = lazy(() => import('../../../components/plans/PlansMapView'));

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PlansScreen() {
  const { fonts } = useAfterglowFonts(COMMUNITY_CHAT_GROUPING_ENABLED);
  const appearance = useMemo(() => MEMBER_REDESIGN_APPEARANCE_ENABLED ? { fonts } : undefined, [fonts]);
  const { width } = useWindowDimensions();
  const styles = useMemo(() => appearance ? { ...baseStyles, ...afterglowStyles(fonts, width) } : baseStyles, [appearance, fonts, width]);
  const accent = appearance ? AfterglowColors.clay : Colors.terracotta;
  const muted = appearance ? AfterglowColors.muted : Colors.secondary;
  const [now, setNow] = useState(() => new Date());
  // Only update `now` when the calendar date actually changes (not every
  // focus). Section headers ("Tonight", "This Weekend") only care about
  // the date, not the minute. Updating every focus caused an unnecessary
  // full re-render + layout shift that looked like a flicker on Android.
  useFocusEffect(useCallback(() => {
    const fresh = new Date();
    setNow(prev => {
      if (prev.toDateString() === fresh.toDateString()) return prev;
      return fresh;
    });
  }, []));
  const sectionDefs = useMemo(() => getSectionDefs(now), [now]);

  const [mapView, setMapView] = useState(false);
  // Near-me (WS-6): OFF by default. Location is requested just-in-time only on
  // the tap, never at startup. When off, the feed query omits geo params so the
  // default feed is byte-identical to before (off-state parity).
  const {
    active: nearMeActive, coords: nearMeCoords, notice: nearMeNotice,
    pending: nearMePending, pendingLabel: nearMePendingLabel,
    toggle: handleNearMeToggle, recover: handleNearMeRecovery, clear: clearNearMe,
  } = usePlansNearMe();
  // Default 25mi (not 10): p_radius_km is a hard server-side filter and the feed
  // is thin, so a tighter default too often returns an empty Near-me. Wider
  // default = the first tap usually shows something; presets let users narrow.
  const [radiusMi, setRadiusMi] = useState(25);
  const radiusKm = radiusMi * 1.60934;
  const navigation = useNavigation();

  React.useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress' as any, () => {
      if (mapView) setMapView(false);
    });
    return unsubscribe;
  }, [navigation, mapView]);

  const [whenSheetOpen, setWhenSheetOpen] = useState(false);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [whenFilter, setWhenFilter] = useState<string[]>([]);
  // When-calendar: a specific LA day chosen from the grid. Mutually exclusive
  // with the coarse whenFilter buckets (selecting one clears the other).
  const [dayFilter, setDayFilter] = useState<CalendarDay | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryOption[]>([]);
  const [snackbar, setSnackbar] = useState<{ planId: string; planTitle: string } | null>(null);
  const [shareSheet, setShareSheet] = useState<{ planId: string; planTitle: string; slug: string | null } | null>(null);

  const { userId, accountUnavailable, retry: retryAccount, showWelcome, dismissWelcome, welcomeChecked, isCurrentAccount } = usePlansEntry();
  const saveOverlayOwner = useMemo(() => ({ userId }), [userId]);
  const saveOverlayOwnerRef = useRef(saveOverlayOwner); saveOverlayOwnerRef.current = saveOverlayOwner;
  useFocusEffect(useCallback(() => {
    setSnackbar(null); setShareSheet(null);
    return () => { setSnackbar(null); setShareSheet(null); };
  }, [saveOverlayOwner]));
  const welcomeBannerOpacity = useMemo(() => new Animated.Value(1), [userId]);
  const [welcomeOverlayDone, setWelcomeOverlayDone] = useState(false);
  // Backstop so the welcome overlay can never block touches forever if the
  // feed queries never settle. Set true by a watchdog timer below.
  const [welcomeWatchdogFired, setWelcomeWatchdogFired] = useState(false);
  // One-shot consume of the post-auth transition flag. Any sign-in path
  // (login.tsx, verify-code.tsx) sets `postAuthTransitionRef.active`; we
  // read once on mount so the WelcomeLoading overlay covers the
  // skeleton-blink even for existing users who've already dismissed the
  // first-visit welcome banner.
  const [postAuthTransition] = useState(() => {
    if (postAuthTransitionRef.active) {
      postAuthTransitionRef.active = false;
      return true;
    }
    return false;
  });
  const profilePrompt = usePlansProfilePrompt(userId, welcomeChecked, isCurrentAccount);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const feedArea = nearMeActive ? `near:${nearMeCoords!.lat.toFixed(3)},${nearMeCoords!.lng.toFixed(3)},${radiusMi}` : 'all';
  const { data: feedData, status: feedStatus, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['events', 'feed', userId, feedArea],
    // Bounded so a stuck request rejects (and retries) instead of hanging the
    // loading gate forever. See FEED_DEADLINE_MS.
    queryFn: () => withDeadline(
      fetchPlans(userId!, nearMeActive ? { lat: nearMeCoords!.lat, lng: nearMeCoords!.lng, radiusKm } : undefined),
      FEED_DEADLINE_MS, 'feed',
    ),
    enabled: !!userId,
    staleTime: 60_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    // NOTE: do NOT add refetchOnMount:'always' here. The Plans screen
    // remounts on every tab switch / app foreground; forcing a network
    // refetch each time returned fresh array refs that recreated the
    // SectionList render callbacks, full-re-rendering the feed on every
    // focus. On heavy accounts this pegged the JS thread (frozen app);
    // for everyone else it was the app-wide slowness (incident
    // 2026-05-18). staleTime:60_000 already keeps the feed fresh while
    // serving the cached (referentially-stable) array on remount.
  });

  const allPlans = feedData ?? EMPTY_PLANS;
  const showPreviousFeed = usePreviousPlansOnDisconnect(feedStatus, feedData, error, isCurrentAccount, feedArea);

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

  const savedPlans = useFeedWishlist(userId, (eventId, title) => setSnackbar({ planId: eventId, planTitle: title }));
  const { data: wishlistIds = [], isLoading: wishlistsLoading } = savedPlans;

  // ── Featured events query ────────────────────────────────────────────────────
  const { data: featuredPlans = [], refetch: refetchFeatured, isRefetching: isFeaturedRefetching } = useQuery<FeaturedPlan[]>({
    queryKey: ['events', 'featured', userId],
    queryFn: () => withDeadline(fetchFeaturedPlans(userId!), FEED_DEADLINE_MS, 'featured feed'),
    enabled: !!userId,
    staleTime: 60_000,
  });

  // Lightweight, bounded, NON-BLOCKING membership lookup. The feed RPC does not
  // return a per-card membership flag. Confirmed membership gives cards the
  // Going state and removes admission prompts. Fetch just the
  // joined + created event ids (ids only) so the feed renders immediately and
  // isMember fills in once this resolves; withTimeout-bounded so it can never
  // pin the feed load. The full My Plans data now lives in the Yours tab.
  const { data: memberIds = [], refetch: refetchMembership } = useQuery<string[]>({
    queryKey: ['feed-member-ids', userId],
    queryFn: () => withTimeout((async () => {
      if (!userId) return [];
      return readFeedMemberIds(userId);
    })(), MEMBER_IDS_TIMEOUT_MS, []),
    enabled: !!userId,
    staleTime: 30_000,
  });

  const refreshFeed = useCallback(() => Promise.allSettled([
    refetch(), refetchFeatured(), refetchMembership(),
  ]), [refetch, refetchFeatured, refetchMembership]);

  const wishlistedSet = useMemo(() => {
    const lookup: Record<string, boolean> = {};
    wishlistIds.forEach((id: string) => { lookup[id] = true; });
    return lookup;
  }, [wishlistIds]);

  const memberIdSet = useMemo(() => {
    const lookup: Record<string, boolean> = {};
    memberIds.forEach((id: string) => { lookup[id] = true; });
    return lookup;
  }, [memberIds]);

  // Gold-dot days for the When calendar: every LA day that has >=1 visible
  // plan. Derived from allPlans (already visibility + Near-me-radius filtered
  // server-side), so the dots respect Where automatically. (Category refinement
  // of the dots is a small follow-up; the tap-to-day filter respects Category.)
  const dayFilterKey = dayFilter ? dayKey(dayFilter.year, dayFilter.month, dayFilter.day) : null;
  const markedDays = useMemo(() => {
    const set = new Set<string>();
    for (const p of plansOutsideFeatured(allPlans, featuredPlans)) {
      const { y, m, d } = getLADayParts(p.start_time);
      set.add(dayKey(y, m, d));
    }
    return set;
  }, [allPlans, featuredPlans]);

  const displayPlans = useMemo(() => {
    // Remove only cards actually present in the carousel. An eligible feed
    // row must not disappear merely because the separate featured read failed.
    let result = plansOutsideFeatured(allPlans, featuredPlans);
    if (dayFilterKey) {
      result = result.filter((p) => {
        const { y, m, d } = getLADayParts(p.start_time);
        return dayKey(y, m, d) === dayFilterKey;
      });
    }
    return result;
  }, [allPlans, featuredPlans, dayFilterKey]);

  const feedItems = useMemo(() => groupIntoFeedItems(displayPlans), [displayPlans]);

  const sections = useMemo(
    () => filterIntoSections(feedItems, sectionDefs, categoryFilter, whenFilter),
    [feedItems, sectionDefs, categoryFilter, whenFilter],
  );

  const sectionListData = useMemo(() => {
    return sections.map((s) => ({
      title: s.def.title,
      data: s.items,
    })).filter((s) => s.data.length > 0);
  }, [sections]);

  const whenLabel = dayFilter
    ? `${MONTHS[dayFilter.month].slice(0, 3)} ${dayFilter.day}`
    : whenFilter.length === 0
      ? 'When'
      : whenFilter.length === 1
        ? WHEN_OPTIONS.find((o) => o.key === whenFilter[0])?.label ?? 'When'
        : `When · ${whenFilter.length}`;

  const whenActive = whenFilter.length > 0 || !!dayFilter;
  const categoryActive = categoryFilter.length > 0;
  const categoryLabel =
    categoryFilter.length === 0
      ? 'Category'
      : categoryFilter.length === 1
        ? categoryFilter[0]
        : `Category · ${categoryFilter.length}`;

  const mapPlans = allPlans;
  const mapLoading = isLoading;

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string } }) => {
      return <Text style={styles.sectionHeader}>{section.title}</Text>;
    },
    [styles],
  );

  const { handleReport, handleBlock, reportPerson, blockPerson, reportTarget, closeReport, scope: feedVisit } = usePlanFeedModeration(
    userId, isCurrentAccount, allPlans, featuredPlans,
  );

  // Keep card callbacks stable so typing, saving, and other feed state changes
  // do not defeat PlanCard's memoization and redraw every visible card.
  const allPlansRef = useRef(allPlans);
  allPlansRef.current = allPlans;
  const wishlistToggleRef = useRef(savedPlans.toggle);
  wishlistToggleRef.current = savedPlans.toggle;
  const handleWishlist = useCallback((id: string, _current: boolean) => {
    setSnackbar(null);
    const plan = allPlansRef.current.find(candidate => candidate.id === id);
    wishlistToggleRef.current(id, plan?.title ?? '');
  }, []);
  const handleFeaturedWishlist = useCallback((id: string, _current: boolean) => {
    wishlistToggleRef.current(id, '', false);
  }, []);
  const [miniProfile, setMiniProfile] = useState<{ id: string; visit: NonNullable<typeof feedVisit> } | null>(null);
  const miniProfileUserId = miniProfile?.visit === feedVisit && feedVisit?.isCurrent() ? miniProfile.id : null;
  const handleCreatorPress = useCallback((creatorId: string) => {
    if (feedVisit?.isCurrent()) setMiniProfile({ id: creatorId, visit: feedVisit });
  }, [feedVisit]);

  const renderItem = useCallback(
    ({ item }: { item: Plan }) => (
      <View style={styles.cardWrap}>
        <PlanCard
          layout="creator-first"
          plan={toPlanCardPlan(item)}
          appearance={appearance}
          wishlistPending={savedPlans.pending(item.id)}
          wishlistDisabled={!savedPlans.canWrite}
          isMember={!!memberIdSet[item.id]}
          isWishlisted={!!wishlistedSet[item.id]}
          onWishlist={handleWishlist}
          onReport={handleReport}
          onBlock={handleBlock}
          onCreatorPress={handleCreatorPress}
          isPast={isPlanPast(item.start_time, item.end_time)}
        />
      </View>
    ),
    [memberIdSet, wishlistedSet, handleWishlist, handleReport, handleBlock, handleCreatorPress, appearance, styles, savedPlans.revision, savedPlans.feedback, savedPlans.canWrite],
  );

  // Renders a cluster of duplicate plans as a horizontal scroll. Each member
  // is the same PlanCard used at full width, just constrained to a 300px
  // wrapper to match the featured carousel's visual density.
  const renderFeedItem = useCallback(
    ({ item }: { item: FeedItem }) => {
      if (item.kind === 'standalone') {
        return renderItem({ item: item.plan });
      }
      return (
        <View style={styles.clusterSection}>
          <Text style={styles.clusterHeaderText}>{appearance ? 'More people, same plan' : 'popular plans'}</Text>
          <FlatList
            decelerationRate="normal"
            horizontal
            data={item.plans}
            keyExtractor={(p) => p.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.clusterScrollContent}
            renderItem={({ item: p }) => (
              <View style={styles.clusterCardWrap}>
                <PlanCard
          layout="creator-first"
                  plan={toPlanCardPlan(p)}
                  appearance={appearance}
                  wishlistPending={savedPlans.pending(p.id)}
                  wishlistDisabled={!savedPlans.canWrite}
                  isMember={!!memberIdSet[p.id]}
                  isWishlisted={!!wishlistedSet[p.id]}
                  onWishlist={handleWishlist}
                  onReport={handleReport}
                  onBlock={handleBlock}
                  onCreatorPress={handleCreatorPress}
                  isPast={isPlanPast(p.start_time, p.end_time)}
                />
              </View>
            )}
          />
        </View>
      );
    },
    [renderItem, memberIdSet, wishlistedSet, handleWishlist, handleReport, handleBlock, handleCreatorPress, appearance, styles, savedPlans.revision, savedPlans.feedback, savedPlans.canWrite],
  );

  const handleWelcomeDismiss = useCallback(() => {
    Animated.timing(welcomeBannerOpacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      dismissWelcome();
    });
  }, [welcomeBannerOpacity, dismissWelcome]);

  // ── Featured events section ──────────────────────────────────────────────────
  const featuredSection = useMemo(() => {
    if (featuredPlans.length === 0) return null;
    const solo = featuredPlans.length === 1;
    return (
      <View style={styles.featuredSection}>
        <View style={styles.featuredHeaderRow}>
          <Ionicons name="star" size={14} color={Colors.goldenAmber} />
          <Text style={styles.featuredHeaderText}>{appearance ? 'Featured' : 'featured'}</Text>
        </View>
        {solo ? (
          <View style={styles.featuredSoloWrap}>
            <FeaturedEventCard
              plan={featuredPlans[0]}
              appearance={appearance}
              wishlistPending={savedPlans.pending(featuredPlans[0].id)}
              wishlistDisabled={!savedPlans.canWrite}
              isMember={!!memberIdSet[featuredPlans[0].id]}
              isWishlisted={!!wishlistedSet[featuredPlans[0].id]}
              onWishlist={handleFeaturedWishlist}
              onReport={handleReport}
              onBlock={handleBlock}
              solo
            />
          </View>
        ) : (
          <FlatList
            decelerationRate="normal"
            horizontal
            data={featuredPlans}
            keyExtractor={(item) => item.id}
            showsHorizontalScrollIndicator={false}
            style={styles.featuredScroll}
            contentContainerStyle={styles.featuredScrollContent}
            renderItem={({ item }) => (
              <FeaturedEventCard
                plan={item}
                appearance={appearance}
                wishlistPending={savedPlans.pending(item.id)}
                wishlistDisabled={!savedPlans.canWrite}
                isMember={!!memberIdSet[item.id]}
                isWishlisted={!!wishlistedSet[item.id]}
                onWishlist={handleFeaturedWishlist}
                onReport={handleReport}
                onBlock={handleBlock}
              />
            )}
          />
        )}
      </View>
    );
  }, [featuredPlans, memberIdSet, wishlistedSet, handleFeaturedWishlist, handleReport, handleBlock, appearance, styles, savedPlans.revision, savedPlans.feedback, savedPlans.canWrite]);

  // First-visit welcome banner. Renders inline at the top of the feed.
  // Uses the same persistence (welcome_seen_at + AsyncStorage) as before;
  // dismiss fades out then unmounts.
  const welcomeBanner = showWelcome ? (
    <Animated.View
      style={[styles.welcomeBannerOuter, { opacity: welcomeBannerOpacity }]}
    >
      <LinearGradient
        colors={[Colors.creamWarm, Colors.brandSoft]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.welcomeBannerInner}
      >
        <Image
          source={wLogo}
          style={styles.welcomeBannerLogo}
          contentFit="contain"
          tintColor={Colors.brand}
        />
        <Text style={styles.welcomeBannerText}>
          people are making plans this week. jump in on one.
        </Text>
        <TouchableOpacity
            accessibilityRole="button"
          onPress={handleWelcomeDismiss}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.welcomeBannerCloseHit}
        >
          <Ionicons name="close" size={15} color={Colors.text3} />
        </TouchableOpacity>
      </LinearGradient>
    </Animated.View>
  ) : null;

  const listHeader = (
    <>
      {/* the approved organizer's front door (7-21): grant-gated, renders
          nothing for everyone else */}
      <CreatorSpaceBanner />
      {showPreviousFeed && (
        <View style={styles.feedback} accessibilityLiveRegion="polite">
          <Text style={styles.feedbackText}>Couldn’t refresh plans. Showing the last list you loaded.</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry refreshing plans"
            disabled={isRefetching} accessibilityState={{ disabled: isRefetching, busy: isRefetching }}
            style={styles.feedbackAction} onPress={() => { void refetch(); }}>
            <Text style={styles.feedbackActionText}>{isRefetching ? 'Retrying…' : 'Try again'}</Text>
          </TouchableOpacity>
        </View>
      )}
      {welcomeBanner}
      {featuredSection}
    </>
  );

  const listEmpty = sections.length === 0;

  // First-visit overlay readiness: feed is mounted underneath as soon as
  // userId + all loading queries resolve. The overlay watches this flag
  // (plus its own min-display timer) to decide when to fade away.
  const dataReady = !!userId && !isLoading && !wishlistsLoading;
  const showWelcomeOverlay = (showWelcome || postAuthTransition) && !welcomeOverlayDone;

  // Once the feed is usable, a late optional greeting stays inline.
  React.useEffect(() => {
    if (dataReady && !showWelcomeOverlay) setWelcomeOverlayDone(true);
  }, [dataReady, showWelcomeOverlay]);

  // Watchdog: while the overlay is up and data hasn't resolved, arm a timer
  // that force-releases it. Guarantees the app becomes touchable within
  // WELCOME_OVERLAY_MAX_MS even if a query never settles underneath.
  React.useEffect(() => {
    if (!showWelcomeOverlay || dataReady || welcomeWatchdogFired) return;
    const t = setTimeout(() => setWelcomeWatchdogFired(true), WELCOME_OVERLAY_MAX_MS);
    return () => clearTimeout(t);
  }, [showWelcomeOverlay, dataReady, welcomeWatchdogFired]);

  // The overlay treats "watchdog fired" the same as "data ready": stop
  // capturing touches and begin its exit. Data keeps loading underneath.
  const overlayReady = dataReady || welcomeWatchdogFired;
  const hasFilters = whenActive || categoryActive || nearMeActive;
  const emptyCopy = getFeedEmptyCopy({
    hasFeatured: featuredPlans.length > 0, whenOrCategory: whenActive || categoryActive,
    nearMe: nearMeActive, redesigned: !!appearance,
  });

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header — logo + ProfileButton (Plans branding) */}
      <View style={styles.header}>
        <View style={styles.logoRow}>
          {appearance ? <Text style={styles.screenTitle}>Plans</Text> : <SunsetWordmark style={styles.logo} />}
        </View>
        <ProfileButton />
      </View>

      {/* The four filters center as a group on roomy phones and become a
          quiet horizontal strip when Dynamic Type or a narrow screen needs
          more width. This keeps the final Map control reachable instead of
          squeezing or clipping the row. */}
      {!mapView && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, flexShrink: 0 }}
          contentContainerStyle={styles.filterRow}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Filter by date"
            accessibilityState={{ expanded: whenSheetOpen, selected: whenActive }}
            style={[styles.filterPill, whenActive && styles.filterPillActive]}
            onPress={() => {
              hapticLight();
              setWhenSheetOpen(true);
            }}
          >
            <Calendar size={14} color={whenActive ? Colors.white : muted} strokeWidth={2} />
            <Text style={[styles.filterPillText, whenActive && styles.filterPillTextActive]} numberOfLines={1}>
              {whenLabel}
            </Text>
            <ChevronDown size={10} color={whenActive ? Colors.white : muted} strokeWidth={2.5} />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Filter by category"
            accessibilityState={{ expanded: categorySheetOpen, selected: categoryActive }}
            style={[styles.filterPill, categoryActive && styles.filterPillActive]}
            onPress={() => {
              hapticLight();
              setCategorySheetOpen(true);
            }}
          >
            <Text style={[styles.filterPillText, categoryActive && styles.filterPillTextActive]} numberOfLines={1}>
              {categoryLabel}
            </Text>
            <ChevronDown size={10} color={categoryActive ? Colors.white : muted} strokeWidth={2.5} />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.filterPill, nearMeActive && styles.filterPillActive]}
            onPress={handleNearMeToggle}
            disabled={nearMePending}
            accessibilityState={{ disabled: nearMePending, busy: nearMePending, selected: nearMeActive }}
            accessibilityLabel={nearMeActive ? 'Turn off near me' : 'Show plans near me'}
          >
            {nearMePending ? <ActivityIndicator size="small" color={accent} /> : <Ionicons name="location-outline" size={14} color={nearMeActive ? Colors.white : muted} />}
            <Text style={[styles.filterPillText, nearMeActive && styles.filterPillTextActive]}>Near me</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.filterPill, mapView && styles.filterPillActive]}
            onPress={() => {
              hapticSelection();
              setMapView((v) => !v);
            }}
            accessibilityLabel={mapView ? 'Switch to list view' : 'Switch to map view'}
          >
            {mapView ? (
              <LayoutList size={14} color={Colors.white} strokeWidth={2} />
            ) : (
              <Map size={14} color={muted} strokeWidth={2} />
            )}
            <Text style={[styles.filterPillText, mapView && styles.filterPillTextActive]}>
              {mapView ? 'List' : 'Map'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Near-me: radius presets + permission-deny notice (list view only) */}
      {nearMeActive && !mapView && (
        <View style={styles.radiusRow}>
          {[5, 10, 25].map((mi) => (
            <TouchableOpacity
            accessibilityRole="button"
              key={mi}
              style={[styles.radiusPill, radiusMi === mi && styles.radiusPillActive]}
              onPress={() => { hapticLight(); setRadiusMi(mi); }}
            >
              <Text style={[styles.radiusPillText, radiusMi === mi && styles.radiusPillTextActive]}>{mi} mi</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {nearMePending ? (
        <View style={styles.nearMeNotice} accessibilityLiveRegion="polite">
          <Text style={styles.nearMeNoticeText}>{nearMePendingLabel}</Text>
        </View>
      ) : nearMeNotice ? (
        <TouchableOpacity
            accessibilityRole="button"
          style={styles.nearMeNotice}
          onPress={handleNearMeRecovery}
          accessibilityLabel={nearMeNotice.reason === 'denied' ? 'Open location settings' : 'Try again to find your location'}
        >
          <Text style={styles.nearMeNoticeText}>{nearMeNotice.message}</Text>
        </TouchableOpacity>
      ) : null}

      {savedPlans.identityError ? (
        <View style={styles.feedback} accessibilityLiveRegion="polite">
          <Text style={styles.feedbackText}>Couldn't check your account. Try again to save plans.</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry account check" style={styles.feedbackAction} onPress={() => { void savedPlans.retryIdentity(); }}>
            <Text numberOfLines={1} style={styles.feedbackActionText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : savedPlans.identityLoading && userId ? (
        <View style={styles.feedback} accessibilityLiveRegion="polite"><ActivityIndicator color={accent} /><Text style={styles.feedbackText}>Checking your account…</Text></View>
      ) : savedPlans.isError ? (
        <View style={styles.feedback} accessibilityLiveRegion="polite">
          <Text style={styles.feedbackText}>Couldn't load your saved plans.</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry saved plans" style={styles.feedbackAction} onPress={() => { void savedPlans.refetch(); }}>
            <Text numberOfLines={1} style={styles.feedbackActionText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : savedPlans.feedback?.kind === 'error' ? (
        <View style={styles.feedback} accessibilityLiveRegion="polite">
          <Text style={styles.feedbackText}>{!savedPlans.feedback.call.wantSaved ? "Couldn't remove this plan from saved." : "Couldn't save this plan."}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry saving plan" style={styles.feedbackAction} onPress={savedPlans.retry}>
            <Text numberOfLines={1} style={styles.feedbackActionText}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Dismiss save error" style={styles.feedbackAction} onPress={savedPlans.dismissFeedback}>
            <Ionicons name="close" size={18} color={muted} />
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Map view — lazy-loaded to avoid crash when react-native-maps fails (e.g. Expo Go) */}
      {mapView ? (
        mapLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={accent} />
          </View>
        ) : (
          <MapErrorBoundary onClose={() => setMapView(false)}>
            <Suspense fallback={
              <View style={styles.centered}>
                <ActivityIndicator size="large" color={accent} />
              </View>
            }>
              <LazyPlansMapView
                plans={mapPlans}
                wishlistedSet={wishlistedSet}
                onPlanPress={(id) => router.push(`/plan/${id}`)}
                onClose={() => setMapView(false)}
                onWishlist={handleFeaturedWishlist}
              />
            </Suspense>
          </MapErrorBoundary>
        )
      ) : (
        <>
          {accountUnavailable && !userId ? (
            <View style={styles.centered}>
              <Text style={styles.errorTitle}>Having trouble loading</Text>
              <Text style={styles.errorMessage}>Sign in may have timed out. Try again or restart the app.</Text>
              <TouchableOpacity accessibilityRole="button" style={styles.retryButton} onPress={retryAccount}>
                <Text numberOfLines={1} style={styles.retryButtonText}>{appearance ? 'Try again' : 'Try Again'}</Text>
              </TouchableOpacity>
            </View>
          ) : !userId || isLoading || wishlistsLoading ? (
            appearance ? <View style={styles.centered} accessibilityLiveRegion="polite"><ActivityIndicator color={accent} /><Text style={styles.errorMessage}>Finding plans…</Text></View> : <SkeletonFeed />
          ) : isError && !showPreviousFeed ? (
            <View style={styles.centered}>
              <Text style={styles.errorTitle}>Couldn't load plans</Text>
              <Text style={styles.errorMessage}>{friendlyError(error, 'Please try again to see plans.')}</Text>
              <TouchableOpacity accessibilityRole="button" style={styles.retryButton} onPress={() => refetch()}>
                <Text numberOfLines={1} style={styles.retryButtonText}>{appearance ? 'Try again' : 'Try Again'}</Text>
              </TouchableOpacity>
            </View>
          ) : listEmpty ? (
            <ScrollView
              decelerationRate="normal"
              contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20 }}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl refreshing={isRefetching || isFeaturedRefetching} onRefresh={refreshFeed} tintColor={accent} />
              }
            >
              {listHeader}
              <View style={styles.emptyState}>
                {emptyCopy && <Text style={styles.emptyText}>{emptyCopy.title}</Text>}
                {emptyCopy?.detail && <Text style={styles.emptySubText}>{emptyCopy.detail}</Text>}
                {hasFilters && (
                  <TouchableOpacity accessibilityRole="button" style={styles.retryButton} onPress={() => { setWhenFilter([]); setDayFilter(null); setCategoryFilter([]); clearNearMe(); }}>
                    <Text numberOfLines={1} style={styles.retryButtonText}>Clear filters</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity accessibilityRole="button" style={styles.emptyButton} onPress={() => router.push('/(tabs)/post')}>
                  <CreatorActionFill /><Text numberOfLines={1} style={styles.emptyButtonText}>{appearance ? 'Post a plan' : 'Post a Plan'}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          ) : (
            <SectionList
              decelerationRate="normal"
              sections={sectionListData}
              keyExtractor={(item) =>
                item.kind === 'standalone' ? item.plan.id : `cluster:${item.rootId}`
              }
              renderItem={renderFeedItem}
              renderSectionHeader={renderSectionHeader}
              ListHeaderComponent={listHeader}
              stickySectionHeadersEnabled={false}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              initialNumToRender={30}
              maxToRenderPerBatch={20}
              windowSize={11}
              refreshControl={
                <RefreshControl refreshing={isRefetching || isFeaturedRefetching} onRefresh={refreshFeed} tintColor={accent} />
              }
            />
          )}
        </>
      )}

      <WhenCalendarSheet
        appearance={appearance}
        visible={whenSheetOpen}
        whenSelected={whenFilter}
        onToggleWhen={(key) => {
          setDayFilter(null); // bucket and specific-day are mutually exclusive
          setWhenFilter((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
        }}
        daySelected={dayFilter}
        onSelectDay={(d) => { setWhenFilter([]); setDayFilter(d); }}
        markedDays={markedDays}
        onClear={() => { setWhenFilter([]); setDayFilter(null); }}
        onClose={() => setWhenSheetOpen(false)}
      />

      <FilterBottomSheet
        appearance={appearance}
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

      {profilePrompt.presenting && (
      <Modal visible={profilePrompt.visible} transparent animationType="fade" onRequestClose={profilePrompt.dismiss} onDismiss={profilePrompt.onDismiss} statusBarTranslucent>
        <Pressable style={styles.profilePromptOverlay} onPress={profilePrompt.dismiss} accessible={false}>
          <Pressable style={styles.profilePromptCard} onPress={(e) => e.stopPropagation()} accessible={false}
            accessibilityViewIsModal onAccessibilityEscape={profilePrompt.dismiss}>
            <Image source={wLogo} style={styles.profilePromptLogo} contentFit="contain" />
            <Text style={styles.profilePromptTitle}>make your profile yours</Text>
            <Text style={styles.profilePromptBody}>
              add a handle, a fun fact, and your neighborhood so people can find you and know where you're coming from.
            </Text>
            <TouchableOpacity accessibilityRole="button" style={styles.profilePromptPrimaryBtn} onPress={profilePrompt.openEditor} activeOpacity={0.9}>
              <Text style={styles.profilePromptPrimaryBtnText}>finish my profile</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" style={styles.profilePromptLaterBtn} onPress={profilePrompt.dismiss} activeOpacity={0.7}>
              <Text style={styles.profilePromptLaterText}>later</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
      )}

      {reportTarget && (
        <ReportModal
          visible
          onClose={closeReport}
          scope={reportTarget.scope}
          reportedUserId={reportTarget.userId}
          reportedUserName={reportTarget.userName}
          eventId={reportTarget.eventId}
        />
      )}

      <MiniProfileCard
        visible={!!miniProfileUserId}
        userId={miniProfileUserId}
        onClose={() => setMiniProfile(current => current === miniProfile ? null : current)}
        onReport={reportPerson}
        onBlock={blockPerson}
      />

      <SaveSnackbar
        appearance={appearance}
        visible={!!snackbar}
        planId={snackbar?.planId ?? ''}
        planTitle={snackbar?.planTitle ?? ''}
        onShare={(id) => {
          if (saveOverlayOwnerRef.current !== saveOverlayOwner) return;
          setSnackbar(null);
          const plan = allPlans.find(p => p.id === id);
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

      {showWelcomeOverlay && (
        <View
          style={styles.welcomeOverlay}
          // Defense in depth on top of the onExit fix above: once data is
          // ready the overlay is on its way out, so don't capture touches
          // even during the 420ms exit animation. The inner WelcomeLoading
          // View already does the same dance, but pointerEvents doesn't
          // propagate UP from child to parent, so the wrapper has to opt
          // out independently.
          pointerEvents={overlayReady ? 'none' : 'auto'}
        >
          <WelcomeLoading
            done={overlayReady}
            onExit={() => setWelcomeOverlayDone(true)}
          />
        </View>
      )}

    </SafeAreaView>
  );
}
