import { Tabs, router, usePathname } from 'expo-router';
import { View, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import Colors from '../../constants/Colors';
import {CreatorActionFill} from '../../components/creator/CreatorActionFill';
import { Fonts, FontSizes } from '../../constants/Typography';
import { Image } from 'expo-image';
import { supabase } from '../../lib/supabase';
import { useTabBadgeData } from '../../hooks/useTabBadgeData';
import { authedDest } from '../../lib/authRouting';
import { fetchNeedsPhoneMigration } from '../../lib/authGate';
import { getAuthProfile } from '../../hooks/useProfile';
import { withTimeout } from '../../lib/withTimeout';
import { YOURS_PAGE_ENABLED } from '../../constants/FeatureFlags';
import SunriseIcon from '../../components/yours/icons/SunriseIcon';
import { SCENE_STAGE, getSeenSceneStage, SCENE_BADGE_KEY } from '../../lib/sceneStage';
import { TermsReacceptance } from '../../components/legal/TermsReacceptance';
import CreateMenuSheet, { type CreationKind } from '../../components/create/CreateMenuSheet';
import { getOrder } from '../../lib/ticketing';
import { getVerificationDestination, approveVerificationEntry } from '../../lib/navState';
import {
  clearPendingDestination,
  peekPendingCheckout,
  consumePendingDestination,
} from '../../lib/pendingLink';

function PostTabIcon() {
  return (
    <View style={styles.postButton}>
      <CreatorActionFill />
      <Ionicons name="add" size={28} color={Colors.white} />
    </View>
  );
}

export default function TabLayout() {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [verificationGateRevision, setVerificationGateRevision] = useState(0);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => { setCreateMenuOpen(false); }, [pathname, userId]);
  const selectCreation = (kind: CreationKind) => {
    setCreateMenuOpen(false);
    if (kind === 'plan') router.navigate('/(tabs)/post' as never);
    else router.push({ pathname: '/creator/start', params: { kind } } as never);
  };

  // Audit findings 2 and 5, consumed HERE because reaching the tabs is the
  // proof that the person is fully inside the app: past the auth gate, the
  // phone-migration gate and onboarding. So resuming a link can never
  // bypass a gate, and it survives the signed-out bounce (and the trip out
  // to Stripe) that used to destroy it.
  useEffect(() => {
    // The verified-entry handoff has one root-owned consumer, after its
    // existing ban/profile/phone checks. Do not race that checkout-first pass.
    if (getVerificationDestination()) return;
    let cancelled = false;
    (async () => {
      // a finished checkout outranks a saved link: they just paid
      const orderId = await peekPendingCheckout();
      if (cancelled) return;
      if (orderId) {
        const pendingOrder = await getOrder(orderId).catch(() => null);
        if (cancelled) return;
        if (pendingOrder && pendingOrder.status !== 'pending') {
          await clearPendingDestination(() => !cancelled);
          if (cancelled) return;
          router.replace(`/tickets/order/${orderId}` as never);
          return;
        }
      }
      const href = await consumePendingDestination(() => !cancelled);
      if (cancelled || !href) return;
      router.push(href as never);
    })();
    return () => { cancelled = true; };
  }, []);
  const insets = useSafeAreaInsets();
  const isAndroid = Platform.OS === 'android';
  const androidBottomInset = Math.max(insets.bottom, 12);
  const tabBarHeight = isAndroid ? 64 + androidBottomInset : 84;
  const tabBarPaddingBottom = isAndroid ? androidBottomInset : 28;

  useEffect(() => {
    let active = true;
    let observedAuthEvent = false;
    // Subscribe before reading. An initial session snapshot must never replace
    // a newer sign-in/sign-out event or reset that account's open Create menu.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      observedAuthEvent = true;
      setUserId(session?.user?.id ?? null);
      const visit = getVerificationDestination();
      if (session?.user && visit && !visit.entryApproved) {
        // A transient gate timeout keeps the link buffered. A recovered auth
        // event retries this visit's gate without changing legacy tab routing.
        setVerificationGateRevision((revision) => revision + 1);
      }
    });
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (active && !observedAuthEvent) setUserId(session?.user?.id ?? null);
      })
      // A residual ProcessLockAcquireTimeoutError must not become an unhandled
      // rejection; the listener can still supply a later session.
      .catch(() => {});
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  // Onboarding guard: bounces incomplete users out of tabs. The auth-state
  // listener in app/_layout.tsx handles this on session changes, but stale
  // navigation history can land an incomplete user here without an auth
  // event firing (e.g., router.back() escaping the onboarding stack).
  // Reads through the React Query cache (seeded by checkAuth) so the cold
  // start doesn't fire two identical profile selects.
  useEffect(() => {
    let cancelled = false;
    const verificationVisit = getVerificationDestination();
    const isCurrent = () => !cancelled && (!verificationVisit || getVerificationDestination() === verificationVisit);
    (async () => {
      // Bounded so a stale/expired token or slow network can't hang the
      // tab mount. On timeout we simply don't run this secondary guard —
      // root checkAuth / the auth listener own primary routing.
      const { data: { user } } = await withTimeout(
        supabase.auth.getUser(),
        4000,
        { data: { user: null } } as any,
      );
      if (!user || !isCurrent()) return;
      const [profile, needsPhone] = await Promise.all([
        withTimeout(getAuthProfile(queryClient, user.id), 4000, null),
        fetchNeedsPhoneMigration(),
      ]);
      if (!profile || !isCurrent()) return;
      const dest = authedDest({
        onboarding_status: profile?.onboarding_status ?? null,
        referral_source: profile?.referral_source ?? null,
        needs_phone_migration: needsPhone,
      });
      if (dest === '/(tabs)/plans') {
        approveVerificationEntry(verificationVisit, user.id);
      }
      // Phone-gate enforcement belongs to app launch (checkAuth) and a
      // genuine fresh login (root listener), NOT a tab-mount guard that
      // re-runs whenever (tabs) remounts (foreground, freezeOnBlur thaw,
      // nav reset). Bouncing to /migration-gate here was throwing
      // actively-using, already-past-the-gate users back mid-session.
      // This guard only exists to catch onboarding escapes.
      if (dest !== '/(tabs)/plans' && dest !== '/migration-gate') {
        console.log('[tabs_guard] bouncing to', dest);
        router.replace(dest as never);
      }
    })();
    return () => { cancelled = true; };
  }, [queryClient, verificationGateRevision]);

  const { unreadChats, hasPendingInvites, pendingRequests } = useTabBadgeData();

  // Scene stage dot: shows when a new coming-soon stage lands via OTA,
  // clears on the first Scene open (stamped by ScenePage's focus effect,
  // which invalidates this key). Local-only, so no userId gate or poll.
  const { data: sceneStageUnseen = false } = useQuery({
    queryKey: SCENE_BADGE_KEY,
    queryFn: async () => (await getSeenSceneStage()) < SCENE_STAGE,
    staleTime: Infinity,
  });

  return (
    <>
    {/* ToS reacceptance interstitial (proposal 49, legal v4.0): dormant
        until the status RPC exists; shows only on a confirmed server
        answer, so an offline open is never blocked. */}
    <TermsReacceptance enabled={!!userId} />
    {/* Hidden routes remain navigable but are not visible tabs. Explicit labels
        keep iOS from announcing those routes in the five-tab count. */}
    <Tabs
      // Profile and conversations are hidden tab routes. Back must return to
      // the screen that opened them, including its existing conversation ID.
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        lazy: true,
        // Keep inactive screens mounted without suspending the tab tree.
        // Suspense freezing reproduced a persistent layout/retry loop on iOS.
        freezeOnBlur: false,
        tabBarActiveTintColor: '#2C1810',
        tabBarInactiveTintColor: '#A09385',
        tabBarStyle: {
          backgroundColor: Colors.parchment,
          borderTopWidth: 0.5,
          borderTopColor: '#E5DDD1',
          height: tabBarHeight,
          paddingBottom: tabBarPaddingBottom,
          paddingTop: 8,
        },
        tabBarVariant: 'uikit',
        tabBarLabelStyle: {
          fontFamily: Fonts.sansMedium,
          fontSize: FontSizes.caption,
        },
      }}
    >
      <Tabs.Screen
        name="plans/index"
        options={{
          title: 'Plans',
          tabBarLabel: 'Plans',
          tabBarAccessibilityLabel: Platform.OS === 'ios' ? 'Plans, tab, 1 of 5' : 'Plans',
          tabBarIcon: ({ color }) => (
            <Image
              source={require('../../assets/wave-icon.png')}
              style={{ width: 32, height: 18, opacity: 0.7 }}
              contentFit="contain"
              tintColor={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="explore/index"
        options={{
          title: 'Scene',
          tabBarLabel: 'Scene',
          tabBarAccessibilityLabel: Platform.OS === 'ios' ? 'Scene, tab, 2 of 5' : 'Scene',
          tabBarIcon: ({ color }) => (
            <View>
              <Ionicons name="compass-outline" size={26} color={color} />
              {sceneStageUnseen && <View style={styles.sceneStageDot} />}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="post/index"
        listeners={{ tabPress: event => { event.preventDefault(); setCreateMenuOpen(true); } }}
        options={{
          title: 'Create',
          tabBarLabel: '',
          tabBarAccessibilityLabel: Platform.OS === 'ios' ? 'Create, tab, 3 of 5' : 'Create',
          tabBarIcon: () => <PostTabIcon />,
        }}
      />
      <Tabs.Screen
        name="chats/index"
        options={{
          title: 'Chats',
          tabBarLabel: 'Chats',
          tabBarAccessibilityLabel: Platform.OS === 'ios' ? 'Chats, tab, 4 of 5' : 'Chats',
          tabBarIcon: ({ color }) => <Ionicons name="chatbubble-outline" size={24} color={color} />,
          tabBarBadge: unreadChats > 0 ? (unreadChats > 9 ? '9+' : unreadChats) : undefined,
          tabBarBadgeStyle: { backgroundColor: '#B5522E' },
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Your People',
          tabBarLabel: 'Yours',
          tabBarAccessibilityLabel: Platform.OS === 'ios' ? 'Yours, tab, 5 of 5' : 'Yours',
          // Warm gold count of people waiting to be added (a "loop", not an
          // alarm: gold, never red). Clears on open via markRequestsSeen.
          tabBarBadge:
            YOURS_PAGE_ENABLED && pendingRequests > 0
              ? (pendingRequests > 9 ? '9+' : pendingRequests)
              : undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.goldAccent, color: Colors.asphalt },
          tabBarIcon: ({ color, focused }) => (
            <View>
              {YOURS_PAGE_ENABLED ? (
                // Sunrise gets its own color scheme (terracotta active /
                // iconMuted inactive) per spec, overriding the default tab
                // tints — this is the "home" tab and reads as warmer.
                <SunriseIcon
                  size={26}
                  color={focused ? Colors.terracotta : Colors.iconMuted}
                />
              ) : (
                <Ionicons name="people-outline" size={24} color={color} />
              )}
              {/* Invite dot only when the requests badge is not already showing,
                  so the two indicators never stack. */}
              {hasPendingInvites && pendingRequests === 0 && <View style={styles.inviteDot} />}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          href: null,
          tabBarItemStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="chats/[id]"
        options={{ href: null, tabBarStyle: { display: 'none' } }}
      />
      <Tabs.Screen
        name="chats/circle/[id]"
        options={{ href: null, tabBarStyle: { display: 'none' } }}
      />
    </Tabs>
    <CreateMenuSheet key={`${userId ?? 'signed-out'}:${pathname}`} visible={createMenuOpen} onClose={() => setCreateMenuOpen(false)} onSelect={selectCreation} />
    </>
  );
}

const styles = StyleSheet.create({
  // Same anatomy as inviteDot below: the house tab-corner notification dot
  // (CLAUDE.md: badge dots are the primary accent).
  sceneStageDot: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.terracotta,
  },
  inviteDot: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.terracotta,
  },
  postButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
    overflow: 'hidden',
    shadowColor: Colors.asphalt,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
});
