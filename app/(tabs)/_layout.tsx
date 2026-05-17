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
import { getAuthProfile } from '../../hooks/useProfile';

function PostTabIcon() {
  return (
    <View style={styles.postButton}>
      <Ionicons name="add" size={28} color={Colors.white} />
    </View>
  );
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
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
    });
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const profile = await getAuthProfile(queryClient, user.id);
      if (cancelled) return;
      const dest = authedDest({
        onboarding_status: profile?.onboarding_status ?? null,
        referral_source: profile?.referral_source ?? null,
        auth_phone: user.phone ?? null,
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
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { data: hasPendingInvites = false } = useQuery({
    queryKey: ['pending-invites-badge'],
    queryFn: fetchHasPendingInvites,
    enabled: !!userId,
    staleTime: 30_000,
    refetchInterval: 60_000,
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
          tabBarIcon: ({ color }) => <Ionicons name="compass-outline" size={26} color={color} />,
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
          tabBarIcon: ({ color }) => (
            <View>
              <Ionicons name="people-outline" size={24} color={color} />
              {hasPendingInvites && <View style={styles.inviteDot} />}
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
    </Tabs>
  );
}

const styles = StyleSheet.create({
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
