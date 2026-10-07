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
    Dimensions,
    Easing,
    FlatList,
    Modal,
    Pressable,
    RefreshControl,
    ScrollView,
    SectionList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { COMMUNITY_CHAT_GROUPING_ENABLED } from '../../../constants/FeatureFlags';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { useFeedWishlist } from '../../../hooks/useFeedWishlist';
import { usePlansNearMe } from '../../../hooks/usePlansNearMe';
import { WHEN_OPTIONS } from '../../../constants/WhenFilter';
import { fetchPlans, fetchRealMemberCounts, Plan } from '../../../lib/fetchPlans';
import { toPlanCardPlan, type PlanCardPlan } from '../../../lib/creatorMarks';
import { getLADayParts, dayKey, MONTHS } from '../../../lib/laDate';
import { WhenCalendarSheet } from '../../../components/plans/WhenCalendarSheet';
import { type CalendarDay } from '../../../components/calendar/WashedUpCalendar';
import { supabase } from '../../../lib/supabase';
import { withTimeout, withDeadline } from '../../../lib/withTimeout';
import { friendlyError } from '../../../lib/friendlyError';
import { postAuthTransitionRef } from '../../../lib/navState';
import { useBlock } from '../../../hooks/useBlock';
import { isPlanPast } from '../../../lib/planTime';
import {
  markWelcomeShown,
  wasHandlePromptShownThisSession,
  wasWelcomeShownThisSession,
} from '../../../lib/promptState';

const wLogo = require('../../../assets/images/w-logo-waves.png');

/**
 * First-visit loading cover. Acts as a true overlay above the plans feed:
 * once data is ready (and a minimum display time has elapsed so it never
 * blinks) the whole layer cross-fades out, revealing the feed already
 * mounted underneath. The W lifts slightly as it leaves — like the screen
 * is delivering the content, not just stepping aside.
 *
 * Props:
 *   - done: parent flips this true when plans data is ready.
 *   - onExit: called once the exit fade finishes so the parent can unmount.
 *
 * Composition:
 *   - whole-screen fades in over 280ms (no hard cut from the photo screen)
 *   - W logo (132px, terracotta) gently breathes — slow scale + opacity
 *     loop, easing both ways so it reads alive instead of mechanical
 *   - label fades in shortly after
 *   - three brand-colored dots pulse in stagger
 *   - exit: brief scale-up on the W (1.0 → 1.10) while the screen fades
 *     to 0 over 420ms; the cumulative effect is the W "lifting away"
 */
const MIN_WELCOME_DISPLAY_MS = 1500;
const EXIT_DURATION_MS = 420;

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
const FEED_DEADLINE_MS = 15000;
const WISHLISTS_TIMEOUT_MS = 8000;
const MEMBER_IDS_TIMEOUT_MS = 8000;

function WelcomeLoading({
  done,
  onExit,
}: {
  done: boolean;
  onExit: () => void;
}) {
  const screenOpacity = React.useRef(new Animated.Value(0)).current;
  const exitScale = React.useRef(new Animated.Value(0)).current;
  const breath = React.useRef(new Animated.Value(0)).current;
  const textOpacity = React.useRef(new Animated.Value(0)).current;
  const dot1 = React.useRef(new Animated.Value(0.3)).current;
  const dot2 = React.useRef(new Animated.Value(0.3)).current;
  const dot3 = React.useRef(new Animated.Value(0.3)).current;
  const mountedAt = React.useRef(Date.now()).current;
  const exitingRef = React.useRef(false);

  // Mount-time animations: fade-in screen, fade-in label, start loops.
  React.useEffect(() => {
    Animated.timing(screenOpacity, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    Animated.timing(textOpacity, {
      toValue: 1,
      duration: 460,
      delay: 140,
      useNativeDriver: true,
    }).start();

    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 1300,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 1300,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    breathLoop.start();

    const pulseDot = (v: Animated.Value) =>
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 420, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.3, duration: 420, useNativeDriver: true }),
      ]);
    const dotsLoop = Animated.loop(
      Animated.stagger(200, [pulseDot(dot1), pulseDot(dot2), pulseDot(dot3)]),
    );
    dotsLoop.start();

    return () => {
      breathLoop.stop();
      dotsLoop.stop();
    };
  }, [screenOpacity, breath, textOpacity, dot1, dot2, dot3]);

  // Exit animation, gated on `done` AND a minimum display time so the
  // overlay never blinks for a sub-second cached load.
  React.useEffect(() => {
    if (!done || exitingRef.current) return;
    const elapsed = Date.now() - mountedAt;
    const wait = Math.max(0, MIN_WELCOME_DISPLAY_MS - elapsed);
    const t = setTimeout(() => {
      exitingRef.current = true;
      Animated.parallel([
        Animated.timing(exitScale, {
          toValue: 1,
          duration: EXIT_DURATION_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(screenOpacity, {
          toValue: 0,
          duration: EXIT_DURATION_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Call onExit unconditionally. Animated.timing's callback receives
        // finished:false when the animation is interrupted (competing
        // animation, layout recalc, focus event, JS-thread pressure on
        // slower silicon). The old `if (finished)` guard meant any
        // interruption left the overlay permanently mounted, which on
        // iPhone SE 3rd gen / A15 traps the user behind a full-screen
        // absoluteFillObject View that absorbs every touch to the feed
        // below. We don't care WHY the animation ended — the overlay
        // needs to come down either way.
        onExit();
      });
    }, wait);
    return () => clearTimeout(t);
  }, [done, onExit, mountedAt, screenOpacity, exitScale]);

  const breathScale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });
  const wOpacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] });
  const exitScaleOut = exitScale.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });

  return (
    <Animated.View
      style={[baseStyles.welcomeLoading, { opacity: screenOpacity }]}
      pointerEvents={exitingRef.current ? 'none' : 'auto'}
    >
      <Animated.View
        style={{
          opacity: wOpacity,
          transform: [{ scale: breathScale }, { scale: exitScaleOut }],
        }}
      >
        <Image
          source={wLogo}
          style={baseStyles.welcomeLoadingLogo}
          contentFit="contain"
          tintColor={Colors.brand}
        />
      </Animated.View>
      <Animated.Text
        style={[baseStyles.welcomeLoadingText, { opacity: textOpacity }]}
      >
        finding plans for you
      </Animated.Text>
      <View style={baseStyles.welcomeLoadingDots}>
        <Animated.View style={[baseStyles.welcomeLoadingDot, { opacity: dot1 }]} />
        <Animated.View style={[baseStyles.welcomeLoadingDot, { opacity: dot2 }]} />
        <Animated.View style={[baseStyles.welcomeLoadingDot, { opacity: dot3 }]} />
      </View>
    </Animated.View>
  );
}

// Lazy-load map to avoid crash on Expo Go / environments where react-native-maps fails
const LazyPlansMapView = lazy(() => import('../../../components/plans/PlansMapView'));

// ─── Types ────────────────────────────────────────────────────────────────────

interface SectionDef {
  key: string;
  title: string;
  from: Date;
  to: Date;
}

interface FeaturedPlan extends PlanCardPlan {
  attendees: { profile_photo_url: string | null }[];
}

// ─── Section boundary logic ───────────────────────────────────────────────────

function getSectionDefs(now: Date): SectionDef[] {
  const day = now.getDay();
  const y = now.getFullYear();
  const mo = now.getMonth();
  const d = now.getDate();
  const sections: SectionDef[] = [];

  const todayEnd = new Date(y, mo, d, 23, 59, 59, 999);
  // Widen the today bucket back 3h so happening-now plans (start_time in
  // the last 3h) land in it instead of falling through the section filter
  // at line ~192. The RPC caps past plans at 3h so this won't pull in
  // anything older than that.
  //
  // Title flips on local-time hour: morning + early afternoon say "Today"
  // (a 9 AM plan under "Tonight" at 11 AM was confusing real users). 4 PM
  // onward keeps the original "Tonight" framing for evening plans.
  const tonightFrom = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const todayTitle = now.getHours() < 16 ? 'Today' : 'Tonight';
  sections.push({ key: 'tonight', title: todayTitle, from: tonightFrom, to: todayEnd });

  if (day >= 1 && day <= 4) {
    const tomorrowStart = new Date(y, mo, d + 1, 0, 0, 0);
    // "This Week" ends Friday at 3:59:59.999 PM — Friday plans starting at/after
    // 4:00 PM belong to "This Weekend" instead.
    const fridayWeekEnd = new Date(y, mo, d + (5 - day), 15, 59, 59, 999);
    sections.push({ key: 'this-week', title: 'This Week', from: tomorrowStart, to: fridayWeekEnd });
  }

  if (day >= 1 && day <= 4) {
    const daysToFri = 5 - day;
    // "This Weekend" starts Friday at 4:00 PM so Friday plans don't double-bucket.
    const friWeekendStart = new Date(y, mo, d + daysToFri, 16, 0, 0, 0);
    const sunEnd = new Date(y, mo, d + daysToFri + 2, 23, 59, 59, 999);
    sections.push({ key: 'this-weekend', title: 'This Weekend', from: friWeekendStart, to: sunEnd });
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

// ─── Feed item grouping (clusters of duplicated plans) ───────────────────────

type FeedItem =
  | { kind: 'standalone'; plan: Plan }
  | { kind: 'cluster'; rootId: string; plans: Plan[] };

function feedItemSpotsRemaining(p: Plan): number {
  return (p.max_invites ?? 0) + 1 - (p.member_count ?? 0);
}

function feedItemSortTime(item: FeedItem): string {
  if (item.kind === 'standalone') return item.plan.start_time;
  // Cluster slots in by its EARLIEST member so it appears at the same point
  // a single member would have in the chronological feed.
  return item.plans.reduce(
    (min, p) => (new Date(p.start_time) < new Date(min) ? p.start_time : min),
    item.plans[0].start_time,
  );
}

function feedItemMatchesCategory(item: FeedItem, filter: CategoryOption[]): boolean {
  if (filter.length === 0) return true;
  const lower = filter.map((c) => c.toLowerCase());
  if (item.kind === 'standalone') {
    return !!item.plan.category && lower.includes(item.plan.category.toLowerCase());
  }
  return item.plans.some((p) => p.category && lower.includes(p.category.toLowerCase()));
}

// Bucket plans into FeedItems by cluster_root_id. The RPC guarantees a
// non-null cluster_root_id only when ≥2 visible rows share the lineage,
// but client-side filters (day filter, !is_featured, etc.) run AFTER the
// RPC and can reduce a cluster back to 1 visible member. We re-collapse
// any 1-member cluster into a standalone here so the "popular plan"
// header never sits over a single card.
function groupIntoFeedItems(plans: Plan[]): FeedItem[] {
  // Plain record instead of Map<...> because the file imports `Map` from
  // lucide-react-native (an icon component) which shadows the global type.
  const clusters: Record<string, Plan[]> = {};
  const items: FeedItem[] = [];
  for (const p of plans) {
    if (p.cluster_root_id) {
      if (!clusters[p.cluster_root_id]) clusters[p.cluster_root_id] = [];
      clusters[p.cluster_root_id].push(p);
    } else {
      items.push({ kind: 'standalone', plan: p });
    }
  }
  for (const rootId of Object.keys(clusters)) {
    const members = clusters[rootId];
    // Most spots first (leftmost), full plans last.
    members.sort((a, b) => feedItemSpotsRemaining(b) - feedItemSpotsRemaining(a));

    // Cap each creator at one card, preserving the cluster's existing sort
    // priority by keeping the first plan encountered for each creator id.
    const seenCreatorIds = new Set<string>();
    const cappedMembers = members.filter((plan) => {
      const creatorId = plan.creator?.id;
      if (!creatorId) return true;
      if (seenCreatorIds.has(creatorId)) return false;
      seenCreatorIds.add(creatorId);
      return true;
    });

    if (cappedMembers.length < 2) {
      // Cluster collapsed to 1 by client-side filters or the creator cap —
      // render as a normal standalone card with no "popular plan" header.
      items.push({ kind: 'standalone', plan: cappedMembers[0] });
      continue;
    }
    items.push({ kind: 'cluster', rootId, plans: cappedMembers });
  }
  // Final chronological pass: clusters slot in by their earliest member's
  // start_time, interleaved with standalones — otherwise clusters all bunch
  // at the end of insertion order regardless of when their plans actually are.
  items.sort(
    (a, b) =>
      new Date(feedItemSortTime(a)).getTime() -
      new Date(feedItemSortTime(b)).getTime(),
  );
  return items;
}

function filterIntoSections(
  items: FeedItem[],
  sectionDefs: SectionDef[],
  categoryFilter: CategoryOption[],
  whenKeys: string[],
): { def: SectionDef; items: FeedItem[] }[] {
  const catFiltered = items.filter((i) => feedItemMatchesCategory(i, categoryFilter));

  return sectionDefs
    .filter((def) => whenKeys.length === 0 || whenKeys.includes(def.key))
    .map((def) => ({
      def,
      items: catFiltered.filter((i) => {
        const t = new Date(feedItemSortTime(i));
        return t >= def.from && t <= def.to;
      }),
    }))
    .filter((s) => s.items.length > 0);
}

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
  const [reportTarget, setReportTarget] = useState<{ userId: string; userName: string; eventId: string } | null>(null);
  const [miniProfileUserId, setMiniProfileUserId] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ planId: string; planTitle: string } | null>(null);
  const [shareSheet, setShareSheet] = useState<{ planId: string; planTitle: string; slug: string | null } | null>(null);

  const [userId, setUserId] = React.useState<string | null>(null);
  const saveOverlayOwner = useMemo(() => ({ userId }), [userId]);
  const saveOverlayOwnerRef = useRef(saveOverlayOwner); saveOverlayOwnerRef.current = saveOverlayOwner;
  useFocusEffect(useCallback(() => {
    setSnackbar(null); setShareSheet(null);
    return () => { setSnackbar(null); setShareSheet(null); };
  }, [saveOverlayOwner]));
  const [userIdTimedOut, setUserIdTimedOut] = React.useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const welcomeBannerOpacity = useRef(new Animated.Value(1)).current;
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
  const [showProfileCompletePrompt, setShowProfileCompletePrompt] = useState(false);

  React.useEffect(() => {
    let cancelled = false;
    let initDone = false;

    async function init() {
      // Bounded: an unwrapped getSession() can hang on a stale/expired session
      // whose token refresh never settles, which leaves `userId` null forever →
      // the feed query stays disabled → the welcome overlay never sees data and
      // (pre-watchdog builds) traps the user. Fail open to no-session; the
      // onAuthStateChange listener below and the userIdTimedOut retry recover
      // once the refresh actually completes. Mirrors app/_layout.tsx.
      const { data } = await withTimeout(
        supabase.auth.getSession(),
        6000,
        { data: { session: null } } as any,
      );
      if (cancelled) return;
      const id = data.session?.user?.id ?? null;

      if (id) {
        // Welcome modal gate. Source of truth is profiles.welcome_seen_at;
        // AsyncStorage is a fast-path cache so we can skip the Supabase read
        // on subsequent opens. Name and seen-at are fetched separately so a
        // missing column on the seen-at check can't null out the whole row
        // and leave the modal rendering "Welcome, friend".
        try {
          const key = `has_seen_welcome_${id}`;
          const cached = await AsyncStorage.getItem(key);
          if (!cached && !cancelled) {
            const [nameRes, seenRes] = await Promise.all([
              supabase
                .from('profiles')
                .select('first_name_display')
                .eq('id', id)
                .maybeSingle(),
              supabase
                .from('profiles')
                .select('welcome_seen_at')
                .eq('id', id)
                .maybeSingle(),
            ]);
            const firstName = (nameRes.data as any)?.first_name_display ?? '';
            // If the seen-at query errors (column missing, RLS, etc.), treat
            // it as "unknown" and fall back to the AsyncStorage-only flow —
            // better to skip a maybe-already-seen modal than show it twice.
            const seenAt = seenRes.error
              ? 'unknown'
              : (seenRes.data as any)?.welcome_seen_at ?? null;
            if (!cancelled) {
              if (seenAt) {
                try { await AsyncStorage.setItem(key, '1'); } catch {}
              } else if (firstName) {
                setShowWelcome(true);
                markWelcomeShown();
                try { await AsyncStorage.setItem(key, '1'); } catch {}
                supabase
                  .from('profiles')
                  .update({ welcome_seen_at: new Date().toISOString() })
                  .eq('id', id)
                  .then(() => {});
              }
              // else: no name yet (profile still propagating) and not seen.
              // Deliberately do NOT cache or show — retry next session so
              // the user gets the modal with their real name, not "friend".
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

  // ── Profile-complete prompt ─────────────────────────────────────────────────
  // Fires once ever per user when any of handle/fun_fact/neighborhood is
  // missing and onboarding is complete. Skipped if the handle prompt or
  // welcome modal is showing/was shown this session to avoid back-to-back.
  React.useEffect(() => {
    if (!userId) return;
    if (wasHandlePromptShownThisSession()) return;
    if (wasWelcomeShownThisSession()) return;

    let cancelled = false;
    let delayTimer: ReturnType<typeof setTimeout> | null = null;
    const flagKey = `has_seen_profile_complete_prompt_${userId}`;

    (async () => {
      try {
        const seen = await AsyncStorage.getItem(flagKey);
        if (cancelled || seen) return;

        const { data: profile } = await supabase
          .from('profiles')
          .select('onboarding_status, handle, fun_fact, neighborhood')
          .eq('id', userId)
          .single();
        if (cancelled || !profile) return;
        if (profile.onboarding_status !== 'complete') return;

        const hasHandle = !!(profile.handle && String(profile.handle).trim());
        const hasFunFact = !!(profile.fun_fact && String(profile.fun_fact).trim());
        const hasNeighborhood = !!(profile.neighborhood && String(profile.neighborhood).trim());
        if (hasHandle && hasFunFact && hasNeighborhood) return;

        delayTimer = setTimeout(() => {
          if (cancelled) return;
          // Final check — another prompt may have raced in during the delay.
          if (wasHandlePromptShownThisSession()) return;
          setShowProfileCompletePrompt(true);
        }, 2000);
      } catch {}
    })();

    return () => {
      cancelled = true;
      if (delayTimer) clearTimeout(delayTimer);
    };
  }, [userId]);

  const dismissProfileCompletePrompt = useCallback(async () => {
    setShowProfileCompletePrompt(false);
    if (userId) {
      try { await AsyncStorage.setItem(`has_seen_profile_complete_prompt_${userId}`, '1'); } catch {}
    }
  }, [userId]);

  const confirmProfileCompletePrompt = useCallback(async () => {
    setShowProfileCompletePrompt(false);
    if (userId) {
      try { await AsyncStorage.setItem(`has_seen_profile_complete_prompt_${userId}`, '1'); } catch {}
    }
    router.push('/(tabs)/profile?openEdit=true' as any);
  }, [userId]);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: allPlans = [], isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['events', 'feed', userId,
      nearMeActive ? `near:${nearMeCoords!.lat.toFixed(3)},${nearMeCoords!.lng.toFixed(3)},${radiusMi}` : 'all'],
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
  const { data: featuredPlans = [] } = useQuery<FeaturedPlan[]>({
    queryKey: ['events', 'featured', userId],
    queryFn: async () => {
      if (!userId) return [];

      // Visibility filtering (gender / age / mutual_blocks) happens in the
      // RPC. Without this, the featured carousel would leak plans to users
      // who shouldn't see them (e.g. a man seeing a women_only plan).
      const { data: eligibleIdsRaw, error: eligErr } = await supabase
        .rpc('get_featured_eligible_ids', { p_user_id: userId });
      if (eligErr) {
        console.warn('[featured] get_featured_eligible_ids failed:', eligErr.message);
        return [];
      }
      const eligibleIds = (eligibleIdsRaw ?? []) as string[];
      if (eligibleIds.length === 0) return [];

      const { data: events, error } = await supabase
        .from('events')
        .select('id, title, start_time, end_time, location_text, location_lat, location_lng, image_url, primary_vibe, gender_rule, target_age_min, target_age_max, max_invites, min_invites, member_count, status, creator_user_id, host_message, slug, is_featured, featured_type')
        .in('id', eligibleIds)
        .order('start_time', { ascending: true });

      if (error || !events || events.length === 0) return [];

      const creatorIds = [...new Set(events.map((e: any) => e.creator_user_id).filter(Boolean))];
      const eventIds = events.map((e: any) => e.id);

      const [{ data: profiles }, { data: members }, realCounts] = await Promise.all([
        creatorIds.length > 0
          ? supabase.from('profiles_public').select('id, first_name_display, profile_photo_url').in('id', creatorIds)
          : Promise.resolve({ data: [] as any[] }),
        supabase.from('event_members').select('event_id, user_id, status').in('event_id', eventIds).eq('status', 'joined'),
        fetchRealMemberCounts(eventIds),
      ]);

      const profileMap: Record<string, any> = {};
      (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p; });

      // Gather member user IDs per event for avatar fetch
      const membersByEvent: Record<string, string[]> = {};
      (members ?? []).forEach((m: any) => {
        if (!membersByEvent[m.event_id]) membersByEvent[m.event_id] = [];
        membersByEvent[m.event_id].push(m.user_id);
      });

      const allMemberIds = [...new Set((members ?? []).map((m: any) => m.user_id))];
      const { data: memberProfiles } = allMemberIds.length > 0
        ? await supabase.from('profiles_public').select('id, profile_photo_url').in('id', allMemberIds)
        : { data: [] as any[] };

      const memberPhotoMap: Record<string, string | null> = {};
      (memberProfiles ?? []).forEach((p: any) => { memberPhotoMap[p.id] = p.profile_photo_url ?? null; });

      return events
        .filter((e: any) => !isPlanPast(e.start_time, e.end_time))
        .map((e: any) => {
        const hp = profileMap[e.creator_user_id] ?? null;
        const eventMembers = membersByEvent[e.id] ?? [];
        return {
          id: e.id,
          title: e.title,
          host_message: e.host_message ?? null,
          target_age_min: e.target_age_min,
          target_age_max: e.target_age_max,
          start_time: e.start_time,
          end_time: e.end_time ?? null,
          status: e.status,
          location_text: e.location_text ?? null,
          neighborhood: null,
          category: e.primary_vibe ?? null,
          max_invites: e.max_invites ?? 0,
          member_count: Math.max(1, realCounts[e.id] ?? e.member_count ?? 0),
          slug: e.slug ?? null,
          is_featured: true,
          featured_type: (e.featured_type as 'washedup_event' | 'birthday_party' | 'special_event' | null) ?? null,
          creator: {
            id: e.creator_user_id,
            first_name_display: hp?.first_name_display ?? 'Creator',
            profile_photo_url: hp?.profile_photo_url ?? null,
          },
          attendees: eventMembers.map((uid: string) => ({
            profile_photo_url: memberPhotoMap[uid] ?? null,
          })),
        } as FeaturedPlan;
      });
    },
    enabled: !!userId,
    staleTime: 60_000,
  });

  // Lightweight, bounded, NON-BLOCKING membership lookup. The feed RPC does not
  // return a per-card membership flag. Confirmed membership gives cards the
  // Going state and removes admission prompts. Fetch just the
  // joined + created event ids (ids only) so the feed renders immediately and
  // isMember fills in once this resolves; withTimeout-bounded so it can never
  // pin the feed load. The full My Plans data now lives in the Yours tab.
  const { data: memberIds = [] } = useQuery<string[]>({
    queryKey: ['feed-member-ids', userId],
    queryFn: () => withTimeout((async () => {
      if (!userId) return [];
      return readFeedMemberIds(userId);
    })(), MEMBER_IDS_TIMEOUT_MS, []),
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
    for (const p of allPlans) {
      if (p.is_featured) continue;
      const { y, m, d } = getLADayParts(p.start_time);
      set.add(dayKey(y, m, d));
    }
    return set;
  }, [allPlans]);

  const displayPlans = useMemo(() => {
    // Featured plans render in their own carousel section above the
    // time-bucketed sections — strip them out here so they never
    // double-appear in "This Week" / "This Weekend" / etc.
    let result = allPlans.filter((p) => !p.is_featured && !isPlanPast(p.start_time, p.end_time));
    if (dayFilterKey) {
      result = result.filter((p) => {
        const { y, m, d } = getLADayParts(p.start_time);
        return dayKey(y, m, d) === dayFilterKey;
      });
    }
    return result;
  }, [allPlans, dayFilterKey]);

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

  const { blockUser } = useBlock();

  const handleReport = useCallback((planId: string) => {
    const plan = allPlans.find((p) => p.id === planId);
    if (plan?.creator?.id) {
      setReportTarget({
        userId: plan.creator.id,
        userName: plan.creator.first_name_display ?? 'User',
        eventId: planId,
      });
    }
  }, [allPlans]);

  const handleBlock = useCallback((planId: string) => {
    const plan = allPlans.find((p) => p.id === planId);
    if (plan?.creator?.id) {
      blockUser(plan.creator.id, plan.creator.first_name_display ?? 'User');
    }
  }, [allPlans, blockUser]);

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
  const handleCreatorPress = useCallback((creatorId: string) => {
    setMiniProfileUserId(creatorId);
  }, []);

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

  const persistWelcomeSeen = useCallback(async () => {
    if (!userId) return;
    try { await AsyncStorage.setItem(`has_seen_welcome_${userId}`, '1'); } catch {}
    supabase
      .from('profiles')
      .update({ welcome_seen_at: new Date().toISOString() })
      .eq('id', userId)
      .then(() => {});
  }, [userId]);

  const handleWelcomeDismiss = useCallback(() => {
    Animated.timing(welcomeBannerOpacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowWelcome(false);
      persistWelcomeSeen();
    });
  }, [welcomeBannerOpacity, persistWelcomeSeen]);

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
  const emptyMessage = appearance
    ? nearMeActive ? 'Make a plan nearby.' : allPlans.length > 0 ? 'Try another day or activity.' : 'What would you like to do?'
    : nearMeActive
    ? 'Nothing quite that close yet.'
    : allPlans.length > 0
      ? 'No plans match your filters.'
      : 'No plans yet.';
  // Near-me empty is a proximity gap on a young feed, not a dead end. Reframe it
  // warmly: name the growth, hand back agency (post + share), no plea.
  const emptySubText = appearance
    ? nearMeActive ? 'Try a wider distance, or post something close to you.' : allPlans.length > 0 ? 'Clear your filters to see more plans, or post one of your own.' : 'Post a plan and give someone a reason to join you.'
    : nearMeActive
    ? "We're still growing in LA. Post your own and share it around. That's how the map fills in."
    : null;

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
          {userIdTimedOut && !userId ? (
            <View style={styles.centered}>
              <Text style={styles.errorTitle}>Having trouble loading</Text>
              <Text style={styles.errorMessage}>Sign in may have timed out. Try again or restart the app.</Text>
              <TouchableOpacity accessibilityRole="button" style={styles.retryButton} onPress={() => {
              setUserIdTimedOut(false);
              // Bounded retry: don't re-hit an unwrapped getSession() that can
              // hang the same way the initial load did.
              withTimeout(
                supabase.auth.getSession(),
                6000,
                { data: { session: null } } as any,
              ).then(({ data }) => setUserId(data.session?.user?.id ?? null));
            }}>
                <Text numberOfLines={1} style={styles.retryButtonText}>{appearance ? 'Try again' : 'Try Again'}</Text>
              </TouchableOpacity>
            </View>
          ) : !userId || isLoading || wishlistsLoading ? (
            appearance ? <View style={styles.centered} accessibilityLiveRegion="polite"><ActivityIndicator color={accent} /><Text style={styles.errorMessage}>Finding plans…</Text></View> : <SkeletonFeed />
          ) : isError ? (
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
                <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={accent} />
              }
            >
              {listHeader}
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>{emptyMessage}</Text>
                {emptySubText && <Text style={styles.emptySubText}>{emptySubText}</Text>}
                {appearance && (whenActive || categoryActive || nearMeActive) && (
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
                <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={accent} />
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

      {showProfileCompletePrompt && (
      <Modal visible={showProfileCompletePrompt} transparent animationType="fade" onRequestClose={dismissProfileCompletePrompt} statusBarTranslucent>
        <Pressable style={styles.profilePromptOverlay} onPress={dismissProfileCompletePrompt} accessible={false}>
          <Pressable style={styles.profilePromptCard} onPress={(e) => e.stopPropagation()} accessible={false}
            accessibilityViewIsModal onAccessibilityEscape={dismissProfileCompletePrompt}>
            <Image source={wLogo} style={styles.profilePromptLogo} contentFit="contain" />
            <Text style={styles.profilePromptTitle}>make your profile yours</Text>
            <Text style={styles.profilePromptBody}>
              add a handle, a fun fact, and your neighborhood so people can find you and know where you're coming from.
            </Text>
            <TouchableOpacity accessibilityRole="button" style={styles.profilePromptPrimaryBtn} onPress={confirmProfileCompletePrompt} activeOpacity={0.9}>
              <Text style={styles.profilePromptPrimaryBtnText}>finish my profile</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" style={styles.profilePromptLaterBtn} onPress={dismissProfileCompletePrompt} activeOpacity={0.7}>
              <Text style={styles.profilePromptLaterText}>later</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
      )}

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

// ─── Styles ───────────────────────────────────────────────────────────────────

const baseStyles = StyleSheet.create({
  screenTitle: { ...AfterglowType.screenTitle, fontFamily: Fonts.sansBold, color: Colors.asphalt },
  feedback: { marginHorizontal: 20, marginBottom: 10, padding: 12, backgroundColor: Colors.inputBg, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 12 },
  feedbackText: { flex: 1, fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  feedbackAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  feedbackActionText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
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
  // ── Filters ──
  filterRow: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginTop: 4,
    marginBottom: 12,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 20,
    backgroundColor: Colors.dividerWarm,
  },
  filterPillActive: {
    backgroundColor: Colors.terracotta,
  },
  filterPillText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    color: Colors.secondary,
    includeFontPadding: false,
  },
  filterPillTextActive: {
    color: Colors.white,
  },
  // ── Near-me radius presets + deny notice ──
  radiusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: -4,
    marginBottom: 12,
  },
  radiusPill: {
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5EDE0',
  },
  radiusPillActive: {
    backgroundColor: '#B5522E',
  },
  radiusPillText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 12,
    color: '#78695C',
    includeFontPadding: false,
  },
  radiusPillTextActive: {
    color: '#FFFFFF',
  },
  nearMeNotice: {
    marginHorizontal: 16,
    marginTop: -4,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#F5EDE0',
  },
  nearMeNoticeText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    color: '#78695C',
  },
  // ── List ──
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  featuredSection: {
    marginBottom: 20,
  },
  welcomeBannerOuter: {
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 14,
    borderRadius: 14,
    overflow: 'hidden',
  },
  welcomeBannerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 8,
  },
  welcomeBannerLogo: {
    width: 18,
    height: 18,
    opacity: 0.9,
  },
  welcomeBannerText: {
    flex: 1,
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.text1,
  },
  welcomeBannerCloseHit: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.7,
  },
  welcomeOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    elevation: 999,
  },
  welcomeLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    paddingBottom: 40,
    backgroundColor: Colors.parchment,
  },
  welcomeLoadingLogo: {
    width: 132,
    height: 132,
  },
  welcomeLoadingText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 16,
    color: Colors.text2,
    letterSpacing: 0.3,
  },
  welcomeLoadingDots: {
    flexDirection: 'row',
    gap: 8,
    marginTop: -8,
  },
  welcomeLoadingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.brand,
  },
  featuredHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  featuredHeaderText: {
    fontFamily: Fonts.display,
    fontSize: 16,
    color: Colors.asphalt,
  },
  featuredSoloWrap: {
  },
  featuredScroll: {
    marginHorizontal: -20,
  },
  featuredScrollContent: {
    paddingHorizontal: 20,
    gap: 12,
  },
  clusterSection: {
    marginBottom: 20,
  },
  clusterHeaderText: {
    fontFamily: Fonts.sansBold,
    fontSize: 11,
    color: Colors.terracotta,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginLeft: 20,
    marginBottom: 8,
  },
  clusterScrollContent: {
    paddingHorizontal: 20,
    gap: 12,
  },
  clusterCardWrap: {
    // 300px on iPhone-13-class+ devices to match the featured carousel,
    // but on narrower devices (iPhone SE @ 320pt) clamp so we keep a
    // visible peek of the next card (~60pt) — otherwise the horizontal
    // scroll affordance disappears.
    width: Math.min(300, Dimensions.get('window').width - 60),
  },
  sectionHeader: {
    fontFamily: Fonts.sansBold,
    fontSize: 11,
    color: Colors.terracotta,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginTop: 24,
    marginBottom: 12,
  },
  cardWrap: {
    marginBottom: 14,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  map: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: '#78695C', textAlign: 'center', marginBottom: 20 },
  emptySubText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: '#A09385', textAlign: 'center', lineHeight: 21, marginTop: -8, marginBottom: 20, maxWidth: 300 },
  emptyButton: { backgroundColor: Colors.terracotta, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 999 },
  emptyButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: '#FFFFFF' },
  errorTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: '#2C1810', marginBottom: 8, textAlign: 'center' },
  errorMessage: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: '#78695C', textAlign: 'center', marginBottom: 20, paddingHorizontal: 32 },
  retryButton: { backgroundColor: Colors.terracotta, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 999 },
  retryButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: '#FFFFFF' },

  profilePromptOverlay: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profilePromptCard: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 28,
    marginHorizontal: 32,
    alignItems: 'center',
  },
  profilePromptLogo: {
    width: 72,
    height: 72,
    marginBottom: 14,
  },
  profilePromptTitle: {
    fontSize: FontSizes.bodyLG,
    fontFamily: Fonts.sansBold,
    color: Colors.asphalt,
    textAlign: 'center',
    marginBottom: 10,
  },
  profilePromptBody: {
    fontSize: FontSizes.bodyMD,
    fontFamily: Fonts.sans,
    color: Colors.textMedium,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  profilePromptPrimaryBtn: {
    backgroundColor: Colors.terracotta,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 14,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  profilePromptPrimaryBtnText: {
    fontSize: FontSizes.bodyMD,
    fontFamily: Fonts.sansBold,
    color: Colors.white,
  },
  profilePromptLaterBtn: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  profilePromptLaterText: {
    fontSize: FontSizes.bodyMD,
    fontFamily: Fonts.sansMedium,
    color: Colors.textMedium,
  },
});

function afterglowStyles(fonts: AfterglowFontFamilies, width: number) {
  const label = { ...AfterglowType.section, fontFamily: fonts.medium, color: AfterglowColors.muted };
  const body = { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted };
  const section = { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink, textTransform: 'none' as const, letterSpacing: -0.2 };
  const action = { minHeight: 48, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 6, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: AfterglowColors.clay };
  const actionText = { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.white };
  return StyleSheet.create({
    container: { ...baseStyles.container, backgroundColor: AfterglowColors.paper },
    header: { ...baseStyles.header, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18 },
    screenTitle: { ...AfterglowType.screenTitle, fontFamily: fonts.display, color: AfterglowColors.ink },
    filterRow: { ...baseStyles.filterRow, justifyContent: 'flex-start', paddingHorizontal: 16, paddingVertical: 0, marginTop: 0, marginBottom: 14 },
    filterPill: { ...baseStyles.filterPill, height: undefined, minHeight: 44, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 22, borderWidth: 0, borderColor: AfterglowColors.line, backgroundColor: AfterglowColors.paper },
    filterPillActive: { backgroundColor: AfterglowColors.clay, borderColor: AfterglowColors.clay },
    filterPillText: { ...label, includeFontPadding: false },
    filterPillTextActive: { color: AfterglowColors.white },
    radiusRow: { ...baseStyles.radiusRow, marginTop: 0 },
    radiusPill: { ...baseStyles.radiusPill, height: undefined, minHeight: 44, paddingVertical: 10, borderRadius: 22, borderWidth: 0, borderColor: AfterglowColors.line, backgroundColor: AfterglowColors.paper },
    radiusPillActive: { backgroundColor: AfterglowColors.clay, borderColor: AfterglowColors.clay },
    radiusPillText: { ...label },
    radiusPillTextActive: { color: AfterglowColors.white },
    nearMeNotice: { ...baseStyles.nearMeNotice, minHeight: 44, borderRadius: 6, backgroundColor: AfterglowColors.white },
    nearMeNoticeText: body,
    listContent: { ...baseStyles.listContent, paddingHorizontal: 16, paddingBottom: 32 },
    sectionHeader: { ...baseStyles.sectionHeader, ...section, marginTop: 20, marginBottom: 12 },
    featuredHeaderText: section,
    clusterHeaderText: { ...baseStyles.clusterHeaderText, ...label, textTransform: 'none', letterSpacing: 0, marginLeft: 16 },
    clusterSection: { ...baseStyles.clusterSection, marginHorizontal: -16 },
    clusterScrollContent: { ...baseStyles.clusterScrollContent, paddingHorizontal: 16 },
    clusterCardWrap: { width: Math.min(340, width - 48) },
    featuredScroll: { marginHorizontal: -16 },
    featuredScrollContent: { ...baseStyles.featuredScrollContent, paddingHorizontal: 16 },
    cardWrap: { marginBottom: 12 },
    centered: { ...baseStyles.centered, paddingHorizontal: 20, gap: 8 },
    emptyState: { ...baseStyles.emptyState, paddingHorizontal: 12, paddingVertical: 32, gap: 12 },
    emptyText: { ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink, textAlign: 'center', marginBottom: 0 },
    emptySubText: { ...body, textAlign: 'center', marginBottom: 8, maxWidth: 300 },
    emptyButton: action,
    emptyButtonText: actionText,
    errorTitle: { ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink, textAlign: 'center', marginBottom: 8 },
    errorMessage: { ...body, textAlign: 'center', marginBottom: 16 },
    retryButton: action,
    retryButtonText: actionText,
    feedback: { ...baseStyles.feedback, backgroundColor: AfterglowColors.white, marginHorizontal: 16, borderWidth: 1, borderColor: AfterglowColors.subtleLine },
    feedbackText: { ...baseStyles.feedbackText, ...body },
    feedbackActionText: { ...actionText, color: AfterglowColors.clay },
  });
}
