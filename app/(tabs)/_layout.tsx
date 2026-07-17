import { Tabs, router } from 'expo-router';
import { View, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { Image } from 'expo-image';
import { supabase } from '../../lib/supabase';
import { UNREAD_CHATS_KEY } from '../../constants/QueryKeys';
import { authedDest } from '../../lib/authRouting';
import { fetchNeedsPhoneMigration } from '../../lib/authGate';
import { getAuthProfile } from '../../hooks/useProfile';
import { withTimeout } from '../../lib/withTimeout';
import { YOURS_PAGE_ENABLED } from '../../constants/FeatureFlags';
import SunriseIcon from '../../components/yours/icons/SunriseIcon';
import { getRequestsSeenAt, REQUESTS_BADGE_KEY } from '../../lib/yours/requestsSeen';
import { SCENE_STAGE, getSeenSceneStage, SCENE_BADGE_KEY } from '../../lib/sceneStage';

function PostTabIcon() {
  return (
    <View style={styles.postButton}>
      <Ionicons name="add" size={28} color={Colors.white} />
    </View>
  );
}

async function fetchPendingRequestsCount(): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const { data, error } = await supabase.rpc('get_incoming_people_requests', { p_user_id: user.id });
  if (error || !Array.isArray(data)) return 0;
  // Only count requests newer than the last time the user looked, so the badge
  // clears on open and re-shows only for genuinely new requests.
  const seen = await getRequestsSeenAt();
  return data.filter((r: { requested_at?: string }) => {
    const t = Date.parse(r?.requested_at ?? '');
    return Number.isFinite(t) && t > seen;
  }).length;
}

async function fetchHasPendingInvites(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { count } = await supabase
    .from('plan_invites')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', user.id)
    .eq('status', 'pending');
  return (count ?? 0) > 0;
}

async function fetchUnreadChatCount(): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  // Only count unread message notifications for events the user is
  // currently a joined member of. Stale notifications from events the
  // user left (or chats that haven't opened yet) were producing a
  // phantom badge with no chat to show.
  const [{ data: notifs }, { data: memberships }] = await Promise.all([
    supabase
      .from('app_notifications')
      .select('event_id')
      .eq('user_id', user.id)
      .eq('type', 'new_message')
      .eq('status', 'unread'),
    supabase
      .from('event_members')
      .select('event_id')
      .eq('user_id', user.id)
      .eq('status', 'joined'),
  ]);

  const joinedEvents = new Set((memberships ?? []).map((r: any) => r.event_id));
  const unreadChats = new Set(
    (notifs ?? [])
      .map((r: any) => r.event_id)
      .filter((eid: string) => joinedEvents.has(eid)),
  );
  return unreadChats.size;
}

export default function TabLayout() {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const isAndroid = Platform.OS === 'android';
  const androidBottomInset = Math.max(insets.bottom, 12);
  const tabBarHeight = isAndroid ? 64 + androidBottomInset : 84;
  const tabBarPaddingBottom = isAndroid ? androidBottomInset : 28;

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        setUserId(session?.user?.id ?? null);
      })
      // A residual ProcessLockAcquireTimeoutError must not become an unhandled
      // rejection; onAuthStateChange below re-sets userId regardless.
      .catch(() => {});
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Onboarding guard: bounces incomplete users out of tabs. The auth-state
  // listener in app/_layout.tsx handles this on session changes, but stale
  // navigation history can land an incomplete user here without an auth
  // event firing (e.g., router.back() escaping the onboarding stack).
  // Reads through the React Query cache (seeded by checkAuth) so the cold
  // start doesn't fire two identical profile selects.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Bounded so a stale/expired token or slow network can't hang the
      // tab mount. On timeout we simply don't run this secondary guard —
      // root checkAuth / the auth listener own primary routing.
      const { data: { user } } = await withTimeout(
        supabase.auth.getUser(),
        4000,
        { data: { user: null } } as any,
      );
      if (!user || cancelled) return;
      const [profile, needsPhone] = await Promise.all([
        withTimeout(getAuthProfile(queryClient, user.id), 4000, null),
        fetchNeedsPhoneMigration(),
      ]);
      if (!profile || cancelled) return;
      const dest = authedDest({
        onboarding_status: profile?.onboarding_status ?? null,
        referral_source: profile?.referral_source ?? null,
        needs_phone_migration: needsPhone,
      });
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
  }, [queryClient]);

  const { data: unreadChats = 0 } = useQuery({
    queryKey: UNREAD_CHATS_KEY,
    queryFn: fetchUnreadChatCount,
    enabled: !!userId,
    // Tab-bar badge poll runs for the whole session. Slowed from 30s to
    // 60s to cut steady background DB/network load (incident 2026-05-18);
    // opening Chats still invalidates this key for an immediate update.
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: hasPendingInvites = false } = useQuery({
    queryKey: ['pending-invites-badge'],
    queryFn: fetchHasPendingInvites,
    enabled: !!userId,
    // Low-churn signal; slowed 60s -> 120s to reduce background load.
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  // Pending people-requests count (Yours rebuild only). Drives the warm gold
  // count badge on the Yours tab; cleared on open via markRequestsSeen.
  const { data: pendingRequests = 0 } = useQuery({
    queryKey: REQUESTS_BADGE_KEY,
    queryFn: fetchPendingRequestsCount,
    enabled: !!userId && YOURS_PAGE_ENABLED,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Scene stage dot: shows when a new coming-soon stage lands via OTA,
  // clears on the first Scene open (stamped by ScenePage's focus effect,
  // which invalidates this key). Local-only, so no userId gate or poll.
  const { data: sceneStageUnseen = false } = useQuery({
    queryKey: SCENE_BADGE_KEY,
    queryFn: async () => (await getSeenSceneStage()) < SCENE_STAGE,
    staleTime: Infinity,
  });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        lazy: true,
        freezeOnBlur: true,
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
        options={{
          title: 'Post',
          tabBarLabel: '',
          tabBarIcon: () => <PostTabIcon />,
        }}
      />
      <Tabs.Screen
        name="chats/index"
        options={{
          title: 'Chats',
          tabBarLabel: 'Chats',
          tabBarIcon: ({ color }) => <Ionicons name="chatbubble-outline" size={24} color={color} />,
          tabBarBadge: unreadChats > 0 ? (unreadChats > 9 ? '9+' : unreadChats) : undefined,
          tabBarBadgeStyle: { backgroundColor: '#B5522E' },
        }}
      />
      <Tabs.Screen
        name="friends/index"
        options={{
          title: 'Your People',
          tabBarLabel: 'Yours',
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
